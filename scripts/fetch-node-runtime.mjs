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

rmSync(tmpDir, { recursive: true, force: true })
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
if (!existsSync(join(target, 'node_modules', 'npm', 'bin', 'npm-cli.js'))) {
  throw new Error(`解包后未找到 npm 入口，更新功能将不可用：${target}`)
}
console.log(`Node 运行时就绪：${target}`)
