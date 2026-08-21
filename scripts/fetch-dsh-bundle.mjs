// 用 npm 把 dsh 安装到 resources/dsh-bundled，作为随包内置的只读基线。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

// 移除安装锚点。electron-builder 一旦看到某个目录里 package.json 与 node_modules
// 并存，就把它当成一个 Node 项目，转而走「依赖交给 asar 处理」的路径并跳过其
// node_modules——产出的安装包里 dsh-bundled 只剩一个 package.json，装完启动即报
// 「内置 dsh 副本不可用」，而打包过程不会有任何报错。
// 这两个文件只是 npm 安装时的锚点，运行时只读 node_modules 下 dsh 自己的清单。
for (const anchor of ['package.json', 'package-lock.json']) {
  rmSync(join(target, anchor), { force: true })
}

console.log(`内置 dsh 副本就绪：${packageRoot}`)
