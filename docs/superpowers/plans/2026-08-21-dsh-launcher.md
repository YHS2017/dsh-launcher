# DSH启动器 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个 Windows 桌面客户端，双击安装即可使用 DeepSeek Harness，无需预装 Node 或使用命令行，并能跟随 npm 发布通道更新且可回滚。

**Architecture:** Electron 主进程作为外壳，用内置的官方 Node 运行时以子进程方式拉起 `dsh --profile web`，读取其 stdout 上的就绪行取得实际端口，再用 BrowserWindow 加载该地址。外壳完全不介入 dsh 的 Web UI，只负责进程监督、设置、日志与更新编排。

**Tech Stack:** Electron 43.4.1 · electron-vite 5.0.0 · electron-builder 26.15.3 · TypeScript 5.9.3 · Vitest 4.1.11 · 内置 Node v24.14.1

## Global Constraints

- 设计依据：`docs/superpowers/specs/2026-08-21-dsh-launcher-design.md`。
- 应用名 **DSH启动器**，英文标识 `dsh-launcher`。**禁止**在应用名、包名、窗口标题、安装包名中出现完整商标「DeepSeek Harness」；关于页须注明「基于 DeepSeek Harness 构建的非官方桌面客户端」。
- dsh 绑定地址固定 `127.0.0.1`，**不得**提供任何 `--host 0.0.0.0` 或对外暴露的选项。
- **不得**在外壳中重做模型/API Key 配置，该能力属于上游 Web UI。
- **不得**修改或注入 dsh 的 Web UI，**不得**解析其内部结构；外壳与 dsh 之间只经由命令行参数、stdout、HTTP 三个接口交互。
- **不得**劫持或迁移 `~/.dsh`；未显式配置时不传 `DSH_HOME`，沿用上游默认。
- 内置 dsh 副本 `resources/dsh-bundled/` 运行期**只读**，是回滚的最终保底。
- 更新**不静默**，须用户确认；失败必须自动回滚。
- 目标平台仅 Windows x64。
- 外壳界面语言为简体中文。
- 主进程业务依赖保持为零：设置校验等逻辑手写，不引入 zod 等运行时库（Electron 与构建工具除外）。
- `src/main/core/` 下的模块**禁止** import `electron`，须为可直接单测的纯逻辑。
- TypeScript 钉在 **5.9.3**，不要升到 7.x。实测 7.0.2（Go 实现）在本机把 `node_modules` 下所有 `.d.ts` 误判为二进制文件（`TS1490`），typecheck 全线报错却对源码零覆盖——它不是更严格，而是根本没检查到源码，会掩盖真实的类型缺陷。
- 测试中出现 Windows 路径时一律用 `String.raw` 模板串书写。普通字符串里的单反斜杠会被 JS 当作转义（`'C:\data'` 实际等于 `'C:data'`），断言两边同时出错时测试还会照样通过，属于会掩盖真实缺陷的写法。

## 文件结构

```
package.json                     应用清单、脚本、electron-builder 入口
tsconfig.json                    TypeScript 配置
electron.vite.config.ts          main/preload/renderer 三端构建
vitest.config.ts                 单元与集成测试
electron-builder.yml             NSIS 打包配置

scripts/
  fetch-node-runtime.mjs         下载并解包内置 Node → resources/runtime/node/
  fetch-dsh-bundle.mjs           安装 dsh → resources/dsh-bundled/

src/main/
  index.ts                       应用生命周期编排（唯一有副作用的入口）
  paths.ts                       各路径的单一事实来源
  core/                          纯逻辑，无 electron 依赖，全部可单测
    settings-schema.ts           设置的类型、默认值与校验
    url-line-parser.ts           识别 dsh 就绪行并取出 URL
    runtime-resolver.ts          在内置副本与已更新副本间择一
    version-compare.ts           语义化版本（含 rc 预发布）比较
    backoff.ts                   崩溃重启的退避策略
  services/                      有副作用的服务
    settings-store.ts            设置持久化
    log-store.ts                 日志归集与滚动
    readiness-probe.ts           HTTP 兜底就绪探测
    dsh-supervisor.ts            dsh 子进程状态机
    npm-updater.ts               版本查询、安装、指针切换、回滚
  ui/
    window-manager.ts            主窗口与外壳窗口
    tray.ts                      托盘
  ipc/
    channels.ts                  IPC 频道名与载荷类型（主/渲染共享）
    handlers.ts                  IPC 注册

src/preload/index.ts             contextBridge 暴露的受限 API
src/renderer/
  splash/index.html + main.ts    启动页
  settings/index.html + main.ts  设置页
  logs/index.html + main.ts      日志页
  about/index.html + main.ts     关于页
  shared.css                     外壳页面共用样式

tests/
  unit/*.spec.ts                 core/ 与 services/ 的单元测试
  integration/fake-dsh.mjs       冒充 dsh 的假服务脚本
  integration/supervisor.spec.ts 状态机集成测试

resources/                       构建产物，不入库
  runtime/node/                  内置 Node（含 npm）
  dsh-bundled/                   内置 dsh 副本
```

**为何这样切分**：`core/` 全是纯函数与纯数据变换，不碰 electron，因此能以最低成本获得最高测试覆盖；`services/` 承担副作用但依赖注入，可用假实现驱动；`ui/` 与 `renderer/` 只做展示，靠手工验收。外壳与 dsh 的接触面被压缩到「命令行参数、stdout、HTTP」三处，任一上游破坏性变更的影响范围都可预判。

---

### Task 1: 项目脚手架与构建管线

建立可构建、可测试、能弹出一个空窗口的最小骨架。后续每个任务都依赖这套管线，因此它必须先独立跑通。

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `electron.vite.config.ts`
- Create: `vitest.config.ts`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/splash/index.html`
- Create: `tests/unit/smoke.spec.ts`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: `npm run dev` 启动开发模式；`npm run build` 产出 `out/`；`npm test` 运行 Vitest。后续所有任务沿用这三个命令。

- [ ] **Step 1: 写一个冒烟测试，确认测试管线可用**

创建 `tests/unit/smoke.spec.ts`：

```typescript
import { describe, expect, it } from 'vitest'

describe('测试管线', () => {
  it('能运行断言', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 2: 运行测试，确认它因缺少配置而失败**

```bash
npx vitest run
```

预期：FAIL —— 找不到 vitest 或无配置文件。

- [ ] **Step 3: 建立 package.json**

创建 `package.json`：

```json
{
  "name": "dsh-launcher",
  "version": "0.1.0",
  "description": "基于 DeepSeek Harness 构建的非官方桌面客户端",
  "main": "out/main/index.js",
  "type": "module",
  "private": true,
  "license": "MIT",
  "dshLauncher": {
    "nodeVersion": "24.14.1",
    "dshVersion": "0.1.0-rc.7"
  },
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "fetch:node": "node scripts/fetch-node-runtime.mjs",
    "fetch:dsh": "node scripts/fetch-dsh-bundle.mjs",
    "prepare:resources": "npm run fetch:node && npm run fetch:dsh",
    "pack": "npm run build && electron-builder --win --x64"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "electron": "43.4.1",
    "electron-builder": "26.15.3",
    "electron-vite": "5.0.0",
    "typescript": "5.9.3",
    "vite": "^7.0.0",
    "vitest": "4.1.11"
  }
}
```

- [ ] **Step 4: 建立 TypeScript 与构建配置**

创建 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "*.config.ts"]
}
```

创建 `electron.vite.config.ts`：

```typescript
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: resolve('src/main/index.ts') },
    },
  },
  preload: {
    build: {
      rollupOptions: { input: resolve('src/preload/index.ts') },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          splash: resolve('src/renderer/splash/index.html'),
        },
      },
    },
  },
})
```

创建 `vitest.config.ts`：

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    testTimeout: 20000,
  },
})
```

- [ ] **Step 5: 配置二进制镜像，安装依赖并运行测试**

Electron 与 electron-builder 的二进制不走 npm registry，默认从 GitHub 下载，在国内网络下会长时间卡死而非快速失败。**先**创建 `.npmrc`：

```
# Electron 与 electron-builder 的二进制默认从 GitHub 下载，国内常年不可达。
# 指向 npmmirror 的二进制镜像，避免安装卡死。
electron_mirror=https://registry.npmmirror.com/-/binary/electron/
electron_builder_binaries_mirror=https://registry.npmmirror.com/-/binary/electron-builder-binaries/
```

```bash
npm install
```

装完确认二进制真的落地了——`npm install` 即使二进制下载失败也可能以 0 退出：

```bash
node -e "console.log(require('node:fs').existsSync('node_modules/electron/dist/electron.exe')?'✓ electron 二进制就位':'✗ 二进制缺失，检查 .npmrc 镜像配置')"
```

预期：输出「✓ electron 二进制就位」（实测约 224 MB）。

若缺失，**不要**直接跑 `node node_modules/electron/install.js` 补救——它不读 `.npmrc`（那是 npm config，只在由 npm 调起时才转成环境变量传入），会继续走 GitHub 并静默卡住。改用环境变量：

```bash
ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/ node node_modules/electron/install.js
```

```bash
npm test
```

预期：PASS，1 个测试通过。

- [ ] **Step 6: 写出最小主进程与启动页**

创建 `src/main/index.ts`：

```typescript
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

function createSplash(): BrowserWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 320,
    resizable: false,
    title: 'DSH启动器',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  void win.loadFile(join(import.meta.dirname, '../renderer/splash/index.html'))
  return win
}

void app.whenReady().then(() => {
  createSplash()
})

app.on('window-all-closed', () => {
  app.quit()
})
```

创建 `src/preload/index.ts`：

```typescript
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('launcher', {
  version: '0.1.0',
})
```

创建 `src/renderer/splash/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>DSH启动器</title>
  </head>
  <body>
    <h1>DSH启动器</h1>
    <p id="status">正在准备…</p>
  </body>
</html>
```

- [ ] **Step 7: 构建并手工确认窗口能弹出**

```bash
npm run build
```

预期：`out/main/index.js`、`out/preload/index.mjs`（ESM 项目下 electron-vite 输出 .mjs，Electron 的 ESM preload 也要求该扩展名）、`out/renderer/` 均生成，无报错。

```bash
npm run dev
```

预期：弹出标题为「DSH启动器」的窗口，显示「正在准备…」。确认后关闭窗口。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat: 项目脚手架与构建管线"
```

---

### Task 2: 设置的类型、默认值与校验

设置是后续几乎所有模块的输入，先把它的形状钉死。此任务只做纯逻辑，不碰文件系统。

**Files:**
- Create: `src/main/core/settings-schema.ts`
- Create: `tests/unit/settings-schema.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `interface LauncherSettings { port: number; dshHome: string | null; closeToTray: boolean; telemetryDisabled: boolean; updateChannel: 'latest' | 'next'; activeRuntime: string | null }`
  - `const DEFAULT_SETTINGS: LauncherSettings`
  - `function parseSettings(raw: unknown): LauncherSettings` —— 逐字段校验，非法字段回落默认值，绝不抛错。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/settings-schema.spec.ts`：

```typescript
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
      dshHome: String.raw`D:\dsh`,
      closeToTray: false,
      telemetryDisabled: true,
      updateChannel: 'next',
      activeRuntime: 'dsh-0.1.0-rc.8',
    })
    expect(parsed).toEqual({
      port: 3080,
      dshHome: String.raw`D:\dsh`,
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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/unit/settings-schema.spec.ts
```

预期：FAIL —— 无法解析 `../../src/main/core/settings-schema.ts`。

- [ ] **Step 3: 实现**

创建 `src/main/core/settings-schema.ts`：

```typescript
/**
 * 外壳自身的设置。刻意不包含任何模型或凭据配置——那属于上游 Web UI。
 */
export interface LauncherSettings {
  /** dsh 监听端口；0 表示交由操作系统分配空闲端口。 */
  port: number
  /** 自定义 DSH_HOME；null 表示不传该变量，沿用上游默认的 ~/.dsh。 */
  dshHome: string | null
  /** 关闭主窗口时最小化到托盘而非退出。 */
  closeToTray: boolean
  /** 是否给 dsh 传 DSH_TELEMETRY_DISABLED。默认 false，保持上游原样。 */
  telemetryDisabled: boolean
  /** 更新通道：latest 为稳定版，next 跟随上游 master。 */
  updateChannel: 'latest' | 'next'
  /** 当前生效的已更新运行时目录名；null 表示使用内置副本。 */
  activeRuntime: string | null
}

export const DEFAULT_SETTINGS: LauncherSettings = {
  port: 0,
  dshHome: null,
  closeToTray: true,
  telemetryDisabled: false,
  updateChannel: 'latest',
  activeRuntime: null,
}

function asPort(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 0
  if (value < 0 || value > 65535) return 0
  return value
}

function asOptionalPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asChannel(value: unknown): 'latest' | 'next' {
  return value === 'next' ? 'next' : 'latest'
}

/**
 * 把任意来源的原始值收敛成一份合法设置。
 * 单个字段非法只影响该字段，绝不抛错——配置文件损坏不应该让应用启动不了。
 */
export function parseSettings(raw: unknown): LauncherSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS }
  const source = raw as Record<string, unknown>
  return {
    port: asPort(source.port),
    dshHome: asOptionalPath(source.dshHome),
    closeToTray: asBoolean(source.closeToTray, DEFAULT_SETTINGS.closeToTray),
    telemetryDisabled: asBoolean(source.telemetryDisabled, DEFAULT_SETTINGS.telemetryDisabled),
    updateChannel: asChannel(source.updateChannel),
    activeRuntime: asOptionalPath(source.activeRuntime),
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/settings-schema.spec.ts
```

预期：PASS，10 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/main/core/settings-schema.ts tests/unit/settings-schema.spec.ts
git commit -m "feat: 设置的类型、默认值与容错校验"
```

---

### Task 3: 就绪行解析

外壳判定 dsh 就绪的**主**依据。上游注释明确该行是为 supervisor 设计的就绪信号，实测格式为 `dsh web: http://127.0.0.1:53933`，LAN 可达时后面还会跟一段 `(LAN: http://...)`。解析必须只认回环地址，避免误把 LAN 地址当作加载目标。

**Files:**
- Create: `src/main/core/url-line-parser.ts`
- Create: `tests/unit/url-line-parser.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces: `function parseReadyLine(line: string): string | undefined` —— 命中返回回环 URL 字符串，否则返回 `undefined`。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/url-line-parser.spec.ts`：

```typescript
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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/unit/url-line-parser.spec.ts
```

预期：FAIL —— 无法解析 `url-line-parser.ts`。

- [ ] **Step 3: 实现**

创建 `src/main/core/url-line-parser.ts`：

```typescript
/** 上游就绪行前缀，见 packages/bundle/web-app/src/index.ts 的 announceReady。 */
const READY_PREFIX = 'dsh web:'

/** 与上游 isLoopbackHostname 保持一致的回环判定。 */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * 从 dsh 的一行 stdout 中识别就绪信号并取出可加载的回环 URL。
 *
 * 只接受回环地址：该行在 LAN 可达时还会附带一个局域网地址，
 * 而外壳必须加载回环地址——上游的 /api 信任围栏无条件放行回环，
 * 加载 LAN 地址则会落入需要额外授信的路径。
 *
 * @param line - dsh stdout 的一行（可含前后空白）
 * @returns 命中时返回回环 URL，否则 undefined
 */
export function parseReadyLine(line: string): string | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith(READY_PREFIX)) return undefined
  const rest = trimmed.slice(READY_PREFIX.length).trim()
  const token = rest.split(/\s+/)[0]
  if (token === undefined || !token.startsWith('http://')) return undefined
  let parsed: URL
  try {
    parsed = new URL(token)
  } catch {
    return undefined
  }
  if (!isLoopbackHostname(parsed.hostname)) return undefined
  return token
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/url-line-parser.spec.ts
```

预期：PASS，6 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/main/core/url-line-parser.ts tests/unit/url-line-parser.spec.ts
git commit -m "feat: dsh 就绪行解析，只接受回环地址"
```

---

### Task 4: 版本比较与退避策略

两个小而关键的纯函数。版本比较要能正确处理 `0.1.0-rc.7` 与 `0.1.0-rc.8` 这类预发布号——上游当前全部版本都是 rc，用朴素字符串比较会出错。

**Files:**
- Create: `src/main/core/version-compare.ts`
- Create: `src/main/core/backoff.ts`
- Create: `tests/unit/version-compare.spec.ts`
- Create: `tests/unit/backoff.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `function isNewer(candidate: string, current: string): boolean`
  - `function backoffDelay(attempt: number): number` —— attempt 从 1 起。
  - `const MAX_RESTART_ATTEMPTS: number` —— 值为 3。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/version-compare.spec.ts`：

```typescript
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
```

创建 `tests/unit/backoff.spec.ts`：

```typescript
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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/unit/version-compare.spec.ts tests/unit/backoff.spec.ts
```

预期：FAIL —— 两个模块都无法解析。

- [ ] **Step 3: 实现**

创建 `src/main/core/version-compare.ts`：

```typescript
interface ParsedVersion {
  release: number[]
  prerelease: (string | number)[]
}

/** 解析形如 `0.1.0-rc.8` 的版本号；无法解析时返回 undefined。 */
function parse(version: string): ParsedVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version.trim())
  if (match === null) return undefined
  const release = [Number(match[1]), Number(match[2]), Number(match[3])]
  const prerelease = match[4] === undefined
    ? []
    : match[4].split('.').map(part => (/^\d+$/.test(part) ? Number(part) : part))
  return { release, prerelease }
}

