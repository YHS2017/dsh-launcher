import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NpmUpdater, runtimeDirName } from '../../src/main/services/npm-updater.ts'
import { DSH_PACKAGE_SUBPATH } from '../../src/main/paths.ts'

let runtimesDir: string

const DIST_TAGS = { latest: '0.1.0-rc.7', next: '0.1.0-rc.8' }

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return (async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  })) as unknown as typeof fetch
}

/** 冒充 npm：在目标目录里造出一个形似真实安装结果的包。 */
function fakeNpmInstalling(version: string) {
  return async (_args: string[], cwd: string): Promise<void> => {
    const packageRoot = join(cwd, DSH_PACKAGE_SUBPATH)
    mkdirSync(join(packageRoot, 'lib'), { recursive: true })
    writeFileSync(join(packageRoot, 'lib', 'bin.js'), '// fake', 'utf8')
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }), 'utf8')
  }
}

beforeEach(() => {
  runtimesDir = mkdtempSync(join(tmpdir(), 'dshl-runtimes-'))
})

afterEach(() => {
  rmSync(runtimesDir, { recursive: true, force: true })
})

function makeUpdater(overrides: Record<string, unknown> = {}): NpmUpdater {
  return new NpmUpdater({
    runtimesDir,
    nodeExe: String.raw`C:\fake\node.exe`,
    npmCli: String.raw`C:\fake\npm-cli.js`,
    fetchFn: fakeFetch({ 'dist-tags': DIST_TAGS }),
    runNpm: fakeNpmInstalling('0.1.0-rc.8'),
    ...overrides,
  })
}

describe('runtimeDirName', () => {
  it('目录名由版本号推出', () => {
    expect(runtimeDirName('0.1.0-rc.8')).toBe('dsh-0.1.0-rc.8')
  })
})

describe('checkForUpdate', () => {
  it('稳定通道读取 latest 标签', async () => {
    const info = await makeUpdater().checkForUpdate('latest', '0.1.0-rc.6')
    expect(info.available).toBe('0.1.0-rc.7')
    expect(info.channel).toBe('latest')
    expect(info.hasUpdate).toBe(true)
  })

  it('预览通道读取 next 标签', async () => {
    const info = await makeUpdater().checkForUpdate('next', '0.1.0-rc.7')
    expect(info.available).toBe('0.1.0-rc.8')
    expect(info.hasUpdate).toBe(true)
  })

  it('已是最新时 hasUpdate 为 false', async () => {
    const info = await makeUpdater().checkForUpdate('latest', '0.1.0-rc.7')
    expect(info.hasUpdate).toBe(false)
  })

  it('当前版本比通道版本更新时也不算有更新', async () => {
    const info = await makeUpdater().checkForUpdate('latest', '0.1.0-rc.8')
    expect(info.hasUpdate).toBe(false)
  })

  it('registry 不可达时抛出可读错误', async () => {
    const updater = makeUpdater({ fetchFn: fakeFetch({}, false) })
    await expect(updater.checkForUpdate('latest', '0.1.0-rc.7')).rejects.toThrow(/无法查询/)
  })

  it('通道缺少对应标签时抛错', async () => {
    const updater = makeUpdater({ fetchFn: fakeFetch({ 'dist-tags': { latest: '0.1.0-rc.7' } }) })
    await expect(updater.checkForUpdate('next', '0.1.0-rc.7')).rejects.toThrow(/预览/)
  })
})

describe('install', () => {
  it('安装成功后返回运行时目录名，且入口文件就位', async () => {
    const dirName = await makeUpdater().install('0.1.0-rc.8')
    expect(dirName).toBe('dsh-0.1.0-rc.8')
    expect(existsSync(join(runtimesDir, dirName, DSH_PACKAGE_SUBPATH, 'lib', 'bin.js'))).toBe(true)
  })

  it('npm 失败时清理半成品目录并抛错', async () => {
    const updater = makeUpdater({
      runNpm: async () => { throw new Error('网络中断') },
    })
    await expect(updater.install('0.1.0-rc.8')).rejects.toThrow(/网络中断/)
    expect(existsSync(join(runtimesDir, 'dsh-0.1.0-rc.8'))).toBe(false)
  })

  it('npm 声称成功但入口缺失时同样判定失败并清理', async () => {
    const updater = makeUpdater({ runNpm: async () => { /* 什么也不装 */ } })
    await expect(updater.install('0.1.0-rc.8')).rejects.toThrow(/入口/)
    expect(existsSync(join(runtimesDir, 'dsh-0.1.0-rc.8'))).toBe(false)
  })

  it('同版本已安装过则直接复用，不重复下载', async () => {
    const updater = makeUpdater()
    await updater.install('0.1.0-rc.8')
    let called = false
    const again = makeUpdater({ runNpm: async () => { called = true } })
    const dirName = await again.install('0.1.0-rc.8')
    expect(dirName).toBe('dsh-0.1.0-rc.8')
    expect(called).toBe(false)
  })
})
