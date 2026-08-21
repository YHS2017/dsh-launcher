import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LogStore } from '../../src/main/services/log-store.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dshl-logs-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('LogStore', () => {
  it('追加的内容能被读回', () => {
    const store = new LogStore(dir)
    store.append('shell', '外壳启动')
    const lines = store.tail(10)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('外壳启动')
    expect(lines[0]).toContain('shell')
  })

  it('一次追加多行会拆成多条', () => {
    const store = new LogStore(dir)
    store.append('dsh-out', '第一行\n第二行\n')
    expect(store.tail(10)).toHaveLength(2)
  })

  it('空行被忽略', () => {
    const store = new LogStore(dir)
    store.append('dsh-out', '\n\n  \n')
    expect(store.tail(10)).toHaveLength(0)
  })

  it('tail 返回最后 N 条', () => {
    const store = new LogStore(dir)
    for (let i = 1; i <= 5; i += 1) store.append('shell', `第${i}条`)
    const lines = store.tail(2)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('第5条')
  })

  it('超过上限时丢弃最旧的记录', () => {
    const store = new LogStore(dir, 3)
    for (let i = 1; i <= 6; i += 1) store.append('shell', `第${i}条`)
    const lines = store.tail(100)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('第4条')
  })

  it('内容会落盘，供用户直接打开查看', () => {
    const store = new LogStore(dir)
    store.append('shell', '落盘测试')
    const reloaded = new LogStore(dir)
    expect(reloaded.tail(10).some(line => line.includes('落盘测试'))).toBe(true)
  })
})
