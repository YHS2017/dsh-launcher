// 对打包产物跑可自动化的验收项：崩溃自动重启、优雅关停无残留、端口每次不同。
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const exe = process.argv[2]
const logFile = join(process.env.APPDATA ?? homedir(), 'dsh-launcher', 'logs', 'launcher.log')
const results = []

const readLog = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '')
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 等日志出现匹配，返回是否命中。 */
async function waitFor(re, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (re.test(readLog())) return true
    await sleep(1000)
  }
  return false
}

/** 数一下当前有几个 dsh 子进程（命令行里带 dsh-bundled 的 node.exe）。 */
function countDshProcesses() {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*dsh-bundled*' }).Count"],
      { encoding: 'utf8', timeout: 30000 })
    return Number(out.trim()) || 0
  } catch { return -1 }
}

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// ---- 第一轮：启动，记录端口 ----
rmSync(logFile, { force: true })
let app = spawn(exe, [], { stdio: 'ignore' })
if (!await waitFor(/dsh 就绪：http/, 120000)) {
  record('首次启动就绪', false, '超时')
  app.kill(); process.exit(1)
}
const port1 = /dsh 就绪：http:\/\/127\.0\.0\.1:(\d+)/.exec(readLog())?.[1]
record('首次启动就绪', true, `端口 ${port1}`)

// ---- 崩溃自动重启：杀掉 dsh 子进程，看外壳是否把它拉回来 ----
const before = readLog().length
try {
  execFileSync('powershell', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*dsh-bundled*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],
    { timeout: 30000 })
  const restarted = await waitFor(/dsh 就绪：http/, 90000) && readLog().length > before
  const port2 = [...readLog().matchAll(/dsh 就绪：http:\/\/127\.0\.0\.1:(\d+)/g)].pop()?.[1]
  record('杀掉 dsh 后自动重启', restarted, restarted ? `新端口 ${port2}` : '未见重新就绪')
} catch (error) {
  record('杀掉 dsh 后自动重启', false, error.message)
}

// ---- 优雅关停：结束外壳，dsh 子进程不应残留 ----
app.kill()
await sleep(6000)
const leftover = countDshProcesses()
record('退出后无残留 dsh 进程', leftover === 0, `残留 ${leftover} 个`)

// ---- 第二轮：端口应与第一次不同（--port 0 自动分配）----
rmSync(logFile, { force: true })
app = spawn(exe, [], { stdio: 'ignore' })
if (await waitFor(/dsh 就绪：http/, 120000)) {
  const port3 = /dsh 就绪：http:\/\/127\.0\.0\.1:(\d+)/.exec(readLog())?.[1]
  record('端口由系统自动分配', port3 !== port1, `本次 ${port3}，上次 ${port1}`)
} else {
  record('端口由系统自动分配', false, '第二次启动超时')
}
app.kill()
await sleep(5000)

const failed = results.filter(r => !r.ok)
console.log(`\n通过 ${results.length - failed.length}/${results.length}`)
process.exit(failed.length === 0 ? 0 : 1)
