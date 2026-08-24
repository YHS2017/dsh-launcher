/** 主进程与渲染层之间的频道名，两端共用此文件避免字符串漂移。 */
export const IPC = {
  splashState: 'splash:state',
  splashRetry: 'splash:retry',
  openLogFile: 'shell:open-log-file',
  settingsRead: 'settings:read',
  settingsUpdate: 'settings:update',
  dshRestart: 'dsh:restart',
  logsTail: 'logs:tail',
  aboutInfo: 'about:info',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  runtimeRollback: 'runtime:rollback',
  quitApp: 'app:quit',
  /** 标题栏点了某个菜单名，请主进程在该处弹出原生菜单。 */
  menuPopup: 'menu:popup',
} as const

/** 标题栏上的菜单分区。渲染层照此顺序画按钮，主进程照 id 决定弹哪份菜单。 */
export const MENU_SECTIONS = [
  { id: 'launcher', label: '启动器' },
  { id: 'view', label: '视图' },
  { id: 'help', label: '帮助' },
] as const

export type MenuSectionId = (typeof MENU_SECTIONS)[number]['id']

export interface SplashPayload {
  phase: 'starting' | 'ready' | 'failed'
  /** 展示给用户的一句话状态。 */
  message: string
  /** 失败时的诊断细节，通常是日志尾部。 */
  detail?: string
}

export interface AboutInfo {
  launcherVersion: string
  dshVersion: string
  dshSource: 'bundled' | 'updated'
  electronVersion: string
  nodeVersion: string
  logFile: string
}
