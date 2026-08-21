/**
 * 关闭主窗口时是否只隐藏而不退出。
 *
 * 抽成纯函数是因为这里有一个容易写错的交叉条件：
 * 用户从托盘菜单选「退出」时，窗口的 close 事件同样会触发，
 * 若只看 closeToTray 就会把真正的退出也拦下来，造成退不掉的应用。
 */
export function shouldHideOnClose(input: { closeToTray: boolean; quitting: boolean }): boolean {
  if (input.quitting) return false
  return input.closeToTray
}
