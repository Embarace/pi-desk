# Pi Desk - 开发笔记

桌面版 pi 智能体客户端（Electron + React）。本文件记录架构、文件地图、关键设计决策，
以及开发过程中踩过的坑——**修改任何相关代码前请先读对应章节**。

## 快速开始

```bash
npm run dev          # Vite (5173) + Electron，F12 开关 DevTools
npm run typecheck    # tsc --noEmit
npm run build:renderer   # vite build → dist/（e2e 与打包依赖它）
npm run e2e          # Playwright 驱动真实 Electron 的回归测试
npm run dist         # icon + build + electron-builder --win → release/
```

- e2e 会启动真实应用并真实拉起后端，**跑之前先 `npm run build:renderer`**（应用加载的是 dist/）。
- 不要手动改 `dist/`；渲染层改动后 e2e 结果才会生效。
- 打包在国内网络环境需要镜像：
  `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ npm run dist`

## 架构

```
┌──────────────────────── Electron ────────────────────────┐
│ 主进程 (electron/*.js, CommonJS, 无构建步骤)              │
│  ├─ BackendManager   pi-web 生命周期（复用/拉起/健康探测）  │
│  ├─ SettingsStore    userData/settings.json + 媒体导入     │
│  ├─ 自定义协议  pidesk-media://  pidesk-file://            │
│  └─ IPC 桥  HTTP 代理 + SSE 转发（渲染层零 CORS）           │
│                                                           │
│ 渲染进程 (src/*.tsx, React 19 + Vite, file:// 加载)        │
│  ├─ 启动遮罩（动画+音频）→ 主界面                           │
│  ├─ 侧栏(会话树) · 聊天(流式) · 文件面板 · 设置             │
│  └─ 所有网络/文件访问只经 window.pidesk 桥                 │
└───────────────────────────────────────────────────────────┘
            │ HTTP（仅主进程访问 127.0.0.1:30141）
            ▼
  pi-web (Next.js)  ←→  ~/.pi/agent 会话/模型/凭据（与 pi TUI 共享）
```

**为什么所有 HTTP 走主进程**：渲染层是 file:// 源，直连 pi-web 会撞 CORS；
主进程 `net.fetch` 无此问题，且 SSE 也只能在主进程流式转发。

## 文件地图

```
electron/
  main.js      窗口/生命周期、IPC 处理、协议注册、SSE 代理、崩溃日志(logCrash)
  backend.js   BackendManager：mode 解析、spawn、健康轮询、kicker、树杀、node 兜底
  settings.js  SettingsStore：默认值合并、set/get、importMedia/removeMedia
  prereqs.js   环境检测：Node/pi 定位（PATH→pi-node →Program Files）、API 配置探测
  skills.js    推荐 skills 下载：GitHub tarball + 系统 tar.exe 提取到 ~/.pi/agent/skills/
  manage.js    技能与插件管理：列表/删除/启用禁用（目录移动）/本地安装/pi 包（经 pi CLI）
  preload.js   contextBridge 暴露 window.pidesk（唯一的渲染层能力入口）

src/
  App.tsx            全局状态：设置、后端状态、会话轮询(5s)、模型缓存、草稿会话、引导挂载
  components/
    StartupOverlay.tsx   启动遮罩：动画变体、粒子 canvas、启动音频、就绪+最短时长后淡出；
                         error 时「跳过，进入应用」先把用户放进界面（新机器无环境场景）
    OnboardingOverlay.tsx 新版两步引导：欢迎（功能卡+视频 iframe）/ 一键接入大模型（提供商搜索+Key 导入）
    BackgroundLayer.tsx  背景层：builtin 渐变 / media 元素、fit/opacity/dim/blur
    TitleBar.tsx         无边框标题栏、后端状态灯、窗口控制
    Sidebar.tsx          会话树（按 projectRoot 分组）、运行指示、重命名/删除
    ChatView.tsx         会话加载、SSE 事件状态机、发送/停止/fork/导出、完成音
    ChatInput.tsx        输入框、模型/思考/工具选择、图片附加
    MessageItem.tsx      user/assistant/thinking/toolCall/toolResult/bash 渲染
    SettingsModal.tsx    设置六页：外观(背景)/启动(动画音频)/后端(模式日志)/聊天/
                         技能与插件(管理)/帮助与支持(B站视频·文档·重新体验引导)
    FilePanel.tsx        file-index 树 + 文件预览（text/媒体/下载/定位）
    Toast.tsx / Icon.tsx
  lib/
    api.ts      后端客户端（req() 统一错误处理、encodeFilePathForApi、fileMediaUrl）
    types.ts    与 pi-web 会话格式对齐的类型
    streaming.ts 流式消息 reducer（对齐 pi-web lib/streaming-message.ts 语义）
    markdown.ts  marked + DOMPurify（链接点击转 openExternal）
    format.ts   时间/大小/路径工具
    skills-catalog.ts 推荐技能目录（官方 Pi Skills 仓库，引导页与管理页共用）

scripts/
  dev.js         先起 Vite 再起 Electron 的开发入口
  gen-icon.js    纯 Node 生成 icon.png/icon.ico（无第三方依赖）
  after-pack.js  electron-builder 钩子：rcedit 嵌入图标+版本信息
  e2e-util.mjs   e2e 公共工具：launchIsolated（独立 userData profile）
  e2e-*.mjs      Playwright 回归测试（见下）
  watch-cache-extract.mjs  应急工具：解压 electron-builder 缓存 .7z（见「打包」）
```

