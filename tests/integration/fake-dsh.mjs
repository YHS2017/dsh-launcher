// 冒充 dsh 的假服务，仅用于驱动 supervisor 的集成测试。
// 通过 FAKE_DSH_MODE 控制行为：
//   ready      正常打印就绪行并保持运行（默认）
//   crash      打印就绪行后立刻退出，模拟运行中崩溃
//   fail       不打印就绪行，直接以非零码退出，模拟启动失败
//   silent     不打印就绪行但保持运行，模拟卡住
import { createServer } from 'node:http'

const mode = process.env.FAKE_DSH_MODE ?? 'ready'

if (mode === 'fail') {
  process.stderr.write('fake-dsh: 启动失败\n')
  process.exit(1)
}

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end('fake dsh')
})

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  if (mode !== 'silent') {
    process.stdout.write(`dsh web: http://127.0.0.1:${port}\n`)
  }
  if (mode === 'crash') {
    process.exit(3)
  }
})

process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})
