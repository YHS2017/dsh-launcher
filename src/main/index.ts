import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BaseWindow, BrowserWindow, ipcMain, Menu, nativeTheme, shell, WebContentsView, type Tray } from 'electron'
import { resolveRuntime } from './core/runtime-resolver.ts'
import type { LauncherSettings } from './core/settings-schema.ts'
import { IPC, type AboutInfo, type MenuSectionId, type SplashPayload } from './ipc/channels.ts'
import { resolvePaths, DSH_PACKAGE_SUBPATH } from './paths.ts'
import { DshSupervisor } from './services/dsh-supervisor.ts'
import { LogStore } from './services/log-store.ts'
import { NpmUpdater } from './services/npm-updater.ts'
import { SettingsStore } from './services/settings-store.ts'
import { buildSectionMenu, type AppMenuCallbacks } from './ui/app-menu.ts'
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
let mainWindow: BaseWindow | undefined
/** 主窗口里装 dsh 页面的那个视图。菜单的视图类操作与重新载入都要点名操作它。 */
let mainContentView: WebContentsView | undefined
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
    icon: paths.windowIcon,
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

/** 自绘标题栏的高度。菜单画在这一条上，因此窗口内不再单独占一行菜单栏。 */
const TITLEBAR_HEIGHT = 32

/** titleBarOverlay 的配色不跟随系统主题，主题变了得重新设一次。 */
function applyOverlayTheme(win: BaseWindow): void {
  const dark = nativeTheme.shouldUseDarkColors
  win.setTitleBarOverlay({
    color: dark ? '#202020' : '#f3f3f3',
    symbolColor: dark ? '#e8e8e8' : '#1a1a1a',
    height: TITLEBAR_HEIGHT,
  })
}

/**
 * 主窗口：上面 32px 是外壳自绘的标题栏（承载菜单），其余整块给 dsh。
 *
 * 用 BaseWindow + 两个并列的 WebContentsView，而不是往 dsh 页面里塞标题栏——
 * 上游的 Web UI 一个字节都没被改动，两者只是同一个窗口里的两个兄弟视图。
 *
 * 系统标题栏用 titleBarStyle:'hidden' 去掉，再用 titleBarOverlay 把右上角
 * 那三颗按钮交还给系统画：最小化/最大化/关闭、以及悬停最大化出的 Snap 布局
 * 都还是原生行为，自己实现这些只会做得更差。
 */
