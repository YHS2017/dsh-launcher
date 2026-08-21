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

### 打包耗时与迭代

完整打包要复制 455MB 资源、给依赖树里的原生二进制逐个签名、再 LZMA 压成约 190MB，单次 8~12 分钟。迭代期间验证产物内容不必走完整流程——用只出目录、不压缩的版本，几十秒就有结果：

```sh
npm run pack:dir
```

改动后先把产物层面的检查一次跑完，确认无误再出正式安装包，能省掉大量重复打包：

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
