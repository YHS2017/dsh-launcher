// 验证 preload 在目标可执行文件里确实生效。
//
// 这项必须单独验：preload 失效是完全静默的——不报错、窗口照常显示、
// dsh 照常启动，只有 window.launcher 为 undefined，于是设置页、日志页、
// 关于页、更新功能全部失灵。只看主进程日志是发现不了的。
import { spawn } from 'node:child_process'

const exe = process.argv[2]
const port = Number(process.argv[3] ?? 9455)
const sleep = ms => new Promise(r => setTimeout(r, ms))

function fail(message) {
  console.log(`✗ ${message}`)
  process.exit(1)
}

/**
 * 启动实例并抓到启动页的调试目标。
 *
 * 时序很紧：dsh 预热后约 1.8 秒就绪，届时主窗口取代启动页、后者随即关闭。
 * 所以确认「没被单实例锁挡回」的窗口必须短，且要立刻开始密集轮询——
 * 被锁挡回的进程实测 561ms 内就退出，900ms 足以区分两者。
 */
async function launchAndFindSplash() {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const child = spawn(exe, [`--remote-debugging-port=${port}`], { stdio: ['ignore', 'ignore', 'pipe'] })
    child.stderr.on('data', () => {})
    let exitedEarly = false
    child.on('exit', () => { exitedEarly = true })

    // 一边等锁的判定窗口，一边就开始找页面，不浪费启动页存活的那几秒。
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      if (exitedEarly) break
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        const found = list.find(x => x.type === 'page' && x.url.includes('splash'))
        if (found !== undefined) return { child, target: found }
      } catch { /* 调试端口尚未就绪 */ }
      await sleep(150)
    }

    if (!exitedEarly) {
      child.kill()
      console.log(`  第 ${attempt} 次：实例在运行但没抓到启动页，重试…`)
    } else {
      console.log(`  第 ${attempt} 次启动被单实例锁挡回，等待上一个实例退出…`)
    }
    await sleep(5000)
  }
  return undefined
}

const launched = await launchAndFindSplash()
if (launched === undefined) fail('未能抓到启动页调试目标（可能有残留实例占着单实例锁）')
const { child, target } = launched

const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pending = new Map()

/** 每个 CDP 调用都要有超时：页面若在此期间关闭，await 会永久悬挂。 */
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const msgId = ++id
  const timer = setTimeout(() => {
    pending.delete(msgId)
    reject(new Error(`CDP ${method} 超时`))
  }, 15000)
  pending.set(msgId, value => { clearTimeout(timer); resolve(value) })
  ws.send(JSON.stringify({ id: msgId, method, params }))
})

ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
})

const opened = await Promise.race([
  new Promise(res => ws.addEventListener('open', () => res(true))),
  sleep(15000).then(() => false),
])
if (!opened) {
  child.kill()
  fail('无法连上启动页的调试端口')
}

/**
 * 连上就开始轮询取值，不能先 sleep 再取。
 * 启动页只存活到 dsh 就绪为止（预热后约 1.8 秒），先睡再问必然扑空。
 * 取到一次合格结果就够——拿到即离开循环，页面随后关闭也不影响结论。
 */
const EXPR = `JSON.stringify({
  api: typeof window.launcher,
  methods: window.launcher ? Object.keys(window.launcher).length : 0,
  status: document.querySelector('#status')?.textContent ?? '',
})`

// 状态文字若还停在 HTML 初始值，说明 IPC 没把主进程的状态送达。
const isComplete = i => i.api === 'object' && i.methods >= 10
  && i.status !== '' && i.status !== '正在准备…'

let info = {}
const probeDeadline = Date.now() + 12000
while (Date.now() < probeDeadline) {
  try {
    const probe = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true })
    const current = JSON.parse(probe?.result?.value ?? '{}')
    if (current.api !== undefined) info = current
    if (isComplete(info)) break
  } catch {
    // 页面关闭后 CDP 不再应答。此前若已取到合格结果就用它，否则如实失败。
    break
  }
  await sleep(250)
}

const ok = isComplete(info)

console.log(`window.launcher 类型: ${info.api}`)
console.log(`暴露方法数: ${info.methods}`)
console.log(`启动页状态文字: ${info.status}`)
console.log(ok ? '\n✓ preload 与 IPC 均已生效' : '\n✗ preload 或 IPC 未生效')

ws.close()
child.kill()
setTimeout(() => process.exit(ok ? 0 : 1), 3000)
