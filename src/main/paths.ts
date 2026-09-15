import { join } from 'node:path'

/** 外壳用到的全部路径，集中在此推导，避免各处散落字符串拼接。 */
export interface LauncherPaths {
  /** 外壳自身的数据根目录。 */
  userData: string
  /** 外壳设置文件。 */
  settingsFile: string
  /** 日志目录。 */
  logsDir: string
  /** 更新下来的各版本 dsh 存放目录。 */
  runtimesDir: string
  /** 内置 dsh 副本的包根目录（只读）。 */
  bundledDshRoot: string
  /** 内置 Node 可执行文件。 */
  nodeExe: string
  /** 内置 npm 的 CLI 入口，更新时用它安装依赖树。 */
  npmCli: string
  /** 打包资源根目录，托盘与安装包图标从此取。 */
  resourcesRoot: string
  /** 窗口图标（PNG）。 */
  windowIcon: string
  /**
   * 托盘图标（多尺寸 ICO）。
   * 托盘实际只显示 16x16（高 DPI 下 20/24），给单张大 PNG 会被缩 16 倍而糊成锯齿；
   * ICO 里备了各号原生尺寸，系统直接挑最接近的一张，不做缩放。
   */
  trayIcon: string
}

/** npm 安装 @deepseek-ai/dsh 后，包根目录相对于安装前缀的位置。 */
export const DSH_PACKAGE_SUBPATH = join('node_modules', '@deepseek-ai', 'dsh')

/**
 * 外壳用户数据目录在 %APPDATA% 下的目录名。
 *
 * Electron 侧由 app.getPath('userData') 按 package.json 的 name 自动推出，
 * 而命令行入口（bin/dsh-cli.mjs）不经过 Electron，得自己拼这个路径。
 * 两边必须是同一个名字，否则命令行会读到一份空设置、永远跑内置版本——
 * 有单元测试断言它与 package.json 的 name 相等，改名时会被拦下。
 */
export const USER_DATA_DIR_NAME = 'dsh-launcher'

export function resolvePaths(input: { userData: string; resources: string }): LauncherPaths {
  const nodeRoot = join(input.resources, 'runtime', 'node')
  return {
    userData: input.userData,
    settingsFile: join(input.userData, 'config.json'),
    logsDir: join(input.userData, 'logs'),
    runtimesDir: join(input.userData, 'dsh-runtime'),
    bundledDshRoot: join(input.resources, 'dsh-bundled', DSH_PACKAGE_SUBPATH),
    nodeExe: join(nodeRoot, 'node.exe'),
    npmCli: join(nodeRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resourcesRoot: input.resources,
    windowIcon: join(input.resources, 'icon.png'),
    trayIcon: join(input.resources, 'icon.ico'),
  }
}
