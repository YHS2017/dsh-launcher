// 生成 256x256 的占位图标 PNG（自带 CRC32，不依赖 zlib.crc32 这类可能不存在的 API）。
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const W = 256
const H = 256
// 画一个圆角方块底 + 中心留白的简单标记，避免纯色块看起来像加载失败。
const raw = Buffer.alloc((W * 3 + 1) * H)
for (let y = 0; y < H; y += 1) {
  const rowStart = y * (W * 3 + 1)
  raw[rowStart] = 0 // filter type: none
  for (let x = 0; x < W; x += 1) {
    const p = rowStart + 1 + x * 3
    const inMargin = x < 24 || x > W - 25 || y < 24 || y > H - 25
    const cx = x - W / 2
    const cy = y - H / 2
    const inRing = cx * cx + cy * cy < 62 * 62 && cx * cx + cy * cy > 34 * 34
    if (inMargin) {
      raw[p] = 0x00; raw[p + 1] = 0x00; raw[p + 2] = 0x00
    } else if (inRing) {
      raw[p] = 0xff; raw[p + 1] = 0xff; raw[p + 2] = 0xff
    } else {
      raw[p] = 0x25; raw[p + 1] = 0x63; raw[p + 2] = 0xeb
    }
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 2 // color type: truecolor
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])

const out = process.argv[2]
mkdirSync(out.replace(/[\\/][^\\/]+$/, ''), { recursive: true })
writeFileSync(out, png)
console.log(`已生成 ${out}，${png.length} 字节`)
