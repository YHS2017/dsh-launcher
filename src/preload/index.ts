import { contextBridge, ipcRenderer } from 'electron'
import type { LauncherSettings } from '../main/core/settings-schema.ts'
import { IPC, type AboutInfo, type SplashPayload } from '../main/ipc/channels.ts'
import type { UpdateInfo } from '../main/services/npm-updater.ts'

contextBridge.exposeInMainWorld('launcher', {
  onSplashState: (callback: (payload: SplashPayload) => void): void => {
    ipcRenderer.on(IPC.splashState, (_event, payload: SplashPayload) => { callback(payload) })
  },
  retry: (): Promise<void> => ipcRenderer.invoke(IPC.splashRetry),
  openLogFile: (): Promise<void> => ipcRenderer.invoke(IPC.openLogFile),
  readSettings: (): Promise<LauncherSettings> => ipcRenderer.invoke(IPC.settingsRead),
  updateSettings: (patch: Partial<LauncherSettings>): Promise<LauncherSettings> =>
    ipcRenderer.invoke(IPC.settingsUpdate, patch),
  restartDsh: (): Promise<void> => ipcRenderer.invoke(IPC.dshRestart),
  tailLogs: (count: number): Promise<string[]> => ipcRenderer.invoke(IPC.logsTail, count),
  aboutInfo: (): Promise<AboutInfo> => ipcRenderer.invoke(IPC.aboutInfo),
  checkUpdate: (): Promise<UpdateInfo> => ipcRenderer.invoke(IPC.updateCheck),
  installUpdate: (version: string): Promise<void> => ipcRenderer.invoke(IPC.updateInstall, version),
  rollbackRuntime: (): Promise<void> => ipcRenderer.invoke(IPC.runtimeRollback),
})
