# DSH启动器 设计文档

- 日期：2026-08-21
- 状态：已确认，待进入实现计划
- 上游：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT），基线版本 `0.1.0-rc.8`

## 1. 背景与目标

DeepSeek Harness（`dsh`）是一个 agent harness，其 Web 形态本质是**一个监听 `127.0.0.1:3080` 的本地 Node 服务加一套 Web UI**。官方交付方式是 `npx @deepseek-ai/dsh web`，要求用户自备 Node（`^22.19.0 || >=24.0.0`）并使用命令行。

本项目为它做一个 Windows 桌面客户端，目标有二：

1. **独立安装使用**——双击安装，无需预装 Node，无需命令行，装完断网即可启动。
2. **跟随上游更新**——能检查并升级到 `@deepseek-ai/dsh` 在 npm 上的新发布版。

### 命名合规

上游 `BRAND_GUIDELINES.zh.md` 声明「DeepSeek Harness」是深度求索的注册商标，要求第三方项目命名避开完整商标、建议使用缩写「DSH」。因此本应用定名 **DSH启动器**（英文标识 `dsh-launcher`），关于页注明「基于 DeepSeek Harness 构建的非官方桌面客户端」，不使用官方品牌素材、不暗示官方背书。

### 非目标

- 不做 macOS / Linux 打包（代码结构保留跨平台可能，但不投入）。
- 不做壳自身的自动更新、不做代码签名（当前定位为自用/小范围）。
- 不从 GitHub master 拉源码本地构建（更新只走 npm 发布通道）。
- **不重做模型/API Key 配置**。上游 Web UI 的「设置 → 模型」已完整实现该能力，凭据存 `$DSH_HOME/.credentials.yaml` 且只写不回显。壳重做既是重复造轮子，也平白引入凭据泄露面。

## 2. 关键上游事实（已核实）

| 事实 | 影响 |
|---|---|
| `dsh --profile web` 启动本地 HTTP 服务，`--no-open` 可抑制自动开浏览器 | 壳用子进程拉起它，再用 BrowserWindow 加载 |
| `--port 0` 让操作系统分配空闲端口 | 端口冲突从根上消除，无需壳自己探测 |
| 就绪后 stdout 打印 `dsh web: http://127.0.0.1:<port>`；上游注释明确它是**给 supervisor 的就绪信号**，且保证在 Loader 插件树 settle 后才输出 | 壳据此判定就绪并取得实际端口，比 HTTP 轮询更权威 |
| `printUrl` 默认 `true`，`--no-open` 不影响该行输出 | 就绪信号在壳的调用姿势下必定出现 |
| `/api` 的 browser-trust 围栏对 loopback（`127.0.0.1`/`localhost`/`[::1]`）无条件放行 | Electron 直接加载即可，无需 `--trusted-host` |
| `--host 0.0.0.0` 被上游明确拒绝（防止把 RCE 暴露到网络） | 壳固定绑 `127.0.0.1`，不提供对外暴露选项 |
| 用户数据统一在 `~/.dsh`，`$DSH_HOME` 可覆盖 | 壳不劫持、不迁移，保证与官方 `npx` 用法数据互通 |
| 内置插件经 `~/.dsh/profiles/node_modules` 的符号链接解析（Windows 用 junction，免管理员权限），由 `healProfilesModuleFallback` 自动维护 | **首启无需联网 npm install**，「装完即用」成立 |
| pnpm 仅在安装**第三方**插件时才需要 | 壳不必内置 pnpm；该能力缺失只影响装外部插件，不影响开箱使用 |
| `@deepseek-ai/dsh` 已发布 npm，bin 为 `dsh` → `lib/bin.js` | 更新走 registry，无需编译工具链 |
| 默认开启遥测，任意非空 `DSH_TELEMETRY_DISABLED` 即关闭 | 设置页给开关，**默认保持上游原样（开启）**，不擅自改变上游默认行为 |
| `native/landlock-run` 是 Linux 沙箱 | Windows 打包不涉及 |
| npm 上存在两条 dist-tag：`latest`=`0.1.0-rc.7`（稳定），`next`=`0.1.0-rc.8`（对应 GitHub master） | 「跟随 master」几乎零成本即可实现——只是查 registry 时换个 tag |
| MIT 协议 | 允许二次打包分发 |
| 官方标注「开发者预览，会有破坏性变更」 | 壳必须与 dsh 解耦，且更新必须可回滚 |

## 2.1 实测验证结论（2026-08-21，本机 Node v24.14.1）

设计的核心假设已用真实运行验证，而非推断：

