/** 上游就绪行前缀，见 packages/bundle/web-app/src/index.ts 的 announceReady。 */
const READY_PREFIX = 'dsh web:'

/** 与上游 isLoopbackHostname 保持一致的回环判定。 */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * 从 dsh 的一行 stdout 中识别就绪信号并取出可加载的回环 URL。
 *
 * 只接受回环地址：该行在 LAN 可达时还会附带一个局域网地址，
 * 而外壳必须加载回环地址——上游的 /api 信任围栏无条件放行回环，
 * 加载 LAN 地址则会落入需要额外授信的路径。
 *
 * @param line - dsh stdout 的一行（可含前后空白）
 * @returns 命中时返回回环 URL，否则 undefined
 */
export function parseReadyLine(line: string): string | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith(READY_PREFIX)) return undefined
  const rest = trimmed.slice(READY_PREFIX.length).trim()
  const token = rest.split(/\s+/)[0]
  if (token === undefined || !token.startsWith('http://')) return undefined
  let parsed: URL
  try {
    parsed = new URL(token)
  } catch {
    return undefined
  }
  if (!isLoopbackHostname(parsed.hostname)) return undefined
  return token
}
