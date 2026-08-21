import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, parseSettings } from '../../src/main/core/settings-schema.ts'

describe('parseSettings', () => {
  it('输入为空时返回默认值', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('不是对象')).toEqual(DEFAULT_SETTINGS)
  })

  it('默认端口为 0，表示交由操作系统分配', () => {
    expect(DEFAULT_SETTINGS.port).toBe(0)
  })

  it('默认不禁用遥测，保持上游原样', () => {
    expect(DEFAULT_SETTINGS.telemetryDisabled).toBe(false)
  })

  it('默认关窗最小化到托盘', () => {
    expect(DEFAULT_SETTINGS.closeToTray).toBe(true)
  })

  it('默认走稳定通道', () => {
    expect(DEFAULT_SETTINGS.updateChannel).toBe('latest')
  })

  it('保留合法字段', () => {
    const parsed = parseSettings({
      port: 3080,
      dshHome: 'D:\dsh',
      closeToTray: false,
      telemetryDisabled: true,
      updateChannel: 'next',
      activeRuntime: 'dsh-0.1.0-rc.8',
    })
    expect(parsed).toEqual({
      port: 3080,
      dshHome: 'D:\dsh',
      closeToTray: false,
      telemetryDisabled: true,
      updateChannel: 'next',
      activeRuntime: 'dsh-0.1.0-rc.8',
    })
  })

  it('端口越界或非整数时回落到 0', () => {
    expect(parseSettings({ port: 70000 }).port).toBe(0)
    expect(parseSettings({ port: -1 }).port).toBe(0)
    expect(parseSettings({ port: 3080.5 }).port).toBe(0)
    expect(parseSettings({ port: '3080' }).port).toBe(0)
  })

  it('未知的更新通道回落到 latest', () => {
    expect(parseSettings({ updateChannel: 'beta' }).updateChannel).toBe('latest')
  })

  it('空白的 dshHome 视为未配置', () => {
    expect(parseSettings({ dshHome: '   ' }).dshHome).toBeNull()
    expect(parseSettings({ dshHome: '' }).dshHome).toBeNull()
  })

  it('部分字段非法时不影响其余合法字段', () => {
    const parsed = parseSettings({ port: 'bad', closeToTray: false })
    expect(parsed.port).toBe(0)
    expect(parsed.closeToTray).toBe(false)
  })
})
