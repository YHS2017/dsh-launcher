// 打包入口：让 electron-builder 与调用方的 stdout 彻底解耦。
//
// 为什么必须这样跑：一次打包要复制三万多个小文件，中间有长达数分钟
// 完全没有日志输出的阶段。如果 stdio 接在调用方（Claude 的工具管道、
// CI 的采集管道）上，管道缓冲一旦写满，所有写入方就阻塞在 write() 上——
// 表现是 CPU 归零、日志停更、进程还在但不再推进，且不报任何错。
// 看起来和"卡死"一模一样，实际只是没人读管道。
//
// 更麻烦的是取消：调用方杀掉外层 shell 后，electron-builder 的孙子进程
// 仍持有继承来的管道写端，调用方读不到 EOF，于是连调用方自己也一起卡住。
//
// 这里把子进程的 stdout/stderr 直接指向文件描述符，detached 独立进程组，
// 全程不存在一根通往调用方的管道。本脚本自己只按里程碑打几行。
import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const logPath = join(root, 'pack.log')

const passthrough = process.argv.slice(2)
const target = passthrough.includes('--dir') ? 'pack:dir:inline' : 'pack:inline'

const fd = openSync(logPath, 'w')
// 直接用 node 跑 npm-cli.js，绕开 npm.cmd。
// 经 npm.cmd（nvm-windows 下的批处理包装）启动时，子进程写往继承 fd 的输出会全部丢失：
// 命令照常跑完、退出码 0，重定向到的文件却始终是 0 字节，没有任何报错。
// 实测 `cmd /c npm --version` 写不进去，`node npm-cli.js --version` 正常。
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const child = spawn(process.execPath, [npmCli, 'run', target], {
  cwd: root,
  detached: true,
  stdio: ['ignore', fd, fd],
  windowsHide: true,
})
// fd 必须等到 'spawn' 事件后再关。spawn() 是异步的，真正的 CreateProcess
// 发生在之后的事件循环里；紧跟着同步 closeSync 会在 libuv 把 fd 复制给子进程
// 之前就把它关掉。
child.on('spawn', () => { closeSync(fd) })

console.log(`打包已脱离启动 (pid ${child.pid})，日志: ${logPath}`)
console.log('本进程被杀不会影响打包；要终止打包请 taskkill /F /T /PID ' + child.pid)

/** 只回显里程碑，避免把上万行文件复制日志灌回调用方。 */
const MILESTONE = /^\s+•\s(?!file|from|to)/
const FAILURE = /(Error:|error Command failed|EPERM|ENOENT|failed with exit code|✗)/i

let offset = 0
let remainder = ''
const seen = new Set()
function drain(final = false) {
  if (!existsSync(logPath)) return
  const size = statSync(logPath).size
  if (size <= offset && !final) return
  const buf = readFileSync(logPath)
  const text = remainder + buf.subarray(offset).toString('utf8')
  offset = size
  const lines = text.split(/\r?\n/)
  // 定时读取会切在行中间，末段留到下次拼上；收尾那次全部吐出。
  remainder = final ? '' : (lines.pop() ?? '')
  for (const line of lines) {
    if (!MILESTONE.test(line) && !FAILURE.test(line)) continue
    const key = line.trim().slice(0, 120)
    if (seen.has(key)) continue
    seen.add(key)
    console.log(key)
  }
}

const timer = setInterval(drain, 2000)

child.on('exit', code => {
  clearInterval(timer)
  drain(true)
  if (code === 0) {
    console.log('\n✓ 打包完成')
  } else {
    console.error(`\n✗ 打包失败，退出码 ${code}；完整日志见 ${logPath}`)
  }
  process.exit(code ?? 1)
})
