import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { backoffDelay, MAX_RESTART_ATTEMPTS } from '../core/backoff.ts'
import { parseReadyLine } from '../core/url-line-parser.ts'
import { probeUntilReady } from './readiness-probe.ts'

/** 本监督器固定以 stdio: ['ignore','pipe','pipe'] 启动，故 stdin 为 null、两个输出流可读。 */
type DshChild = ChildProcessByStdio<null, Readable, Readable>

export type SupervisorState = 'idle' | 'starting' | 'ready' | 'stopping' | 'crashed'

export interface DshSupervisorOptions {
  /** 内置 Node 可执行文件。 */
  nodeExe: string
  /** dsh 的 lib/bin.js 绝对路径。 */
  dshBin: string
  /** 监听端口；0 表示交由操作系统分配。 */
  port: number
  /** 自定义 DSH_HOME；null 表示不传，沿用上游默认。 */
  dshHome: string | null
  telemetryDisabled: boolean
  /** 等待就绪行的上限，默认 60 秒。 */
  readyTimeoutMs?: number
  /** 附加到子进程的环境变量，仅测试用。 */
  spawnEnv?: Record<string, string>
}

const DEFAULT_READY_TIMEOUT_MS = 60000
const STOP_GRACE_MS = 5000

/**
 * dsh 子进程的生命周期管理者。
 *
 * 就绪判定以 stdout 的就绪行为准——上游明确把该行设计为 supervisor 信号，
 * 且保证它在插件树挂载完成后才输出，比 HTTP 探测更早也更准。
 * HTTP 探测只在「用户指定了固定端口」且迟迟等不到就绪行时作为兜底：
 * 端口为 0 时端口由操作系统分配，不读就绪行就无从得知，也就无从探测。
 */
export class DshSupervisor extends EventEmitter {
  readonly #opts: DshSupervisorOptions
  #child: DshChild | undefined
  #state: SupervisorState = 'idle'
  #url: string | undefined
  #stdoutBuffer = ''
  #restartAttempts = 0
  #readyTimer: NodeJS.Timeout | undefined
  #restartTimer: NodeJS.Timeout | undefined
  /** 用户主动停止后置位，用于区分「崩溃」与「正常关停」。 */
  #stopping = false

  constructor(opts: DshSupervisorOptions) {
    super()
    this.#opts = opts
  }

  get state(): SupervisorState {
    return this.#state
  }

  get url(): string | undefined {
    return this.#url
  }

  #setState(next: SupervisorState): void {
    if (this.#state === next) return
    this.#state = next
    this.emit('state', next)
  }

  #buildArgs(): string[] {
    return [
      this.#opts.dshBin,
      '--profile', 'web',
      '--no-open',
      '--host', '127.0.0.1',
      '--port', String(this.#opts.port),
    ]
  }

  #buildEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ...this.#opts.spawnEnv }
    if (this.#opts.dshHome !== null) env.DSH_HOME = this.#opts.dshHome
    if (this.#opts.telemetryDisabled) env.DSH_TELEMETRY_DISABLED = '1'
    else delete env.DSH_TELEMETRY_DISABLED
    return env
  }

  start(): void {
    // 守卫的判据是「是否已有活跃子进程」，不能用状态判断：
    // 崩溃后等待重启期间状态同样是 starting，但此时并无子进程，
    // 用状态判断会让退避计时器到点后原地返回，重启永远不发生。
    if (this.#child !== undefined) return
    this.#stopping = false
    this.#url = undefined
    this.#stdoutBuffer = ''
    this.#setState('starting')

    const child: DshChild = spawn(this.#opts.nodeExe, this.#buildArgs(), {
      env: this.#buildEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.#child = child

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      this.emit('output', 'dsh-out', chunk)
      this.#consumeStdout(chunk)
    })
    child.stderr.on('data', (chunk: string) => {
      this.emit('output', 'dsh-err', chunk)
    })
    child.on('error', (error: Error) => {
      this.#fail(`dsh 启动失败：${error.message}`)
    })
    child.on('exit', (code, signal) => {
      this.#child = undefined
      this.#clearReadyTimer()
      if (this.#stopping) {
        this.#setState('idle')
        return
      }
      this.#handleUnexpectedExit(code, signal)
    })

    const timeout = this.#opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    this.#readyTimer = setTimeout(() => { void this.#onReadyTimeout(timeout) }, timeout)
  }

  /** 按行扫描 stdout，命中就绪行即宣告就绪。 */
  #consumeStdout(chunk: string): void {
    if (this.#url !== undefined) return
    this.#stdoutBuffer += chunk
    const lines = this.#stdoutBuffer.split('\n')
    this.#stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      const url = parseReadyLine(line)
      if (url === undefined) continue
      this.#markReady(url)
      return
    }
  }

