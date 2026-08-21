// 验证 preload 在目标可执行文件里确实生效。
//
// 这项必须单独验：preload 失效是完全静默的——不报错、窗口照常显示、
// dsh 照常启动，只有 window.launcher 为 undefined，于是设置页、日志页、
// 关于页、更新功能全部失灵。只看主进程日志是发现不了的。
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const exe = process.argv[2]
const port = Number(process.argv[3] ?? 9455)
const sleep = ms => new Promise(r => setTimeout(r, ms))

const child = spawn(exe, [`--remote-debugging-port=${port}`], { stdio: ['ignore', 'ignore', 'pipe'] })
child.stderr.on('data', () => {})

let target
for (let i = 0; i < 60 && target === undefined; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    target = list.find(x => x.type === 'page' && x.url.includes('splash'))
  } catch { /* 调试端口尚未就绪 */ }
  if (target === undefined) await sleep(500)
}
if (target === undefined) {
  console.log('✗ 未找到启动页调试目标')
  child.kill(); process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise(res => {
  const msgId = ++id
  pending.set(msgId, res)
  ws.send(JSON.stringify({ id: msgId, method, params }))
})
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
})
await new Promise(res => ws.addEventListener('open', res))
await sleep(2500)

const probe = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    api: typeof window.launcher,
    methods: window.launcher ? Object.keys(window.launcher).length : 0,
    status: document.querySelector('#status')?.textContent ?? '',
  })`,
  returnByValue: true,
})
const info = JSON.parse(probe?.result?.value ?? '{}')

// 状态文字若还停在 HTML 初始值，说明 IPC 没把主进程的状态送达。
const statusFromMain = info.status !== '' && info.status !== '正在准备…'
const ok = info.api === 'object' && info.methods >= 10 && statusFromMain

console.log(`window.launcher 类型: ${info.api}`)
console.log(`暴露方法数: ${info.methods}`)
console.log(`启动页状态文字: ${info.status}`)
console.log(ok ? '\n✓ preload 与 IPC 均已生效' : '\n✗ preload 或 IPC 未生效')

ws.close()
child.kill()
setTimeout(() => process.exit(ok ? 0 : 1), 2500)
