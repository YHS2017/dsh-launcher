// 打包入口。
//
// 关键约束：electron-builder 的 stdio 绝不能直接接到调用方（Claude Code 的
// 工具管道、CI 的采集管道、`| tail`）身上。一次打包要复制上万个小文件，
// 中间有整整几分钟不输出任何日志；管道缓冲一旦写满，所有写入方就阻塞在
// write() 上——CPU 归零、日志停更、进程还在但不再推进，且不报任何错，
// 与真卡死无法区分。取消时更糟：调用方杀掉外层 shell 后，孙子进程仍持有
// 继承来的管道写端，调用方读不到 EOF，于是调用方自己也一起卡住。
//
// 这里的做法：本脚本自己 spawn 打包进程并用管道接住，然后**主动读干净**。
// 管道本身没问题，问题只在于没人读；读取方就在本进程时不会有背压死锁。
// 调用方那一侧只收到本脚本打的十几行里程碑，量小，不可能憋住。
//
// 早先这里用的是 detached + 输出重定向到文件描述符。那样确实解耦了，
// 但 Windows 上 detached 等于 DETACHED_PROCESS——子进程没有控制台，
// npm 起 cmd.exe 时会另开一个新控制台窗口，而输出全进了文件，
// 于是弹出一个**空白的命令行窗口**，用户不知道那是什么，一关就把打包整棵树带走。
// 不 detached 就没有这个窗口：子进程与孙子进程都沿用调用方已有的控制台。
//
// 代价是打包不再能在本脚本被杀之后继续跑。这是合理的取舍：停掉命令就该停掉打包，
// 而不是留一个看不见的进程在后台继续写文件。
import { spawn } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const logPath = join(root, 'pack.log')
const target = process.argv.slice(2).includes('--dir') ? 'pack:dir:inline' : 'pack:inline'

writeFileSync(logPath, '')
console.log(`开始打包（${target}），完整日志: ${logPath}`)

// 绕开 npm.cmd：经它（nvm-windows 下的批处理包装）启动时子进程的输出会整个丢失。
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const child = spawn(process.execPath, [npmCli, 'run', target], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
})

/** 回显里程碑与失败信号，其余（上万行文件复制日志）只进文件。 */
const MILESTONE = /^\s+•\s(?!file|from|to)/
const FAILURE = /(Error:|error Command failed|EPERM|ENOENT|failed with exit code|✗)/i

const seen = new Set()
let remainder = ''
function consume(chunk, final = false) {
  appendFileSync(logPath, chunk)
  const lines = (remainder + chunk.toString('utf8')).split(/\r?\n/)
  // chunk 边界会切在行中间，末段留到下次拼上；收尾那次全部吐出。
  remainder = final ? '' : (lines.pop() ?? '')
  for (const line of lines) {
    if (!MILESTONE.test(line) && !FAILURE.test(line)) continue
    const key = line.trim().slice(0, 120)
    if (seen.has(key)) continue
    seen.add(key)
    console.log(key)
  }
}

child.stdout.on('data', consume)
child.stderr.on('data', consume)

child.on('error', err => {
  console.error(`✗ 无法启动打包进程：${err.message}`)
  process.exit(1)
})

child.on('close', code => {
  if (remainder !== '') consume(Buffer.alloc(0), true)
  if (code === 0) {
    console.log('\n✓ 打包完成')
  } else {
    console.error(`\n✗ 打包失败，退出码 ${code}；完整日志见 ${logPath}`)
  }
  process.exit(code ?? 1)
})