## 关键设计决策与坑

### 1. Windows 下 spawn 后端（backend.js）

- **`npx.cmd` 必须 `shell: true`**，否则 spawn 直接 `EINVAL`（.cmd 不是可执行文件）。
- `local` 模式用 `process.execPath`（即 electron.exe）+ 环境变量 `ELECTRON_RUN_AS_NODE=1`，
  让 Electron 以纯 Node 运行 `bin/pi-web.js`——打包后无需系统 Node。
- 拉起时注入 `PI_WEB_NO_OPEN=1`、`PI_WEB_IDLE_TIMEOUT_MS=0`（桌面端常驻，禁用空闲退出）。

### 2. 后端进程树必须同步树杀（血泪教训）

`stop()` 顺序：**先 `execSync('taskkill /pid <pid> /T /F')` 再 `child.kill()`**。

- 反过来的话：父进程（npx.cmd/cmd.exe）先死 → taskkill 找不到进程树 → 孤儿 node 进程存活。
- 孤儿有两个恶果：① 继承 stdio 管道，导致父进程/Playwright 等不到进程句柄关闭而**永久挂起**；
  ② `PI_WEB_IDLE_TIMEOUT_MS=0` 下孤儿**永不自杀**，长期占用 30141 端口。
- 必须 `execSync` 而非异步 exec：Electron 退出时事件循环很快终止，异步 taskkill
  会被打断；同步阻塞 ~100ms 在退出路径完全可接受。
- `before-quit` 里 `backend.stop()` 不 await（stop 内部关键路径已同步化）。

### 3. EventEmitter 的 'error' 事件

无监听者时 `emit('error')` 会**直接抛异常**。BackendManager 曾因此在启动失败路径崩溃。
错误状态统一走 `#setState({phase:'error'})` + 'status' 事件，不 emit 'error'。

### 4. userData 目录名 = productName 不是 name

开发模式 Electron 的 `app.getPath('userData')` 取 `package.json` 的 **productName**
（`Roaming/Pi Desk/`），不是 name（`Roaming/pi-desk/`）。测试脚本写死路径、
手查日志时务必用对目录，否则「设置已保存但读不到」的假象。

### 5. 渲染层路径 URL 编码

`import.meta.url` 的 pathname 是**百分号编码**的（中文 `杂物` → `%E6%9D%82%E7%89%A9`）。
Node 脚本里必须先 `decodeURIComponent` 再用，否则 cwd 无效 → Electron 启动即退（exit 1）。

### 6. 自定义协议

- `protocol.registerSchemesAsPrivileged` 必须在 `app.whenReady()` **之前**调用，
  privileges 里 `standard/secure/stream/supportFetchAPI` 缺一不可（视频背景需要 stream）。
