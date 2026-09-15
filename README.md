# DSH启动器

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 构建的非官方 Windows 桌面客户端。与 DeepSeek 官方无从属或授权关系。

装完即用：安装包内置 Node 运行时与 dsh 副本，无需预装 Node，无需命令行，断网也能启动。

## 功能

- 一键启动 dsh 的 Web UI，端口由系统自动分配，不与其他程序冲突
- 托盘驻留：关掉窗口后台任务继续运行
- 双更新通道：稳定版（npm `latest`）与预览版（npm `next`，跟随上游 master）
- 更新失败或新版本起不来时自动退回内置版本
- 日志面板与设置页

## 界面入口

菜单画在**标题栏**上，不额外占用窗口空间——垂直方向整块留给 dsh：

- **启动器** — 设置…、检查更新…、日志…、重启 dsh、退出
- **视图** — 重新加载、缩放、全屏
- **帮助** — 关于

托盘图标的右键菜单提供同一组入口。别只依赖托盘：**Windows 11 默认把新出现的托盘图标折叠进溢出区**，得点时钟旁边的 `^` 才看得到——标题栏上的菜单就是为此加的。

菜单项没有快捷键。弹出式菜单的加速键本来就不会被注册（只有应用菜单的会），要让它们真生效就得在 dsh 页面上拦 `before-input-event`——而 dsh 是终端式界面，`Ctrl+L`、`Ctrl+R` 在它那里另有含义，抢过来会破坏上游交互。

### 更新 dsh 版本

菜单「启动器 → 检查更新…」，或「设置…」里拉到最下面的「更新」区块。那里可以切换更新通道（稳定版 / 预览版）、检查并安装新版本、或回退到安装包自带的内置版本。

更新不自动进行。装下来的运行时放在 `%APPDATA%\dsh-launcher\dsh-runtime`；内置那份始终只读，新版本起不来时会自动退回它。

### 在终端里使用 `dsh`

