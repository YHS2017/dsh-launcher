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
}

/** npm 安装 @deepseek-ai/dsh 后，包根目录相对于安装前缀的位置。 */
export const DSH_PACKAGE_SUBPATH = join('node_modules', '@deepseek-ai', 'dsh')

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
  }
}
