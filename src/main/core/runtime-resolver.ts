import { join } from 'node:path'

export interface RuntimeChoice {
  /** dsh 包根目录。 */
  dshRoot: string
  /** 实际要交给 Node 执行的入口。 */
  dshBin: string
  version: string
  source: 'bundled' | 'updated'
}

export interface ResolveRuntimeInput {
  bundledDshRoot: string
  /** 设置中指向的已更新副本；null 表示未启用更新副本。 */
  updatedDshRoot: string | null
  /** 读取某个 dsh 包根目录的版本号；读不到（不存在或损坏）返回 undefined。 */
  readVersion: (dshRoot: string) => string | undefined
}

/**
 * 决定本次启动使用哪一份 dsh。
 *
 * 更新副本优先，但只要它读不出版本就回落到内置副本——这是回滚链条的最后一环：
 * 即使更新写坏了目录，下次启动仍能用内置副本起来，用户不会被卡在启动失败。
 * 不比较版本高低，因为用户可能刻意停留在某个旧版本。
 *
 * @throws 内置副本也不可用时抛错，此时属于安装损坏，须让用户重装而非静默降级。
 */
export function resolveRuntime(input: ResolveRuntimeInput): RuntimeChoice {
  if (input.updatedDshRoot !== null) {
    const version = input.readVersion(input.updatedDshRoot)
    if (version !== undefined) {
      return {
        dshRoot: input.updatedDshRoot,
        dshBin: join(input.updatedDshRoot, 'lib', 'bin.js'),
        version,
        source: 'updated',
      }
    }
  }
  const bundledVersion = input.readVersion(input.bundledDshRoot)
  if (bundledVersion === undefined) {
    throw new Error(`内置 dsh 副本不可用：${input.bundledDshRoot}。安装可能已损坏，请重新安装 DSH启动器。`)
  }
  return {
    dshRoot: input.bundledDshRoot,
    dshBin: join(input.bundledDshRoot, 'lib', 'bin.js'),
    version: bundledVersion,
    source: 'bundled',
  }
}