- `pidesk-media://local/<rel>` → userData/media 下文件，`net.fetch(pathToFileURL(abs))` 转发；
  必须校验 rel 不越出 mediaDir（路径穿越）。
- `pidesk-file://pi/<api-path>?query` → 主进程转发到 `后端/api/<api-path>`：
  会话上下文里的相对 URL、`/api/files` 的图片/音视频流都走它（前端零 CORS、支持 Range）。
- 会话里 lazy 图片 URL 直接 `backendMediaUrl()` 前缀转换即可。

### 7. 启动遮罩逻辑

- App 挂载时**不得**在后端已就绪时直接 `setBooting(false)`——否则快速重启场景下
  启动动画/音频被跳过。始终由 StartupOverlay 自己判断 `ready && 经过 minDuration` 后淡出。
- 音频自动播放靠 `app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')`。
- 粒子动画是 canvas（devicePixelRatio 感知），其余变体是 CSS keyframes（见 styles/app.css 的 `a-*`）。

### 8. SSE 代理与事件状态机

- 主进程按 `\n\n` 分帧、取 `data:` 行 join 后 `webContents.send('sse:event',{streamId,data})`；
  结束/出错发 `sse:end`（带 error），渲染层据此重连（指数退避，上限 12 次）或对账。
- ChatView 的事件处理对齐 pi-web `useAgentSession` 语义：
  `agent_start/agent_end/agent_settled` + `sdkAgentActiveRef` 门控；`prompt_done`
  仅在无 SDK agent 活动时收敛（扩展注入的运行没有 wrapper 级 prompt_done）；
  `message_start/message_update/message_end` 驱动流式 reducer；`tool_execution_*` 维护运行工具集。
- 切会话/卸载必须 `sseClose` 旧 streamId，否则主进程流泄漏。

### 9. pi 会话格式陷阱

- **新版 pi 的用户消息 `content` 是数组**（`[{type:"text",text}]`），不是字符串。
  提取首条消息做标题时两种形态都要处理（Sidebar 用服务端 firstMessage 无此问题，
  ChatView 的 firstUserText 踩过这个坑：所有会话标题显示「新会话」）。
- 子代理会话可能没有任何 user 消息 → 标题回退到任意 assistant 文本，再回退「（无标题会话）」。
- 媒体 URL：`source.type==='base64'` 拼 data URL；`'url'` 相对路径走 `pidesk-file://`。

### 10. 文件访问白名单

- `/api/models` 需要 cwd 且受 pi-web 文件白名单约束；`/api/file-index` 同理。
- **草稿会话**（已选目录未发首条消息）的 cwd 尚未加入允许根 → 文件面板只在有
  sessionInfo 时渲染；新会话首次 prompt 由 `/api/agent/new` 内部 allowFileRoot。
- 模型数据按 cwd 缓存于 Map，切会话不重复拉取（该接口较慢）。

### 11. 设置双通道

`window.pidesk.setSettings` 只写主进程 JSON，**不会**更新 React 状态——
UI 内必须走 App 的 setSettings 包装（本地 merge + 落盘）。
测试中直接调桥后要 reload 页面才能验证持久化+渲染（e2e-deep 就是这么做）。

### 12. 打包（electron-builder）

- **electron-builder 26 有缓存提取 bug**：lockfile 句柄未释放就 rename 目录，
  Windows 下 100% EPERM（`win-unpacked.tmp` → `win-unpacked`）。**锁定 25.1.8**。
- winCodeSign 的 7z 含 darwin **符号链接**，普通 Windows 账户（未开开发者模式）解压必失败；
  electron-builder 还会逐个尝试不同候选版本（缓存目录名每次都变，无法预置缓存绕过）。
  对策：`win.signAndEditExecutable: false` 彻底跳过该阶段，
  图标/版本信息由 `scripts/after-pack.js` 用 vendored rcedit（`build/tools/rcedit-x64.exe`，
  从 electron-builder 缓存拷出，NSIS 打包前执行）嵌入。**rcedit 要重试**：exe 刚解包时
  常被 Defender 锁住（"Unable to commit changes"），循环重试 12 次 × 2s。
