// DSH启动器 的命令行入口。
//
// 打成单文件 bin/dsh-cli.mjs 放在安装目录，由 bin/dsh.cmd 用内置 Node 调起。
// 它不经过 Electron：用户数据目录、内置副本位置、当前激活的版本，全部按
// 与主进程相同的规则自行推出（见 resolve-cli-target.ts），然后把参数原样
// 交给真正的 dsh。
//
// 用 spawnSync 而不是在本进程内 import dsh 的 bin.js：前者与启动器窗口拉起 dsh
// 的方式一模一样（同一个 node.exe、同一个入口、同一套 env），行为不会有任何差异；
// 进程内 import 则要替 dsh 伪造 process.argv[1]，它内部若按此判断"是否主模块"就会出错。
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDshVersion } from '../main/core/dsh-version.ts'
import { resolvePaths, USER_DATA_DIR_NAME } from '../main/paths.ts'
import { SettingsStore } from '../main/services/settings-store.ts'
import { resolveCliTarget } from './resolve-cli-target.ts'

const binDir = dirname(fileURLToPath(import.meta.url))
const installRoot = dirname(binDir)

const appData = process.env.APPDATA
if (appData === undefined || appData === '') {
  console.error('dsh: 找不到 %APPDATA%，无法定位 DSH启动器 的设置。')
  process.exit(1)
}

const paths = resolvePaths({ userData: join(appData, USER_DATA_DIR_NAME), resources: join(installRoot, 'resources') })
const settings = new SettingsStore(paths.settingsFile).read()

let target
try {
  target = resolveCliTarget({ paths, settings, baseEnv: process.env, readVersion: readDshVersion })
} catch (error) {
  console.error(`dsh: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

// 排障开关：说明本次跑的是哪份 dsh。只写 stderr，不污染 dsh 自己的输出。
if (process.env.DSH_LAUNCHER_DEBUG === '1') {
  console.error(`[dsh-launcher] ${target.choice.source === 'updated' ? '更新副本' : '内置副本'} ${target.choice.version}`)
  console.error(`[dsh-launcher] ${target.dshBin}`)
}

const result = spawnSync(target.nodeExe, [target.dshBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: target.env,
})
if (result.error !== undefined) {
  console.error(`dsh: 无法启动 ${target.nodeExe}：${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
