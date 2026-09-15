// 校验打包产物里的 dsh 命令行入口。
//
// 覆盖：三个文件在位；产物是单文件（没有指向 out/main 的共享 chunk——那种
// 搬到 bin/ 后会找不到，而且构建零报错）；无设置时跑内置副本；设置里激活了
// 更新副本就跑更新副本；DSH_HOME 从设置透传到 dsh；退出码原样透传。
//
// 全程用临时 APPDATA 隔离，不读不写真实的用户设置。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const unpacked = join(root, 'release', 'win-unpacked')
const bin = join(unpacked, 'bin')
const shim = join(bin, 'dsh.cmd')

let ok = true
function check(label, pass, detail = '') {
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!pass) ok = false
}

if (!existsSync(unpacked)) {
  console.error('✗ 未找到 release/win-unpacked，请先 npm run pack:dir')
  process.exit(1)
}

// ---- 文件在位 ----
for (const f of ['dsh.cmd', 'dsh-cli.mjs', 'path-setup.ps1']) {
  check(`bin/${f} 在位`, existsSync(join(bin, f)))
}
if (!ok) process.exit(1)

// ---- 单文件：只允许 node: 内置模块的 import ----
const cliSource = readFileSync(join(bin, 'dsh-cli.mjs'), 'utf8')
const imports = [...cliSource.matchAll(/^import\b[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1])
const foreign = imports.filter(s => !s.startsWith('node:'))
check('dsh-cli.mjs 是自包含单文件', foreign.length === 0,
  foreign.length === 0 ? `${imports.length} 个 import 全为 node: 内置模块` : `含外部引用 ${foreign.join(', ')}`)

// ---- 临时 APPDATA ----
const appData = mkdtempSync(join(tmpdir(), 'dsh-cli-check-'))
const userData = join(appData, 'dsh-launcher')
mkdirSync(userData, { recursive: true })

/**
 * 用临时 APPDATA 跑 dsh.cmd。
 *
 * 必须 windowsVerbatimArguments：否则 Node 会给含引号的参数加反斜杠转义，
 * cmd 收到的是 \"…dsh.cmd\"，当成一个不存在的命令报错。这里手工拼出的命令行
 * 与 Node 自己 shell:true 时生成的完全一样（/d /s /c 加最外层一对引号），
 * 只是不触发 DEP0190 弃用警告。
 */
function runShim(args, extraEnv = {}) {
  return spawnSync('cmd.exe', ['/d', '/s', '/c', `""${shim}" ${args.join(' ')}"`], {
    encoding: 'utf8',
    env: { ...process.env, APPDATA: appData, ...extraEnv },
    windowsHide: true,
    windowsVerbatimArguments: true,
  })
}

try {
  // ---- 无设置 → 内置副本 ----
  const bundledPkg = join(unpacked, 'resources', 'dsh-bundled', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const bundledVersion = JSON.parse(readFileSync(bundledPkg, 'utf8')).version
  const r1 = runShim(['--version'])
  check('无设置时跑内置副本', r1.status === 0 && r1.stdout.trim().endsWith(bundledVersion),
    r1.status === 0 ? `输出 ${r1.stdout.trim().split('\n').pop()}，内置 ${bundledVersion}` : `退出码 ${r1.status}：${r1.stderr.trim()}`)

  // ---- 伪造一份"更新副本"，让设置指向它 ----
  const fakeName = 'dsh-9.9.9-check'
  const fakeRoot = join(userData, 'dsh-runtime', fakeName, 'node_modules', '@deepseek-ai', 'dsh')
  mkdirSync(join(fakeRoot, 'lib'), { recursive: true })
  writeFileSync(join(fakeRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '9.9.9-check' }))
  writeFileSync(join(fakeRoot, 'lib', 'bin.js'), [
    "const a = process.argv.slice(2)",
    "if (a[0] === '--exit') process.exit(Number(a[1]))",
    "if (a[0] === '--home') { console.log(process.env.DSH_HOME ?? '(unset)'); process.exit(0) }",
    "console.log('FAKE 9.9.9-check')",
  ].join('\n'))
  const fakeHome = join(appData, 'custom-dsh-home')
  writeFileSync(join(userData, 'config.json'), JSON.stringify({
    port: 0, dshHome: fakeHome, closeToTray: true, telemetryDisabled: false,
    updateChannel: 'latest', activeRuntime: fakeName,
  }))

  const r2 = runShim(['--version'])
  check('设置激活更新副本后跑更新副本', r2.status === 0 && r2.stdout.includes('FAKE 9.9.9-check'),
    r2.status === 0 ? r2.stdout.trim() : `退出码 ${r2.status}：${r2.stderr.trim()}`)

  const r3 = runShim(['--home'])
  check('设置里的 DSH_HOME 透传给 dsh', r3.stdout.trim() === fakeHome, r3.stdout.trim())

  const r4 = runShim(['--home'], { DSH_HOME: 'FROM-SHELL' })
  check('shell 显式设置的 DSH_HOME 优先', r4.stdout.trim() === 'FROM-SHELL', r4.stdout.trim())

  const r5 = runShim(['--exit', '7'])
  check('退出码原样透传', r5.status === 7, `退出码 ${r5.status}`)
} finally {
  rmSync(appData, { recursive: true, force: true })
}

if (!ok) {
  console.error('\n✗ 命令行入口校验失败')
  process.exit(1)
}
console.log('\n✓ dsh 命令行入口完好')