- NSIS 目标本身无符号链接问题，可正常构建。
- `scripts/watch-cache-extract.mjs` 是应急工具（监视缓存目录、自动解压 .7z），正常流程用不到。

### 13. 图标与音频素材

- 图标纯 Node 程序化生成：超采样 + 胶囊 SDF 覆盖度绘制 π 字形，手写 PNG 编码器
  （zlib + CRC32），ICO 直接内嵌 PNG。改 `scripts/gen-icon.js` 后 `npm run icon`。
- 完成提示音是 WebAudio 合成（双音 sine），无需素材文件；启动音频走用户上传。

### 14. 傻瓜式安装（首次启动引导）

> ⚠️ 0.2.4 起引导已简化为两步（功能+视频 / 一键接入 API），本节为旧版记录（见 §25）。
> 环境兜底链与 Node/pi 探测逻辑仍在使用（欢迎页环境状态行 + 后端 spawn）。

- **后端起不来的机器也能装**：引导挂载条件是 `!booting && settingsLoaded && !onboarding.completed`；
  后端 error 时 StartupOverlay 提供「跳过，进入应用」→ 引导环境步骤指导安装 Node/pi。
- **Node 兜底链**：PATH `node` → `%LOCALAPPDATA%\pi-node\current\node.exe`（pi 自带）→ Program Files；
  npx 模式若无系统 npx 则用 pi 自带 node 跑 `pi-node/.../npm/bin/npx-cli.js`。
  即：**只装 pi 也能跑**，完全不装则引导安装。
- API 配置检测：`~/.pi/agent/models-store.json` / `auth.json` 大小 >20B 即视为已配置。
- 引导的箭头教程（tour）用 `.ob-spot` class 给目标元素加 outline+glow，气泡
  `getBoundingClientRect` 定位（resize 重算）；目标选择器要挑稳定 class
  （`.sidebar` `.composer` `.chip-select` `.chat-head .icon-btn[title=文件面板]` `.tb-btn[title=设置]`）。
- 环境检测通过且后端此前 error 时，引导内自动 restartBackend（联动恢复）。

### 15. skills 下载（skills.js）

- 不依赖 git：`net.fetch` 拉 `codeload.github.com/<repo>/tar.gz/refs/heads/main`，
  用 Windows 自带 `tar.exe`（bsdtar，System32）解压；`--strip-components` 剥掉仓库根前缀。
- **解压后 SKILL.md 在 `<tmpDir>/<name>/SKILL.md`**（不是 tmpDir 根）——曾因校验
  tmpDir 根导致误报失败；校验与 rename 都要带 `<name>/` 子目录。
- 技能名限定 `/^[a-z0-9][a-z0-9-]{0,63}$/` 防 tar 参数注入；目标目录 `~/.pi/agent/skills/`。

### 16. e2e 选择器教训

Playwright `text=继续` 这类裸文本选择器会命中**背景 UI 里同名的文本**（如空状态文案），
必须用作用域定位器：`win.locator(".ob-card button", { hasText: "继续" })`。
引导测试会重置 onboarding.completed 并真实下载一个 skill 验证解压链路（测完删除）。

### 17. 技能与插件管理（manage.js）

- **技能目录**：`~/.pi/agent/skills`（只扫根级目录）+ `~/.agents/skills`（递归）两处根；
  禁用 = 移入 `~/.pi/agent/skills-disabled/` 并写 `.pidesk-origin.json` 记住原根（启用时还原）。
- **扩展目录**：`~/.pi/agent/extensions/*.ts` 与 `*/index.ts`；同理移入 `extensions-disabled/`。
- **pi 包的 npm 布局是共享根**：`~/.pi/agent/npm/node_modules/<包名>/`（不是每包一目录），
  检测安装状态要按这个路径；scoped 包名直接拼 `@scope/pkg`。
- pi 包安装/移除经 `pi install` / `pi remove` 异步 spawn（`shell:true`，Windows .cmd），
  输出经 `manage:pkg-log` 事件流式推给渲染层；pi 未安装时该区块禁用。
- 管理页删除/禁用操作必须限定在技能/扩展根目录内（inRoot 校验防删错）。

### 18. 两个 JS 陷阱（本模块踩到）

