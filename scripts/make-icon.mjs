// 从启动页那份鲸鱼 SVG 渲染出 icon.png，供托盘与安装包使用。
// 复用同一份图形定义，保证三处外观始终一致——手工维护两套迟早会漂移。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outFile = process.argv[2] ?? join(root, 'resources', 'icon.png')
const size = Number(process.argv[3] ?? 256)

const electronPath = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
if (!existsSync(electronPath)) {
  throw new Error(`未找到 Electron，请先 npm install：${electronPath}`)
}

// 从 whale.ts 里取出 SVG 字符串。这里不走 TS 编译，直接执行模板字面量部分：
// 该文件只导出一个纯函数，用正则摘出函数体反而比引入编译链更省事。
const source = readFileSync(join(root, 'src', 'renderer', 'splash', 'whale.ts'), 'utf8')
const match = /return `([\s\S]*?)`\n}/.exec(source)
if (match === null) throw new Error('无法从 whale.ts 中解析出 SVG 模板')
const svgBody = match[1]
  .replace(/\$\{p\}/g, 'icon')
  .replace(/\$\{disc \? '([^']*)' : ''\}/, '$1')

const workDir = join(root, 'resources', '.icon-tmp')
mkdirSync(workDir, { recursive: true })
const page = join(workDir, 'icon.html')
writeFileSync(page, `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
svg{display:block;width:${size}px;height:${size}px}
</style></head><body><svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">${svgBody}</svg></body></html>`, 'utf8')

writeFileSync(join(workDir, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: ${size}, height: ${size}, show: false, frame: false,
    transparent: true, backgroundColor: '#00000000',
  })
  await win.loadFile(${JSON.stringify(page)})
  await new Promise(r => setTimeout(r, 900))
  const img = await win.webContents.capturePage()
  writeFileSync(${JSON.stringify(outFile)}, img.toPNG())
  console.log('written')
  app.quit()
})
`, 'utf8')
writeFileSync(join(workDir, 'package.json'), JSON.stringify({ name: 'icon-gen', main: 'main.cjs' }), 'utf8')

const child = spawn(electronPath, [workDir], { stdio: ['ignore', 'pipe', 'pipe'] })
let ok = false
child.stdout.on('data', b => { if (b.toString().includes('written')) ok = true })
child.stderr.on('data', () => {})
child.on('exit', () => {
  if (!ok || !existsSync(outFile)) {
    console.error('图标生成失败')
    process.exit(1)
  }
  const bytes = readFileSync(outFile)
  const signature = bytes.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') {
    console.error('产出的不是合法 PNG')
    process.exit(1)
  }
  console.log(`已生成 ${outFile}，${size}x${size}，${bytes.length} 字节`)
  process.exit(0)
})
setTimeout(() => { child.kill(); process.exit(1) }, 40000)
