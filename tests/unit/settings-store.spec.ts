import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/main/core/settings-schema.ts'
import { SettingsStore } from '../../src/main/services/settings-store.ts'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dshl-settings-'))
  file = join(dir, 'config.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('SettingsStore', () => {
  it('文件不存在时返回默认设置', () => {
    expect(new SettingsStore(file).read()).toEqual(DEFAULT_SETTINGS)
  })

  it('文件是损坏的 JSON 时仍返回默认设置，不抛错', () => {
    writeFileSync(file, '{ 这不是 JSON', 'utf8')
    expect(new SettingsStore(file).read()).toEqual(DEFAULT_SETTINGS)
  })

  it('update 写入后能被重新读出', () => {
    const store = new SettingsStore(file)
    store.update({ port: 3080, updateChannel: 'next' })
    const reloaded = new SettingsStore(file).read()
    expect(reloaded.port).toBe(3080)
    expect(reloaded.updateChannel).toBe('next')
  })

  it('update 只改动指定字段', () => {
    const store = new SettingsStore(file)
    store.update({ port: 3080 })
    const after = store.update({ closeToTray: false })
    expect(after.port).toBe(3080)
    expect(after.closeToTray).toBe(false)
  })

  it('update 返回落盘后的完整设置', () => {
    const result = new SettingsStore(file).update({ telemetryDisabled: true })
    expect(result.telemetryDisabled).toBe(true)
    expect(result.updateChannel).toBe('latest')
  })

  it('写入的非法值会被校验拦下', () => {
    const store = new SettingsStore(file)
    const result = store.update({ port: 99999 })
    expect(result.port).toBe(0)
  })

  it('目录不存在时自动创建', () => {
    const nested = join(dir, 'a', 'b', 'config.json')
    const store = new SettingsStore(nested)
    expect(() => store.update({ port: 3080 })).not.toThrow()
    expect(new SettingsStore(nested).read().port).toBe(3080)
  })
})
