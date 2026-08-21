// 打包前的资源自检：确认内置运行时与 dsh 副本完整可用。
// 只检查文件存在是不够的——npm 安装中途会短暂出现又移走入口文件，
// 因此这里额外实际执行一次内置 Node 与 dsh 的版本查询。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const nodeExe = join(root, 'resources', 'runtime', 'node', 'node.exe')
const npmCli = join(root, 'resources', 'runtime', 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js')
const dshRoot = join(root, 'resources', 'dsh-bundled', 'node_modules', '@deepseek-ai', 'dsh')
const dshBin = join(dshRoot, 'lib', 'bin.js')
const icon = join(root, 'resources', 'icon.png')

const problems = []

function must(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) problems.push(label)
}

must('内置 Node 存在', existsSync(nodeExe))
must('内置 npm 存在', existsSync(npmCli))
must('图标存在', existsSync(icon))
must('dsh 入口存在', existsSync(dshBin))

if (existsSync(nodeExe)) {
  try {
    const v = execFileSync(nodeExe, ['--version'], { encoding: 'utf8' }).trim()
    must('内置 Node 可执行', true, v)
  } catch (error) {
    must('内置 Node 可执行', false, error.message)
  }
}

if (existsSync(dshBin) && existsSync(nodeExe)) {
  const version = JSON.parse(readFileSync(join(dshRoot, 'package.json'), 'utf8')).version
  try {
    // --version 会走完整的依赖解析，能真正验出依赖树是否完整。
    const out = execFileSync(nodeExe, [dshBin, '--version'], { encoding: 'utf8', timeout: 60000 }).trim()
    must('内置 dsh 可执行', true, `清单 ${version} / 自报 ${out}`)
  } catch (error) {
    must('内置 dsh 可执行', false, (error.stderr ?? error.message).toString().split('\n')[0])
  }
}

if (problems.length > 0) {
  console.error(`\n资源自检未通过：${problems.join('、')}`)
  process.exit(1)
}
console.log('\n资源自检通过，可以打包。')
