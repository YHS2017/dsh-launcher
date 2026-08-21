export interface ProbeOptions {
  timeoutMs: number
  intervalMs: number
  fetchFn?: typeof fetch
}

/**
 * 轮询直到目标地址有响应。
 *
 * 这是**兜底**手段，不是主判定：主判定是 dsh stdout 上的就绪行。
 * 任何 HTTP 响应都视为就绪——哪怕是 5xx，也说明端口已在监听，
 * 服务已经起来了，具体某个路径报错不属于「有没有起来」的范畴。
 */
export async function probeUntilReady(url: string, opts: ProbeOptions): Promise<boolean> {
  const fetchFn = opts.fetchFn ?? fetch
  const deadline = Date.now() + opts.timeoutMs
  for (;;) {
    try {
      await fetchFn(url, { method: 'GET' })
      return true
    } catch {
      if (Date.now() + opts.intervalMs >= deadline) return false
      await new Promise(resolve => setTimeout(resolve, opts.intervalMs))
    }
  }
}
