interface ParsedVersion {
  release: number[]
  prerelease: (string | number)[]
}

/** 解析形如 `0.1.0-rc.8` 的版本号；无法解析时返回 undefined。 */
function parse(version: string): ParsedVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version.trim())
  if (match === null) return undefined
  const release = [Number(match[1]), Number(match[2]), Number(match[3])]
  const prerelease = match[4] === undefined
    ? []
    : match[4].split('.').map(part => (/^\d+$/.test(part) ? Number(part) : part))
  return { release, prerelease }
}

/** 比较两个预发布标识符序列，遵循 semver 规则。 */
function comparePrerelease(a: (string | number)[], b: (string | number)[]): number {
  // 空预发布序列代表正式版，正式版大于任何预发布版。
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i]
    const right = b[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue
    if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1
    if (typeof left === 'number') return -1
    if (typeof right === 'number') return 1
    return left < right ? -1 : 1
  }
  return 0
}

/**
 * candidate 是否比 current 更新。
 * 任一方无法解析时返回 false——宁可漏报更新，也不要据一个看不懂的版本号去替换可用的运行时。
 */
export function isNewer(candidate: string, current: string): boolean {
  const left = parse(candidate)
  const right = parse(current)
  if (left === undefined || right === undefined) return false
  for (let i = 0; i < 3; i += 1) {
    const a = left.release[i] ?? 0
    const b = right.release[i] ?? 0
    if (a !== b) return a > b
  }
  return comparePrerelease(left.prerelease, right.prerelease) > 0
}
