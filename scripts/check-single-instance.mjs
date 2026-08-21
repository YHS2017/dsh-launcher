// 验证单实例：第二次启动应立即退出，且不新建任何窗口。
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const exe = process.argv[2]
const logFile = join(process.env.APPDATA ?? homedir(), 'dsh-launcher', 'logs', 'launcher.log')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const readLog = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '')
const countReady = () => [...readLog().matchAll(/dsh 就绪：http/g)].length

rmSync(logFile, { force: true })

// 第一个实例
const first = spawn(exe, [], { stdio: 'ignore' })
const deadline = Date.now() + 120000
while (Date.now() < deadline && countReady() === 0) await sleep(1000)
if (countReady() === 0) {
  console.log('✗ 第一个实例未能就绪')
  first.kill(); process.exit(1)
}
console.log('✓ 第一个实例已就绪')

const readyBefore = countReady()

// 第二个实例：应当立刻退出
const started = Date.now()
const second = spawn(exe, [], { stdio: 'ignore' })
const exitCode = await new Promise(resolve => {
  second.on('exit', code => resolve(code))
  setTimeout(() => resolve('timeout'), 30000)
})
const elapsed = Date.now() - started

if (exitCode === 'timeout') {
  console.log('✗ 第二个实例 30 秒内未退出，单实例锁未生效')
  second.kill(); first.kill(); process.exit(1)
}
console.log(`✓ 第二个实例自行退出（${elapsed}ms，退出码 ${exitCode}）`)

// 第二个实例不得触发一次新的启动流程
await sleep(3000)
const readyAfter = countReady()
if (readyAfter !== readyBefore) {
  console.log(`✗ 第二个实例又拉起了一次 dsh（就绪行 ${readyBefore} → ${readyAfter}）`)
  first.kill(); process.exit(1)
}
console.log(`✓ 未重复走启动流程（就绪行仍为 ${readyAfter} 条）`)

first.kill()
await sleep(4000)
console.log('\n单实例验证通过')
