// 校验安装包里确实编入了自定义 NSIS 逻辑。
//
// 这项必须显式验：nsis.include 的路径相对 directories.buildResources 解析，
// 写错时 electron-builder 既不报错也不警告——安装包照常生成、体积正常、
// 能装能用，只是自定义安装逻辑从未编进去。图标缓存刷新会静静失效，
// 用户覆盖安装后仍看到旧图标，而构建日志里找不到任何线索。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const releaseDir = join(root, 'release')

if (!existsSync(releaseDir)) {
  console.error('✗ 未找到 release 目录，请先 npm run pack')
  process.exit(1)
}

const setup = readdirSync(releaseDir).find(f => f.endsWith('.exe') && f.includes('Setup'))
if (setup === undefined) {
  console.error('✗ 未找到安装包，请先 npm run pack')
  process.exit(1)
}

const bytes = readFileSync(join(releaseDir, setup))

/** NSIS 编译后，System 插件名与被调函数串会以明文留在二进制中。 */
const checks = [
  ['System.dll 插件', 'System.dll'],
  ['SHChangeNotify 调用', 'shell32::SHChangeNotify'],
]

let ok = true
for (const [label, needle] of checks) {
  const found = bytes.includes(Buffer.from(needle, 'ascii'))
  console.log(`${found ? '✓' : '✗'} ${label}`)
  if (!found) ok = false
}

if (!ok) {
  console.error('\n✗ 自定义 NSIS 逻辑未编入安装包')
  console.error('  检查 electron-builder.yml：nsis.include 的路径相对 directories.buildResources 解析')
  process.exit(1)
}
console.log(`\n✓ 安装包已编入图标缓存刷新逻辑（${setup}）`)