- **正则字面量里 `//` 必须转义**：`/https?:\/\//`——否则正则提前闭合，
  tsc 报令人费解的 "Expression expected"（位置指向正则中间的 `|`）。
- **`process.exit()` 不会执行 `finally`**：e2e 清理代码放 finally 会静默跳过，
  用 `process.exitCode = 1` 让自然退出走完清理。

### 19. 孤儿后端复用（自愈设计，不是 bug）

强杀应用（任务管理器/`taskkill /F`）时 `before-quit` 不执行 → 后端孤儿存活并占用 30141。
这是**可接受的**：下次启动 auto 模式健康探测发现它 → 直接复用为 external（无新进程、
不累积）。当初排查「回归后有残留进程」时，真凶是手动强杀打包版 exe 留下的孤儿被
后续所有 e2e 复用了——e2e 本身零泄漏。排查残留先看 backend.log 里是「复用已运行」
还是新 spawn。

### 20. 帮助与支持页

设置页第 6 个 tab：B 站入门视频（BV139bD6gEa8，`openExternal` 打开）、pi.dev、
pi-web 配置页、skills 仓库链接、关于信息，以及「重新体验首次启动引导」按钮
（写 `onboarding.completed=false` 并关弹窗 → 引导立即重新出现）。

### 21. 后端启动超时与自动重试（朋友踩到的真实场景）

- **症状**：无 pi 的新机器首次启动报「等待 pi-web 启动超时」，关掉重开就好了。
  原因：npx 首次要冷下载 pi-web 全家桶（Next/xterm/node-pty/内嵌 pi 运行时，几百 MB），
  超过旧版 120s 硬上限；npx 缓存是内容寻址的，第二次启动命中缓存几秒就绪。
  pi-web 包**自带 pi 运行时**（pi-coding-agent 等依赖），所以没装 pi 也能用。
- **改进（0.2.2）**：npx 首次尝试超时放宽到 **300s**，超时后**自动杀掉重试一次**
  （120s，缓存已暖几乎必成）；local 模式单次 120s 不重试。最终失败会杀掉僵死子进程
  再报错（否则残留进程占端口、干扰手动重试）。
- 重试期间用 `manualRetry` 标志 + 子进程身份比对（`this.child === child`）压制
  exit 事件里的自动重启逻辑，避免双拉进程。
- 启动文案走 state.startDetail：首次「正在下载并启动 pi-web 组件（首次启动可能需几分钟）」、
  重试「首次启动超时，正在自动重试…」；StartupOverlay 与设置页后端状态都展示它。
- 测试钩子：`PI_DESK_SPAWN_TIMEOUTS="5000,4000"` 覆盖超时（e2e-timeout 用假 pi-web——
  存活但不监听端口——验证整条链路）。

### 22. 单实例锁与 e2e 数据隔离（多实例踩踏事故）

- **事故**：开发机测试时用户同时开着 Pi Desk，两个实例共享 `settings.json`、后端日志、
  30141 端口——测试写入的设置被另一个实例覆盖/重启干扰，断言全挂且难以归因。
- **产品修复**：主进程加 `app.requestSingleInstanceLock()`（以 userData 为键），
  第二个实例直接唤起已有窗口。
- **测试修复**：全部 e2e 改用**隔离 profile**——主进程支持 `PI_DESK_USER_DATA` 环境变量
  重定向 userData；`scripts/e2e-util.mjs` 提供 `launchIsolated()`（临时目录 + 预写
  onboarding.completed）。测试与用户真实数据/运行中实例彻底互不干扰，
  单实例锁也不再阻碍测试。
- **顺带揪出的真 bug**：aurora 启动动画的装饰层 `.so-aurora` 是 `position:absolute;
  inset:0`，按 CSS 层叠规则画在按钮上方，默认动画下错误页的「重试/跳过」按钮
  **真实用户也点不到**（Playwright click 超时暴露）；加 `pointer-events:none` 修复
  （`.so-particles` 早有此处理，aurora 漏了）。
- 教训：e2e 断言乱挂时先查 backend.log/crash.log 里是否有**多个实例交错**的痕迹
  （whenReady 时间戳成对出现）。

