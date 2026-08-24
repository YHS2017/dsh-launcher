import { Menu, type MenuItemConstructorOptions } from 'electron'
import { type MenuSectionId } from '../ipc/channels.ts'

export interface AppMenuCallbacks {
  onSettings: () => void
  onCheckUpdate: () => void
  onLogs: () => void
  onRestartDsh: () => void
  onAbout: () => void
  onQuit: () => void
  onReload: () => void
  onZoomReset: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onToggleFullScreen: () => void
}

/**
 * 主窗口的菜单，按标题栏上的分区逐个构建。
 *
 * 一路的取舍记在这里，免得再绕回去：
 *
 * 最初是 Menu.setApplicationMenu(null)——主窗口整个交给 dsh 自己的 Web UI，
 * 不要两层菜单打架。代价是设置、日志、更新的唯一入口只剩托盘右键，
 * 而 Windows 11 默认把新出现的托盘图标折叠进溢出区，用户看不到那个图标，
 * 于是更新这类功能做了却等于没有。
 *
 * 接着加了原生菜单栏，入口有了，但它在窗口内额外占掉一行（约 26px），
 * 而这一行本该全给 dsh。现在改成菜单名画在自绘标题栏上，点击时 Menu.popup
 * 弹出真正的原生菜单：外观与行为仍是系统菜单，只是不再单独占窗口空间。
 *
 * 两个由此而来的约束：
 *
 * 一、不能用 role。role 作用于当前聚焦的 webContents，而弹出菜单时聚焦的是
 * 标题栏那个视图，不是装 dsh 页面的那个——「重新加载」会去刷新标题栏自己。
 * 所以视图类操作全部走显式回调，由主进程点名操作内容视图。
 *
 * 二、不设加速键。只有应用菜单的加速键会被注册，弹出菜单的不会，标上去就是骗人；
 * 而要让它们真生效就得在内容视图上拦 before-input-event——dsh 是终端式界面，
 * Ctrl+L、Ctrl+R 在它那里另有含义，抢过来会破坏上游的交互。
 */
export function buildSectionMenu(id: MenuSectionId, callbacks: AppMenuCallbacks): Menu {
  const sections: Record<MenuSectionId, MenuItemConstructorOptions[]> = {
    launcher: [
      { label: '设置…', click: callbacks.onSettings },
      { label: '检查更新…', click: callbacks.onCheckUpdate },
      { label: '日志…', click: callbacks.onLogs },
      { type: 'separator' },
      { label: '重启 dsh', click: callbacks.onRestartDsh },
      { type: 'separator' },
      { label: '退出', click: callbacks.onQuit },
    ],
    view: [
      { label: '重新加载', click: callbacks.onReload },
      { type: 'separator' },
      { label: '实际大小', click: callbacks.onZoomReset },
      { label: '放大', click: callbacks.onZoomIn },
      { label: '缩小', click: callbacks.onZoomOut },
      { type: 'separator' },
      { label: '全屏', click: callbacks.onToggleFullScreen },
    ],
    help: [{ label: '关于', click: callbacks.onAbout }],
  }
  return Menu.buildFromTemplate(sections[id])
}
