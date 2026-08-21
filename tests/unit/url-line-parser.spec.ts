import { describe, expect, it } from 'vitest'
import { parseReadyLine } from '../../src/main/core/url-line-parser.ts'

describe('parseReadyLine', () => {
  it('识别实测的真实就绪行', () => {
    expect(parseReadyLine('dsh web: http://127.0.0.1:53933')).toBe('http://127.0.0.1:53933')
  })

  it('带 LAN 后缀时只取回环地址', () => {
    const line = 'dsh web: http://127.0.0.1:3080 (LAN: http://192.168.1.7:3080)'
    expect(parseReadyLine(line)).toBe('http://127.0.0.1:3080')
  })

  it('容忍前后空白', () => {
    expect(parseReadyLine('  dsh web: http://127.0.0.1:3080  ')).toBe('http://127.0.0.1:3080')
  })

  it('接受 localhost 与 IPv6 回环', () => {
    expect(parseReadyLine('dsh web: http://localhost:3080')).toBe('http://localhost:3080')
    expect(parseReadyLine('dsh web: http://[::1]:3080')).toBe('http://[::1]:3080')
  })

  it('拒绝非回环地址', () => {
    expect(parseReadyLine('dsh web: http://192.168.1.7:3080')).toBeUndefined()
    expect(parseReadyLine('dsh web: http://evil.example:3080')).toBeUndefined()
  })

  it('拒绝无关行', () => {
    expect(parseReadyLine('')).toBeUndefined()
    expect(parseReadyLine('dsh web: opening the default browser; pass --no-open to disable')).toBeUndefined()
    expect(parseReadyLine('some other log line')).toBeUndefined()
    expect(parseReadyLine('http://127.0.0.1:3080')).toBeUndefined()
  })
})