### 23. 对话运行状态：两个后端陷阱（「运行中」卡死）

- **陷阱 1：pi 0.85 起不再发 `agent_start`**。旧逻辑用 sdkAgentActiveRef 门控
  agent_end 收敛，agent_start 永不到达 → agent_end 被忽略 → 运行中永不清理。
- **陷阱 2：GET /api/agent/[id] 的顶层 `running` 只要 RPC 会话进程活着就恒为 true**
  （会话空闲 10 分钟内一直如此）——用它判定会永远「运行中」。
- **正确做法**：看 `state` 字段：`isPromptRunning || isStreaming || isBashRunning ||
  isCompacting || queuedMessages.followUp.length > 0`。
- **对账兜底**：运行期间每 4s 拉一次 agentState 对账；agent_end/agent_settled/prompt_done
  也触发对账（而不是直接改状态）。事件流断了、扩展注入的运行没有 prompt_done，都能收敛。
- **排队 = pi 的 follow-up**：运行中发送时 prompt 带 `streamingBehavior: "followUp"`，
  SDK 自动排队当前任务完成后执行（注意：带 streamingBehavior 时后端不发 prompt_done，
  收敛靠 agent_end + 对账）。打断 = `abort` 命令。
- **fork 不允许在运行中**（后端会话替换限制），运行中隐藏 fork 按钮；
  分支命令是 `{type:"fork", entryId}`，entryId 与 messages 数组 1:1 对应。
- 真实链路 e2e（e2e-chat）会消耗少量 token：发送→收敛→排队→fork 全链路验证。

### 24. 引导聚光灯重构（“不够清晰”反馈）

旧版教程气泡不显眼、箭头长、无遮罩。新版：
- **聚光灯**：四块遮罩 div（`.ob-mask`）留出目标洞口 + `.ob-hole` 发光描边脉动；
  洞外点击被遮罩拦截聚焦当前步骤，**洞内点击直达目标**（overlay 根 pointer-events:none，
  遮罩块 auto，气泡 auto，docked 卡 auto）。
- **就近气泡**：四方向自动选边（偏好方向放不下自动换边，再不行选空间最大边并 clamp）；
  气泡与目标间距仅 14px，箭头固定 16px 贴边、对准目标中心。
- 气泡高度用 ref 实测回填（只量一次防循环）；resize + 500ms 轮询持续校正定位。
- e2e-onboard 断言：四块遮罩 + 洞口 + 气泡与洞口间距 ≤ 32px。

### 25. 新版引导：欢迎（功能+视频）+ 一键接入 API（0.2.4）

用户反馈「新手引导太繁琐」，重做为两步：
- **欢迎页**：功能简介 6 卡片 + B 站教程视频 iframe 内嵌（`player.bilibili.com/player.html?bvid=BV139bD6gEa8`，
  index.html 无 CSP 所以 file:// 下可直接嵌）+ 环境状态一行。旧的环境/外观/箭头教程/技能四步全部删除
  （技能下载、背景动画都在设置页）。
- **一键接入 API**：复用 pi-web 现成端点，**不要手写 auth.json**——
  `GET /api/auth/providers`（apiKeyProviders: id/displayName/configured/modelCount），
  `POST /api/auth/api-key/[provider]` {apiKey}（pi SDK 存储凭据并失效模型缓存），
  `DELETE /api/auth/api-key/[provider]`。写 ~/.pi/agent 不需要管理员权限，不碰 UAC。
- e2e 用「未配置提供商 + 假 Key」验证导入链路后**立即 DELETE 清理**——必须在应用关闭前删
  （应用自己拉起的后端在退出时被树杀，退出后再删会无后端可用）。
- 提供商按钮带 data-id 供测试定位。
- **搜索交互（0.2.5）**：空搜索不展示全部提供商（用户反馈列表太乱），只展示热门快捷标签
  （点击即搜索）；只有命中结果才渲染行；搜索框加聚焦光晕、清空按钮（×，Esc 也行）。

## 版本记录

