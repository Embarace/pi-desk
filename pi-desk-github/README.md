# Pi Desk —— 你的 pi 智能体桌面端

为 [pi coding agent](https://github.com/earendil-works/pi) 打造的本地桌面客户端（Windows）。
自带一套独立的现代化聊天 UI，底层复用 [pi-web](https://github.com/agegr/pi-web) 的本地 HTTP API 作为后端，
会话、模型、凭据全部与 pi / pi-web 共享（同一个 `~/.pi/agent` 数据目录）。

![screenshot](.e2e-shots/1-main.png)

## 特性

- **自己的桌面端 UI**：深色玻璃拟态界面，自绘 π 图标，无边框窗口 + 自定义标题栏
- **🎨 自定义背景（需求 1）**：上传图片 / 视频 / GIF 作为界面背景
  - 4 种显示方式：裁剪铺满 / 完整显示 / 平铺 / 拉伸
  - 独立调节背景亮度、压暗遮罩、模糊程度
  - 视频与 GIF 静音循环播放；内置 3 套极光渐变备选
- **🚀 启动动画与音频（需求 2）**：每次启动展示开机动画 + 可选启动音
  - 6 种动画：淡入 / 缩放浮现 / 上滑浮现 / 极光流转 / 粒子升腾 / 无
  - 可自定义最短展示时长（后端就绪且时长满足后自动淡出）
  - 启动音频支持 mp3 / wav / ogg / m4a / flac，音量可调、可试听
- **会话工作台**：按项目分组浏览/继续/重命名/删除/导出历史会话，运行状态指示
- **流式对话**：SSE 实时流式输出、思考过程折叠、工具调用与执行状态、压缩提示、断线自动重连
- **消息分支**：任意用户消息一键 fork 出新会话
- **输入控制**：模型切换、思考强度、工具权限预设（纯聊天/只读/标准/完整）、图片附加
- **文件面板**：项目文件树 + 全文搜索 + 文本/图片/音视频预览 + 下载/定位
- **后端管理**：自动复用已运行的 pi-web，否则 npx 拉起官方包（也可指向本地源码）；状态指示灯、日志查看、一键重启；健康探测防空闲退出、崩溃自动重启
- **🧭 极简首次引导**：欢迎页直接展示功能简介 + 内置 B 站教程视频；**一键接入大模型**——搜索/选择提供商，粘贴 API Key 一键导入（与 pi 共享配置，本机存储）；无需任何技术背景
- **🧩 技能与插件管理**：设置页内管理 skills（列表/禁用/启用/删除/本地安装/推荐一键下载）、extensions（同理）、pi 包（安装/移除经 pi 命令、流式日志）
- **🚀 首次启动友好**：首次拉起后端需冷下载组件时，超时放宽至 5 分钟并自动重试一次；报错可跳过先进应用；单实例锁防多开冲突
- **💬 对话不卡壳**：运行中可继续输入排队（pi 的 follow-up 机制，当前任务完成后自动继续）、一键打断、运行状态自动对账收敛；消息分支（fork）一键开新会话
- **帮助与支持**：设置页内置 B 站入门视频、官方文档、配置页入口

## 快速开始

### 安装（推荐）

直接运行安装包：`release/Pi Desk Setup *.exe`（未签名，SmartScreen 拦截时选「仍要运行」）。

### 系统要求

- **Windows 10/11**
- **Node.js LTS** 或 **pi 智能体**（两者有其一即可；pi 自带 Node）。
  两者都没有也不影响安装——首次启动会进入安装引导，逐步指引你完成环境安装。
- 模型凭据与 pi 共享（`~/.pi/agent`），在 pi-web 配置页登录一次即可。

### 开发模式

要求：Node.js ≥ 22.19。

```bash
cd pi-desk
npm install            # 若 Electron 下载失败：ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
npm run dev            # 开发模式（Vite HMR + Electron，F12 打开 DevTools）
```

打包安装程序（NSIS）：

```bash
npm run dist           # 输出 release/Pi Desk Setup *.exe
```

> 打包说明：构建已配置 `signAndEditExecutable: false`（跳过签名工具，规避 Windows
> 无符号链接权限导致的 winCodeSign 解压失败），图标与版本信息由 `scripts/after-pack.js`
> 用 vendored rcedit（`build/tools/rcedit-x64.exe`）在 NSIS 打包前嵌入。国内打包建议：
> `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ npm run dist`

运行自动化回归测试（Playwright 驱动 Electron，需要已 `npm run build:renderer`）：

```bash
npm run e2e                                    # 全量回归（smoke/deep/startup/onboard/manage）
node scripts/e2e-timeout.mjs                    # 后端超时→自动重试→可跳过链路（假后端）
```

首次启动后，若还没有配置模型，点击标题栏的「打开 pi-web 网页版」按钮，在浏览器里完成模型登录 / API Key 配置，
回到桌面端即可开始对话（模型配置与 pi 完全共享）。

## 架构

```
┌────────────────────────────── Electron ──────────────────────────────┐
│  主进程 main.js                                                       │
│   ├─ BackendManager ── spawn npx @agegr/pi-web / 复用已运行服务        │
│   ├─ 设置存储（userData/settings.json）+ 媒体导入（原生文件对话框）      │
│   ├─ 自定义协议：pidesk-media://（背景/音频） pidesk-file://（项目文件）  │
│   └─ IPC 桥：HTTP 代理 + SSE 转发（渲染层零 CORS 问题）                  │
│                                                                       │
│  渲染进程（React 19 + Vite，file:// 加载）                              │
│   ├─ 启动遮罩（动画 + 音频）→ 主界面                                    │
│   ├─ 侧栏（会话树）· 聊天（流式 SSE）· 文件面板                          │
│   └─ 设置：背景 / 启动动画音频 / 后端 / 聊天 / 技能与插件 / 帮助与支持
└───────────────────────────────────────────────────────────────────────┘
                    │ HTTP（仅主进程访问，监听 127.0.0.1）
                    ▼
          pi-web 本地服务（Next.js，端口 30141）
                    │ 同一 ~/.pi/agent 数据目录
                    ▼
              pi 会话文件 / 模型 / 凭据
```

- **会话数据**：桌面端与 pi TUI、pi-web 共用 `~/.pi/agent` 下的会话与配置，两边看到的会话完全一致。
- **安全边界**：渲染层不直接访问网络与文件系统，全部经主进程校验转发；文件浏览沿用 pi-web 的允许根目录规则。
- **媒体存储**：上传的背景与音频复制到 `%APPDATA%/Pi Desk/media/`，通过 `pidesk-media://` 协议读取。

## 目录结构

```text
pi-desk/
  electron/           主进程：main.js / preload.js / backend.js / settings.js / prereqs.js / skills.js
  src/                渲染进程（React + TS）
    components/       TitleBar Sidebar ChatView ChatInput MessageItem
                      FilePanel SettingsModal StartupOverlay OnboardingOverlay BackgroundLayer …
    lib/              api.ts（后端客户端）types.ts streaming.ts markdown.ts …
  scripts/            开发脚本 + e2e 测试 + 图标生成
  build/              icon.png / icon.ico（自动生成，可替换）
```

## 常见问题

- **启动遮罩停在「后端启动失败」**：可点「跳过，进入应用」先进界面（引导会带你装环境）。
  打开设置 → 后端服务可看日志。`npx` 模式需要网络下载
  `@agegr/pi-web`（国内可用 `npm config set registry https://registry.npmmirror.com` 加速）；
  也可以先用 `npm install -g @agegr/pi-web` 装好，再把模式改为 `external` 并填 `http://127.0.0.1:30141`。
- **本地源码模式**：把 pi-web 克隆到本地，`npm install && npm run build` 后在设置中选择该目录。
- **模型选择器为空**：说明该目录下没有可用模型，点标题栏「打开 pi-web 网页版」完成登录后，聊天框里点模型下拉框会自动带出（刷新一次会话即可）。
- **中文路径**：桌面端全程支持中文/空格路径（内部统一处理，已通过 e2e 验证）。

## 技术栈

Electron 37 · React 19 · Vite 7 · TypeScript · marked + DOMPurify · pi-web HTTP API
（图标与提示音均为纯代码生成，无第三方素材）

## License

MIT
