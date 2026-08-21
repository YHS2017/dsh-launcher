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