/** 比较两个预发布标识符序列，遵循 semver 规则。 */
function comparePrerelease(a: (string | number)[], b: (string | number)[]): number {
  // 空预发布序列代表正式版，正式版大于任何预发布版。
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i]
    const right = b[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue
    if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1
    if (typeof left === 'number') return -1
    if (typeof right === 'number') return 1
    return left < right ? -1 : 1
  }
  return 0
}

/**
 * candidate 是否比 current 更新。
 * 任一方无法解析时返回 false——宁可漏报更新，也不要据一个看不懂的版本号去替换可用的运行时。
 */
export function isNewer(candidate: string, current: string): boolean {
  const left = parse(candidate)
  const right = parse(current)
  if (left === undefined || right === undefined) return false
  for (let i = 0; i < 3; i += 1) {
    const a = left.release[i] ?? 0
    const b = right.release[i] ?? 0
    if (a !== b) return a > b
  }
  return comparePrerelease(left.prerelease, right.prerelease) > 0
}
```

创建 `src/main/core/backoff.ts`：

```typescript
/** 连续崩溃达到此次数后停止自动重启，转为向用户报错。 */
export const MAX_RESTART_ATTEMPTS = 3

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30000

/**
 * 第 attempt 次重启前的等待时长。
 * 指数退避避免在 dsh 持续启动失败时形成高频重启循环。
 * @param attempt - 第几次重启，从 1 起
 */
export function backoffDelay(attempt: number): number {
  const normalized = attempt < 1 ? 1 : attempt
  return Math.min(BASE_DELAY_MS * 2 ** (normalized - 1), MAX_DELAY_MS)
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/version-compare.spec.ts tests/unit/backoff.spec.ts
```

预期：PASS，10 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/main/core/version-compare.ts src/main/core/backoff.ts tests/unit/version-compare.spec.ts tests/unit/backoff.spec.ts
git commit -m "feat: semver 比较（含 rc 预发布）与崩溃重启退避策略"
```

---

### Task 5: 路径解析与运行时择一

外壳需要在「内置只读副本」与「更新下来的副本」之间选一个来运行。把路径推导和择一规则都做成纯函数，是为了让「更新翻车后能不能回落到内置副本」这件事可以被测试直接验证，而不是靠手工模拟。

**Files:**
- Create: `src/main/paths.ts`
- Create: `src/main/core/runtime-resolver.ts`
- Create: `tests/unit/paths.spec.ts`
- Create: `tests/unit/runtime-resolver.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `interface LauncherPaths { userData: string; settingsFile: string; logsDir: string; runtimesDir: string; bundledDshRoot: string; nodeExe: string; npmCli: string }`
  - `function resolvePaths(input: { userData: string; resources: string }): LauncherPaths`
  - `interface RuntimeChoice { dshRoot: string; dshBin: string; version: string; source: 'bundled' | 'updated' }`
  - `function resolveRuntime(input: { bundledDshRoot: string; updatedDshRoot: string | null; readVersion: (dshRoot: string) => string | undefined }): RuntimeChoice`
  - `resolveRuntime` 在内置副本也读不到版本时抛 `Error`。

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/paths.spec.ts`：

```typescript
import { describe, expect, it } from 'vitest'
import { resolvePaths } from '../../src/main/paths.ts'

// 用 String.raw 写 Windows 路径，避免反斜杠被当成字符串转义。
const USER_DATA = String.raw`C:\data`
const RESOURCES = String.raw`C:\app\resources`

describe('resolvePaths', () => {
  const paths = resolvePaths({ userData: USER_DATA, resources: RESOURCES })

  it('设置文件位于用户数据目录下', () => {
    expect(paths.settingsFile).toBe(String.raw`C:\data\config.json`)
  })

  it('日志与运行时目录位于用户数据目录下', () => {
    expect(paths.logsDir).toBe(String.raw`C:\data\logs`)
    expect(paths.runtimesDir).toBe(String.raw`C:\data\dsh-runtime`)
  })

  it('内置 dsh 副本指向 npm 安装后的包根目录', () => {
    expect(paths.bundledDshRoot).toBe(String.raw`C:\app\resources\dsh-bundled\node_modules\@deepseek-ai\dsh`)
  })

  it('内置 Node 与 npm 入口位于 resources/runtime/node 下', () => {
    expect(paths.nodeExe).toBe(String.raw`C:\app\resources\runtime\node\node.exe`)
    expect(paths.npmCli).toBe(String.raw`C:\app\resources\runtime\node\node_modules\npm\bin\npm-cli.js`)
  })

  it('暴露资源根目录', () => {
    expect(paths.resourcesRoot).toBe(RESOURCES)
  })
})
```

创建 `tests/unit/runtime-resolver.spec.ts`：

```typescript
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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/unit/paths.spec.ts tests/unit/runtime-resolver.spec.ts
```

预期：FAIL —— 两个模块都无法解析。

- [ ] **Step 3: 实现**

创建 `src/main/paths.ts`：

```typescript
import { join } from 'node:path'

/** 外壳用到的全部路径，集中在此推导，避免各处散落字符串拼接。 */
export interface LauncherPaths {
  /** 外壳自身的数据根目录。 */
  userData: string
  /** 外壳设置文件。 */
  settingsFile: string
  /** 日志目录。 */
  logsDir: string
  /** 更新下来的各版本 dsh 存放目录。 */
  runtimesDir: string
  /** 内置 dsh 副本的包根目录（只读）。 */
  bundledDshRoot: string
  /** 内置 Node 可执行文件。 */
  nodeExe: string
  /** 内置 npm 的 CLI 入口，更新时用它安装依赖树。 */
  npmCli: string
}

/** npm 安装 @deepseek-ai/dsh 后，包根目录相对于安装前缀的位置。 */
export const DSH_PACKAGE_SUBPATH = join('node_modules', '@deepseek-ai', 'dsh')

export function resolvePaths(input: { userData: string; resources: string }): LauncherPaths {
  const nodeRoot = join(input.resources, 'runtime', 'node')
  return {
    userData: input.userData,
    settingsFile: join(input.userData, 'config.json'),
    logsDir: join(input.userData, 'logs'),
    runtimesDir: join(input.userData, 'dsh-runtime'),
    bundledDshRoot: join(input.resources, 'dsh-bundled', DSH_PACKAGE_SUBPATH),
    nodeExe: join(nodeRoot, 'node.exe'),
    npmCli: join(nodeRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  }
}
```

创建 `src/main/core/runtime-resolver.ts`：

```typescript
import { join } from 'node:path'

export interface RuntimeChoice {
  /** dsh 包根目录。 */
  dshRoot: string
  /** 实际要交给 Node 执行的入口。 */
  dshBin: string
  version: string
  source: 'bundled' | 'updated'
}

export interface ResolveRuntimeInput {
  bundledDshRoot: string
  /** 设置中指向的已更新副本；null 表示未启用更新副本。 */
  updatedDshRoot: string | null
  /** 读取某个 dsh 包根目录的版本号；读不到（不存在或损坏）返回 undefined。 */
  readVersion: (dshRoot: string) => string | undefined
}

/**
 * 决定本次启动使用哪一份 dsh。
 *
 * 更新副本优先，但只要它读不出版本就回落到内置副本——这是回滚链条的最后一环：
 * 即使更新写坏了目录，下次启动仍能用内置副本起来，用户不会被卡在启动失败。
 * 不比较版本高低，因为用户可能刻意停留在某个旧版本。
 *
 * @throws 内置副本也不可用时抛错，此时属于安装损坏，须让用户重装而非静默降级。
 */
export function resolveRuntime(input: ResolveRuntimeInput): RuntimeChoice {
  if (input.updatedDshRoot !== null) {
    const version = input.readVersion(input.updatedDshRoot)
    if (version !== undefined) {
      return {
        dshRoot: input.updatedDshRoot,
        dshBin: join(input.updatedDshRoot, 'lib', 'bin.js'),
        version,
        source: 'updated',
      }
    }
  }
  const bundledVersion = input.readVersion(input.bundledDshRoot)
  if (bundledVersion === undefined) {
    throw new Error(`内置 dsh 副本不可用：${input.bundledDshRoot}。安装可能已损坏，请重新安装 DSH启动器。`)
  }
  return {
    dshRoot: input.bundledDshRoot,
    dshBin: join(input.bundledDshRoot, 'lib', 'bin.js'),
    version: bundledVersion,
    source: 'bundled',
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/paths.spec.ts tests/unit/runtime-resolver.spec.ts
```

预期：PASS，10 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/main/paths.ts src/main/core/runtime-resolver.ts tests/unit/paths.spec.ts tests/unit/runtime-resolver.spec.ts
git commit -m "feat: 路径推导与 dsh 运行时择一（更新副本损坏可回落内置）"
```

---

### Task 6: 设置持久化与日志归集

两个都有副作用但职责很窄的服务。设置读取必须在文件损坏时也能返回可用默认值——否则一个坏掉的 JSON 会让应用彻底起不来。

**Files:**
- Create: `src/main/services/settings-store.ts`
- Create: `src/main/services/log-store.ts`
- Create: `tests/unit/settings-store.spec.ts`
- Create: `tests/unit/log-store.spec.ts`

**Interfaces:**
- Consumes: `LauncherSettings`、`parseSettings`、`DEFAULT_SETTINGS`（Task 2）
- Produces:
  - `class SettingsStore { constructor(filePath: string); read(): LauncherSettings; update(patch: Partial<LauncherSettings>): LauncherSettings }`
  - `type LogSource = 'shell' | 'dsh-out' | 'dsh-err'`
  - `class LogStore { constructor(dir: string, maxLines?: number); append(source: LogSource, text: string): void; tail(count: number): string[]; get filePath(): string }`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/settings-store.spec.ts`：

```typescript
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
```

创建 `tests/unit/log-store.spec.ts`：

```typescript
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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/unit/settings-store.spec.ts tests/unit/log-store.spec.ts
```

预期：FAIL —— 两个服务模块都无法解析。

- [ ] **Step 3: 实现**

创建 `src/main/services/settings-store.ts`：

```typescript
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, parseSettings, type LauncherSettings } from '../core/settings-schema.ts'

/**
 * 外壳设置的持久化。
 * 读取一律走 parseSettings，因此损坏的文件只会退化成默认设置，
 * 不会让应用起不来——配置问题不该升级成可用性问题。
 */
export class SettingsStore {
  readonly #filePath: string

  constructor(filePath: string) {
    this.#filePath = filePath
  }

  get filePath(): string {
    return this.#filePath
  }

  read(): LauncherSettings {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(this.#filePath, 'utf8'))
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
    return parseSettings(raw)
  }

  /** 合并写入若干字段，返回落盘后的完整设置。 */
  update(patch: Partial<LauncherSettings>): LauncherSettings {
    const merged = parseSettings({ ...this.read(), ...patch })
    mkdirSync(dirname(this.#filePath), { recursive: true })
    writeFileSync(this.#filePath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
    return merged
  }
}
```

创建 `src/main/services/log-store.ts`：

```typescript
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type LogSource = 'shell' | 'dsh-out' | 'dsh-err'

const DEFAULT_MAX_LINES = 5000

/**
 * 外壳与 dsh 输出的统一归集。
 * 内存保留最近若干行供面板即时展示，同时落盘一份供用户直接打开或反馈问题时附带。
 */
export class LogStore {
  readonly #filePath: string
  readonly #maxLines: number
  #lines: string[] = []

  constructor(dir: string, maxLines: number = DEFAULT_MAX_LINES) {
    mkdirSync(dir, { recursive: true })
    this.#filePath = join(dir, 'launcher.log')
    this.#maxLines = maxLines
    try {
      const existing = readFileSync(this.#filePath, 'utf8').split('\n').filter(line => line !== '')
      this.#lines = existing.slice(-maxLines)
    } catch {
      this.#lines = []
    }
  }

  get filePath(): string {
    return this.#filePath
  }

  /** 追加一段输出；其中的换行会被拆成独立记录，空行忽略。 */
  append(source: LogSource, text: string): void {
    const stamp = new Date().toISOString()
    const incoming = text
      .split('\n')
      .map(line => line.trimEnd())
      .filter(line => line.trim() !== '')
      .map(line => `${stamp} [${source}] ${line}`)
    if (incoming.length === 0) return

    this.#lines.push(...incoming)
    const overflow = this.#lines.length - this.#maxLines
    if (overflow > 0) {
      this.#lines = this.#lines.slice(overflow)
      // 超限后整体重写，避免磁盘文件无限增长。
      writeFileSync(this.#filePath, `${this.#lines.join('\n')}\n`, 'utf8')
      return
    }
    appendFileSync(this.#filePath, `${incoming.join('\n')}\n`, 'utf8')
  }

  tail(count: number): string[] {
    return this.#lines.slice(-count)
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/settings-store.spec.ts tests/unit/log-store.spec.ts
```

预期：PASS，13 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/main/services/settings-store.ts src/main/services/log-store.ts tests/unit/settings-store.spec.ts tests/unit/log-store.spec.ts
git commit -m "feat: 设置持久化与日志归集"
```

---

### Task 7: dsh 子进程监督

外壳的心脏。它把「拉起进程、等就绪、崩了重启、退出时收干净」这四件事收在一个状态机里。用一个假 dsh 脚本驱动集成测试，因此不需要真的装 dsh 就能验证全部分支。

注意一个容易做错的地方：`--port 0` 模式下若始终没等到就绪行，外壳**无从**做 HTTP 兜底探测——端口是由操作系统分配的，不读就绪行就不知道端口是多少。只有用户配置了固定端口时兜底探测才有意义。

**Files:**
- Create: `src/main/services/readiness-probe.ts`
- Create: `src/main/services/dsh-supervisor.ts`
- Create: `tests/integration/fake-dsh.mjs`
- Create: `tests/unit/readiness-probe.spec.ts`
- Create: `tests/integration/supervisor.spec.ts`

**Interfaces:**
- Consumes: `parseReadyLine`（Task 3）、`backoffDelay`、`MAX_RESTART_ATTEMPTS`（Task 4）
- Produces:
  - `function probeUntilReady(url: string, opts: { timeoutMs: number; intervalMs: number; fetchFn?: typeof fetch }): Promise<boolean>`
  - `type SupervisorState = 'idle' | 'starting' | 'ready' | 'stopping' | 'crashed'`
  - `interface DshSupervisorOptions { nodeExe: string; dshBin: string; port: number; dshHome: string | null; telemetryDisabled: boolean; readyTimeoutMs?: number; spawnEnv?: Record<string, string> }`
  - `simulateCrashForTest(): void` —— 仅供集成测试触发崩溃重启路径。
  - `class DshSupervisor extends EventEmitter { start(): void; stop(): Promise<void>; get state(): SupervisorState; get url(): string | undefined }`
  - 事件：`state`(SupervisorState)、`ready`(string)、`output`(source: 'dsh-out'|'dsh-err', text: string)、`failed`(reason: string)

- [ ] **Step 1: 写失败测试**

创建 `tests/integration/fake-dsh.mjs`（冒充 dsh 的假服务，由环境变量控制行为）：

```javascript
// 冒充 dsh 的假服务，仅用于驱动 supervisor 的集成测试。
// 通过 FAKE_DSH_MODE 控制行为：
//   ready      正常打印就绪行并保持运行（默认）
//   crash      打印就绪行后立刻退出，模拟运行中崩溃
//   fail       不打印就绪行，直接以非零码退出，模拟启动失败
//   silent     不打印就绪行但保持运行，模拟卡住
import { createServer } from 'node:http'

const mode = process.env.FAKE_DSH_MODE ?? 'ready'

if (mode === 'fail') {
  process.stderr.write('fake-dsh: 启动失败\n')
  process.exit(1)
}

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end('fake dsh')
})

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  if (mode !== 'silent') {
    process.stdout.write(`dsh web: http://127.0.0.1:${port}\n`)
  }
  if (mode === 'crash') {
    process.exit(3)
  }
})

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})
```

创建 `tests/unit/readiness-probe.spec.ts`：

```typescript
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
```

创建 `tests/integration/supervisor.spec.ts`：

```typescript
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DshSupervisor, type SupervisorState } from '../../src/main/services/dsh-supervisor.ts'

