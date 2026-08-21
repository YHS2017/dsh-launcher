import { describe, expect, it } from 'vitest'
import { resolvePaths } from '../../src/main/paths.ts'

// 用 String.raw 写 Windows 路径，避免反斜杠被当成字符串转义。
const USER_DATA = String.raw`C:\data`
const RESOURCES = String.raw`C:\app\resources`

describe('resolvePaths', () => {
  const paths = resolvePaths({ userData: USER_DATA, resources: RESOURCES })

  it('设置文件位于用户数据目录下', () => {
    expect(paths.settingsFile).toBe(String.raw`C:\data\config.json`)
  })

  it('日志与运行时目录位于用户数据目录下', () => {
    expect(paths.logsDir).toBe(String.raw`C:\data\logs`)
    expect(paths.runtimesDir).toBe(String.raw`C:\data\dsh-runtime`)
  })

  it('内置 dsh 副本指向 npm 安装后的包根目录', () => {
    expect(paths.bundledDshRoot).toBe(String.raw`C:\app\resources\dsh-bundled\node_modules\@deepseek-ai\dsh`)
  })

  it('内置 Node 与 npm 入口位于 resources/runtime/node 下', () => {
    expect(paths.nodeExe).toBe(String.raw`C:\app\resources\runtime\node\node.exe`)
    expect(paths.npmCli).toBe(String.raw`C:\app\resources\runtime\node\node_modules\npm\bin\npm-cli.js`)
  })

  it('暴露资源根目录', () => {
    expect(paths.resourcesRoot).toBe(RESOURCES)
  })

  it('窗口图标用 PNG，托盘图标用多尺寸 ICO', () => {
    expect(paths.windowIcon).toBe(String.raw`C:\app\resources\icon.png`)
    // 托盘只显示 16x16，必须给 ICO 让系统挑原生尺寸，否则缩放出锯齿。
    expect(paths.trayIcon).toBe(String.raw`C:\app\resources\icon.ico`)
  })
})