function showMainWindow(url: string): void {
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    void mainContentView?.webContents.loadURL(url)
    mainWindow.show()
    return
  }
  const win = new BaseWindow({
    width: 1280,
    height: 860,
    title: 'DSH启动器',
    show: false,
    icon: paths.windowIcon,
    titleBarStyle: 'hidden',
    titleBarOverlay: true,
  })
  applyOverlayTheme(win)
  // 主窗口会被反复重建（重启 dsh、更新后重启），监听器不摘就会一次次累积。
  const onThemeChange = (): void => {
    if (!win.isDestroyed()) applyOverlayTheme(win)
  }
  nativeTheme.on('updated', onThemeChange)

  const chrome = new WebContentsView({
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  void chrome.webContents.loadFile(join(import.meta.dirname, '../renderer/titlebar/index.html'))

  // 装 dsh 的那个视图不挂 preload：外壳不往上游页面注入任何脚本。
  const content = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  void content.webContents.loadURL(url)

  win.contentView.addChildView(chrome)
  win.contentView.addChildView(content)

  // WebContentsView 不会自己跟随窗口尺寸，每次 resize 都要重新摆。
  const layout = (): void => {
    const { width, height } = win.getContentBounds()
    chrome.setBounds({ x: 0, y: 0, width, height: TITLEBAR_HEIGHT })
    content.setBounds({ x: 0, y: TITLEBAR_HEIGHT, width, height: Math.max(0, height - TITLEBAR_HEIGHT) })
  }
  layout()
  win.on('resize', layout)

  // 刻意不把 dsh 页面的标题转发到窗口标题或标题栏：那个标题是完整商标
  // 「DeepSeek Harness」，而窗口标题属于本项目的身份标识，按约束不得出现它。
  // BaseWindow 不像 BrowserWindow 那样自动继承页面标题，不设即保持 'DSH启动器'。

  content.webContents.once('did-finish-load', () => {
    win.show()
    // 焦点交给 dsh。不给的话它会停在标题栏视图上，第一个菜单按钮带着焦点框显示。
    content.webContents.focus()
    splashWindow?.close()
    splashWindow = undefined
  })

  win.on('close', event => {
    if (!shouldHideOnClose({ closeToTray: settingsStore.read().closeToTray, quitting })) return
    // agent 任务可能仍在后台跑，关窗不应终止服务。
    event.preventDefault()
    win.hide()
  })
  win.on('closed', () => {
    nativeTheme.off('updated', onThemeChange)
    mainWindow = undefined
    mainContentView = undefined
  })
  mainWindow = win
  mainContentView = content
}

/**
 * 菜单项的行为。
 *
 * 视图类操作必须点名操作装 dsh 的那个视图：弹出菜单时聚焦的是标题栏视图，
 * 用 role 的话「重新加载」会去刷新标题栏自己。
 */
function mainMenuCallbacks(): AppMenuCallbacks {
  const contents = mainContentView?.webContents
  const zoomBy = (step: number): void => {
    if (contents === undefined) return
    contents.setZoomLevel(Math.max(-5, Math.min(5, contents.getZoomLevel() + step)))
  }
  return {
    onSettings: () => { openSettingsWindow() },
    onCheckUpdate: () => { openSettingsWindow('update') },
    onLogs: () => { openLogsWindow() },
    onRestartDsh: () => { void restartFromSplash() },
    onAbout: () => { openAboutWindow() },
    onQuit: () => {
      quitting = true
      app.quit()
    },
    onReload: () => { contents?.reload() },
    onZoomReset: () => { contents?.setZoomLevel(0) },
    onZoomIn: () => { zoomBy(0.5) },
    onZoomOut: () => { zoomBy(-0.5) },
    onToggleFullScreen: () => {
      if (mainWindow === undefined || mainWindow.isDestroyed()) return
      mainWindow.setFullScreen(!mainWindow.isFullScreen())
    },
  }
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
    icon: paths.windowIcon,
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

/**
 * 让设置窗口滚到指定区块。
 *
 * 设置页是外壳自己的页面，不是 dsh 的 Web UI，所以这里直接注入一行滚动脚本；
 * 单为「跳到某个区块」开一条 IPC 推送通道不值得。
 */
function scrollSettingsTo(win: BrowserWindow, section: string): void {
  void win.webContents.executeJavaScript(
    `document.getElementById(${JSON.stringify(section)})?.scrollIntoView({ behavior: 'smooth' })`,
  )
}

/** section 用于从菜单「检查更新…」直接落到更新区块——它在设置页最下面，不滚过去等于没入口。 */
function openSettingsWindow(section?: 'update'): void {
  if (settingsWindow !== undefined && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    if (section !== undefined) scrollSettingsTo(settingsWindow, section)
    return
  }
  const win = new BrowserWindow({
    width: 600,
    height: 620,
    title: '设置 — DSH启动器',
    icon: paths.windowIcon,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  void win.loadFile(join(import.meta.dirname, '../renderer/settings/index.html'))
  if (section !== undefined) {
    // 首次打开要等页面加载完才有节点可滚。
    win.webContents.once('did-finish-load', () => { scrollSettingsTo(win, section) })
  }
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

// 标题栏上点了菜单名。invoke 直到菜单关闭才 resolve，渲染层据此复位按钮的按下态。
ipcMain.handle(IPC.menuPopup, async (_event, section: MenuSectionId, x: number, y: number) => {
  const win = mainWindow
  if (win === undefined || win.isDestroyed()) return
  const menu = buildSectionMenu(section, mainMenuCallbacks())
  await new Promise<void>(resolve => {
    menu.popup({ window: win, x, y, callback: () => { resolve() } })
  })
})
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
    // 清掉 Electron 的默认英文菜单栏，让启动页与设置/日志/关于这些子窗口都不带菜单。
    // 主窗口另行用 BrowserWindow.setMenu 挂自己的中文菜单（见 showMainWindow）。
    Menu.setApplicationMenu(null)
    tray = createTray({
      iconPath: paths.trayIcon,
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
