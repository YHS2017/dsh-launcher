// 校验安装包里确实编入了自定义 NSIS 逻辑。
//
// 这项必须显式验：nsis.include 的路径相对 directories.buildResources 解析，
// 写错时 electron-builder 既不报错也不警告——安装包照常生成、体积正常、
// 能装能用，只是自定义安装逻辑从未编进去。图标缓存刷新会静静失效，
// 用户覆盖安装后仍看到旧图标，而构建日志里找不到任何线索。
//
// 判据是 release/builder-debug.yml——electron-builder 每次构建都会把它
// 真正交给 makensis 的完整脚本原样写进去，是权威记录。
//
// 早先这里的做法是在安装包二进制里 grep "System.dll"/"SHChangeNotify"，
// 那是不成立的：NSIS 的脚本与数据段经 LZMA 压缩，连产品名本身都搜不到
// 明文，只有最外层 "NullsoftInst" 头是未压缩的。该做法会对完全正常的
// 安装包报假阴性，反过来也可能因为撞上未压缩区段而给出假阳性。
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

const debugFile = join(releaseDir, 'builder-debug.yml')
if (!existsSync(debugFile)) {
  console.error('✗ 未找到 release/builder-debug.yml，无法确认编入内容')
  console.error('  它由 electron-builder 在构建时写出；请重新 npm run pack')
  process.exit(1)
}

const script = readFileSync(debugFile, 'utf8')

// npm run pack:dir 也会重写 builder-debug.yml，但 --dir 模式根本不生成 NSIS 脚本。
// 此时 release/ 里可能还留着上一次完整打包的安装包，两者对不上：安装包本身没问题，
// 判据却已经被覆盖掉了。必须把"无从判定"和"确实没编进去"区分开，否则这里会对着
// 一个完好的安装包报假失败。
if (!script.includes('nsis:')) {
  console.error('✗ 无从判定：release/builder-debug.yml 里没有 NSIS 脚本')
  console.error('  上一次构建是 npm run pack:dir（--dir 模式不生成安装包），判据已被覆盖。')
  console.error('  请先 npm run pack 出一次完整安装包再验。')
  process.exit(1)
}

const nshPath = join(root, 'build', 'installer.nsh')
const nsh = existsSync(nshPath) ? readFileSync(nshPath, 'utf8') : ''

const checks = [
  // 生成的 NSIS 脚本里必须真的 include 了我们的 installer.nsh。
  ['installer.nsh 已被 include', /!include\s+"[^"]*build[^"]*installer\.nsh"/.test(script)],
  ['安装钩子 customInstall', /!macro\s+customInstall/.test(nsh)],
  ['卸载钩子 customUnInstall', /!macro\s+customUnInstall/.test(nsh)],
  ['图标缓存刷新调用', /shell32::SHChangeNotify/.test(nsh)],
  // 安装加 PATH、卸载移除，两条都得在——少一条就是装了删不干净或删了装不上。
  ['安装时把 bin 加进 PATH', /path-setup\.ps1[^\r\n]*-Action add\b/.test(nsh)],
  ['卸载时从 PATH 移除', /path-setup\.ps1[^\r\n]*-Action remove\b/.test(nsh)],
]

let ok = true
for (const [label, found] of checks) {
  console.log(`${found ? '✓' : '✗'} ${label}`)
  if (!found) ok = false
}

if (!ok) {
  console.error('\n✗ 自定义 NSIS 逻辑未编入安装包')
  console.error('  检查 electron-builder.yml：nsis.include 的路径相对 directories.buildResources 解析')
  process.exit(1)
}
console.log(`\n✓ 安装包已编入图标缓存刷新逻辑（${setup}）`)
