import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { resolveRuntime } from './core/runtime-resolver.ts'
import { IPC, type SplashPayload } from './ipc/channels.ts'
import { resolvePaths, DSH_PACKAGE_SUBPATH } from './paths.ts'
import { DshSupervisor } from './services/dsh-supervisor.ts'
import { LogStore } from './services/log-store.ts'
import { SettingsStore } from './services/settings-store.ts'

const paths = resolvePaths({
  userData: app.getPath('userData'),
  resources: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
})
const settingsStore = new SettingsStore(paths.settingsFile)
const logStore = new LogStore(paths.logsDir)

let splashWindow: BrowserWindow | undefined
let mainWindow: BrowserWindow | undefined
let supervisor: DshSupervisor | undefined

/** 读取某个 dsh 包根目录的版本号；不可用时返回 undefined。 */
function readDshVersion(dshRoot: string): string | undefined {
  try {
    if (!existsSync(join(dshRoot, 'lib', 'bin.js'))) return undefined
    const manifest = JSON.parse(readFileSync(join(dshRoot, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

function postSplash(payload: SplashPayload): void {
  splashWindow?.webContents.send(IPC.splashState, payload)
}

function createSplashWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 560,
    height: 380,
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

function showMainWindow(url: string): void {
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    void mainWindow.loadURL(url)
    mainWindow.show()
    return
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'DSH启动器',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  // 主窗口加载的是 dsh 自己的 Web UI，外壳不注入任何脚本。
  void win.loadURL(url)
  win.once('ready-to-show', () => {
    win.show()
    splashWindow?.close()
    splashWindow = undefined
  })
  win.on('closed', () => { mainWindow = undefined })
  mainWindow = win
}

function startDsh(): void {
  const settings = settingsStore.read()
  postSplash({ phase: 'starting', message: '正在准备运行时…' })

  let choice
  try {
    choice = resolveRuntime({
      bundledDshRoot: paths.bundledDshRoot,
      updatedDshRoot: settings.activeRuntime === null
        ? null
        : join(paths.runtimesDir, settings.activeRuntime, DSH_PACKAGE_SUBPATH),
      readVersion: readDshVersion,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logStore.append('shell', reason)
    postSplash({ phase: 'failed', message: '无法启动', detail: reason })
    return
  }

  logStore.append('shell', `使用 dsh ${choice.version}（${choice.source === 'bundled' ? '内置副本' : '已更新副本'}）`)
  postSplash({ phase: 'starting', message: `正在启动 dsh ${choice.version}…` })

  const next = new DshSupervisor({
    nodeExe: paths.nodeExe,
    dshBin: choice.dshBin,
    port: settings.port,
    dshHome: settings.dshHome,
    telemetryDisabled: settings.telemetryDisabled,
  })
  next.on('output', (source, text) => { logStore.append(source, text) })
  next.on('ready', url => {
    logStore.append('shell', `dsh 就绪：${url}`)
    postSplash({ phase: 'ready', message: '已就绪' })
    showMainWindow(url)
  })
  next.on('failed', reason => {
    logStore.append('shell', reason)
    postSplash({ phase: 'failed', message: '启动失败', detail: `${reason}\n\n${logStore.tail(20).join('\n')}` })
  })
  supervisor = next
  next.start()
}

ipcMain.handle(IPC.splashRetry, async () => {
  await supervisor?.stop()
  startDsh()
})
ipcMain.handle(IPC.openLogFile, () => shell.openPath(logStore.filePath))

void app.whenReady().then(() => {
  splashWindow = createSplashWindow()
  splashWindow.webContents.once('did-finish-load', () => { startDsh() })
})

app.on('window-all-closed', () => { app.quit() })

// 退出前把 dsh 收干净，避免留下孤儿进程继续占用端口与资源。
app.on('before-quit', event => {
  if (supervisor === undefined || supervisor.state === 'idle') return
  event.preventDefault()
  void supervisor.stop().then(() => {
    supervisor = undefined
    app.quit()
  })
})