| 验证项 | 结果 |
|---|---|
| 生产依赖安装体积 | **280MB**，195 个 `@deepseek-ai` 包 |
| `--port 0` 自动分配端口 | 成立，实测分配到 `53933` |
| 就绪行实际输出 | `dsh web: http://127.0.0.1:53933`，格式与源码一致 |
| 冷启动到就绪耗时 | **约 1.8 秒** |
| SIGTERM 优雅终止 | 正常退出，无残留 |
| 内置 Node 拉起内置 dsh | 打通。首次约 24 秒（一次性建立 `profiles/node_modules` 符号链接回退目录），之后稳定约 1.8 秒 |
| 完整 Electron 应用端到端 | 打通。日志记录「使用 dsh 0.1.0-rc.7（内置副本）」与「dsh 就绪：http://127.0.0.1:51789」 |
| 数据目录 | `~/.dsh` 已由既有使用创建，含 `settings.yaml`、`.credentials.yaml`、`sessions/`、`profiles/`（含 `node_modules` 符号链接回退目录），印证 symlink fallback 机制生效 |

280MB 的体积意味着最终安装包压缩后预计 120–200MB。这是「装完断网即用」的代价，与既定取舍一致。

## 3. 架构

**核心原则：壳不碰 dsh 的 Web UI，不注入任何 JS，不解析其内部结构。** 壳只负责进程监督与外围设施。dsh 是一个高速迭代且明确会破坏兼容的上游，任何对其内部的耦合都会成为持续的维护负债。

```
Electron 主进程（壳）
  ├── 窗口 / 托盘 / 菜单 / 设置 / 日志 / 更新编排
  ├── spawn + 监督
  │     └── dsh 服务子进程
  │           内置 node.exe 运行 <dsh>/lib/bin.js --profile web --no-open
  │           监听 127.0.0.1:<自动分配端口>
  └── BrowserWindow
        ├── 主窗口 → loadURL(http://127.0.0.1:<port>)  即 dsh 原生 UI
        └── 壳页面 → 启动页 / 设置 / 日志 / 关于
```

### 技术选型理由

**Electron 43 + 单独内置官方 Node 24**，而非复用 Electron 自带的 Node。dsh 会派生子进程、执行 shell 工具、做沙箱等重活，与官方 `npx` 路径行为一致性比省下的 20–40MB 更重要；且 Node 版本与 Electron 版本解耦后，任一方升级不会牵连另一方。

不选 Tauri：它同样必须内置 Node（总体积省不了多少），却额外要求 Rust 工具链，开发与调试成本显著更高。

## 4. 目录布局

**安装目录** `%LOCALAPPDATA%\Programs\DSH启动器`
```
DSH启动器.exe
resources/
  app.asar            壳自身代码
  runtime/node/       内置官方 Node 24（node.exe）
  dsh-bundled/        内置 dsh 副本 —— 只读基线，运行期永不改动
```

**壳数据目录** `%APPDATA%\dsh-launcher`
```
config.json           壳设置
logs/                 壳日志 + dsh 输出（滚动）
dsh-runtime/          从 npm 更新下来的 dsh；存在且有效则优先于内置副本
```

**dsh 自身数据**：`~/.dsh`（默认，设置页可改 `DSH_HOME`）。

内置副本只读、更新副本可写，这个分离是回滚能力的基础：任何更新翻车都能一键退回一个已知可用的版本。

## 5. 模块划分

每个模块单一职责、接口明确、依赖注入以便独立测试。

| 模块 | 职责 | 接口要点 | 测试方式 |
|---|---|---|---|
| `runtime-resolver` | 在内置副本与已更新副本间择一，比对版本、校验完整性 | 输入两个路径，输出选中路径与版本 | 纯函数，注入 fs |
| `url-line-parser` | 从 dsh stdout 中识别 `dsh web: <url>` 就绪行并取出实际端口 | 输入一行文本，输出 URL 或 undefined | 纯函数 |
| `dsh-supervisor` | spawn / 就绪等待 / 崩溃退避重启 / 优雅关停 | 状态机 `idle→starting→ready→stopping\|crashed`，对外发事件 | 假 Node 服务脚本冒充 dsh |
| `readiness-probe` | 兜底与运行期健康检查：轮询 HTTP 至就绪或超时 | 输入 URL、间隔、超时 | 注入 fetch |
| `npm-updater` | 查 registry → 下载 → 校验 → 原子切换 → 失败回滚 | 输入当前版本，输出更新结果 | 注入 registry 与 fs |
| `settings-store` | config.json 读写、schema 校验、默认值 | 读/写/订阅 | 纯逻辑 |
| `log-store` | 归集壳与 dsh 输出，滚动落盘，供面板读取 | 追加/读取尾部 | 纯逻辑 |
| `window-manager` / `tray` / `app-menu` | 系统外围 | — | 手工验收 |

壳内页面仅四个：**启动页**（进度、失败详情与重试）、**设置**、**日志**、**关于**。界面语言为简体中文。

## 6. 关键流程

