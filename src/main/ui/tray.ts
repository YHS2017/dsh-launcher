import { Menu, Tray, nativeImage } from 'electron'

export interface TrayCallbacks {
  iconPath: string
  onShow: () => void
  onQuit: () => void
}

/** 建立托盘图标与右键菜单。退出应用的唯一入口在此。 */
export function createTray(callbacks: TrayCallbacks): Tray {
  const tray = new Tray(nativeImage.createFromPath(callbacks.iconPath))
  tray.setToolTip('DSH启动器')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: callbacks.onShow },
    { type: 'separator' },
    { label: '退出', click: callbacks.onQuit },
  ]))
  tray.on('double-click', callbacks.onShow)
  return tray
}
