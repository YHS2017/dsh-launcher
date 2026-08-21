import { describe, expect, it } from 'vitest'
import { isNewer } from '../../src/main/core/version-compare.ts'

describe('isNewer', () => {
  it('比较主版本号', () => {
    expect(isNewer('1.0.0', '0.9.9')).toBe(true)
    expect(isNewer('0.9.9', '1.0.0')).toBe(false)
  })

  it('比较次版本与修订号', () => {
    expect(isNewer('0.2.0', '0.1.9')).toBe(true)
    expect(isNewer('0.1.2', '0.1.1')).toBe(true)
    expect(isNewer('0.1.1', '0.1.2')).toBe(false)
  })

  it('正确比较 rc 预发布号（上游当前的真实场景）', () => {
    expect(isNewer('0.1.0-rc.8', '0.1.0-rc.7')).toBe(true)
    expect(isNewer('0.1.0-rc.7', '0.1.0-rc.8')).toBe(false)
    expect(isNewer('0.1.0-rc.10', '0.1.0-rc.9')).toBe(true)
  })

  it('正式版新于同版本号的预发布版', () => {
    expect(isNewer('0.1.0', '0.1.0-rc.8')).toBe(true)
    expect(isNewer('0.1.0-rc.8', '0.1.0')).toBe(false)
  })

  it('相同版本不算更新', () => {
    expect(isNewer('0.1.0-rc.7', '0.1.0-rc.7')).toBe(false)
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
  })

  it('无法解析的版本一律不算更新', () => {
    expect(isNewer('乱码', '0.1.0')).toBe(false)
    expect(isNewer('0.1.0', '乱码')).toBe(false)
  })
})
