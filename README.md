# DSH启动器

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 构建的非官方 Windows 桌面客户端。与 DeepSeek 官方无从属或授权关系。

装完即用：安装包内置 Node 运行时与 dsh 副本，无需预装 Node，无需命令行，断网也能启动。

## 功能

- 一键启动 dsh 的 Web UI，端口由系统自动分配，不与其他程序冲突
- 托盘驻留：关掉窗口后台任务继续运行
- 双更新通道：稳定版（npm `latest`）与预览版（npm `next`，跟随上游 master）
- 更新失败或新版本起不来时自动退回内置版本
- 日志面板与设置页

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
npm run pack       # 完整 NSIS 安装包，约 4 分半
npm run pack:dir   # 只出目录、不压缩，迭代时用
```

这两条都会把 electron-builder **脱离启动**、日志写进 `release/pack.log`，命令行上只回显里程碑。这不是为了好看，是必须的：

打包要复制三万多个小文件（`resources/dsh-bundled` 29434 个、`resources/runtime` 1837 个），中间有整整几分钟一行日志都没有。若把 stdio 接在会缓冲的管道上（Claude Code 的工具管道、CI 的采集管道、`| tail`），缓冲写满后所有写入方就阻塞在 `write()` 上——**CPU 归零、日志停更、进程还在但不再推进，且不报任何错**。看着和卡死一模一样，实际只是没人读管道。

取消时更麻烦：杀掉外层 shell 后，electron-builder 的孙子进程仍持有继承来的管道写端，调用方读不到 EOF，于是**调用方自己也一起卡住**。

所以 `npm run pack` 的子进程 stdout/stderr 直接指向文件描述符、独立进程组，全程不存在通往调用方的管道。要终止打包用 `taskkill /F /T /PID <pid>`（脚本会打印 pid），`/T` 不能省。

另有一项与本仓库无关但会显著拖慢的因素：Windows Defender 实时保护会逐个扫描这三万多个写入文件。把项目目录加进排除列表可以明显提速，需要管理员权限，由使用者自行决定。

### 迭代与验收

改动后先跑产物层面的快速检查，确认无误再出正式安装包：

```sh
npm run check:artifacts
```

出了正式安装包后，跑完整验收：

```sh
npm run verify:all
```

它覆盖四项：运行行为（启动、崩溃重启、无残留、端口分配）、单实例、preload 与 IPC 是否生效、自定义安装逻辑是否真的编进了安装包。后两项都属于**静默失效**——不报错、能装能用，只有主动探测才发现，所以固化成了脚本。

## 许可

本项目以 MIT 协议发布。DeepSeek Harness 亦为 MIT 协议；「DeepSeek Harness」是深度求索公司的注册商标，本项目仅在说明关系时使用该名称，不使用其品牌素材，也不暗示官方背书。
