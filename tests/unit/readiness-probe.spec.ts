import { describe, expect, it } from 'vitest'
import { probeUntilReady } from '../../src/main/services/readiness-probe.ts'

describe('probeUntilReady', () => {
  it('首次请求成功即返回 true', async () => {
    const fetchFn = (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch
    await expect(probeUntilReady('http://127.0.0.1:3080', {
      timeoutMs: 1000, intervalMs: 10, fetchFn,
    })).resolves.toBe(true)
  })

  it('先失败后成功时会重试直到成功', async () => {
    let calls = 0
    const fetchFn = (async () => {
      calls += 1
      if (calls < 3) throw new Error('连接被拒绝')
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch
    await expect(probeUntilReady('http://127.0.0.1:3080', {
      timeoutMs: 2000, intervalMs: 10, fetchFn,
    })).resolves.toBe(true)
    expect(calls).toBe(3)
  })

  it('超时前始终失败则返回 false', async () => {
    const fetchFn = (async () => { throw new Error('连接被拒绝') }) as unknown as typeof fetch
    await expect(probeUntilReady('http://127.0.0.1:3080', {
      timeoutMs: 120, intervalMs: 20, fetchFn,
    })).resolves.toBe(false)
  })

  it('服务端返回 5xx 也算就绪——服务已在监听，只是这个路径出错', async () => {
    const fetchFn = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch
    await expect(probeUntilReady('http://127.0.0.1:3080', {
      timeoutMs: 1000, intervalMs: 10, fetchFn,
    })).resolves.toBe(true)
  })
})