| 版本 | 内容 |
|------|------|
| 0.1.0 | 初版：自定义背景、启动动画/音频、会话工作台、流式聊天、fork、文件面板、后端管理 |
| 0.2.0 | 傻瓜式安装：首次启动六步引导（环境检测→API→外观→箭头教程→推荐 skills）；无 Node/pi 机器可装并获指引；Node 兜底链（只装 pi 也能跑）；启动遮罩加「跳过，进入应用」；帮助与支持 tab |
| 0.2.1 | 技能与插件管理：设置页管理页（skills 列表/禁用/启用/删除/本地安装/推荐下载；extensions 同理；pi 包列表/安装/移除经 pi CLI 流式日志） |
| 0.2.2 | 首次启动体验：npx 首次启动超时 120s→300s（覆盖冷下载），超时自动重试一次；启动文案细化（“正在下载组件…/自动重试…”）；单实例锁（多开唤起已有窗口）；修复 aurora 动画下错误页按钮点不到的 bug；e2e 全面隔离 userData（PI_DESK_USER_DATA + e2e-util.mjs） |
| 0.2.3 | 对话体验修复：运行状态卡死（agent_start 消失 + 状态接口恒 true 两个陷阱，4s 对账兜底）；运行中可继续输入排队（嫁接 pi follow-up），打断（abort）按钮去红色；fork 修复（运行中隐藏 + 错误提示）；新手引导聚光灯重构（变暗周边 + 洞口高亮 + 就近短箭头气泡） |
| 0.2.4 | 引导大简化（用户反馈“太繁琐”）：欢迎页 = 功能简介 + B 站教程视频内嵌；一键接入大模型（搜索/选择提供商 → 输入 API Key → 经 pi-web API 导入并验证，与 pi 共享配置）；删除环境/外观/箭头教程/技能四步 |
| 0.2.5 | API 搜索界面美化：空搜索不再展示全部提供商，只展示热门快捷标签与命中结果；搜索框加聚焦光晕/清空按钮/Enter 与 Esc 快捷操作 |

## e2e 测试（scripts/e2e-*.mjs）

全部用 Playwright `_electron` 启动真实应用（`require('electron')` 即 exe 路径），
加载 dist/ 构建产物。要点：

- **启动前 `taskkill /F /IM electron.exe`** 清残留，launch 失败重试 3 次（偶发 EPERM）。
- 每个用例都要**等待后端 ready**（轮询 `window.pidesk.getBackendStatus()`），
  再等启动遮罩淡出（minDuration+缓冲）。
- 用例覆盖：smoke（整体+控制台错误断言）、deep（媒体背景协议渲染+真实会话+文件面板）、
  startup（遮罩动画类+音频设置+淡出）、onboard（新版引导：欢迎功能卡+视频 iframe →
  提供商搜索/选择 → 假 Key 导入链路验证 → 立即清理）、
  manage（技能/插件列表→禁用→启用→删除全生命周期，用临时目录不碰真实数据）、
  timeout（后端超时→自动重试→报错可跳过，用假 pi-web + PI_DESK_SPAWN_TIMEOUTS 压缩超时，
  独立端口 39999 避开真实后端）、chat（真实对话：发送→运行收敛→运行中排队 follow-up→
  fork 分支全链路，消耗少量 token）、proto（两个协议直连探测）、shots（截图产出）。
- 断言不要依赖具体会话内容——用户数据会变；用元素存在性/计数/协议状态码。
- 跑完必须确认零残留：`tasklist | grep -iE "electron|Pi Desk"` 与 30141 端口都为空
  （这正是第 2 节树杀修复的回归点）。

## 常用排障

- **遮罩停在「后端启动失败」**：看 `%APPDATA%/Pi Desk/logs/backend.log` 与 crash.log。
- **渲染器报错**：开发模式 F12；e2e 的 console errors 断言会抓 file:// 下的报错。
- **端口被占**：看 backend.log——「复用已运行」说明是之前的孤儿后端（见第 19 节，
  下次启动会继续复用它，无害；要清理就 `netstat -ano | grep 30141` 找到 PID 杀掉）；
  也可能是用户自跑的 pi-web（勿杀）。
- **模型选择器为空**：该 cwd 无可用模型或未登录 → 标题栏「打开 pi-web 网页版」配置后
  刷新（模型按 cwd 缓存，切换会话即重取）。
