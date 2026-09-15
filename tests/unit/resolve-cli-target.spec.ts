import { describe, expect, it } from 'vitest'
import { resolveCliTarget } from '../../src/cli/resolve-cli-target.ts'
import { DEFAULT_SETTINGS } from '../../src/main/core/settings-schema.ts'
import { resolvePaths } from '../../src/main/paths.ts'

// 用 String.raw 写 Windows 路径，避免反斜杠被当成字符串转义。
const paths = resolvePaths({ userData: String.raw`C:\data`, resources: String.raw`C:\app\resources` })
const BUNDLED = String.raw`C:\app\resources\dsh-bundled\node_modules\@deepseek-ai\dsh`
const UPDATED = String.raw`C:\data\dsh-runtime\dsh-9.9.9\node_modules\@deepseek-ai\dsh`

/** 只认识给定几个目录的版本读取器，其余一律"不可用"。 */
const knowing = (known: Record<string, string>) => (root: string): string | undefined => known[root]

describe('resolveCliTarget', () => {
  it('未激活更新副本时跑内置副本，且用内置 Node', () => {
    const t = resolveCliTarget({
      paths, settings: { ...DEFAULT_SETTINGS }, baseEnv: {},
      readVersion: knowing({ [BUNDLED]: '0.1.0' }),
    })
    expect(t.nodeExe).toBe(String.raw`C:\app\resources\runtime\node\node.exe`)
    expect(t.dshBin).toBe(String.raw`${BUNDLED}\lib\bin.js`)
    expect(t.choice.source).toBe('bundled')
  })

  it('激活了更新副本就跑更新副本——与窗口里选版本的规则一致', () => {
    const t = resolveCliTarget({
      paths, settings: { ...DEFAULT_SETTINGS, activeRuntime: 'dsh-9.9.9' }, baseEnv: {},
      readVersion: knowing({ [BUNDLED]: '0.1.0', [UPDATED]: '9.9.9' }),
    })
    expect(t.dshBin).toBe(String.raw`${UPDATED}\lib\bin.js`)
    expect(t.choice).toMatchObject({ source: 'updated', version: '9.9.9' })
  })

  it('更新副本读不出版本时回落内置副本', () => {
    const t = resolveCliTarget({
      paths, settings: { ...DEFAULT_SETTINGS, activeRuntime: 'dsh-9.9.9' }, baseEnv: {},
      readVersion: knowing({ [BUNDLED]: '0.1.0' }),
    })
    expect(t.choice.source).toBe('bundled')
  })

  it('内置副本也不可用时抛错，不静默降级', () => {
    expect(() => resolveCliTarget({
      paths, settings: { ...DEFAULT_SETTINGS }, baseEnv: {}, readVersion: () => undefined,
    })).toThrow(/内置 dsh 副本不可用/)
  })

  describe('环境变量', () => {
    const readVersion = knowing({ [BUNDLED]: '0.1.0' })

    it('把设置里的 DSH_HOME 与遥测开关带给 dsh', () => {
      const t = resolveCliTarget({
        paths, readVersion,
        settings: { ...DEFAULT_SETTINGS, dshHome: String.raw`D:\dsh-home`, telemetryDisabled: true },
        baseEnv: { PATH: 'x' },
      })
      expect(t.env).toMatchObject({ PATH: 'x', DSH_HOME: String.raw`D:\dsh-home`, DSH_TELEMETRY_DISABLED: '1' })
    })

    it('设置为空时不塞多余变量', () => {
      const t = resolveCliTarget({ paths, readVersion, settings: { ...DEFAULT_SETTINGS }, baseEnv: {} })
      expect(t.env).not.toHaveProperty('DSH_HOME')
      expect(t.env).not.toHaveProperty('DSH_TELEMETRY_DISABLED')
    })

    it('shell 里显式设置的环境变量优先于启动器设置——命令行的一次性覆写惯例', () => {
      const t = resolveCliTarget({
        paths, readVersion,
        settings: { ...DEFAULT_SETTINGS, dshHome: String.raw`D:\from-settings`, telemetryDisabled: true },
        baseEnv: { DSH_HOME: String.raw`E:\from-shell`, DSH_TELEMETRY_DISABLED: '0' },
      })
      expect(t.env.DSH_HOME).toBe(String.raw`E:\from-shell`)
      expect(t.env.DSH_TELEMETRY_DISABLED).toBe('0')
    })
  })
})
