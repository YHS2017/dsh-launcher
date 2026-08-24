// 校验打包后的内置 dsh 副本仍然可用，且裁剪规则确实生效。
//
// electron-builder.yml 把 dsh 依赖树里约六成的文件（sourcemap、类型声明、
// TypeScript 源、文档、测试）排除在安装包之外。这项优化的两个方向都会静默出错：
//
//   排多了 —— 内置 dsh 起不来，但打包照常成功、体积正常，只有真正运行才暴露；
//   排少了 —— filter 模式没匹配上（比如顺序被挪动、写错通配符），打包也照常
//             成功，只是又慢回去了，日志里找不到任何线索。
//
// 所以这里验四件事：跑得起来、该排的排掉了、许可证还在、没有哪个依赖包被整个清空。
// 最后一条是前三条都抓不住的——详见第 4 项的注释。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packedResources = join(root, 'release', 'win-unpacked', 'resources')
const bundledRoot = join(packedResources, 'dsh-bundled', 'node_modules')
const dshRoot = join(bundledRoot, '@deepseek-ai', 'dsh')
const nodeExe = join(packedResources, 'runtime', 'node', 'node.exe')

if (!existsSync(bundledRoot)) {
  console.error('✗ 未找到打包后的 dsh 副本，请先 npm run pack 或 npm run pack:dir')
  process.exit(1)
}

let ok = true
const fail = msg => { console.error(`✗ ${msg}`); ok = false }

// 1) 打包后的 dsh 能被打包后的 Node 跑起来，且自报版本与清单一致。
const manifest = JSON.parse(readFileSync(join(dshRoot, 'package.json'), 'utf8'))
const binRel = typeof manifest.bin === 'string' ? manifest.bin : Object.values(manifest.bin)[0]
try {
  const out = execFileSync(nodeExe, [join(dshRoot, binRel), '--version'], {
    encoding: 'utf8',
    timeout: 120_000,
  }).trim()
  if (out === manifest.version) {
    console.log(`✓ 打包后的 dsh 可执行 — ${out}`)
  } else {
    fail(`打包后的 dsh 自报版本 ${out} 与清单 ${manifest.version} 不一致`)
  }
} catch (err) {
  fail(`打包后的 dsh 起不来：${err.message.split('\n')[0]}`)
  console.error('  裁剪规则可能排多了，先摘掉 electron-builder.yml 里 !**/*.ts 那四条验证')
}

// 2) 该排掉的确实排掉了。留一条也说明 filter 没生效。
const PRUNED_SUFFIXES = ['.map', '.d.ts', '.d.mts', '.d.cts', '.ts', '.tsx', '.mts', '.cts']
// 必须与 electron-builder.yml 的 filter 保持一致。注意 spec 不在其中：
// @standard-schema/spec 是真实依赖包，同名排除会把它整个清空。
const PRUNED_DIRS = new Set(['test', 'tests', '__tests__', '__mocks__', 'example', 'examples', 'demo', 'benchmark', 'benchmarks'])
/** 许可证是被 filter 末尾那条特意捞回来的，不算残留。 */
const isLicense = name => /^(LICEN[CS]E|COPYING|NOTICE)/i.test(name)

let total = 0
const residual = new Map()
let licenses = 0
const walk = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (PRUNED_DIRS.has(entry.name)) residual.set(`${entry.name}/ 目录`, (residual.get(`${entry.name}/ 目录`) ?? 0) + 1)
      walk(full)
      continue
    }
    if (!entry.isFile()) continue
    total += 1
    if (isLicense(entry.name)) { licenses += 1; continue }
    const hit = PRUNED_SUFFIXES.find(s => entry.name.endsWith(s))
    if (hit !== undefined) residual.set(hit, (residual.get(hit) ?? 0) + 1)
    if (entry.name.endsWith('.md')) residual.set('.md', (residual.get('.md') ?? 0) + 1)
  }
}
walk(bundledRoot)

if (residual.size === 0) {
  console.log(`✓ 裁剪规则已生效 — 打包后共 ${total} 个文件`)
} else {
  fail(`裁剪规则未完全生效，打包后仍有 ${[...residual].map(([k, v]) => `${k}×${v}`).join('、')}`)
  console.error('  检查 electron-builder.yml 的 filter：末尾捞回许可证那条之后不能再加排除模式')
}

// 3) 许可证必须还在——依赖树里的 MIT/BSD/Apache 都要求再分发时附上。
if (licenses > 0) {
  console.log(`✓ 许可证文件已保留 — ${licenses} 个`)
} else {
  fail('打包后一个许可证文件都没有，违反依赖的再分发要求')
  console.error('  filter 末尾必须保留 **/{LICENSE,LICENCE,COPYING,NOTICE}* 这条')
}

// 4) 没有哪个依赖包被 filter 整个清空。
//
// 这一条是上面三条都抓不住的。filter 里的目录名（test/example/benchmark…）
// 在 node_modules 下既可能是包内的测试目录，也可能正好是一个真实依赖包的名字；
// 撞上时那个包会被整个排掉，而打包零报错、体积正常、dsh --version 照常通过——
// 只有运行到用它的代码路径才会炸。判据取「包目录必须有 package.json」：
// 被清空的包只会剩下靠许可证那条捞回来的 LICENSE。
const packageDirs = []
const collectPackages = nmDir => {
  for (const entry of readdirSync(nmDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = join(nmDir, entry.name)
    if (entry.name.startsWith('@')) {
      // 作用域目录本身不是包，下一层才是。
      for (const scoped of readdirSync(full, { withFileTypes: true })) {
        if (scoped.isDirectory()) packageDirs.push(join(full, scoped.name))
      }
      continue
    }
    packageDirs.push(full)
  }
}
collectPackages(bundledRoot)
// 嵌套依赖也要查。
for (const dir of [...packageDirs]) {
  const nested = join(dir, 'node_modules')
  if (existsSync(nested) && statSync(nested).isDirectory()) collectPackages(nested)
}

const gutted = packageDirs.filter(d => !existsSync(join(d, 'package.json')))
if (gutted.length === 0) {
  console.log(`✓ ${packageDirs.length} 个依赖包均完整（都有 package.json）`)
} else {
  fail(`${gutted.length} 个依赖包被 filter 整个清空：`)
  for (const d of gutted.slice(0, 10)) console.error(`    ${d.slice(bundledRoot.length + 1)}`)
  console.error('  某条目录名排除规则撞上了真实包名，把该名字从 electron-builder.yml 的 filter 里去掉')
}

if (!ok) process.exit(1)
console.log('\n✓ 内置 dsh 副本裁剪后仍完好')
