import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DshSupervisor, type SupervisorState } from '../../src/main/services/dsh-supervisor.ts'

const FAKE_DSH = fileURLToPath(new URL('./fake-dsh.mjs', import.meta.url))

function makeSupervisor(mode: string, overrides: Record<string, unknown> = {}): DshSupervisor {
  return new DshSupervisor({
    nodeExe: process.execPath,
    dshBin: FAKE_DSH,
    port: 0,
    dshHome: null,
    telemetryDisabled: false,
    readyTimeoutMs: 8000,
    spawnEnv: { FAKE_DSH_MODE: mode },
    ...overrides,
  })
}

describe('DshSupervisor', () => {
  it('正常启动后进入 ready 并给出回环 URL', async () => {
    const supervisor = makeSupervisor('ready')
    const url = await new Promise<string>((resolve, reject) => {
      supervisor.on('ready', resolve)
      supervisor.on('failed', reason => reject(new Error(reason)))
      supervisor.start()
    })
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(supervisor.state).toBe('ready')
    expect(supervisor.url).toBe(url)
    await supervisor.stop()
    expect(supervisor.state).toBe('idle')
  })

  it('状态依次经过 starting 与 ready', async () => {
    const supervisor = makeSupervisor('ready')
    const seen: SupervisorState[] = []
    supervisor.on('state', s => seen.push(s))
    await new Promise<void>((resolve, reject) => {
      supervisor.on('ready', () => resolve())
      supervisor.on('failed', reason => reject(new Error(reason)))
      supervisor.start()
    })
    expect(seen).toContain('starting')
    expect(seen).toContain('ready')
    await supervisor.stop()
  })

  it('子进程启动即失败时报 failed 而非无限重试', async () => {
    const supervisor = makeSupervisor('fail', { readyTimeoutMs: 3000 })
    const reason = await new Promise<string>(resolve => {
      supervisor.on('failed', resolve)
      supervisor.start()
    })
    expect(reason).toContain('启动失败')
    expect(supervisor.state).toBe('crashed')
  }, 40000)

  it('就绪后崩溃会自动重启并重新就绪', async () => {
    const supervisor = makeSupervisor('ready')
    await new Promise<void>((resolve, reject) => {
      supervisor.on('ready', () => resolve())
      supervisor.on('failed', reason => reject(new Error(reason)))
      supervisor.start()
    })
    const restarted = new Promise<string>(resolve => supervisor.once('ready', resolve))
    supervisor.simulateCrashForTest()
    const url = await restarted
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    await supervisor.stop()
  }, 40000)

  it('固定端口且始终等不到就绪行时，超时后判定失败', async () => {
    const supervisor = makeSupervisor('silent', { port: 3080, readyTimeoutMs: 600 })
    const reason = await new Promise<string>(resolve => {
      supervisor.on('failed', resolve)
      supervisor.start()
    })
    expect(reason).toContain('超时')
    await supervisor.stop()
  }, 40000)

  it('stop 后不再自动重启', async () => {
    const supervisor = makeSupervisor('ready')
    await new Promise<void>((resolve, reject) => {
      supervisor.on('ready', () => resolve())
      supervisor.on('failed', reason => reject(new Error(reason)))
      supervisor.start()
    })
    await supervisor.stop()
    let restarted = false
    supervisor.on('ready', () => { restarted = true })
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(restarted).toBe(false)
    expect(supervisor.state).toBe('idle')
  }, 40000)

  it('把子进程输出转发给监听者', async () => {
    const supervisor = makeSupervisor('ready')
    const chunks: string[] = []
    supervisor.on('output', (_source, text) => chunks.push(text))
    await new Promise<void>((resolve, reject) => {
      supervisor.on('ready', () => resolve())
      supervisor.on('failed', reason => reject(new Error(reason)))
      supervisor.start()
    })
    expect(chunks.join('')).toContain('dsh web:')
    await supervisor.stop()
  })
})
