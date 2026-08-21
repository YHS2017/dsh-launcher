import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

function createSplash(): BrowserWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 320,
    resizable: false,
    title: 'DSH启动器',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  void win.loadFile(join(import.meta.dirname, '../renderer/splash/index.html'))
  return win
}

void app.whenReady().then(() => {
  createSplash()
})

app.on('window-all-closed', () => {
  app.quit()
})
