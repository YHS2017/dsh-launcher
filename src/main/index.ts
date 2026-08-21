import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, shell, type Tray } from 'electron'
import { resolveRuntime } from './core/runtime-resolver.ts'
import type { LauncherSettings } from './core/settings-schema.ts'
import { IPC, type SplashPayload } from './ipc/channels.ts'
import { resolvePaths, DSH_PACKAGE_SUBPATH } from './paths.ts'
import { DshSupervisor } from './services/dsh-supervisor.ts'
import { LogStore } from './services/log-store.ts'
import { SettingsStore } from './services/settings-store.ts'
import { createTray } from './ui/tray.ts'
import { shouldHideOnClose } from './ui/window-manager.ts'

const paths = resolvePaths({
  userData: app.getPath('userData'),
  resources: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
})
const settingsStore = new SettingsStore(paths.settingsFile)
const logStore = new LogStore(paths.logsDir)

let splashWindow: BrowserWindow | undefined
let mainWindow: BrowserWindow | undefined
let supervisor: DshSupervisor | undefined
let tray: Tray | undefined
/** 用户是否已选择退出。托盘「退出」与关窗隐藏共用一个窗口 close 事件，靠它区分。 */
let quitting = false

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
    icon: join(paths.resourcesRoot, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  // 主窗口加载的是 dsh 自己的 Web UI，外壳不注入任何脚本。
  void win.loadURL(url)
  win.once('ready-to-show', () => {
    win.show()
    splashWindow?.close()
    splashWindow = undefined
  })
  win.on('close', event => {
    if (!shouldHideOnClose({ closeToTray: settingsStore.read().closeToTray, quitting })) return
    // agent 任务可能仍在后台跑，关窗不应终止服务。
    event.preventDefault()
    win.hide()
  })
  win.on('closed', () => { mainWindow = undefined })
  mainWindow = win
}

let settingsWindow: BrowserWindow | undefined

function openSettingsWindow(): void {
  if (settingsWindow !== undefined && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }
  const win = new BrowserWindow({
    width: 600,
    height: 620,
    title: '设置 — DSH启动器',
    icon: join(paths.resourcesRoot, 'icon.png'),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  void win.loadFile(join(import.meta.dirname, '../renderer/settings/index.html'))
  win.on('closed', () => { settingsWindow = undefined })
  settingsWindow = win
}

/** 停掉当前 dsh、丢弃主窗口，回到启动页重新走一遍启动流程。 */
async function restartFromSplash(): Promise<void> {
  await supervisor?.stop()
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    mainWindow.destroy()
    mainWindow = undefined
  }
  splashWindow = createSplashWindow()
  splashWindow.webContents.once('did-finish-load', () => { startDsh() })
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
ipcMain.handle(IPC.settingsRead, () => settingsStore.read())
ipcMain.handle(IPC.settingsUpdate, (_event, patch: Partial<LauncherSettings>) => settingsStore.update(patch))
ipcMain.handle(IPC.dshRestart, () => restartFromSplash())

void app.whenReady().then(() => {
  // 主窗口承载的是 dsh 的 Web UI，不需要 Electron 的默认菜单栏。
  Menu.setApplicationMenu(null)
  tray = createTray({
    iconPath: join(paths.resourcesRoot, 'icon.png'),
    onShow: () => {
      if (mainWindow === undefined || mainWindow.isDestroyed()) return
      mainWindow.show()
      mainWindow.focus()
    },
    onSettings: () => { openSettingsWindow() },
    onQuit: () => {
      quitting = true
      app.quit()
    },
  })
  splashWindow = createSplashWindow()
  splashWindow.webContents.once('did-finish-load', () => { startDsh() })
})

// 托盘驻留模式下，窗口全关不等于退出——退出只由托盘菜单发起。
app.on('window-all-closed', () => {
  if (settingsStore.read().closeToTray && !quitting) return
  app.quit()
})

// 退出前把 dsh 收干净，避免留下孤儿进程继续占用端口与资源。
app.on('before-quit', event => {
  quitting = true
  tray?.destroy()
  tray = undefined
  if (supervisor === undefined || supervisor.state === 'idle') return
  event.preventDefault()
  void supervisor.stop().then(() => {
    supervisor = undefined
    app.quit()
  })
})
