/**
 * 外壳自身的设置。刻意不包含任何模型或凭据配置——那属于上游 Web UI。
 */
export interface LauncherSettings {
  /** dsh 监听端口；0 表示交由操作系统分配空闲端口。 */
  port: number
  /** 自定义 DSH_HOME；null 表示不传该变量，沿用上游默认的 ~/.dsh。 */
  dshHome: string | null
  /** 关闭主窗口时最小化到托盘而非退出。 */
  closeToTray: boolean
  /** 是否给 dsh 传 DSH_TELEMETRY_DISABLED。默认 false，保持上游原样。 */
  telemetryDisabled: boolean
  /** 更新通道：latest 为稳定版，next 跟随上游 master。 */
  updateChannel: 'latest' | 'next'
  /** 当前生效的已更新运行时目录名；null 表示使用内置副本。 */
  activeRuntime: string | null
}

export const DEFAULT_SETTINGS: LauncherSettings = {
  port: 0,
  dshHome: null,
  closeToTray: true,
  telemetryDisabled: false,
  updateChannel: 'latest',
  activeRuntime: null,
}

function asPort(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 0
  if (value < 0 || value > 65535) return 0
  return value
}

function asOptionalPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asChannel(value: unknown): 'latest' | 'next' {
  return value === 'next' ? 'next' : 'latest'
}

/**
 * 把任意来源的原始值收敛成一份合法设置。
 * 单个字段非法只影响该字段，绝不抛错——配置文件损坏不应该让应用启动不了。
 */
export function parseSettings(raw: unknown): LauncherSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS }
  const source = raw as Record<string, unknown>
  return {
    port: asPort(source.port),
    dshHome: asOptionalPath(source.dshHome),
    closeToTray: asBoolean(source.closeToTray, DEFAULT_SETTINGS.closeToTray),
    telemetryDisabled: asBoolean(source.telemetryDisabled, DEFAULT_SETTINGS.telemetryDisabled),
    updateChannel: asChannel(source.updateChannel),
    activeRuntime: asOptionalPath(source.activeRuntime),
  }
}
