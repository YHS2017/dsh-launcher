import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, shell, type Tray } from 'electron'
import { resolveRuntime } from './core/runtime-resolver.ts'
import type { LauncherSettings } from './core/settings-schema.ts'
import { IPC, type AboutInfo, type SplashPayload } from './ipc/channels.ts'
import { resolvePaths, DSH_PACKAGE_SUBPATH } from './paths.ts'
import { DshSupervisor } from './services/dsh-supervisor.ts'
import { LogStore } from './services/log-store.ts'
import { NpmUpdater } from './services/npm-updater.ts'
import { SettingsStore } from './services/settings-store.ts'
import { createTray } from './ui/tray.ts'
import { shouldHideOnClose } from './ui/window-manager.ts'

const paths = resolvePaths({
  userData: app.getPath('userData'),
  resources: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
})
const settingsStore = new SettingsStore(paths.settingsFile)
const logStore = new LogStore(paths.logsDir)
const updater = new NpmUpdater({
  runtimesDir: paths.runtimesDir,
  nodeExe: paths.nodeExe,
  npmCli: paths.npmCli,
})

let splashWindow: BrowserWindow | undefined
let mainWindow: BrowserWindow | undefined
let supervisor: DshSupervisor | undefined
let tray: Tray | undefined
/** 用户是否已选择退出。托盘「退出」与关窗隐藏共用一个窗口 close 事件，靠它区分。 */
let quitting = false
/** 已经因启动失败自动回退过一次，避免回退—失败—再回退的循环。 */
let rolledBackOnce = false

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

/** 启动页两种状态的窗口高度：失败时要额外容纳错误详情与按钮。 */
const SPLASH_WIDTH = 460
const SPLASH_HEIGHT = 268
const SPLASH_HEIGHT_FAILED = 430

function postSplash(payload: SplashPayload): void {
  const win = splashWindow
  if (win === undefined || win.isDestroyed()) return
  win.webContents.send(IPC.splashState, payload)
  // 高度跟着状态走，避免加载态下方空出一大片、失败态又挤不下详情。
  const height = payload.phase === 'failed' ? SPLASH_HEIGHT_FAILED : SPLASH_HEIGHT
  if (win.getBounds().height === height) return
  win.setSize(SPLASH_WIDTH, height)
  win.center()
}

function createSplashWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: SPLASH_WIDTH,
    height: SPLASH_HEIGHT,
    resizable: false,
    // 无边框 + 透明：圆角卡片才不会被方形窗口底色切出直角。
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // 启动阶段窗口会被反复创建（重试、更新后重启），居中且不进任务栏更少干扰。
    center: true,
    skipTaskbar: true,
    show: false,
    title: 'DSH启动器',
    icon: join(paths.resourcesRoot, 'icon.png'),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  void win.loadFile(join(import.meta.dirname, '../renderer/splash/index.html'))
  // 等首帧就绪再显示，避免透明窗口先闪一下白底。
  win.once('ready-to-show', () => { win.show() })
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
let logsWindow: BrowserWindow | undefined
let aboutWindow: BrowserWindow | undefined
/** 本次启动实际选中的 dsh，供关于页展示。 */
let activeChoice: { version: string; source: 'bundled' | 'updated' } | undefined

/** 打开一个外壳内部页面窗口；同一页面重复调用只聚焦既有窗口。 */
function openShellWindow(
  current: BrowserWindow | undefined,
  options: { file: string; title: string; width: number; height: number },
  assign: (win: BrowserWindow | undefined) => void,
): void {
  if (current !== undefined && !current.isDestroyed()) {
    current.show()
    current.focus()
    return
  }
  const win = new BrowserWindow({
    width: options.width,
    height: options.height,
    title: options.title,
    icon: join(paths.resourcesRoot, 'icon.png'),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  void win.loadFile(join(import.meta.dirname, options.file))
  win.on('closed', () => { assign(undefined) })
  assign(win)
}

function openLogsWindow(): void {
  openShellWindow(logsWindow, {
    file: '../renderer/logs/index.html', title: '日志 — DSH启动器', width: 900, height: 620,
  }, win => { logsWindow = win })
}

function openAboutWindow(): void {
  openShellWindow(aboutWindow, {
    file: '../renderer/about/index.html', title: '关于 — DSH启动器', width: 560, height: 440,
  }, win => { aboutWindow = win })
}

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
      preload: join(import.meta.dirname, '../preload/index.cjs'),
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
  activeChoice = { version: choice.version, source: choice.source }
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
// 启动页是无边框窗口，没有系统关闭按钮，退出通道得由它自己提供。
ipcMain.handle(IPC.quitApp, () => {
  quitting = true
  app.quit()
})
ipcMain.handle(IPC.settingsRead, () => settingsStore.read())
ipcMain.handle(IPC.settingsUpdate, (_event, patch: Partial<LauncherSettings>) => settingsStore.update(patch))
ipcMain.handle(IPC.dshRestart, () => restartFromSplash())
ipcMain.handle(IPC.updateCheck, async () => {
  const settings = settingsStore.read()
  const current = activeChoice?.version ?? '0.0.0'
  return updater.checkForUpdate(settings.updateChannel, current)
})

ipcMain.handle(IPC.updateInstall, async (_event, version: string) => {
  const dirName = await updater.install(version)
  settingsStore.update({ activeRuntime: dirName })
  // 装好即重启到新版本；若起不来，failed 分支会自动退回内置副本。
  rolledBackOnce = false
  await restartFromSplash()
})

ipcMain.handle(IPC.runtimeRollback, async () => {
  settingsStore.update({ activeRuntime: null })
  rolledBackOnce = false
  await restartFromSplash()
})

ipcMain.handle(IPC.logsTail, (_event, count: number) => logStore.tail(count))
ipcMain.handle(IPC.aboutInfo, (): AboutInfo => ({
  launcherVersion: app.getVersion(),
  dshVersion: activeChoice?.version ?? '未知',
  dshSource: activeChoice?.source ?? 'bundled',
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node,
  logFile: logStore.filePath,
}))

/**
 * 把已在运行的那个实例带到前台。
 *
 * 主窗口可能被关到托盘里（closeToTray 默认开启），所以要先 show 再 focus；
 * 若它被最小化了，restore 也不能少。启动尚未完成时主窗口还不存在，
 * 这时聚焦启动页——用户至少能看到当前进度，而不是毫无反应。
 */
function focusExistingInstance(): void {
  const target = mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow : splashWindow
  if (target === undefined || target.isDestroyed()) return
  if (target.isMinimized()) target.restore()
  target.show()
  target.focus()
}

// 单实例锁：第二次启动不再走一遍启动流程，而是把已有窗口唤到前台。
// 取锁必须早于 whenReady，且抢不到锁时整套启动逻辑都不能注册——
// app.quit() 是异步的，若把 whenReady 留在锁外，第二个实例会先建出
// 启动页窗口再退出，用户看到的是窗口一闪。
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { focusExistingInstance() })
  void app.whenReady().then(() => {
    // 主窗口承载的是 dsh 的 Web UI，不需要 Electron 的默认菜单栏。
    Menu.setApplicationMenu(null)
    tray = createTray({
      iconPath: join(paths.resourcesRoot, 'icon.png'),
      onShow: () => { focusExistingInstance() },
      onSettings: () => { openSettingsWindow() },
      onLogs: () => { openLogsWindow() },
      onAbout: () => { openAboutWindow() },
      onQuit: () => {
        quitting = true
        app.quit()
      },
    })
    splashWindow = createSplashWindow()
    splashWindow.webContents.once('did-finish-load', () => { startDsh() })
  })
}

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
