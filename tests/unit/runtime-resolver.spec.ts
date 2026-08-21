import { describe, expect, it } from 'vitest'
import { resolveRuntime } from '../../src/main/core/runtime-resolver.ts'

// 用 String.raw 写 Windows 路径，避免反斜杠被当成字符串转义。
const BUNDLED = String.raw`C:\app\resources\dsh-bundled\node_modules\@deepseek-ai\dsh`
const UPDATED = String.raw`C:\data\dsh-runtime\dsh-0.1.0-rc.8\node_modules\@deepseek-ai\dsh`

describe('resolveRuntime', () => {
  it('没有更新副本时使用内置副本', () => {
    const choice = resolveRuntime({
      bundledDshRoot: BUNDLED,
      updatedDshRoot: null,
      readVersion: () => '0.1.0-rc.7',
    })
    expect(choice.source).toBe('bundled')
    expect(choice.dshRoot).toBe(BUNDLED)
    expect(choice.version).toBe('0.1.0-rc.7')
  })

  it('有可用的更新副本时优先使用它', () => {
    const choice = resolveRuntime({
      bundledDshRoot: BUNDLED,
      updatedDshRoot: UPDATED,
      readVersion: root => (root === UPDATED ? '0.1.0-rc.8' : '0.1.0-rc.7'),
    })
    expect(choice.source).toBe('updated')
    expect(choice.dshRoot).toBe(UPDATED)
    expect(choice.version).toBe('0.1.0-rc.8')
  })

  it('更新副本损坏时回落到内置副本', () => {
    const choice = resolveRuntime({
      bundledDshRoot: BUNDLED,
      updatedDshRoot: UPDATED,
      readVersion: root => (root === UPDATED ? undefined : '0.1.0-rc.7'),
    })
    expect(choice.source).toBe('bundled')
    expect(choice.version).toBe('0.1.0-rc.7')
  })

  it('即便更新副本版本更旧，选中它仍然合法——用户可能是刻意降级的', () => {
    const choice = resolveRuntime({
      bundledDshRoot: BUNDLED,
      updatedDshRoot: UPDATED,
      readVersion: root => (root === UPDATED ? '0.1.0-rc.6' : '0.1.0-rc.7'),
    })
    expect(choice.source).toBe('updated')
    expect(choice.version).toBe('0.1.0-rc.6')
  })

  it('bin 路径由包根目录推导', () => {
    const choice = resolveRuntime({
      bundledDshRoot: BUNDLED,
      updatedDshRoot: null,
      readVersion: () => '0.1.0-rc.7',
    })
    expect(choice.dshBin).toBe(String.raw`${BUNDLED}\lib\bin.js`)
  })

  it('内置副本也读不到版本时抛错——这是安装损坏，不能静默吞掉', () => {
    expect(() => resolveRuntime({
      bundledDshRoot: BUNDLED,
      updatedDshRoot: null,
      readVersion: () => undefined,
    })).toThrow(/内置/)
  })
})
