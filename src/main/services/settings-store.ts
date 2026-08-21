import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, parseSettings, type LauncherSettings } from '../core/settings-schema.ts'

/**
 * 外壳设置的持久化。
 * 读取一律走 parseSettings，因此损坏的文件只会退化成默认设置，
 * 不会让应用起不来——配置问题不该升级成可用性问题。
 */
export class SettingsStore {
  readonly #filePath: string

  constructor(filePath: string) {
    this.#filePath = filePath
  }

  get filePath(): string {
    return this.#filePath
  }

  read(): LauncherSettings {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(this.#filePath, 'utf8'))
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
    return parseSettings(raw)
  }

  /** 合并写入若干字段，返回落盘后的完整设置。 */
  update(patch: Partial<LauncherSettings>): LauncherSettings {
    const merged = parseSettings({ ...this.read(), ...patch })
    mkdirSync(dirname(this.#filePath), { recursive: true })
    writeFileSync(this.#filePath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
    return merged
  }
}
