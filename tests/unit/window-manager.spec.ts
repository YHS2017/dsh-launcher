import { describe, expect, it } from 'vitest'
import { shouldHideOnClose } from '../../src/main/ui/window-manager.ts'

describe('shouldHideOnClose', () => {
  it('开启托盘驻留时，关窗只隐藏', () => {
    expect(shouldHideOnClose({ closeToTray: true, quitting: false })).toBe(true)
  })

  it('关闭托盘驻留时，关窗即真正关闭', () => {
    expect(shouldHideOnClose({ closeToTray: false, quitting: false })).toBe(false)
  })

  it('用户已选择退出时，即便开着托盘驻留也不再拦截', () => {
    expect(shouldHideOnClose({ closeToTray: true, quitting: true })).toBe(false)
  })
})