  #markReady(url: string): void {
    this.#clearReadyTimer()
    this.#url = url
    this.#restartAttempts = 0
    this.#setState('ready')
    this.emit('ready', url)
  }

  /**
   * 就绪行迟迟不来。固定端口下还能靠 HTTP 探测兜底；
   * 端口为 0 时端口不可知，只能判定失败。
   */
  async #onReadyTimeout(timeout: number): Promise<void> {
    if (this.#url !== undefined || this.#stopping) return
    if (this.#opts.port > 0) {
      const fallbackUrl = `http://127.0.0.1:${String(this.#opts.port)}`
      const alive = await probeUntilReady(fallbackUrl, { timeoutMs: 3000, intervalMs: 300 })
      if (alive) {
        this.#markReady(fallbackUrl)
        return
      }
    }
    this.#fail(`等待 dsh 就绪超时（${String(timeout)} 毫秒内未收到就绪信号）`)
  }

  #handleUnexpectedExit(code: number | null, signal: NodeJS.Signals | null): void {
    const detail = code === null ? `信号 ${String(signal)}` : `退出码 ${String(code)}`
    // 从未就绪过就退出，属于启动失败，重试通常也不会好转。
    if (this.#url === undefined) {
      this.#fail(`dsh 启动失败：进程以${detail}退出`)
      return
    }
    this.#restartAttempts += 1
    if (this.#restartAttempts > MAX_RESTART_ATTEMPTS) {
      this.#fail(`dsh 连续 ${String(MAX_RESTART_ATTEMPTS)} 次崩溃后停止重启（最后一次${detail}）`)
      return
    }
    this.#url = undefined
    this.#setState('starting')
    const delay = backoffDelay(this.#restartAttempts)
    this.#restartTimer = setTimeout(() => {
      if (this.#stopping) return
      this.start()
    }, delay)
  }

  #fail(reason: string): void {
    this.#clearReadyTimer()
    this.#setState('crashed')
    this.emit('failed', reason)
  }

  #clearReadyTimer(): void {
    if (this.#readyTimer !== undefined) {
      clearTimeout(this.#readyTimer)
      this.#readyTimer = undefined
    }
  }

  /** 优雅关停：先送终止信号，超时未退再强制结束。 */
  async stop(): Promise<void> {
    this.#stopping = true
    this.#clearReadyTimer()
    if (this.#restartTimer !== undefined) {
      clearTimeout(this.#restartTimer)
      this.#restartTimer = undefined
    }
    const child = this.#child
    if (child === undefined) {
      this.#setState('idle')
      return
    }
    this.#setState('stopping')
    await new Promise<void>(resolve => {
      const forceTimer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, STOP_GRACE_MS)
      child.once('exit', () => {
        clearTimeout(forceTimer)
        resolve()
      })
      child.kill('SIGTERM')
    })
    this.#child = undefined
    this.#url = undefined
    this.#setState('idle')
  }

  /** 仅供测试：强制杀死当前子进程以触发崩溃重启路径。 */
  simulateCrashForTest(): void {
    this.#child?.kill('SIGKILL')
  }
}