### 启动
```
读设置 → runtime-resolver 选副本 → 显示启动页
→ spawn(内置 node, <dsh>/lib/bin.js, --profile web --no-open --host 127.0.0.1 --port <0 或用户指定>)
→ 逐行读 stdout，url-line-parser 命中 `dsh web: <url>` 即视为就绪并取得实际端口
→ 主窗口 loadURL(该 URL)，关闭启动页
→ 超时未见就绪行：readiness-probe 兜底探测；仍失败则启动页展示 stderr 尾部
   +「打开日志」+「重试」+「回退到内置版本」
```

**端口策略**：默认传 `--port 0`，由操作系统分配空闲端口。这比壳自己探测更可靠——自行探测存在「探到空闲」与「实际绑定」之间被抢占的竞争窗口，而 OS 分配没有这个窗口。实际端口从就绪行权威读出。设置页提供「固定端口」高级选项，供需要稳定地址的场景（如外部工具对接）使用；固定端口被占用时如实报错，不静默改端口。

**绑定与安全**：固定绑 `127.0.0.1`。上游明确拒绝 `--host 0.0.0.0`（那会把远程代码执行能力暴露到网络），壳因此不提供任何对外暴露的开关。loopback 无条件通过 `/api` 信任围栏，无需配置 `--trusted-host`。

### 关闭
关闭主窗口默认**最小化到托盘，dsh 继续后台运行**——agent 任务可能长时间执行，关窗即杀不合理。真正退出走托盘右键菜单，届时对 dsh 优雅关停（先终止信号，等待超时后强制结束）。设置页可改为「关窗即退出」。

### 更新（手动触发，不静默）

**两条更新通道**，设置页可选，默认稳定通道：

| 通道 | 对应 dist-tag | 含义 |
|---|---|---|
| 稳定 | `latest` | 上游标记为稳定的发布版 |
| 预览 | `next` | 跟随 GitHub master 的预发布版 |

这条设计直接回应了「同步源代码仓库更新」的原始诉求：`next` tag 即 master 的发布产物，无需在用户机器上克隆源码与执行构建，也就不必内置 git 与 pnpm、不必要求编译环境。代价是仍略滞后于 master 的未发布提交，这是本方案已接受的取舍。

```
查 npm 最新版 → 展示版本号并请用户确认 → 下载至临时目录 → 完整性校验
→ 停止 dsh → 切换 dsh-runtime → 重启 → 失败自动回滚上一版
```

**「原子替换」在 Windows 上的具体做法**：新版本先完整解压到 `dsh-runtime-<版本>` 目录，校验通过后再更新 `config.json` 中的「当前运行时」指针。切换动作因此退化为一次小文件写入，不依赖目录重命名（Windows 上目录重命名会被运行中的句柄阻塞）。旧版本目录保留一份，回滚即改回指针。
不做静默自动更新：上游处于 rc 阶段且明示会破坏兼容，静默升级可能把能用的版本升成不能用的。

## 7. 错误处理

| 场景 | 处理 |
|---|---|
| 端口被占用（仅固定端口模式） | 如实报错并提示改端口或切回自动分配；默认的 `--port 0` 模式不存在此问题 |
| 未出现就绪行 | 超时后 readiness-probe 兜底探测，再失败才判定启动失败 |
| dsh 启动失败 | 启动页展示日志尾部，提供重试与回退内置版本 |
| 运行中崩溃 | 指数退避自动重启；连续 3 次失败则停止并提示，避免无限重启循环 |
| 更新失败 | 保留旧版本、自动回滚，可用性不受影响 |
| 断网首启 | 内置副本 + 上游 symlink fallback，无需联网 |
| 内置副本损坏 | 启动页提示重新安装，不静默吞错 |

## 8. 测试策略

- **单元测试**（vitest）：`runtime-resolver` 的择一与校验分支、`url-line-parser` 对就绪行的识别与误报拒绝、`settings-store` 的校验与默认值、`npm-updater` 的版本比较与回滚分支。
- **集成测试**：以一个假 Node 服务脚本冒充 dsh，驱动 `dsh-supervisor` 走完「启动 → 就绪 → 崩溃重启 → 退避上限 → 优雅关停」完整状态机。
- **手工验收清单**：全新安装；断网启动；固定端口被占用；更新成功；更新失败回滚；托盘与关窗行为；设置项改动生效。

## 9. 内置 Node 运行时的范围（已确定）

内置运行时**不能**只带 `node.exe`，必须保留 npm。

原因是更新路径：dsh 的生产依赖是一棵约 195 个包的树，自行实现依赖解析与安装不现实，因此更新时须调用 npm 完成安装。npm 随官方 Node 压缩包一同分发，保留它是最省事也最可靠的做法。

据此修正体积估算：官方 `node-v24.14.1-win-x64.zip` 下载体积 34.7MB，解包后约 110MB；叠加 dsh 副本 280MB 与 Electron 自身，安装包压缩后预计 **200–300MB**。
