import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type SplashPayload } from '../main/ipc/channels.ts'

contextBridge.exposeInMainWorld('launcher', {
  onSplashState: (callback: (payload: SplashPayload) => void): void => {
    ipcRenderer.on(IPC.splashState, (_event, payload: SplashPayload) => { callback(payload) })
  },
  retry: (): Promise<void> => ipcRenderer.invoke(IPC.splashRetry),
  openLogFile: (): Promise<void> => ipcRenderer.invoke(IPC.openLogFile),
})
