import { join } from 'node:path'
import { resolveRuntime, type RuntimeChoice } from '../main/core/runtime-resolver.ts'
import type { LauncherSettings } from '../main/core/settings-schema.ts'
import { DSH_PACKAGE_SUBPATH, type LauncherPaths } from '../main/paths.ts'

export interface CliTarget {
  nodeExe: string
  dshBin: string
  choice: RuntimeChoice
  env: NodeJS.ProcessEnv
}

export interface ResolveCliTargetInput {
  paths: LauncherPaths
  settings: LauncherSettings
  /** 当前 shell 的环境变量。 */
  baseEnv: NodeJS.ProcessEnv
  readVersion: (dshRoot: string) => string | undefined
}

/**
 * 决定命令行入口跑哪份 dsh、带什么环境变量。
 *
 * 版本选择与启动器窗口完全同一套规则（resolveRuntime：更新副本优先，读不出版本
 * 才回落内置），否则会出现窗口里是一个版本、命令行是另一个版本的分裂——
 * 用户在设置里点了更新，命令行必须跟着变。
 *
 * 环境变量与窗口有一处刻意的不同：窗口无条件按设置覆盖 DSH_HOME 与遥测开关，
 * 而命令行里用户显式设置的环境变量优先。`DSH_HOME=x dsh …` 这种一次性覆写
 * 是命令行的基本惯例，被启动器设置静默吃掉会让人摸不着头脑。
 *
 * @throws 内置副本也不可用时抛错（安装已损坏）。
 */
export function resolveCliTarget(input: ResolveCliTargetInput): CliTarget {
  const { paths, settings } = input
  const choice = resolveRuntime({
    bundledDshRoot: paths.bundledDshRoot,
    updatedDshRoot: settings.activeRuntime === null
      ? null
      : join(paths.runtimesDir, settings.activeRuntime, DSH_PACKAGE_SUBPATH),
    readVersion: input.readVersion,
  })

  const env: NodeJS.ProcessEnv = { ...input.baseEnv }
  if (settings.dshHome !== null && env.DSH_HOME === undefined) env.DSH_HOME = settings.dshHome
  if (settings.telemetryDisabled && env.DSH_TELEMETRY_DISABLED === undefined) env.DSH_TELEMETRY_DISABLED = '1'

  return { nodeExe: paths.nodeExe, dshBin: choice.dshBin, choice, env }
}
