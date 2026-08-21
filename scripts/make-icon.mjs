// 从鲸鱼图形模块渲染出图标资源，供托盘、任务栏与安装包使用。
//
// 直接 import src/renderer/splash/whale-shapes.mjs —— 与渲染层共用同一份定义，
// 两处外观不可能漂移。早先的做法是用正则从 .ts 源码里抠模板字符串，
// 结构一改就静默产出错误图标（白圆盘也是合法 PNG，任何校验都发现不了）。
//
// 产出两个文件：
//   icon.png  256x256，给 electron-builder 生成安装包与 exe 图标
//   icon.ico  多尺寸（16~256），给托盘用
// 托盘必须用 ICO：它实际只显示 16x16（高 DPI 下 20/24），
// 拿单张 256x256 去缩 16 倍必然糊成锯齿；ICO 里备好各号原生尺寸，
// 系统直接挑最接近的那张，不做缩放。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SIMPLIFY_AT_OR_BELOW, whaleSvg } from '../src/renderer/splash/whale-shapes.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const resourcesDir = join(root, 'resources')
const pngFile = join(resourcesDir, 'icon.png')
const icoFile = join(resourcesDir, 'icon.ico')

/** ICO 里备的尺寸。16/20/24 覆盖各档 DPI 下的托盘，其余给任务栏与文件列表。 */
const ICO_SIZES = [16, 20, 24, 32, 48, 64, 128, 256]
const PNG_SIZE = 256
/** 固定画布，靠裁剪区取目标尺寸。见下方注释。 */
const CANVAS = 300

const electronPath = join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
if (!existsSync(electronPath)) {
  throw new Error(`未找到 Electron，请先 npm install：${electronPath}`)
}

const workDir = join(resourcesDir, '.icon-tmp')
mkdirSync(workDir, { recursive: true })

const sizes = [...new Set([...ICO_SIZES, PNG_SIZE])].sort((a, b) => a - b)

// SVG 一律钉在左上角，靠 capturePage 的裁剪区取出目标尺寸。
// 不能给每个尺寸开一个同样大小的窗口——Windows 上 Electron 有最小窗口尺寸，
// 16/20/24px 的窗口会被强行撑大，页面直接加载失败。
// 固定用一个大画布，让 SVG 以目标像素原生光栅化（抗锯齿交给矢量渲染器），
// 比先渲染大图再缩小位图清晰得多。
for (const size of sizes) {
  const body = whaleSvg({
    idPrefix: `icon${String(size)}`,
    disc: true,
    simplified: size <= SIMPLIFY_AT_OR_BELOW,
  })
  writeFileSync(join(workDir, `icon-${String(size)}.html`), `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
svg{position:absolute;top:0;left:0;display:block;width:${String(size)}px;height:${String(size)}px}
</style></head><body><svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">${body}</svg></body></html>`, 'utf8')
}

writeFileSync(join(workDir, 'main.cjs'), `
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
app.disableHardwareAcceleration()
const SIZES = ${JSON.stringify(sizes)}
const DIR = ${JSON.stringify(workDir)}
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: ${String(CANVAS)}, height: ${String(CANVAS)}, show: false, frame: false,
    transparent: true, backgroundColor: '#00000000', useContentSize: true,
  })
  for (const size of SIZES) {
    await win.loadFile(join(DIR, 'icon-' + size + '.html'))
    await new Promise(r => setTimeout(r, 300))
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
    writeFileSync(join(DIR, 'icon-' + size + '.png'), img.toPNG())
  }
  win.destroy()
  console.log('rendered')
  app.quit()
})
`, 'utf8')
writeFileSync(join(workDir, 'package.json'), JSON.stringify({ name: 'icon-gen', main: 'main.cjs' }), 'utf8')

/** 按 ICO 规范拼装。Vista 起允许直接内嵌 PNG，不必转 BMP。 */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)

  const dir = []
  let offset = 6 + entries.length * 16
  for (const { size, data } of entries) {
    const e = Buffer.alloc(16)
    // 256 在这一字节里记作 0，这是规范定义的表示法。
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2)
    e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    dir.push(e)
    offset += data.length
  }
  return Buffer.concat([header, ...dir, ...entries.map(x => x.data)])
}

/**
 * 粗查图像是否近乎全白/全透明——图形模块若被改坏，产出的会是一张空圆盘，
 * 它同样是合法 PNG，尺寸校验也照样通过。这里按压缩后体积下限兜底：
 * 实测有鲸鱼的 256px 图约 20KB 以上，纯圆盘不到 3KB。
 */
function looksEmpty(size, data) {
  if (size < 128) return false
  return data.length < 6000
}

const child = spawn(electronPath, [workDir], { stdio: ['ignore', 'pipe', 'pipe'] })
let rendered = false
child.stdout.on('data', b => { if (b.toString().includes('rendered')) rendered = true })
child.stderr.on('data', () => {})
child.on('exit', () => {
  if (!rendered) {
    console.error('图标渲染失败')
    process.exit(1)
  }

  const PNG_SIGNATURE = '89504e470d0a1a0a'
  const entries = []
  for (const size of ICO_SIZES) {
    const file = join(workDir, `icon-${String(size)}.png`)
    if (!existsSync(file)) {
      console.error(`缺少 ${String(size)}x${String(size)} 渲染结果`)
      process.exit(1)
    }
    const data = readFileSync(file)
    if (data.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) {
      console.error(`${String(size)}x${String(size)} 产出的不是合法 PNG`)
      process.exit(1)
    }
    // 逐张核对实际像素尺寸：窗口尺寸与内容尺寸在高 DPI 下未必相等，
    // 若被系统缩放过，ICO 的目录项就会与数据不符。
    const actual = data.readUInt32BE(16)
    if (actual !== size) {
      console.error(`${String(size)}x${String(size)} 实际渲染为 ${String(actual)}px，请检查 DPI 缩放`)
      process.exit(1)
    }
    if (looksEmpty(size, data)) {
      console.error(`${String(size)}x${String(size)} 疑似空图（${String(data.length)} 字节），图形模块可能有问题`)
      process.exit(1)
    }
    entries.push({ size, data })
  }

  writeFileSync(pngFile, readFileSync(join(workDir, `icon-${String(PNG_SIZE)}.png`)))
  const ico = buildIco(entries)
  writeFileSync(icoFile, ico)

  console.log(`已生成 ${pngFile}（${String(PNG_SIZE)}x${String(PNG_SIZE)}）`)
  console.log(`已生成 ${icoFile}（${ICO_SIZES.join('/')}，${(ico.length / 1024).toFixed(1)} KB）`)
  process.exit(0)
})
setTimeout(() => { child.kill(); process.exit(1) }, 90000)
