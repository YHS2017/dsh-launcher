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
} as const

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
