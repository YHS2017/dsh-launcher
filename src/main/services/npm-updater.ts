import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isNewer } from '../core/version-compare.ts'
import { DSH_PACKAGE_SUBPATH } from '../paths.ts'

const execFileAsync = promisify(execFile)

/** scoped 包名在 registry 上的转义形式。 */
const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh'
const PACKAGE_SPEC = '@deepseek-ai/dsh'

export interface UpdateInfo {
  channel: 'latest' | 'next'
  current: string
  available: string
  hasUpdate: boolean
}

export type RunNpm = (args: string[], cwd: string) => Promise<void>

export interface NpmUpdaterOptions {
  /** 各版本运行时的存放根目录。 */
  runtimesDir: string
  nodeExe: string
  npmCli: string
  registryUrl?: string
  fetchFn?: typeof fetch
  /** 注入点，便于测试；缺省时用内置 Node 执行内置 npm。 */
  runNpm?: RunNpm
}

/** 某版本对应的运行时目录名。 */
export function runtimeDirName(version: string): string {
  return `dsh-${version}`
}

const CHANNEL_LABEL: Record<'latest' | 'next', string> = {
  latest: '稳定',
  next: '预览',
}

export class NpmUpdater {
  readonly #opts: NpmUpdaterOptions

  constructor(opts: NpmUpdaterOptions) {
    this.#opts = opts
  }

  /** 查询指定通道的最新版本，并与当前版本比较。 */
  async checkForUpdate(channel: 'latest' | 'next', currentVersion: string): Promise<UpdateInfo> {
    const fetchFn = this.#opts.fetchFn ?? fetch
    const url = this.#opts.registryUrl ?? DEFAULT_REGISTRY_URL
    let payload: unknown
    try {
      const response = await fetchFn(url, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      payload = await response.json()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`无法查询更新：${reason}`)
    }
    const tags = (payload as { 'dist-tags'?: Record<string, unknown> })['dist-tags']
    const available = tags?.[channel]
    if (typeof available !== 'string') {
      throw new Error(`${CHANNEL_LABEL[channel]}通道当前没有可用版本`)
    }
    return {
      channel,
      current: currentVersion,
      available,
      hasUpdate: isNewer(available, currentVersion),
    }
  }

  /**
   * 把指定版本装进 runtimesDir。
   *
   * 安装失败——包括 npm 报错，以及 npm 声称成功但入口文件不存在——
   * 一律删除该目录再抛错。留下半成品会让下次启动的运行时择一面对一个
   * 似有实无的候选，那是更难排查的故障。
   *
   * @returns runtimesDir 下的目录名
   */
  async install(version: string): Promise<string> {
    const dirName = runtimeDirName(version)
    const targetDir = join(this.#opts.runtimesDir, dirName)
    const entry = join(targetDir, DSH_PACKAGE_SUBPATH, 'lib', 'bin.js')

    if (existsSync(entry) && this.#installedVersion(targetDir) === version) return dirName

    rmSync(targetDir, { recursive: true, force: true })
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(
      join(targetDir, 'package.json'),
      `${JSON.stringify({ name: dirName, version: '0.0.0', private: true }, null, 2)}\n`,
      'utf8',
    )

    try {
      const runNpm = this.#opts.runNpm ?? this.#defaultRunNpm.bind(this)
      await runNpm(
        ['install', `${PACKAGE_SPEC}@${version}`, '--omit=dev', '--no-audit', '--no-fund'],
        targetDir,
      )
      if (!existsSync(entry)) {
        throw new Error(`安装后未找到 dsh 入口文件：${entry}`)
      }
    } catch (error) {
      rmSync(targetDir, { recursive: true, force: true })
      throw error instanceof Error ? error : new Error(String(error))
    }
    return dirName
  }

  #installedVersion(targetDir: string): string | undefined {
    try {
      const manifest = JSON.parse(
        readFileSync(join(targetDir, DSH_PACKAGE_SUBPATH, 'package.json'), 'utf8'),
      ) as { version?: unknown }
      return typeof manifest.version === 'string' ? manifest.version : undefined
    } catch {
      return undefined
    }
  }

  /** 用内置 Node 执行内置 npm，避免依赖用户机器上是否装了 Node。 */
  async #defaultRunNpm(args: string[], cwd: string): Promise<void> {
    await execFileAsync(this.#opts.nodeExe, [this.#opts.npmCli, ...args], {
      cwd,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    })
  }
}
