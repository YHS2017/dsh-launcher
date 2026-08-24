import { Menu, type MenuItemConstructorOptions } from 'electron'

export interface AppMenuCallbacks {
  onSettings: () => void
  onCheckUpdate: () => void
  onLogs: () => void
  onRestartDsh: () => void
  onAbout: () => void
  onQuit: () => void
}

/**
 * 主窗口的菜单栏。
 *
 * 早先这里是 Menu.setApplicationMenu(null)——想法是主窗口整个交给 dsh 自己的
 * Web UI，不要两层菜单打架。代价是设置、日志、更新的唯一入口只剩托盘右键，
 * 而 Windows 11 默认把新出现的托盘图标折叠进溢出区，用户看不到那个图标，
 * 于是更新这类功能做了却等于没有。
 *
 * 菜单只挂在主窗口上（BrowserWindow.setMenu，Windows/Linux 限定），
 * 设置、日志、关于那几个子窗口仍然不带菜单栏。
 */
export function buildMainMenu(callbacks: AppMenuCallbacks): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '启动器',
      submenu: [
        { label: '设置…', accelerator: 'CmdOrCtrl+,', click: callbacks.onSettings },
        { label: '检查更新…', click: callbacks.onCheckUpdate },
        { label: '日志…', accelerator: 'CmdOrCtrl+L', click: callbacks.onLogs },
        { type: 'separator' },
        { label: '重启 dsh', click: callbacks.onRestartDsh },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: callbacks.onQuit },
      ],
    },
    {
      // 主窗口装的是网页，重载与缩放按网页习惯给齐。
      // 这些 role 的默认标签是英文，逐个覆写成中文。
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [{ label: '关于', click: callbacks.onAbout }],
    },
  ]
  return Menu.buildFromTemplate(template)
}
