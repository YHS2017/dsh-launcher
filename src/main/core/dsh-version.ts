import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 读取某个 dsh 包根目录的版本号；不可用（不存在、损坏、缺入口）时返回 undefined。
 *
 * 判据是「lib/bin.js 存在且 package.json 可解析出 version」——这也是运行时解析器
 * 判断一份副本能不能用的唯一标准。主进程与命令行入口共用此函数，
 * 两边对"可用"的定义才不会漂移。
 */
export function readDshVersion(dshRoot: string): string | undefined {
  try {
    if (!existsSync(join(dshRoot, 'lib', 'bin.js'))) return undefined
    const manifest = JSON.parse(readFileSync(join(dshRoot, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}
