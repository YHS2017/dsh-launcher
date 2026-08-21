/** 连续崩溃达到此次数后停止自动重启，转为向用户报错。 */
export const MAX_RESTART_ATTEMPTS = 3

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30000

/**
 * 第 attempt 次重启前的等待时长。
 * 指数退避避免在 dsh 持续启动失败时形成高频重启循环。
 * @param attempt - 第几次重启，从 1 起
 */
export function backoffDelay(attempt: number): number {
  const normalized = attempt < 1 ? 1 : attempt
  return Math.min(BASE_DELAY_MS * 2 ** (normalized - 1), MAX_DELAY_MS)
}
