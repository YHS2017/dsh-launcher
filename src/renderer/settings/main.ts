import type { LauncherSettings } from '../../main/core/settings-schema.ts'

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.querySelector<T>(`#${id}`)
  if (node === null) throw new Error(`设置页缺少元素：${id}`)
  return node
}

const fixedPortEnabled = el<HTMLInputElement>('fixed-port-enabled')
const port = el<HTMLInputElement>('port')
const dshHome = el<HTMLInputElement>('dsh-home')
const closeToTray = el<HTMLInputElement>('close-to-tray')
const telemetryDisabled = el<HTMLInputElement>('telemetry-disabled')
const channel = el<HTMLSelectElement>('channel')
const restartHint = el<HTMLParagraphElement>('restart-hint')
const saved = el<HTMLSpanElement>('saved')

/** 需要重启才生效的字段的初始值，用于判断是否提示重启。 */
let initialRestartSensitive = ''

function restartSensitiveKey(settings: LauncherSettings): string {
  return `${String(settings.port)}|${settings.dshHome ?? ''}`
}

function render(settings: LauncherSettings): void {
  fixedPortEnabled.checked = settings.port > 0
  port.value = settings.port > 0 ? String(settings.port) : ''
  port.disabled = settings.port === 0
  dshHome.value = settings.dshHome ?? ''
  closeToTray.checked = settings.closeToTray
  telemetryDisabled.checked = settings.telemetryDisabled
  channel.value = settings.updateChannel
  restartHint.hidden = restartSensitiveKey(settings) === initialRestartSensitive
}

function flashSaved(): void {
  saved.hidden = false
  setTimeout(() => { saved.hidden = true }, 1500)
}

async function save(patch: Partial<LauncherSettings>): Promise<void> {
  const next = await window.launcher.updateSettings(patch)
  render(next)
  flashSaved()
}

fixedPortEnabled.addEventListener('change', () => {
  // 取消固定端口即回到 0（由操作系统分配）。
  void save({ port: fixedPortEnabled.checked ? Number(port.value) || 3080 : 0 })
})
port.addEventListener('change', () => {
  if (!fixedPortEnabled.checked) return
  void save({ port: Number(port.value) || 0 })
})
dshHome.addEventListener('change', () => { void save({ dshHome: dshHome.value }) })
closeToTray.addEventListener('change', () => { void save({ closeToTray: closeToTray.checked }) })
telemetryDisabled.addEventListener('change', () => { void save({ telemetryDisabled: telemetryDisabled.checked }) })
channel.addEventListener('change', () => {
  void save({ updateChannel: channel.value === 'next' ? 'next' : 'latest' })
})
el<HTMLButtonElement>('restart').addEventListener('click', () => { void window.launcher.restartDsh() })

void window.launcher.readSettings().then(settings => {
  initialRestartSensitive = restartSensitiveKey(settings)
  render(settings)
})