安装后终端里可以直接敲 `dsh`——安装器把安装目录下的 `bin\` 加进了 PATH（全用户安装写系统级，仅当前用户安装写用户级；卸载时移除）。**已经开着的终端看不到新 PATH，要新开一个。**

这个 `dsh` 用启动器自带的 Node 跑**启动器当前激活的那份 dsh**：在设置里点了更新，命令行跟着一起变，永远和窗口里跑的是同一个版本。不需要系统里装 Node。设置里的数据目录（`DSH_HOME`）与遥测开关也会一并带上；shell 里显式设置的同名环境变量优先。

想确认命令行跑的是哪一份：

```sh
set DSH_LAUNCHER_DEBUG=1
dsh --version
```

会在 stderr 多打两行，说明选中的是内置副本还是更新副本、以及具体路径。

如果你另外用 `npm i -g @deepseek-ai/dsh` 装过一份，PATH 上就有两个 `dsh`，先出现的生效——二选一即可。

## 数据位置

- dsh 的配置与会话：`~/.dsh`（与命令行 `npx @deepseek-ai/dsh web` 共用，不会迁移或劫持）
- 启动器自身的设置与日志：`%APPDATA%\dsh-launcher`

模型与 API 密钥在主窗口的「设置 → 模型」里配置——那是 DeepSeek Harness 自身的功能，本启动器不介入，密钥也不经过启动器。

## 开发

```sh
npm install                 # 国内网络请先确认 .npmrc 中的二进制镜像配置
npm run prepare:resources   # 下载内置 Node 与 dsh，首次需要数分钟
npm run dev
```

仓库内的 `.npmrc` 把 Electron 与 electron-builder 的二进制指向了 npmmirror 镜像。缺少这项配置时，二进制会去 GitHub 下载并在国内网络下长时间卡死。

常用命令：

```sh
npm test        # 单元与集成测试
npm run typecheck
npm run build   # 构建到 out/
npm run pack    # 产出 NSIS 安装包到 release/
```

### 打包

```sh
npm run pack       # 完整 NSIS 安装包，约 2 分半
npm run pack:dir   # 只出目录、不压缩，迭代时用
```

两条都走 [scripts/pack.mjs](scripts/pack.mjs)：它自己 spawn electron-builder 并**主动把管道读干净**，完整日志写进 `pack.log`，命令行上只回显十几行里程碑。这不是为了好看，是必须的：

打包要复制上万个小文件，中间有整整几分钟一行日志都没有。若把 electron-builder 的 stdio 直接接到调用方（Claude Code 的工具管道、CI 的采集管道、`| tail`）身上，缓冲写满后所有写入方就阻塞在 `write()` 上——**CPU 归零、日志停更、进程还在但不再推进，且不报任何错**。看着和卡死一模一样，实际只是没人读管道。取消时更糟：杀掉外层 shell 后孙子进程仍持有继承来的管道写端，调用方读不到 EOF，于是**调用方自己也一起卡住**。

管道本身没错，错在没人读。所以由 `pack.mjs` 接住并逐块读走，调用方那侧只收到量很小的里程碑，不可能憋住。

**不要给它加 `detached`。** 曾经那样做过（子进程 stdio 指向文件描述符、独立进程组），解耦是达到了，但 Windows 上 `detached` 等于 `DETACHED_PROCESS`——子进程没有控制台，npm 起 `cmd.exe` 时会另开一个新控制台，而输出全进了文件，于是弹出一个**空白的命令行窗口**。用户不知道那是什么，一关就把打包整棵树带走。不 detached 就没有这个窗口。代价是打包不再能在脚本被杀之后继续跑——停掉命令就该停掉打包，这是想要的行为。

### 为什么 extraResources 要排掉那么多文件

`resources/dsh-bundled` 源树有 29434 个文件。其中约六成是 sourcemap、TypeScript 类型声明与源码、文档和测试目录，Node 运行期一律不读。`electron-builder.yml` 把它们排掉后，装进包里的只剩 **10235 个文件（107MB）**——少 19185 个、86MB。这里的收益主要不是体积而是**文件数**，因为每个文件的写入都要单独过一遍实时杀毒。

许可证文件必须留：依赖树里的 MIT/BSD/Apache 都要求再分发时附上全文与版权声明。`!**/*.md` 会连 `LICENSE.md` 一起排掉，所以 filter 末尾有一条把 `LICENSE`/`LICENCE`/`COPYING`/`NOTICE` 捞回来——electron-builder 的 filter 是后面的模式可以翻转前面的结论，那条的位置不能往前挪。

排 `*.ts` 这一条值得留个记录：Node 24 默认开启类型擦除，是能直接跑 `.ts` 的。已核对依赖树里 484 个 `package.json`，指向 `.ts` 的入口只出现在 `browser` 字段（bundler 约定，Node 不读）和 `source`／`@zod/source` 之类自定义 export 条件里（Node 不激活），解析一律落到编译后的 JS。

**按目录名排除有个坑**：`node_modules` 下同名的目录既可能是包内的测试目录，也可能正好是一个真实依赖包。`spec` 就踩过——`@standard-schema/spec` 是真实依赖，`!**/spec/**` 把它整个清空（只剩被许可证规则捞回的 `LICENSE`），而打包零报错、体积正常、`dsh --version` 也照常通过，只有运行到用它的代码路径才会炸。这类错误由 `npm run check:bundled-dsh` 的第 4 项拦住，判据是「每个包目录都必须还有 `package.json`」。

另有一项与本仓库无关但会显著拖慢的因素：Windows Defender 实时保护会逐个扫描每个写入文件。把项目目录加进排除列表可以明显提速，需要管理员权限，由使用者自行决定。

### 迭代与验收

改动后先跑产物层面的快速检查，确认无误再出正式安装包：

```sh
npm run check:artifacts
```

出了正式安装包后，跑完整验收：

```sh
npm run verify:all
```

它覆盖五项：运行行为（启动、崩溃重启、无残留、端口分配）、单实例、preload 与 IPC 是否生效、内置 dsh 副本裁剪后是否完好、自定义安装逻辑是否真的编进了安装包。后三项都属于**静默失效**——不报错、能装能用，只有主动探测才发现，所以固化成了脚本。

## 许可

本项目以 MIT 协议发布。DeepSeek Harness 亦为 MIT 协议；「DeepSeek Harness」是深度求索公司的注册商标，本项目仅在说明关系时使用该名称，不使用其品牌素材，也不暗示官方背书。
