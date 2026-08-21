import { describe, expect, it } from 'vitest'
import { backoffDelay, MAX_RESTART_ATTEMPTS } from '../../src/main/core/backoff.ts'

describe('backoffDelay', () => {
  it('随尝试次数指数增长', () => {
    expect(backoffDelay(1)).toBe(1000)
    expect(backoffDelay(2)).toBe(2000)
    expect(backoffDelay(3)).toBe(4000)
  })

  it('有上限，不会无限增长', () => {
    expect(backoffDelay(10)).toBe(30000)
  })

  it('非法尝试次数按首次处理', () => {
    expect(backoffDelay(0)).toBe(1000)
    expect(backoffDelay(-5)).toBe(1000)
  })
})

describe('MAX_RESTART_ATTEMPTS', () => {
  it('连续三次失败后停止重启', () => {
    expect(MAX_RESTART_ATTEMPTS).toBe(3)
  })
})
