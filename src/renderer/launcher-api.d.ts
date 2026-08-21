import type { LauncherSettings } from '../main/core/settings-schema.ts'
import type { SplashPayload } from '../main/ipc/channels.ts'

/**
 * preload 通过 contextBridge 暴露给全部渲染页面的受限 API。
 * 所有页面共用这一份声明——若每个页面各自 declare global，
 * TypeScript 会因同名属性形状不一致而报错。
 */
export interface LauncherApi {
  onSplashState: (callback: (payload: SplashPayload) => void) => void
  retry: () => Promise<void>
  openLogFile: () => Promise<void>
  readSettings: () => Promise<LauncherSettings>
  updateSettings: (patch: Partial<LauncherSettings>) => Promise<LauncherSettings>
  restartDsh: () => Promise<void>
}

declare global {
  interface Window {
    launcher: LauncherApi
  }
}