const FAKE_DSH = fileURLToPath(new URL('./fake-dsh.mjs', import.meta.url))

function makeSupervisor(mode: string, overrides: Record<string, unknown> = {}): DshSupervisor {
  return new DshSupervisor({
    nodeExe: process.execPath,
    dshBin: FAKE_DSH,
    port: 0,
    dshHome: null,
    telemetryDisabled: false,
    readyTimeoutMs: 8000,
    spawnEnv: { FAKE_DSH_MODE: mode },
    ...overrides,
  })
}

describe('DshSupervisor', () => {
  it('正常启动后进入 ready 并给出回环 URL', async () => {
    const supervisor = makeSupervisor('ready')
    const url = await new Promise<string>((resolve, reject) => {
      supervisor.on('ready', resolve)
      supervisor.on('failed', reason => reject(new Error(reason)))
      supervisor.start()
    })
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(supervisor.state).toBe('ready')
    expect(supervisor.url).toBe(url)
    await supervisor.stop()
    expect(supervisor.state).toBe('idle')
  })

  it('状态依次经过 starting 与 ready', async () => {
    const supervisor = makeSupervisor('ready')
    const seen: SupervisorState[] = []
    supervisor.on('state', s => seen.push(s))
    await new Promise<void>((resolve, reject) => {
      supervisor.on('ready', () => resolve())
      supervisor.on('failed', reason => reject(new Error(reason)))
      supervisor.start()
    })
    expect(seen).toContain('starting')
    expect(seen).toContain('ready')
    await supervisor.stop()
  })

  it('子进程启动即失败时报 failed 而非无限重试', async () => {
    const supervisor = makeSupervisor('fail', { readyTimeoutMs: 3000 })
    const reason = await new Promise<string>(resolve => {
      supervisor.on('failed', resolve)
      supervisor.start()
    })
    expect(reason).toContain('启动失败')
    expect(supervisor.state).toBe('crashed')
  }, 40000)

  it('就绪后崩溃会自动重启并重新就绪', async () => {
    const supervisor = makeSupervisor('ready')
    await new Promise<void>((resolve, reject) => {
      supervisor.on('ready', () => resolve())
      supervisor.on('failed', reason => reject(new Error(reason)))
      supervisor.start()
    })
    const restarted = new Promise<string>(resolve => supervisor.once('ready', resolve))
    supervisor.simulateCrashForTest()
    const url = await restarted
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    await supervisor.stop()
  }, 40000)

  it('固定端口且始终等不到就绪行时，超时后判定失败', async () => {
    const supervisor = makeSupervisor('silent', { port: 3080, readyTimeoutMs: 600 })
    const reason = await new Promise<string>(resolve => {
      supervisor.on('failed', resolve)
      supervisor.start()
    })
    expect(reason).toContain('超时')
    await supervisor.stop()
  }, 40000)

  it('stop 后不再自动重启', async () => {
    const supervisor = makeSupervisor('ready')
    await new Promise<void>((resolve, reject) => {
      supervisor.on('ready', () => resolve())
      supervisor.on('failed', reason => reject(new Error(reason)))
      supervisor.start()
    })
    await supervisor.stop()
    let restarted = false
    supervisor.on('ready', () => { restarted = true })
    await new Promise(resolve => setTimeout(resolve, 500))
    expect(restarted).toBe(false)
    expect(supervisor.state).toBe('idle')
  }, 40000)

  it('把子进程输出转发给监听者', async () => {
    const supervisor = makeSupervisor('ready')
    const chunks: string[] = []
    supervisor.on('output', (_source, text) => chunks.push(text))
    await new Promise<void>((resolve, reject) => {
      supervisor.on('ready', () => resolve())
      supervisor.on('failed', reason => reject(new Error(reason)))
      supervisor.start()
    })
    expect(chunks.join('')).toContain('dsh web:')
    await supervisor.stop()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/unit/readiness-probe.spec.ts tests/integration/supervisor.spec.ts
```

预期：FAIL —— `readiness-probe.ts` 与 `dsh-supervisor.ts` 都无法解析。

- [ ] **Step 3: 实现兜底探测**

创建 `src/main/services/readiness-probe.ts`：

```typescript
export interface ProbeOptions {
  timeoutMs: number
  intervalMs: number
  fetchFn?: typeof fetch
}

/**
 * 轮询直到目标地址有响应。
 *
 * 这是**兜底**手段，不是主判定：主判定是 dsh stdout 上的就绪行。
 * 任何 HTTP 响应都视为就绪——哪怕是 5xx，也说明端口已在监听，
 * 服务已经起来了，具体某个路径报错不属于「有没有起来」的范畴。
 */
export async function probeUntilReady(url: string, opts: ProbeOptions): Promise<boolean> {
  const fetchFn = opts.fetchFn ?? fetch
  const deadline = Date.now() + opts.timeoutMs
  for (;;) {
    try {
      await fetchFn(url, { method: 'GET' })
      return true
    } catch {
      if (Date.now() + opts.intervalMs >= deadline) return false
      await new Promise(resolve => setTimeout(resolve, opts.intervalMs))
    }
  }
}
```

- [ ] **Step 4: 实现监督器**

创建 `src/main/services/dsh-supervisor.ts`：

```typescript
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { backoffDelay, MAX_RESTART_ATTEMPTS } from '../core/backoff.ts'
import { parseReadyLine } from '../core/url-line-parser.ts'
import { probeUntilReady } from './readiness-probe.ts'

/** 本监督器固定以 stdio: ['ignore','pipe','pipe'] 启动，故 stdin 为 null、两个输出流可读。 */
type DshChild = ChildProcessByStdio<null, Readable, Readable>

export type SupervisorState = 'idle' | 'starting' | 'ready' | 'stopping' | 'crashed'

export interface DshSupervisorOptions {
  /** 内置 Node 可执行文件。 */
  nodeExe: string
  /** dsh 的 lib/bin.js 绝对路径。 */
  dshBin: string
  /** 监听端口；0 表示交由操作系统分配。 */
  port: number
  /** 自定义 DSH_HOME；null 表示不传，沿用上游默认。 */
  dshHome: string | null
  telemetryDisabled: boolean
  /** 等待就绪行的上限，默认 60 秒。 */
  readyTimeoutMs?: number
  /** 附加到子进程的环境变量，仅测试用。 */
  spawnEnv?: Record<string, string>
}

const DEFAULT_READY_TIMEOUT_MS = 60000
const STOP_GRACE_MS = 5000

/**
 * dsh 子进程的生命周期管理者。
 *
 * 就绪判定以 stdout 的就绪行为准——上游明确把该行设计为 supervisor 信号，
 * 且保证它在插件树挂载完成后才输出，比 HTTP 探测更早也更准。
 * HTTP 探测只在「用户指定了固定端口」且迟迟等不到就绪行时作为兜底：
 * 端口为 0 时端口由操作系统分配，不读就绪行就无从得知，也就无从探测。
 */
export class DshSupervisor extends EventEmitter {
  readonly #opts: DshSupervisorOptions
  #child: DshChild | undefined
  #state: SupervisorState = 'idle'
  #url: string | undefined
  #stdoutBuffer = ''
  #restartAttempts = 0
  #readyTimer: NodeJS.Timeout | undefined
  #restartTimer: NodeJS.Timeout | undefined
  /** 用户主动停止后置位，用于区分「崩溃」与「正常关停」。 */
  #stopping = false

  constructor(opts: DshSupervisorOptions) {
    super()
    this.#opts = opts
  }

  get state(): SupervisorState {
    return this.#state
  }

  get url(): string | undefined {
    return this.#url
  }

  #setState(next: SupervisorState): void {
    if (this.#state === next) return
    this.#state = next
    this.emit('state', next)
  }

  #buildArgs(): string[] {
    return [
      this.#opts.dshBin,
      '--profile', 'web',
      '--no-open',
      '--host', '127.0.0.1',
      '--port', String(this.#opts.port),
    ]
  }

  #buildEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ...this.#opts.spawnEnv }
    if (this.#opts.dshHome !== null) env.DSH_HOME = this.#opts.dshHome
    if (this.#opts.telemetryDisabled) env.DSH_TELEMETRY_DISABLED = '1'
    else delete env.DSH_TELEMETRY_DISABLED
    return env
  }

  start(): void {
    // 守卫的判据是「是否已有活跃子进程」，不能用状态判断：
    // 崩溃后等待重启期间状态同样是 starting，但此时并无子进程，
    // 用状态判断会让退避计时器到点后原地返回，重启永远不发生。
    if (this.#child !== undefined) return
    this.#stopping = false
    this.#url = undefined
    this.#stdoutBuffer = ''
    this.#setState('starting')

    const child: DshChild = spawn(this.#opts.nodeExe, this.#buildArgs(), {
      env: this.#buildEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.#child = child

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      this.emit('output', 'dsh-out', chunk)
      this.#consumeStdout(chunk)
    })
    child.stderr.on('data', (chunk: string) => {
      this.emit('output', 'dsh-err', chunk)
    })
    child.on('error', (error: Error) => {
      this.#fail(`dsh 启动失败：${error.message}`)
    })
    child.on('exit', (code, signal) => {
      this.#child = undefined
      this.#clearReadyTimer()
      if (this.#stopping) {
        this.#setState('idle')
        return
      }
      this.#handleUnexpectedExit(code, signal)
    })

    const timeout = this.#opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    this.#readyTimer = setTimeout(() => { void this.#onReadyTimeout(timeout) }, timeout)
  }

  /** 按行扫描 stdout，命中就绪行即宣告就绪。 */
  #consumeStdout(chunk: string): void {
    if (this.#url !== undefined) return
    this.#stdoutBuffer += chunk
    const lines = this.#stdoutBuffer.split('\n')
    this.#stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      const url = parseReadyLine(line)
      if (url === undefined) continue
      this.#markReady(url)
      return
    }
  }

  #markReady(url: string): void {
    this.#clearReadyTimer()
    this.#url = url
    this.#restartAttempts = 0
    this.#setState('ready')
    this.emit('ready', url)
  }

  /**
   * 就绪行迟迟不来。固定端口下还能靠 HTTP 探测兜底；
   * 端口为 0 时端口不可知，只能判定失败。
   */
  async #onReadyTimeout(timeout: number): Promise<void> {
    if (this.#url !== undefined || this.#stopping) return
    if (this.#opts.port > 0) {
      const fallbackUrl = `http://127.0.0.1:${String(this.#opts.port)}`
      const alive = await probeUntilReady(fallbackUrl, { timeoutMs: 3000, intervalMs: 300 })
      if (alive) {
        this.#markReady(fallbackUrl)
        return
      }
    }
    this.#fail(`等待 dsh 就绪超时（${String(timeout)} 毫秒内未收到就绪信号）`)
  }

  #handleUnexpectedExit(code: number | null, signal: NodeJS.Signals | null): void {
    const detail = code === null ? `信号 ${String(signal)}` : `退出码 ${String(code)}`
    // 从未就绪过就退出，属于启动失败，重试通常也不会好转。
    if (this.#url === undefined) {
      this.#fail(`dsh 启动失败：进程以${detail}退出`)
      return
    }
    this.#restartAttempts += 1
    if (this.#restartAttempts > MAX_RESTART_ATTEMPTS) {
      this.#fail(`dsh 连续 ${String(MAX_RESTART_ATTEMPTS)} 次崩溃后停止重启（最后一次${detail}）`)
      return
    }
    this.#url = undefined
    this.#setState('starting')
    const delay = backoffDelay(this.#restartAttempts)
    this.#restartTimer = setTimeout(() => {
      if (this.#stopping) return
      this.start()
    }, delay)
  }

  #fail(reason: string): void {
    this.#clearReadyTimer()
    this.#setState('crashed')
    this.emit('failed', reason)
  }

  #clearReadyTimer(): void {
    if (this.#readyTimer !== undefined) {
      clearTimeout(this.#readyTimer)
      this.#readyTimer = undefined
    }
  }

  /** 优雅关停：先送终止信号，超时未退再强制结束。 */
  async stop(): Promise<void> {
    this.#stopping = true
    this.#clearReadyTimer()
    if (this.#restartTimer !== undefined) {
      clearTimeout(this.#restartTimer)
      this.#restartTimer = undefined
    }
    const child = this.#child
    if (child === undefined) {
      this.#setState('idle')
      return
    }
    this.#setState('stopping')
    await new Promise<void>(resolve => {
      const forceTimer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, STOP_GRACE_MS)
      child.once('exit', () => {
        clearTimeout(forceTimer)
        resolve()
      })
      child.kill('SIGTERM')
    })
    this.#child = undefined
    this.#url = undefined
    this.#setState('idle')
  }

  /** 仅供测试：强制杀死当前子进程以触发崩溃重启路径。 */
  simulateCrashForTest(): void {
    this.#child?.kill('SIGKILL')
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npx vitest run tests/unit/readiness-probe.spec.ts tests/integration/supervisor.spec.ts
```

预期：PASS，11 个测试全部通过。若崩溃重启一例超时，确认 `backoffDelay(1)` 为 1000 毫秒且用例超时设为 40000。

- [ ] **Step 6: 提交**

```bash
git add src/main/services/readiness-probe.ts src/main/services/dsh-supervisor.ts tests/unit/readiness-probe.spec.ts tests/integration/supervisor.spec.ts tests/integration/fake-dsh.mjs
git commit -m "feat: dsh 子进程监督状态机与就绪兜底探测"
```

---

### Task 8: 启动编排与启动页（里程碑：首次真正跑通）

把前七个任务串起来：读设置 → 择一运行时 → 拉起 dsh → 等就绪 → 主窗口加载真实 Web UI。完成后应用第一次具备实际使用价值。

此任务需要真实的 dsh 与 Node，因此先落地取资源的脚本。

**Files:**
- Create: `scripts/fetch-node-runtime.mjs`
- Create: `scripts/fetch-dsh-bundle.mjs`
- Create: `src/main/ipc/channels.ts`
- Modify: `src/main/index.ts`（Task 1 建立，此处整体替换）
- Modify: `src/preload/index.ts`（Task 1 建立，此处整体替换）
- Create: `src/renderer/shared.css`
- Modify: `src/renderer/splash/index.html`（Task 1 建立，此处整体替换）
- Create: `src/renderer/splash/main.ts`
- Modify: `electron.vite.config.ts`（Task 1 建立，此处整体替换）

**Interfaces:**
- Consumes: `resolvePaths`、`resolveRuntime`（Task 5）、`SettingsStore`、`LogStore`（Task 6）、`DshSupervisor`（Task 7）
- Produces:
  - `const IPC: { splashState: 'splash:state'; splashRetry: 'splash:retry'; openLogFile: 'shell:open-log-file' }`
  - `interface SplashPayload { phase: 'starting' | 'ready' | 'failed'; message: string; detail?: string }`
  - preload 暴露 `window.launcher.onSplashState(cb)`、`window.launcher.retry()`、`window.launcher.openLogFile()`

- [ ] **Step 1: 写取资源脚本**

创建 `scripts/fetch-node-runtime.mjs`：

```javascript
// 下载官方 Node 运行时并解包到 resources/runtime/node。
// 保留 npm：更新 dsh 需要安装一棵约 195 个包的依赖树，
// 自行实现依赖解析不现实，交给 npm 最稳妥。
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = manifest.dshLauncher.nodeVersion
const target = join(root, 'resources', 'runtime', 'node')

if (existsSync(join(target, 'node.exe'))) {
  console.log(`Node 运行时已存在，跳过下载：${target}`)
  process.exit(0)
}

const name = `node-v${version}-win-x64`
const url = `https://nodejs.org/dist/v${version}/${name}.zip`
const tmpDir = join(root, 'resources', '.tmp')
const zipPath = join(tmpDir, `${name}.zip`)

mkdirSync(tmpDir, { recursive: true })
console.log(`正在下载 ${url}`)
const response = await fetch(url)
if (!response.ok || response.body === null) {
  throw new Error(`下载 Node 运行时失败：HTTP ${response.status}`)
}
await pipeline(Readable.fromWeb(response.body), createWriteStream(zipPath))

console.log('正在解包…')
// 必须用 Windows 自带的 bsdtar，不能依赖 PATH 里的 tar：
// 在 Git Bash 等 MSYS 环境下 PATH 命中的是 GNU tar，它会把 `E:\...` 的
// 盘符当成 `host:path` 里的远程主机名，报 "Cannot connect to E"。
const systemTar = process.env.SystemRoot === undefined
  ? 'tar'
  : join(process.env.SystemRoot, 'System32', 'tar.exe')
const tarCmd = existsSync(systemTar) ? systemTar : 'tar'
execFileSync(tarCmd, ['-xf', zipPath, '-C', tmpDir], { stdio: 'inherit' })

mkdirSync(dirname(target), { recursive: true })
rmSync(target, { recursive: true, force: true })
renameSync(join(tmpDir, name), target)
rmSync(tmpDir, { recursive: true, force: true })

if (!existsSync(join(target, 'node.exe'))) {
  throw new Error(`解包后未找到 node.exe：${target}`)
}
console.log(`Node 运行时就绪：${target}`)
```

创建 `scripts/fetch-dsh-bundle.mjs`：

```javascript
// 用 npm 把 dsh 安装到 resources/dsh-bundled，作为随包内置的只读基线。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = manifest.dshLauncher.dshVersion
const target = join(root, 'resources', 'dsh-bundled')
const packageRoot = join(target, 'node_modules', '@deepseek-ai', 'dsh')

if (existsSync(join(packageRoot, 'lib', 'bin.js'))) {
  const installed = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version
  if (installed === version) {
    console.log(`内置 dsh 副本已是 ${version}，跳过安装`)
    process.exit(0)
  }
}

mkdirSync(target, { recursive: true })
writeFileSync(
  join(target, 'package.json'),
  `${JSON.stringify({ name: 'dsh-bundled', version: '0.0.0', private: true }, null, 2)}\n`,
  'utf8',
)

console.log(`正在安装 @deepseek-ai/dsh@${version}（依赖树较大，需要数分钟）`)
execFileSync('npm', ['install', `@deepseek-ai/dsh@${version}`, '--omit=dev', '--no-audit', '--no-fund'], {
  cwd: target,
  stdio: 'inherit',
  shell: true,
})

if (!existsSync(join(packageRoot, 'lib', 'bin.js'))) {
  throw new Error(`安装后未找到 dsh 入口：${packageRoot}`)
}
console.log(`内置 dsh 副本就绪：${packageRoot}`)
```

- [ ] **Step 2: 运行取资源脚本**

```bash
npm run prepare:resources
```

预期：`resources/runtime/node/node.exe` 存在；`resources/dsh-bundled/node_modules/@deepseek-ai/dsh/lib/bin.js` 存在。首次执行需数分钟。

- [ ] **Step 3: 定义 IPC 契约**

创建 `src/main/ipc/channels.ts`：

```typescript
/** 主进程与渲染层之间的频道名，两端共用此文件避免字符串漂移。 */
export const IPC = {
  splashState: 'splash:state',
  splashRetry: 'splash:retry',
  openLogFile: 'shell:open-log-file',
} as const

export interface SplashPayload {
  phase: 'starting' | 'ready' | 'failed'
  /** 展示给用户的一句话状态。 */
  message: string
  /** 失败时的诊断细节，通常是日志尾部。 */
  detail?: string
}
```

- [ ] **Step 4: 改写主进程为完整编排**

整体替换 `src/main/index.ts`：

```typescript
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { resolveRuntime } from './core/runtime-resolver.ts'
import { IPC, type SplashPayload } from './ipc/channels.ts'
import { resolvePaths, DSH_PACKAGE_SUBPATH } from './paths.ts'
import { DshSupervisor } from './services/dsh-supervisor.ts'
import { LogStore } from './services/log-store.ts'
import { SettingsStore } from './services/settings-store.ts'

const paths = resolvePaths({
  userData: app.getPath('userData'),
  resources: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
})
const settingsStore = new SettingsStore(paths.settingsFile)
const logStore = new LogStore(paths.logsDir)

let splashWindow: BrowserWindow | undefined
let mainWindow: BrowserWindow | undefined
let supervisor: DshSupervisor | undefined

/** 读取某个 dsh 包根目录的版本号；不可用时返回 undefined。 */
function readDshVersion(dshRoot: string): string | undefined {
  try {
    if (!existsSync(join(dshRoot, 'lib', 'bin.js'))) return undefined
    const manifest = JSON.parse(readFileSync(join(dshRoot, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

function postSplash(payload: SplashPayload): void {
  splashWindow?.webContents.send(IPC.splashState, payload)
}

function createSplashWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 560,
    height: 380,
    resizable: false,
    title: 'DSH启动器',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  void win.loadFile(join(import.meta.dirname, '../renderer/splash/index.html'))
  return win
}

function showMainWindow(url: string): void {
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    void mainWindow.loadURL(url)
    mainWindow.show()
    return
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'DSH启动器',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  // 主窗口加载的是 dsh 自己的 Web UI，外壳不注入任何脚本。
  void win.loadURL(url)
  win.once('ready-to-show', () => {
    win.show()
    splashWindow?.close()
    splashWindow = undefined
  })
  win.on('closed', () => { mainWindow = undefined })
  mainWindow = win
}

function startDsh(): void {
  const settings = settingsStore.read()
  postSplash({ phase: 'starting', message: '正在准备运行时…' })

  let choice
  try {
    choice = resolveRuntime({
      bundledDshRoot: paths.bundledDshRoot,
      updatedDshRoot: settings.activeRuntime === null
        ? null
        : join(paths.runtimesDir, settings.activeRuntime, DSH_PACKAGE_SUBPATH),
      readVersion: readDshVersion,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logStore.append('shell', reason)
    postSplash({ phase: 'failed', message: '无法启动', detail: reason })
    return
  }

  logStore.append('shell', `使用 dsh ${choice.version}（${choice.source === 'bundled' ? '内置副本' : '已更新副本'}）`)
  postSplash({ phase: 'starting', message: `正在启动 dsh ${choice.version}…` })

  const next = new DshSupervisor({
    nodeExe: paths.nodeExe,
    dshBin: choice.dshBin,
    port: settings.port,
    dshHome: settings.dshHome,
    telemetryDisabled: settings.telemetryDisabled,
  })
  next.on('output', (source, text) => { logStore.append(source, text) })
  next.on('ready', url => {
    logStore.append('shell', `dsh 就绪：${url}`)
    postSplash({ phase: 'ready', message: '已就绪' })
    showMainWindow(url)
  })
  next.on('failed', reason => {
    logStore.append('shell', reason)
    postSplash({ phase: 'failed', message: '启动失败', detail: `${reason}\n\n${logStore.tail(20).join('\n')}` })
  })
  supervisor = next
  next.start()
}

ipcMain.handle(IPC.splashRetry, async () => {
  await supervisor?.stop()
  startDsh()
})
ipcMain.handle(IPC.openLogFile, () => shell.openPath(logStore.filePath))

void app.whenReady().then(() => {
  splashWindow = createSplashWindow()
  splashWindow.webContents.once('did-finish-load', () => { startDsh() })
})

app.on('window-all-closed', () => { app.quit() })

// 退出前把 dsh 收干净，避免留下孤儿进程继续占用端口与资源。
app.on('before-quit', event => {
  if (supervisor === undefined || supervisor.state === 'idle') return
  event.preventDefault()
  void supervisor.stop().then(() => {
    supervisor = undefined
    app.quit()
  })
})
```

- [ ] **Step 5: 改写 preload 与启动页**

整体替换 `src/preload/index.ts`：

```typescript
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type SplashPayload } from '../main/ipc/channels.ts'

contextBridge.exposeInMainWorld('launcher', {
  onSplashState: (callback: (payload: SplashPayload) => void): void => {
    ipcRenderer.on(IPC.splashState, (_event, payload: SplashPayload) => { callback(payload) })
  },
  retry: (): Promise<void> => ipcRenderer.invoke(IPC.splashRetry),
  openLogFile: (): Promise<void> => ipcRenderer.invoke(IPC.openLogFile),
})
```

创建 `src/renderer/shared.css`：

```css
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted: #6b7280;
  --border: #e5e7eb;
  --accent: #2563eb;
  --danger: #b91c1c;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1c1e;
    --fg: #f5f5f7;
    --muted: #9ca3af;
    --border: #3a3a3c;
    --accent: #60a5fa;
    --danger: #f87171;
  }
}

body {
  margin: 0;
  padding: 24px;
  background: var(--bg);
  color: var(--fg);
  font-family: "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif;
  font-size: 14px;
}

h1 { font-size: 18px; margin: 0 0 4px; }
.muted { color: var(--muted); }

button {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
}
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }

pre.detail {
  max-height: 150px;
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  white-space: pre-wrap;
  color: var(--danger);
}
```

整体替换 `src/renderer/splash/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>DSH启动器</title>
    <link rel="stylesheet" href="../shared.css" />
  </head>
  <body>
    <h1>DSH启动器</h1>
    <p class="muted">基于 DeepSeek Harness 构建的非官方桌面客户端</p>
    <p id="status">正在准备…</p>
    <pre id="detail" class="detail" hidden></pre>
    <div id="actions" hidden>
      <button id="retry" class="primary" type="button">重试</button>
      <button id="open-log" type="button">打开日志</button>
    </div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

创建 `src/renderer/launcher-api.d.ts`（**所有**渲染页面共用这一份 `window.launcher` 声明。若每个页面各自 `declare global`，TypeScript 会因同名属性形状不一致而报错，后续任务只需往这里追加方法）：

```typescript
import type { SplashPayload } from '../main/ipc/channels.ts'

export interface LauncherApi {
  onSplashState: (callback: (payload: SplashPayload) => void) => void
  retry: () => Promise<void>
  openLogFile: () => Promise<void>
}

declare global {
  interface Window {
    launcher: LauncherApi
  }
}
```

创建 `src/renderer/splash/main.ts`：

```typescript
// 不能叫 status：DOM 全局已有 window.status，块级同名声明会与之冲突。
const statusEl = document.querySelector<HTMLParagraphElement>('#status')
const detail = document.querySelector<HTMLPreElement>('#detail')
const actions = document.querySelector<HTMLDivElement>('#actions')

window.launcher.onSplashState(payload => {
  if (statusEl !== null) statusEl.textContent = payload.message
  const failed = payload.phase === 'failed'
  if (detail !== null) {
    detail.hidden = !failed || payload.detail === undefined
    detail.textContent = payload.detail ?? ''
  }
  if (actions !== null) actions.hidden = !failed
})

document.querySelector('#retry')?.addEventListener('click', () => { void window.launcher.retry() })
document.querySelector('#open-log')?.addEventListener('click', () => { void window.launcher.openLogFile() })
```

- [ ] **Step 6: 让构建能处理新增的渲染入口**

整体替换 `electron.vite.config.ts`：

```typescript
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: { rollupOptions: { input: resolve('src/main/index.ts') } },
  },
  preload: {
    build: { rollupOptions: { input: resolve('src/preload/index.ts') } },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          splash: resolve('src/renderer/splash/index.html'),
        },
      },
    },
  },
})
```

- [ ] **Step 7: 确认既有测试仍然全绿**

```bash
npm test
```

预期：PASS，此前各任务的测试全部通过。

- [ ] **Step 8: 手工验收——第一次真正跑起来**

```bash
npm run dev
```

预期依次发生：
1. 弹出启动页，显示「正在启动 dsh 0.1.0-rc.7…」
2. 数秒后启动页关闭，主窗口打开并显示 dsh 的 Web UI
3. 关闭主窗口，应用退出，任务管理器中不残留 node.exe

再验证失败路径：临时把 `resources/dsh-bundled` 改名，重新 `npm run dev`，预期启动页显示「无法启动」与「安装可能已损坏」的提示，且「打开日志」可用。验证完把目录名改回。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "feat: 启动编排与启动页，首次可加载真实 Web UI"
```

---

### Task 9: 托盘与关窗行为

agent 任务可能长时间运行，关掉窗口就杀掉后台服务并不合理。默认行为改为最小化到托盘，真正的退出走托盘菜单；设置里可切换回「关窗即退出」。

**Files:**
- Create: `src/main/ui/tray.ts`
- Create: `src/main/ui/window-manager.ts`
- Create: `resources/icon.png`（占位图标，见 Step 1）
- Modify: `src/main/index.ts`（接入托盘与关窗策略）
- Create: `tests/unit/window-manager.spec.ts`

**Interfaces:**
- Consumes: `SettingsStore`（Task 6）、`DshSupervisor`（Task 7）
- Produces:
  - `function shouldHideOnClose(input: { closeToTray: boolean; quitting: boolean }): boolean`
  - `function createTray(opts: { iconPath: string; onShow: () => void; onSettings: () => void; onQuit: () => void }): Tray`

- [ ] **Step 1: 准备托盘图标**

托盘与安装包都需要一个图标。生成一个 256×256 的纯色占位 PNG：

```bash
node -e "const{writeFileSync,mkdirSync}=require('node:fs');mkdirSync('resources',{recursive:true});const w=256,h=256;const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++){const o=y*(w*3+1);raw[o]=0;for(let x=0;x<w;x++){const p=o+1+x*3;raw[p]=0x25;raw[p+1]=0x63;raw[p+2]=0xeb}}const z=require('node:zlib').deflateSync(raw);const c=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const b=Buffer.concat([Buffer.from(t),d]);const q=Buffer.alloc(4);q.writeUInt32BE(require('node:zlib').crc32?require('node:zlib').crc32(b):0);return Buffer.concat([l,b,q])};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;writeFileSync('resources/icon.png',Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),c('IHDR',ihdr),c('IDAT',z),c('IEND',Buffer.alloc(0))]))"
```

预期：生成 `resources/icon.png`。若该命令在当前 Node 版本上因 `crc32` 缺失而产出无法解析的 PNG，改为任取一张 256×256 PNG 放到 `resources/icon.png` 即可——图标内容不影响功能，后续可随时替换为正式设计。用以下命令确认 Electron 能读取它：

```bash
node -e "const{statSync}=require('node:fs');console.log('图标字节数:',statSync('resources/icon.png').size)"
```

预期：输出一个大于 0 的字节数。

- [ ] **Step 2: 写失败测试**

创建 `tests/unit/window-manager.spec.ts`：

```typescript
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
```

- [ ] **Step 3: 运行测试确认失败**

```bash
npx vitest run tests/unit/window-manager.spec.ts
```

预期：FAIL —— 无法解析 `window-manager.ts`。

- [ ] **Step 4: 实现**

创建 `src/main/ui/window-manager.ts`：

```typescript
/**
 * 关闭主窗口时是否只隐藏而不退出。
 *
 * 抽成纯函数是因为这里有一个容易写错的交叉条件：
 * 用户从托盘菜单选「退出」时，窗口的 close 事件同样会触发，
 * 若只看 closeToTray 就会把真正的退出也拦下来，造成退不掉的应用。
 */
export function shouldHideOnClose(input: { closeToTray: boolean; quitting: boolean }): boolean {
  if (input.quitting) return false
  return input.closeToTray
}
```

创建 `src/main/ui/tray.ts`：

```typescript
import { Menu, Tray, nativeImage } from 'electron'

export interface TrayCallbacks {
  iconPath: string
  onShow: () => void
  onQuit: () => void
}

/** 建立托盘图标与右键菜单。退出应用的唯一入口在此。 */
export function createTray(callbacks: TrayCallbacks): Tray {
  const tray = new Tray(nativeImage.createFromPath(callbacks.iconPath))
  tray.setToolTip('DSH启动器')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: callbacks.onShow },
    { type: 'separator' },
    { label: '退出', click: callbacks.onQuit },
  ]))
  tray.on('double-click', callbacks.onShow)
  return tray
}
```

菜单项会随后续任务增加：Task 10 加「设置…」，Task 11 加「日志…」与「关于」。本任务只放已经实现的入口，避免菜单里出现点了没反应的项。

- [ ] **Step 5: 运行测试确认通过**

```bash
npx vitest run tests/unit/window-manager.spec.ts
```

预期：PASS，3 个测试通过。

- [ ] **Step 6: 接入主进程**

在 `src/main/index.ts` 的 import 区补上（`Menu` 用于移除默认菜单栏）：

```typescript
import { Menu, type Tray } from 'electron'
import { createTray } from './ui/tray.ts'
import { shouldHideOnClose } from './ui/window-manager.ts'
```

注意 `Menu` 与 `Tray` 都来自 `electron`，与文件顶部既有的 `import { app, BrowserWindow, ipcMain, shell } from 'electron'` 合并为一条 import 即可。

在模块级变量区（`let supervisor` 附近）补上：

```typescript
let tray: Tray | undefined
/** 用户是否已选择退出。托盘「退出」与关窗隐藏共用一个窗口 close 事件，靠它区分。 */
let quitting = false
```

把 `showMainWindow` 中创建窗口的部分替换为下面这段（新增 close 拦截）：

```typescript
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'DSH启动器',
    show: false,
    icon: join(paths.resourcesRoot, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  // 主窗口加载的是 dsh 自己的 Web UI，外壳不注入任何脚本。
  void win.loadURL(url)
  win.once('ready-to-show', () => {
    win.show()
    splashWindow?.close()
    splashWindow = undefined
  })
  win.on('close', event => {
    if (!shouldHideOnClose({ closeToTray: settingsStore.read().closeToTray, quitting })) return
    // agent 任务可能仍在后台跑，关窗不应终止服务。
    event.preventDefault()
    win.hide()
  })
  win.on('closed', () => { mainWindow = undefined })
  mainWindow = win
```

把 `app.whenReady` 回调整体替换为。其中第一行移除 Electron 的默认菜单：主窗口里显示的是 dsh 自己的 Web UI，顶上再挂一条 File / Edit / View 的英文菜单既突兀又无用，而所有入口都已在托盘中提供。

```typescript
void app.whenReady().then(() => {
  // 主窗口承载的是 dsh 的 Web UI，不需要 Electron 的默认菜单栏。
  Menu.setApplicationMenu(null)
  tray = createTray({
    iconPath: join(paths.resourcesRoot, 'icon.png'),
    onShow: () => {
      if (mainWindow === undefined || mainWindow.isDestroyed()) return
      mainWindow.show()
      mainWindow.focus()
    },
    onQuit: () => {
      quitting = true
      app.quit()
    },
  })
  splashWindow = createSplashWindow()
  splashWindow.webContents.once('did-finish-load', () => { startDsh() })
})
```

把 `window-all-closed` 处理器替换为：

```typescript
// 托盘驻留模式下，窗口全关不等于退出——退出只由托盘菜单发起。
app.on('window-all-closed', () => {
  if (settingsStore.read().closeToTray && !quitting) return
  app.quit()
})
```

在 `before-quit` 处理器开头补一行，确保托盘图标随退出移除：

```typescript
app.on('before-quit', event => {
  quitting = true
  tray?.destroy()
  tray = undefined
  if (supervisor === undefined || supervisor.state === 'idle') return
  event.preventDefault()
  void supervisor.stop().then(() => {
    supervisor = undefined
    app.quit()
  })
})
```


- [ ] **Step 7: 让 paths 暴露资源根目录**

图标路径需要资源根目录。修改 `src/main/paths.ts`：在 `LauncherPaths` 接口中新增一个字段：

```typescript
  /** 打包资源根目录，托盘与安装包图标从此取。 */
  resourcesRoot: string
```

并在 `resolvePaths` 的返回对象中新增：

```typescript
    resourcesRoot: input.resources,
```

同步在 `tests/unit/paths.spec.ts` 中补一个用例：

```typescript
  it('暴露资源根目录', () => {
    expect(paths.resourcesRoot).toBe('C:\\app\\resources')
  })
```

- [ ] **Step 8: 全量测试与手工验收**

```bash
npm test
```

预期：PASS，全部测试通过。

```bash
npm run dev
```

手工确认：
1. 任务栏托盘出现图标
2. 关闭主窗口后应用不退出，托盘图标仍在，双击托盘可重新唤出窗口
3. 托盘右键「退出」能真正退出，任务管理器中不残留 node.exe

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "feat: 托盘驻留与关窗行为"
```

---

### Task 10: 设置页

外壳自身的设置。刻意**不含**任何模型或 API Key 配置——那属于上游 Web UI。改动端口或 DSH_HOME 需要重启 dsh 才生效，页面须如实提示并提供重启入口。

**Files:**
- Create: `src/renderer/settings/index.html`
- Create: `src/renderer/settings/main.ts`
- Modify: `src/main/ipc/channels.ts`（新增频道）
- Modify: `src/preload/index.ts`（暴露设置 API）
- Modify: `src/main/index.ts`（实现 openSettingsWindow 与设置 IPC）
- Modify: `electron.vite.config.ts`（新增渲染入口）

**Interfaces:**
- Consumes: `LauncherSettings`（Task 2）、`SettingsStore`（Task 6）
- Produces:
  - `IPC` 新增 `settingsRead: 'settings:read'`、`settingsUpdate: 'settings:update'`、`dshRestart: 'dsh:restart'`
  - preload 新增 `window.launcher.readSettings()`、`window.launcher.updateSettings(patch)`、`window.launcher.restartDsh()`

- [ ] **Step 1: 扩展 IPC 契约**

在 `src/main/ipc/channels.ts` 的 `IPC` 对象中新增三个频道：

```typescript
export const IPC = {
  splashState: 'splash:state',
  splashRetry: 'splash:retry',
  openLogFile: 'shell:open-log-file',
  settingsRead: 'settings:read',
  settingsUpdate: 'settings:update',
  dshRestart: 'dsh:restart',
} as const
```

- [ ] **Step 2: 在主进程注册设置相关处理器**

在 `src/main/index.ts` 的 import 区补上：

```typescript
import type { LauncherSettings } from './core/settings-schema.ts'
```

把 Task 9 留下的 `openSettingsWindow` 占位整体替换为：

```typescript
let settingsWindow: BrowserWindow | undefined

function openSettingsWindow(): void {
  if (settingsWindow !== undefined && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }
  const win = new BrowserWindow({
    width: 560,
    height: 560,
    title: '设置 — DSH启动器',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  void win.loadFile(join(import.meta.dirname, '../renderer/settings/index.html'))
  win.on('closed', () => { settingsWindow = undefined })
  settingsWindow = win
}
```

在既有的 `ipcMain.handle` 区域补上三个处理器：

```typescript
ipcMain.handle(IPC.settingsRead, () => settingsStore.read())
ipcMain.handle(IPC.settingsUpdate, (_event, patch: Partial<LauncherSettings>) => settingsStore.update(patch))
ipcMain.handle(IPC.dshRestart, async () => {
  await supervisor?.stop()
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    mainWindow.destroy()
    mainWindow = undefined
  }
  splashWindow = createSplashWindow()
  splashWindow.webContents.once('did-finish-load', () => { startDsh() })
})
```

- [ ] **Step 3: 把「设置…」加进托盘菜单**

修改 `src/main/ui/tray.ts`，在 `TrayCallbacks` 中新增一个回调：

```typescript
  onSettings: () => void
```

并在菜单模板中「显示主窗口」之后插入一项：

```typescript
    { label: '设置…', click: callbacks.onSettings },
```

在 `src/main/index.ts` 的 `createTray` 调用中补上对应回调：

```typescript
    onSettings: () => { openSettingsWindow() },
```

- [ ] **Step 4: 在 preload 暴露设置 API**

整体替换 `src/preload/index.ts`：

```typescript
import { contextBridge, ipcRenderer } from 'electron'
import type { LauncherSettings } from '../main/core/settings-schema.ts'
import { IPC, type SplashPayload } from '../main/ipc/channels.ts'

contextBridge.exposeInMainWorld('launcher', {
  onSplashState: (callback: (payload: SplashPayload) => void): void => {
    ipcRenderer.on(IPC.splashState, (_event, payload: SplashPayload) => { callback(payload) })
  },
  retry: (): Promise<void> => ipcRenderer.invoke(IPC.splashRetry),
  openLogFile: (): Promise<void> => ipcRenderer.invoke(IPC.openLogFile),
  readSettings: (): Promise<LauncherSettings> => ipcRenderer.invoke(IPC.settingsRead),
  updateSettings: (patch: Partial<LauncherSettings>): Promise<LauncherSettings> =>
    ipcRenderer.invoke(IPC.settingsUpdate, patch),
  restartDsh: (): Promise<void> => ipcRenderer.invoke(IPC.dshRestart),
})
```

- [ ] **Step 5: 写设置页**

创建 `src/renderer/settings/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>设置 — DSH启动器</title>
    <link rel="stylesheet" href="../shared.css" />
  </head>
  <body>
    <h1>设置</h1>
    <p class="muted">模型与 API 密钥请在主窗口的「设置 → 模型」中配置，此处只管启动器自身。</p>

    <section>
      <h2>启动</h2>
      <label>
        <input id="fixed-port-enabled" type="checkbox" />
        使用固定端口
      </label>
      <input id="port" type="number" min="1" max="65535" placeholder="3080" />
      <p class="muted">默认由操作系统自动分配空闲端口，不会与其他程序冲突。仅在需要稳定地址对接外部工具时才固定端口。</p>

      <label for="dsh-home">数据目录（DSH_HOME）</label>
      <input id="dsh-home" type="text" placeholder="留空则使用默认的 ~/.dsh" />
      <p class="muted">留空时沿用上游默认位置，与命令行使用方式共享同一份配置和会话记录。</p>
    </section>

    <section>
      <h2>窗口</h2>
      <label>
        <input id="close-to-tray" type="checkbox" />
        关闭窗口时最小化到托盘（后台任务继续运行）
      </label>
    </section>

    <section>
      <h2>隐私</h2>
      <label>
        <input id="telemetry-disabled" type="checkbox" />
        禁用 dsh 遥测
      </label>
      <p class="muted">默认保持 DeepSeek Harness 的原有行为，勾选后启动时传入 DSH_TELEMETRY_DISABLED。</p>
    </section>

    <section>
      <h2>更新</h2>
      <label for="channel">更新通道</label>
      <select id="channel">
        <option value="latest">稳定版</option>
        <option value="next">预览版（跟随上游 master）</option>
      </select>
    </section>

    <p id="restart-hint" class="muted" hidden>端口或数据目录已修改，需要重启 dsh 才能生效。</p>
    <div>
      <button id="restart" type="button">重启 dsh</button>
      <span id="saved" class="muted" hidden>已保存</span>
    </div>

    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

先在 `src/renderer/launcher-api.d.ts` 的 `LauncherApi` 接口中追加三个方法，并补上对应的 import：

```typescript
import type { LauncherSettings } from '../main/core/settings-schema.ts'
```

```typescript
  readSettings: () => Promise<LauncherSettings>
  updateSettings: (patch: Partial<LauncherSettings>) => Promise<LauncherSettings>
  restartDsh: () => Promise<void>
```

创建 `src/renderer/settings/main.ts`：

```typescript
import type { LauncherSettings } from '../../main/core/settings-schema.ts'

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.querySelector<T>(`#${id}`)
  if (node === null) throw new Error(`设置页缺少元素：${id}`)
  return node
}

const fixedPortEnabled = el<HTMLInputElement>('fixed-port-enabled')
const port = el<HTMLInputElement>('port')
const dshHome = el<HTMLInputElement>('dsh-home')
const closeToTray = el<HTMLInputElement>('close-to-tray')
const telemetryDisabled = el<HTMLInputElement>('telemetry-disabled')
const channel = el<HTMLSelectElement>('channel')
const restartHint = el<HTMLParagraphElement>('restart-hint')
const saved = el<HTMLSpanElement>('saved')

/** 需要重启才生效的字段的初始值，用于判断是否提示重启。 */
let initialRestartSensitive = ''

function restartSensitiveKey(settings: LauncherSettings): string {
  return `${String(settings.port)}|${settings.dshHome ?? ''}`
}

function render(settings: LauncherSettings): void {
  fixedPortEnabled.checked = settings.port > 0
  port.value = settings.port > 0 ? String(settings.port) : ''
  port.disabled = settings.port === 0
  dshHome.value = settings.dshHome ?? ''
  closeToTray.checked = settings.closeToTray
  telemetryDisabled.checked = settings.telemetryDisabled
  channel.value = settings.updateChannel
  restartHint.hidden = restartSensitiveKey(settings) === initialRestartSensitive
}

function flashSaved(): void {
  saved.hidden = false
  setTimeout(() => { saved.hidden = true }, 1500)
}

async function save(patch: Partial<LauncherSettings>): Promise<void> {
  const next = await window.launcher.updateSettings(patch)
  render(next)
  flashSaved()
}

fixedPortEnabled.addEventListener('change', () => {
  // 取消固定端口即回到 0（由操作系统分配）。
  void save({ port: fixedPortEnabled.checked ? Number(port.value) || 3080 : 0 })
})
port.addEventListener('change', () => {
  if (!fixedPortEnabled.checked) return
  void save({ port: Number(port.value) || 0 })
})
dshHome.addEventListener('change', () => { void save({ dshHome: dshHome.value }) })
closeToTray.addEventListener('change', () => { void save({ closeToTray: closeToTray.checked }) })
telemetryDisabled.addEventListener('change', () => { void save({ telemetryDisabled: telemetryDisabled.checked }) })
channel.addEventListener('change', () => {
  void save({ updateChannel: channel.value === 'next' ? 'next' : 'latest' })
})
el<HTMLButtonElement>('restart').addEventListener('click', () => { void window.launcher.restartDsh() })

void window.launcher.readSettings().then(settings => {
  initialRestartSensitive = restartSensitiveKey(settings)
  render(settings)
})
```

- [ ] **Step 6: 注册渲染入口**

在 `electron.vite.config.ts` 的 `renderer.build.rollupOptions.input` 中新增一行：

```typescript
          settings: resolve('src/renderer/settings/index.html'),
```

- [ ] **Step 7: 全量测试与手工验收**

```bash
npm test
```

预期：PASS。

```bash
npm run dev
```

手工确认：
1. 托盘右键「设置…」能打开设置窗口
2. 勾选「使用固定端口」并填 3080，显示「已保存」，同时出现重启提示
3. 点「重启 dsh」，主窗口重新加载，地址栏端口变为 3080（可在日志页或日志文件中确认）
4. 取消固定端口后重启，端口恢复为随机分配
5. 关掉设置窗口再打开，各项取值与上次一致

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat: 外壳设置页（不含模型与密钥配置）"
```

---

### Task 11: 日志页与关于页

两个只读展示页。日志页是启动失败时的主要诊断入口；关于页承载合规声明。

**Files:**
- Create: `src/renderer/logs/index.html`
- Create: `src/renderer/logs/main.ts`
- Create: `src/renderer/about/index.html`
- Create: `src/renderer/about/main.ts`
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/ui/tray.ts`
- Modify: `electron.vite.config.ts`

**Interfaces:**
- Consumes: `LogStore`（Task 6）、`resolveRuntime`（Task 5）
- Produces:
  - `IPC` 新增 `logsTail: 'logs:tail'`、`aboutInfo: 'about:info'`
  - `interface AboutInfo { launcherVersion: string; dshVersion: string; dshSource: 'bundled' | 'updated'; electronVersion: string; nodeVersion: string; logFile: string }`
  - preload 新增 `window.launcher.tailLogs(count)`、`window.launcher.aboutInfo()`
  - `createTray` 的 `TrayCallbacks` 新增 `onLogs: () => void`、`onAbout: () => void`

- [ ] **Step 1: 扩展 IPC 契约**

在 `src/main/ipc/channels.ts` 中，`IPC` 新增两个频道，并在文件末尾新增一个接口：

```typescript
  logsTail: 'logs:tail',
  aboutInfo: 'about:info',
```

```typescript
export interface AboutInfo {
  launcherVersion: string
  dshVersion: string
  dshSource: 'bundled' | 'updated'
  electronVersion: string
  nodeVersion: string
  logFile: string
}
```

- [ ] **Step 2: 在主进程注册处理器**

在 `src/main/index.ts` 中，模块级变量区新增一个变量，用于向关于页汇报当前运行时：

```typescript
/** 本次启动实际选中的 dsh，供关于页展示。 */
let activeChoice: { version: string; source: 'bundled' | 'updated' } | undefined
```

在 `startDsh` 中，`logStore.append('shell', \`使用 dsh ...\`)` 那一行之后补上：

```typescript
  activeChoice = { version: choice.version, source: choice.source }
```

在 `ipcMain.handle` 区域补上两个处理器：

```typescript
ipcMain.handle(IPC.logsTail, (_event, count: number) => logStore.tail(count))
ipcMain.handle(IPC.aboutInfo, (): AboutInfo => ({
  launcherVersion: app.getVersion(),
  dshVersion: activeChoice?.version ?? '未知',
  dshSource: activeChoice?.source ?? 'bundled',
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node,
  logFile: logStore.filePath,
}))
```

并在 import 区把 `AboutInfo` 一并引入：

```typescript
import { IPC, type AboutInfo, type SplashPayload } from './ipc/channels.ts'
```

新增两个开窗函数（放在 `openSettingsWindow` 之后）：

```typescript
let logsWindow: BrowserWindow | undefined
let aboutWindow: BrowserWindow | undefined

/** 打开一个外壳内部页面窗口；同一页面重复调用只聚焦既有窗口。 */
function openShellWindow(
  current: BrowserWindow | undefined,
  options: { file: string; title: string; width: number; height: number },
  assign: (win: BrowserWindow | undefined) => void,
): void {
  if (current !== undefined && !current.isDestroyed()) {
    current.show()
    current.focus()
    return
  }
  const win = new BrowserWindow({
    width: options.width,
    height: options.height,
    title: options.title,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  void win.loadFile(join(import.meta.dirname, options.file))
  win.on('closed', () => { assign(undefined) })
  assign(win)
}

function openLogsWindow(): void {
  openShellWindow(logsWindow, {
    file: '../renderer/logs/index.html', title: '日志 — DSH启动器', width: 900, height: 600,
  }, win => { logsWindow = win })
}

function openAboutWindow(): void {
  openShellWindow(aboutWindow, {
    file: '../renderer/about/index.html', title: '关于 — DSH启动器', width: 520, height: 420,
  }, win => { aboutWindow = win })
}
```

在 `createTray` 调用中补上两个回调：

```typescript
    onLogs: () => { openLogsWindow() },
    onAbout: () => { openAboutWindow() },
```

- [ ] **Step 3: 扩展托盘菜单**

整体替换 `src/main/ui/tray.ts` 中的 `TrayCallbacks` 与菜单模板：

```typescript
export interface TrayCallbacks {
  iconPath: string
  onShow: () => void
  onSettings: () => void
  onLogs: () => void
  onAbout: () => void
  onQuit: () => void
}

/** 建立托盘图标与右键菜单。退出应用的唯一入口在此。 */
export function createTray(callbacks: TrayCallbacks): Tray {
  const tray = new Tray(nativeImage.createFromPath(callbacks.iconPath))
  tray.setToolTip('DSH启动器')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: callbacks.onShow },
    { label: '设置…', click: callbacks.onSettings },
    { label: '日志…', click: callbacks.onLogs },
    { label: '关于', click: callbacks.onAbout },
    { type: 'separator' },
    { label: '退出', click: callbacks.onQuit },
  ]))
  tray.on('double-click', callbacks.onShow)
  return tray
}
```

- [ ] **Step 4: 在 preload 暴露两个只读 API**

在 `src/preload/index.ts` 的 `exposeInMainWorld` 对象中补上两项，并在 import 区加入 `AboutInfo`：

```typescript
  tailLogs: (count: number): Promise<string[]> => ipcRenderer.invoke(IPC.logsTail, count),
  aboutInfo: (): Promise<AboutInfo> => ipcRenderer.invoke(IPC.aboutInfo),
```

```typescript
import { IPC, type AboutInfo, type SplashPayload } from '../main/ipc/channels.ts'
```

- [ ] **Step 5: 写两个页面**

创建 `src/renderer/logs/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>日志 — DSH启动器</title>
    <link rel="stylesheet" href="../shared.css" />
  </head>
  <body>
    <h1>日志</h1>
    <div>
      <button id="refresh" type="button">刷新</button>
      <label><input id="auto" type="checkbox" checked /> 自动刷新</label>
      <button id="open-file" type="button">在文件管理器中打开</button>
    </div>
    <pre id="content" class="detail" style="max-height: 420px; color: inherit;"></pre>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

先在 `src/renderer/launcher-api.d.ts` 的 `LauncherApi` 中追加两个方法，并把 import 扩展为同时引入 `AboutInfo`：

```typescript
import type { AboutInfo, SplashPayload } from '../main/ipc/channels.ts'
```

```typescript
  tailLogs: (count: number) => Promise<string[]>
  aboutInfo: () => Promise<AboutInfo>
```

创建 `src/renderer/logs/main.ts`：

```typescript
const content = document.querySelector<HTMLPreElement>('#content')
const auto = document.querySelector<HTMLInputElement>('#auto')

async function refresh(): Promise<void> {
  const lines = await window.launcher.tailLogs(500)
  if (content === null) return
  const atBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 20
  content.textContent = lines.join('\n')
  // 只在用户本来就在底部时才跟随，避免打断向上翻阅。
  if (atBottom) content.scrollTop = content.scrollHeight
}

document.querySelector('#refresh')?.addEventListener('click', () => { void refresh() })
document.querySelector('#open-file')?.addEventListener('click', () => { void window.launcher.openLogFile() })

setInterval(() => {
  if (auto?.checked !== true) return
  void refresh()
}, 2000)

void refresh()
```

创建 `src/renderer/about/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>关于 — DSH启动器</title>
    <link rel="stylesheet" href="../shared.css" />
  </head>
  <body>
    <h1>DSH启动器</h1>
    <p class="muted">基于 DeepSeek Harness 构建的非官方桌面客户端，与 DeepSeek 官方无从属或授权关系。</p>
    <dl id="info"></dl>
    <p class="muted">
      DeepSeek Harness 以 MIT 协议发布，「DeepSeek Harness」是深度求索公司的注册商标。
    </p>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

创建 `src/renderer/about/main.ts`：

```typescript
void window.launcher.aboutInfo().then(info => {
  const list = document.querySelector<HTMLDListElement>('#info')
  if (list === null) return
  const rows: [string, string][] = [
    ['启动器版本', info.launcherVersion],
    ['dsh 版本', `${info.dshVersion}（${info.dshSource === 'bundled' ? '内置副本' : '已更新副本'}）`],
    ['Electron', info.electronVersion],
    ['Node', info.nodeVersion],
    ['日志文件', info.logFile],
  ]
  for (const [term, value] of rows) {
    const dt = document.createElement('dt')
    dt.textContent = term
    const dd = document.createElement('dd')
    dd.textContent = value
    list.append(dt, dd)
  }
})
```

- [ ] **Step 6: 注册渲染入口**

在 `electron.vite.config.ts` 的 `input` 中新增两行：

```typescript
          logs: resolve('src/renderer/logs/index.html'),
          about: resolve('src/renderer/about/index.html'),
```

- [ ] **Step 7: 全量测试与手工验收**

```bash
npm test
```

预期：PASS。

```bash
npm run dev
```

手工确认：
1. 托盘「日志…」打开日志窗口，能看到启动过程记录，且随 dsh 输出自动刷新
2. 向上翻阅日志时不会被自动刷新拽回底部
3. 托盘「关于」显示版本信息，dsh 版本与来源标注正确
4. 关于页包含非官方声明与商标说明

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat: 日志面板与关于页（含非官方与商标声明）"
```

---

### Task 12: 更新器核心

查询 npm registry 的 dist-tags、把指定版本装到用户目录、失败时不留半成品。此任务只做机制，接入界面在 Task 13。

依赖树约 195 个包，自行实现依赖解析不现实，因此用**内置的 npm** 执行安装——这也是内置 Node 运行时必须保留 npm 的原因。

**Files:**
- Create: `src/main/services/npm-updater.ts`
- Create: `tests/unit/npm-updater.spec.ts`

**Interfaces:**
- Consumes: `isNewer`（Task 4）、`DSH_PACKAGE_SUBPATH`（Task 5）
- Produces:
  - `interface UpdateInfo { channel: 'latest' | 'next'; current: string; available: string; hasUpdate: boolean }`
  - `type RunNpm = (args: string[], cwd: string) => Promise<void>`
  - `interface NpmUpdaterOptions { runtimesDir: string; nodeExe: string; npmCli: string; registryUrl?: string; fetchFn?: typeof fetch; runNpm?: RunNpm }`
  - `class NpmUpdater { checkForUpdate(channel: 'latest' | 'next', currentVersion: string): Promise<UpdateInfo>; install(version: string): Promise<string> }` —— `install` 返回 `runtimesDir` 下的目录名。
  - `function runtimeDirName(version: string): string`

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/npm-updater.spec.ts`：

```typescript
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NpmUpdater, runtimeDirName } from '../../src/main/services/npm-updater.ts'
import { DSH_PACKAGE_SUBPATH } from '../../src/main/paths.ts'

let runtimesDir: string

const DIST_TAGS = { latest: '0.1.0-rc.7', next: '0.1.0-rc.8' }

function fakeFetch(body: unknown, ok = true): typeof fetch {
  return (async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  })) as unknown as typeof fetch
}

/** 冒充 npm：在目标目录里造出一个形似真实安装结果的包。 */
function fakeNpmInstalling(version: string) {
  return async (_args: string[], cwd: string): Promise<void> => {
    const packageRoot = join(cwd, DSH_PACKAGE_SUBPATH)
    mkdirSync(join(packageRoot, 'lib'), { recursive: true })
    writeFileSync(join(packageRoot, 'lib', 'bin.js'), '// fake', 'utf8')
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }), 'utf8')
  }
}

beforeEach(() => {
  runtimesDir = mkdtempSync(join(tmpdir(), 'dshl-runtimes-'))
})

afterEach(() => {
  rmSync(runtimesDir, { recursive: true, force: true })
})

function makeUpdater(overrides: Record<string, unknown> = {}): NpmUpdater {
  return new NpmUpdater({
    runtimesDir,
    nodeExe: 'C:\\fake\\node.exe',
    npmCli: 'C:\\fake\\npm-cli.js',
    fetchFn: fakeFetch({ 'dist-tags': DIST_TAGS }),
    runNpm: fakeNpmInstalling('0.1.0-rc.8'),
    ...overrides,
  })
}

describe('runtimeDirName', () => {
  it('目录名由版本号推出', () => {
    expect(runtimeDirName('0.1.0-rc.8')).toBe('dsh-0.1.0-rc.8')
  })
})

describe('checkForUpdate', () => {
  it('稳定通道读取 latest 标签', async () => {
    const info = await makeUpdater().checkForUpdate('latest', '0.1.0-rc.6')
    expect(info.available).toBe('0.1.0-rc.7')
    expect(info.channel).toBe('latest')
    expect(info.hasUpdate).toBe(true)
  })

  it('预览通道读取 next 标签', async () => {
    const info = await makeUpdater().checkForUpdate('next', '0.1.0-rc.7')
    expect(info.available).toBe('0.1.0-rc.8')
    expect(info.hasUpdate).toBe(true)
  })

  it('已是最新时 hasUpdate 为 false', async () => {
    const info = await makeUpdater().checkForUpdate('latest', '0.1.0-rc.7')
    expect(info.hasUpdate).toBe(false)
  })

  it('当前版本比通道版本更新时也不算有更新', async () => {
    const info = await makeUpdater().checkForUpdate('latest', '0.1.0-rc.8')
    expect(info.hasUpdate).toBe(false)
  })

  it('registry 不可达时抛出可读错误', async () => {
    const updater = makeUpdater({ fetchFn: fakeFetch({}, false) })
    await expect(updater.checkForUpdate('latest', '0.1.0-rc.7')).rejects.toThrow(/无法查询/)
  })

  it('通道缺少对应标签时抛错', async () => {
    const updater = makeUpdater({ fetchFn: fakeFetch({ 'dist-tags': { latest: '0.1.0-rc.7' } }) })
    await expect(updater.checkForUpdate('next', '0.1.0-rc.7')).rejects.toThrow(/预览/)
  })
})

describe('install', () => {
  it('安装成功后返回运行时目录名，且入口文件就位', async () => {
    const dirName = await makeUpdater().install('0.1.0-rc.8')
    expect(dirName).toBe('dsh-0.1.0-rc.8')
    expect(existsSync(join(runtimesDir, dirName, DSH_PACKAGE_SUBPATH, 'lib', 'bin.js'))).toBe(true)
  })

  it('npm 失败时清理半成品目录并抛错', async () => {
    const updater = makeUpdater({
      runNpm: async () => { throw new Error('网络中断') },
    })
    await expect(updater.install('0.1.0-rc.8')).rejects.toThrow(/网络中断/)
    expect(existsSync(join(runtimesDir, 'dsh-0.1.0-rc.8'))).toBe(false)
  })

  it('npm 声称成功但入口缺失时同样判定失败并清理', async () => {
    const updater = makeUpdater({ runNpm: async () => { /* 什么也不装 */ } })
    await expect(updater.install('0.1.0-rc.8')).rejects.toThrow(/入口/)
    expect(existsSync(join(runtimesDir, 'dsh-0.1.0-rc.8'))).toBe(false)
  })

  it('同版本已安装过则直接复用，不重复下载', async () => {
    const updater = makeUpdater()
    await updater.install('0.1.0-rc.8')
    let called = false
    const again = makeUpdater({ runNpm: async () => { called = true } })
    const dirName = await again.install('0.1.0-rc.8')
    expect(dirName).toBe('dsh-0.1.0-rc.8')
    expect(called).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run tests/unit/npm-updater.spec.ts
```

预期：FAIL —— 无法解析 `npm-updater.ts`。

- [ ] **Step 3: 实现**

创建 `src/main/services/npm-updater.ts`：

```typescript
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isNewer } from '../core/version-compare.ts'
import { DSH_PACKAGE_SUBPATH } from '../paths.ts'

const execFileAsync = promisify(execFile)

/** scoped 包名在 registry 上的转义形式。 */
const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh'
const PACKAGE_SPEC = '@deepseek-ai/dsh'

export interface UpdateInfo {
  channel: 'latest' | 'next'
  current: string
  available: string
  hasUpdate: boolean
}

export type RunNpm = (args: string[], cwd: string) => Promise<void>

export interface NpmUpdaterOptions {
  /** 各版本运行时的存放根目录。 */
  runtimesDir: string
  nodeExe: string
  npmCli: string
  registryUrl?: string
  fetchFn?: typeof fetch
  /** 注入点，便于测试；缺省时用内置 Node 执行内置 npm。 */
  runNpm?: RunNpm
}

/** 某版本对应的运行时目录名。 */
export function runtimeDirName(version: string): string {
  return `dsh-${version}`
}

const CHANNEL_LABEL: Record<'latest' | 'next', string> = {
  latest: '稳定',
  next: '预览',
}

export class NpmUpdater {
  readonly #opts: NpmUpdaterOptions

  constructor(opts: NpmUpdaterOptions) {
    this.#opts = opts
  }

  /** 查询指定通道的最新版本，并与当前版本比较。 */
  async checkForUpdate(channel: 'latest' | 'next', currentVersion: string): Promise<UpdateInfo> {
    const fetchFn = this.#opts.fetchFn ?? fetch
    const url = this.#opts.registryUrl ?? DEFAULT_REGISTRY_URL
    let payload: unknown
    try {
      const response = await fetchFn(url, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      payload = await response.json()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`无法查询更新：${reason}`)
    }
    const tags = (payload as { 'dist-tags'?: Record<string, unknown> })['dist-tags']
    const available = tags?.[channel]
    if (typeof available !== 'string') {
      throw new Error(`${CHANNEL_LABEL[channel]}通道当前没有可用版本`)
    }
    return {
      channel,
      current: currentVersion,
      available,
      hasUpdate: isNewer(available, currentVersion),
    }
  }

  /**
   * 把指定版本装进 runtimesDir。
   *
   * 安装失败——包括 npm 报错，以及 npm 声称成功但入口文件不存在——
   * 一律删除该目录再抛错。留下半成品会让下次启动的运行时择一面对一个
   * 似有实无的候选，那是更难排查的故障。
   *
   * @returns runtimesDir 下的目录名
   */
  async install(version: string): Promise<string> {
    const dirName = runtimeDirName(version)
    const targetDir = join(this.#opts.runtimesDir, dirName)
    const entry = join(targetDir, DSH_PACKAGE_SUBPATH, 'lib', 'bin.js')

    if (existsSync(entry) && this.#installedVersion(targetDir) === version) return dirName

    rmSync(targetDir, { recursive: true, force: true })
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(
      join(targetDir, 'package.json'),
      `${JSON.stringify({ name: dirName, version: '0.0.0', private: true }, null, 2)}\n`,
      'utf8',
    )

    try {
      const runNpm = this.#opts.runNpm ?? this.#defaultRunNpm.bind(this)
      await runNpm(
        ['install', `${PACKAGE_SPEC}@${version}`, '--omit=dev', '--no-audit', '--no-fund'],
        targetDir,
      )
      if (!existsSync(entry)) {
        throw new Error(`安装后未找到 dsh 入口文件：${entry}`)
      }
    } catch (error) {
      rmSync(targetDir, { recursive: true, force: true })
      throw error instanceof Error ? error : new Error(String(error))
    }
    return dirName
  }

  #installedVersion(targetDir: string): string | undefined {
    try {
      const manifest = JSON.parse(
        readFileSync(join(targetDir, DSH_PACKAGE_SUBPATH, 'package.json'), 'utf8'),
      ) as { version?: unknown }
      return typeof manifest.version === 'string' ? manifest.version : undefined
    } catch {
      return undefined
    }
  }

  /** 用内置 Node 执行内置 npm，避免依赖用户机器上是否装了 Node。 */
  async #defaultRunNpm(args: string[], cwd: string): Promise<void> {
    await execFileAsync(this.#opts.nodeExe, [this.#opts.npmCli, ...args], {
      cwd,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    })
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/npm-updater.spec.ts
```

预期：PASS，11 个测试全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/main/services/npm-updater.ts tests/unit/npm-updater.spec.ts
git commit -m "feat: dsh 更新器（双通道查询、安装、失败清理）"
```

---

### Task 13: 更新接入与自动回滚

把更新器接到设置页，并补上回滚链条中最关键的一环：**新版本装上了却起不来时，自动退回内置副本并重启**，而不是把用户卡在启动失败页。

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/settings/index.html`
- Modify: `src/renderer/settings/main.ts`

**Interfaces:**
- Consumes: `NpmUpdater`、`UpdateInfo`、`runtimeDirName`（Task 12）、`SettingsStore`（Task 6）
- Produces:
  - `IPC` 新增 `updateCheck: 'update:check'`、`updateInstall: 'update:install'`、`runtimeRollback: 'runtime:rollback'`
  - preload 新增 `window.launcher.checkUpdate()`、`window.launcher.installUpdate(version)`、`window.launcher.rollbackRuntime()`

- [ ] **Step 1: 扩展 IPC 契约**

在 `src/main/ipc/channels.ts` 的 `IPC` 中新增三个频道：

```typescript
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  runtimeRollback: 'runtime:rollback',
```

- [ ] **Step 2: 在主进程接入更新器与自动回滚**

在 `src/main/index.ts` 的 import 区补上：

```typescript
import { NpmUpdater } from './services/npm-updater.ts'
```

在模块级变量区新增：

```typescript
const updater = new NpmUpdater({
  runtimesDir: paths.runtimesDir,
  nodeExe: paths.nodeExe,
  npmCli: paths.npmCli,
})
/** 已经因启动失败自动回退过一次，避免回退—失败—再回退的循环。 */
let rolledBackOnce = false
```

把 `startDsh` 中 `next.on('failed', ...)` 的处理器整体替换为：

```typescript
  next.on('failed', reason => {
    logStore.append('shell', reason)
    // 更新副本起不来时自动退回内置副本：内置副本是出厂即验证过的已知可用版本。
    if (choice.source === 'updated' && !rolledBackOnce) {
      rolledBackOnce = true
      settingsStore.update({ activeRuntime: null })
      logStore.append('shell', `dsh ${choice.version} 启动失败，已自动回退到内置副本`)
      postSplash({ phase: 'starting', message: '新版本启动失败，正在回退到内置版本…' })
      void next.stop().then(() => { startDsh() })
      return
    }
    postSplash({ phase: 'failed', message: '启动失败', detail: `${reason}\n\n${logStore.tail(20).join('\n')}` })
  })
```

在 `ipcMain.handle` 区域补上三个处理器：

```typescript
ipcMain.handle(IPC.updateCheck, async () => {
  const settings = settingsStore.read()
  const current = activeChoice?.version ?? '0.0.0'
  return updater.checkForUpdate(settings.updateChannel, current)
})

ipcMain.handle(IPC.updateInstall, async (_event, version: string) => {
  const dirName = await updater.install(version)
  settingsStore.update({ activeRuntime: dirName })
  // 装好即重启到新版本；若起不来，上面的 failed 分支会自动退回内置副本。
  rolledBackOnce = false
  await supervisor?.stop()
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    mainWindow.destroy()
    mainWindow = undefined
  }
  splashWindow = createSplashWindow()
  splashWindow.webContents.once('did-finish-load', () => { startDsh() })
})

ipcMain.handle(IPC.runtimeRollback, async () => {
  settingsStore.update({ activeRuntime: null })
  rolledBackOnce = false
  await supervisor?.stop()
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    mainWindow.destroy()
    mainWindow = undefined
  }
  splashWindow = createSplashWindow()
  splashWindow.webContents.once('did-finish-load', () => { startDsh() })
})
```

- [ ] **Step 3: 在 preload 暴露更新 API**

在 `src/preload/index.ts` 的 `exposeInMainWorld` 对象中补上三项，import 区加入 `UpdateInfo`：

```typescript
  checkUpdate: (): Promise<UpdateInfo> => ipcRenderer.invoke(IPC.updateCheck),
  installUpdate: (version: string): Promise<void> => ipcRenderer.invoke(IPC.updateInstall, version),
  rollbackRuntime: (): Promise<void> => ipcRenderer.invoke(IPC.runtimeRollback),
```

```typescript
import type { UpdateInfo } from '../main/services/npm-updater.ts'
```

- [ ] **Step 4: 在设置页加入更新区**

把 `src/renderer/settings/index.html` 中的「更新」一节整体替换为：

```html
    <section>
      <h2>更新</h2>
      <label for="channel">更新通道</label>
      <select id="channel">
        <option value="latest">稳定版</option>
        <option value="next">预览版（跟随上游 master）</option>
      </select>

      <div>
        <button id="check-update" type="button">检查更新</button>
        <button id="install-update" type="button" class="primary" hidden>安装并重启</button>
        <button id="rollback" type="button">回退到内置版本</button>
      </div>
      <p id="update-status" class="muted"></p>
      <p class="muted">更新不会自动进行。新版本若无法启动，会自动退回内置版本。</p>
    </section>
```

在 `src/renderer/settings/main.ts` 的顶部**不要**再写 `declare global`——改为在 `src/renderer/launcher-api.d.ts` 的 `LauncherApi` 中补上三个方法：

并补上对应的 import：

```typescript
import type { UpdateInfo } from '../main/services/npm-updater.ts'
```

```typescript
  checkUpdate: () => Promise<UpdateInfo>
  installUpdate: (version: string) => Promise<void>
  rollbackRuntime: () => Promise<void>
```

并在文件末尾追加更新区逻辑：

```typescript
const updateStatus = el<HTMLParagraphElement>('update-status')
const installButton = el<HTMLButtonElement>('install-update')
let pendingVersion: string | undefined

el<HTMLButtonElement>('check-update').addEventListener('click', () => {
  updateStatus.textContent = '正在查询…'
  installButton.hidden = true
  void window.launcher.checkUpdate().then(info => {
    if (info.hasUpdate) {
      pendingVersion = info.available
      updateStatus.textContent = `发现新版本 ${info.available}（当前 ${info.current}）`
      installButton.hidden = false
      return
    }
    updateStatus.textContent = `已是最新：${info.current}`
  }).catch((error: unknown) => {
    updateStatus.textContent = error instanceof Error ? error.message : String(error)
  })
})

installButton.addEventListener('click', () => {
  if (pendingVersion === undefined) return
  updateStatus.textContent = `正在安装 ${pendingVersion}，依赖较多需要数分钟…`
  installButton.disabled = true
  void window.launcher.installUpdate(pendingVersion)
    .then(() => { updateStatus.textContent = '已安装，正在重启 dsh…' })
    .catch((error: unknown) => {
      updateStatus.textContent = `安装失败：${error instanceof Error ? error.message : String(error)}`
    })
    .finally(() => { installButton.disabled = false })
})

el<HTMLButtonElement>('rollback').addEventListener('click', () => {
  updateStatus.textContent = '正在回退到内置版本…'
  void window.launcher.rollbackRuntime()
})
```

- [ ] **Step 5: 全量测试**

```bash
npm test
```

预期：PASS，全部测试通过。

- [ ] **Step 6: 手工验收更新与回滚**

```bash
npm run dev
```

依次确认：
1. 设置页选「预览版」通道，点「检查更新」，提示发现 `0.1.0-rc.8`（当前内置为 `0.1.0-rc.7`）
2. 点「安装并重启」，数分钟后主窗口重新加载；托盘「关于」中 dsh 版本显示 `0.1.0-rc.8（已更新副本）`
3. 点「回退到内置版本」，重启后关于页显示 `0.1.0-rc.7（内置副本）`
4. 验证自动回滚：手工把 `%APPDATA%\dsh-launcher\dsh-runtime\dsh-0.1.0-rc.8\node_modules\@deepseek-ai\dsh\lib\bin.js` 改名，再在设置里把 `activeRuntime` 切回该版本（或重新安装一次后改坏文件），重启应用，预期启动页短暂显示「新版本启动失败，正在回退到内置版本…」后正常进入主界面。验证完把文件名改回。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat: 更新接入设置页，新版本起不来时自动回退内置副本"
```

---

### Task 14: 打包安装程序与最终验收

产出可双击安装的 NSIS 安装包，并跑完整验收清单。

**Files:**
- Create: `electron-builder.yml`
- Create: `README.md`
- Create: `LICENSE`
- Modify: `.gitignore`
- Modify: `package.json`（补 build 字段指向配置）

**Interfaces:**
- Consumes: 全部前置任务
- Produces: `release/DSH启动器 Setup <version>.exe`

- [ ] **Step 1: 写 electron-builder 配置**

创建 `electron-builder.yml`：

```yaml
appId: com.dshlauncher.desktop
productName: DSH启动器
copyright: 基于 DeepSeek Harness 构建的非官方桌面客户端

directories:
  output: release
  buildResources: resources

files:
  - out/**
  - package.json

# 内置运行时与 dsh 副本必须放在 asar 之外：
# node.exe 需要作为真实文件被 spawn，dsh 的依赖树也需要真实的 node_modules 结构。
#
# dsh 这一条的 from 必须**直指 node_modules 本身**，不能写成父目录 resources/dsh-bundled。
# electron-builder 会丢弃直接位于 from 根下的 node_modules，产出的 dsh-bundled 是个空目录，
# 而打包过程零报错、零警告——安装包照常生成，只是装完一启动就报「内置 dsh 副本不可用」。
# 对照：runtime 那条能带上 node_modules，是因为它嵌在 runtime/node/ 第二层而非根下。
extraResources:
  - from: resources/runtime
    to: runtime
    filter: ['**/*']
  - from: resources/dsh-bundled/node_modules
    to: dsh-bundled/node_modules
    filter: ['**/*']
  - from: resources/icon.png
    to: icon.png

win:
  target:
    - target: nsis
      arch: [x64]
  icon: resources/icon.png

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: DSH启动器
```

在 `package.json` 中新增一行，让 electron-builder 找到该配置：

```json
  "build": { "extends": null, "directories": { "buildResources": "resources" } },
```

若 electron-builder 已能自动读取根目录的 `electron-builder.yml`（26.x 默认如此），则**不要**添加上面的 `build` 字段——两者同时存在会冲突。先直接执行 Step 3 打包；仅当报错提示找不到配置时才回来添加。

- [ ] **Step 2: 补充分发所需文档**

创建 `LICENSE`（MIT，署名为你自己）：

```
MIT License

Copyright (c) 2026 DSH启动器 contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

创建 `README.md`：

```markdown
# DSH启动器

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 构建的非官方 Windows 桌面客户端。与 DeepSeek 官方无从属或授权关系。

装完即用：安装包内置 Node 运行时与 dsh 副本，无需预装 Node，无需命令行，断网也能启动。

## 功能

- 一键启动 dsh 的 Web UI，端口由系统自动分配，不与其他程序冲突
- 托盘驻留：关掉窗口后台任务继续运行
- 双更新通道：稳定版（npm `latest`）与预览版（npm `next`，跟随上游 master）
- 更新失败或新版本起不来时自动退回内置版本
- 日志面板与设置页

## 数据位置

- dsh 的配置与会话：`~/.dsh`（与命令行 `npx @deepseek-ai/dsh web` 共用，不会迁移或劫持）
- 启动器自身的设置与日志：`%APPDATA%\dsh-launcher`

## 开发

```sh
npm install                 # 国内网络请先确认 .npmrc 中的二进制镜像配置
npm run prepare:resources   # 下载内置 Node 与 dsh，首次需要数分钟
npm run dev
```

仓库内的 `.npmrc` 把 Electron 与 electron-builder 的二进制指向了 npmmirror 镜像。缺少这项配置时，二进制会去 GitHub 下载并在国内网络下长时间卡死。

打包安装程序：

```sh
npm run pack
```

## 许可

本项目以 MIT 协议发布。DeepSeek Harness 亦为 MIT 协议；「DeepSeek Harness」是深度求索公司的注册商标，本项目仅在说明关系时使用该名称。
```

在 `.gitignore` 中补上打包输出目录：

```
release/
```

- [ ] **Step 3: 打包**

```bash
npm run prepare:resources
```

**不要把这条命令接到 `| tail` 之类的管道上。** 取 dsh 的那一步以 `stdio: 'inherit'` 调 npm，输出量很大；管道缓冲区写满后 npm 会阻塞在写 stdout 上，表现为「跑了半小时一个包都没落地、也没有任何输出」，很容易误判成网络问题。让它直接输出到终端或日志文件。

预期：`resources/runtime/node/node.exe` 与 `resources/dsh-bundled/node_modules/@deepseek-ai/dsh/lib/bin.js` 均存在。首次执行需数分钟。

**判断完成只看命令是否退出，不要轮询文件是否存在。** npm 在安装过程中会先落盘再重排目录，`bin.js` 会短暂出现又被移走；用 `until [ -f ... ]` 之类的循环等待会命中这个中间态，得出「已完成」的错误结论，随后启动就会报 MODULE_NOT_FOUND。脚本自身在结尾已做入口校验，命令正常退出即代表装好。

先跑资源自检。它不只看文件存不存在，还会真正执行一次内置 Node 与内置 dsh 的版本查询——
`dsh --version` 会走完整的依赖解析，能验出依赖树是否真的完整，而单纯的文件存在性检查会被
npm 安装中途的目录重排骗过去：

```bash
npm run verify:resources
```

预期：四项全为 ✓，末尾输出「资源自检通过，可以打包」。

```bash
npm run pack
```

打包结束后**必须核查 dsh 副本真的进了产物**——这一步失败时打包不会报错：

```bash
node -e "const{existsSync,readdirSync}=require('node:fs');const b='release/win-unpacked/resources/dsh-bundled/node_modules/@deepseek-ai';console.log(existsSync(b+'/dsh/lib/bin.js')?'✓ dsh 已打入，'+readdirSync(b).length+' 个包':'✗ dsh 缺失，检查 extraResources 的 from 是否直指 node_modules')"
```

预期：输出「✓ dsh 已打入，195 个包」。

预期：`release/` 下生成 `DSH启动器 Setup 0.1.0.exe`。`pack` 已把资源自检设为前置步骤。
首次打包需要下载 electron-builder 的 winCodeSign 与 nsis 二进制，国内网络下须先设好镜像：

```bash
ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/ npm run pack
```

```bash
node -e "const{statSync,readdirSync}=require('node:fs');for(const f of readdirSync('release')){if(f.endsWith('.exe'))console.log(f,(statSync('release/'+f).size/1048576).toFixed(0)+' MB')}"
```

预期：输出安装包体积，约 200–300 MB。

- [ ] **Step 4: 全新安装验收**

在一台**未装过 Node** 的机器上（或至少在全新用户账户下）执行安装包，逐条确认：

1. **安装** —— 双击安装包，可选择安装目录，完成后桌面与开始菜单出现「DSH启动器」快捷方式。SmartScreen 警告属预期（未做代码签名），点「更多信息 → 仍要运行」。
2. **首次启动** —— 启动页显示进度，随后主窗口加载出 dsh 的 Web UI。
3. **断网启动** —— 断开网络后重启应用，仍能正常进入主界面。
4. **数据互通** —— 关于页显示的 dsh 版本正确；若此前用过命令行版本，原有会话与模型配置仍在。
5. **端口自动分配** —— 连续启动两次，日志中记录的端口不同且都能正常访问。
6. **固定端口冲突** —— 设置固定端口为一个已被占用的端口（如另开一个占用 3080 的程序），重启 dsh，预期启动页如实报错而非静默换端口。
7. **托盘行为** —— 关闭主窗口后应用驻留托盘，双击托盘可唤回；托盘「退出」后任务管理器中无残留 `node.exe`。
8. **更新** —— 切到预览通道检查更新并安装，关于页版本随之变化；再点「回退到内置版本」可退回。
9. **崩溃重启** —— 在任务管理器中结束 dsh 的 `node.exe`，预期应用自动重启它并恢复；连续结束 4 次后停止重启并提示。
10. **日志** —— 上述过程在日志面板中均有记录，「在文件管理器中打开」可定位到日志文件。

把每条的实际结果记录下来；任何一条不符预期都属于本计划未完成。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: NSIS 打包配置与分发文档"
```

---

## 附：本计划有意不做的事

这些都属于 spec 明确的非目标，实现时不要顺手加上：

- **壳自身的自动更新**（electron-updater）与代码签名 —— 当前定位是自用/小范围。
- **macOS / Linux 打包** —— 代码结构未阻断跨平台，但不投入。
- **从 GitHub master 克隆源码本地构建** —— 已被 npm `next` 通道以低得多的成本替代。
- **模型 / API Key 配置界面** —— 上游 Web UI 已完整实现，重做既是重复劳动，也平白增加凭据泄露面。
- **对外暴露服务** —— 上游明确拒绝 `--host 0.0.0.0`，外壳同样不提供。
