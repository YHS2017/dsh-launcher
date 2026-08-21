import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('launcher', {
  version: '0.1.0',
})
