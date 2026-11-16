# Mian 项目协作说明

## 一、项目概况

Mian 是手机优先的私人聊天应用，用档案馆、票根和线索墙组织对话，支持文字、图片、文件和语音。前端是 React + Vite + TypeScript，后端是 Node.js + Express，`shared/` 放前后端共用的协议、数据模型和类型声明。

聊天有两条通道：Codex 订阅通道通过本地 `codex app-server` 通信，需要先登录 Codex CLI；OpenAI 兼容 API 通道使用连接中心保存的服务商预设。两条通道共用聊天记录和回复展示。

使用 Node 24 或更新的 LTS 版本。首次安装依赖用 `npm.cmd ci`；Windows 双击 `启动Mian.cmd`，未运行时打包并启动后台服务，已经运行时复用现有服务。改完代码双击 `重启Mian.cmd`，会暂停后端、重新打包并恢复，不必关窗口找进程。后台服务由 `scripts/service.mjs` 管理；`npm start` 前台运行守护进程，`npm run lan` 后台启动，`npm run restart` 重新打包并重启。开发用 `npm run dev`。

聊天记录、附件、语音文件、预设和服务器配置固定保存在仓库的 `server/data/`，不依赖启动工作目录；可用 `MIAN_DATA_DIR` 覆盖（相对路径按仓库根目录解析）。这些数据不进仓库；浏览器另存部分界面偏好和草稿。

部署配置从仓库 `.env` 读取，进程环境变量优先；模板见 `.env.example`。`MIAN_WORKSPACE_DIR` 控制 Codex 工作目录，`MIAN_CODEX_BIN` / `MIAN_CODEX_HOME` 控制 CLI 和登录目录，`MIAN_HOST` / `MIAN_PORT` 控制监听地址，`MIAN_PUBLIC_ORIGIN` 是公网 HTTPS 地址。Windows 和 Linux 共用 `shared/deployment.mjs`，禁止再写死本机用户名或依赖 cwd。

## 二、目录结构

- `client/src/App.tsx`、`client/src/pages/`：路由、会话切换和主页、聊天、线索墙、连接中心、档案馆页面。
- `client/src/pages/Chat.tsx`、`ChatMessage.tsx`：聊天布局、输入与附件草稿、消息和票根展示。
- `client/src/chatSession.ts`、`conversationSessions.ts`、`messageSync.ts`：前端会话状态、事件处理和服务器消息同步。
- `client/src/replyTimeline.ts`、`visualPlayback.ts`：回复逐字播放、工具时间线和气泡、票根的出现顺序。
- `client/src/components/`：共用组件，包括 ScrollText、AnimatedText、ChoiceTag、FileTicket、FilePreview、PaperPreview 和 VoiceTicket。
- `client/src/useTicketSwipe.ts`、`components/FileDraftTicket.tsx`：左滑/下拖删除、附件拖动及补位。
- `client/src/pages/Clues.tsx`、`pages/clues/`：线索墙布局、卡片编辑、图钉连线和手势。
- `client/src/pages/Connections.tsx`、`ConnectionSheet.tsx`、`SubscriptionSheet.tsx`：连接中心总览、API 预设和订阅纸片。
- `client/src/pages/Settings*.tsx`、`pages/settings/`、`settingsBackup.ts`：档案馆设置、字体、头像、语音页和备份整理。
- `client/src/voicePlayer.ts`：全局唯一语音播放器，供试听、语音票根和台词预览共用。
- `client/src/api.ts`、`pagePreloads.ts`、`lazyImport.ts`：前端请求、页面预载和懒加载分块恢复。
- `client/public/`、`design-reference/`：静态资源（含 `grain.png`）和界面设计稿。
- `server/src/index.ts`、`turnRoutes.ts`：Express、WebSocket、聊天通道接线和每轮请求入口。
- `server/src/codex.ts`、`conversationRuntime.ts`、`codexEvents.ts`：Codex 进程、会话线程和工具/消息事件。
- `server/src/apiChat.ts`、`apiPrompt.ts`、`providers/`：API 回复流、提示词组装、服务商适配和用量读取。
- `server/src/clues.ts`、`clueSelection.ts`、`clueChat.ts`、`codexClueSelection.ts`：线索保存与迁移、触发选择及两条通道的提示词注入。
- `server/src/conversations.ts`、`messages.ts`、`messageRoutes.ts`：会话元数据、聊天记录落盘与同步接口。
- `server/src/chatFiles.ts`、`workspaceFiles.ts`、`fileRoutes.ts`：聊天附件存储、Codex 工作目录文件捕获和文件读取下载。
- `server/src/voicePresets.ts`、`elevenLabs.ts`、`voiceGeneration.ts`、`voiceReplies.ts`、`voiceWaveform.ts`：语音预设、ElevenLabs 调用、生成缓存、回复音频和波形。
- `server/src/config.ts`、`apiPresets.ts`、`connections.ts`、`settingsRoutes.ts`：服务器配置、API 预设、连接管理和备份导入导出。
- `server/src/auth.ts`、`client/src/AuthGate.tsx`、`pages/SettingsSecurity.tsx`：登录、会话、门锁设置与退出所有设备。
- `server/src/codexSecurity.ts`、`scripts/check-codex-sandbox.mjs`：Codex 权限和实际隔离检查。
- `shared/deployment.mjs`、`scripts/service.mjs`、`control.mjs`、`launch.mjs`：跨平台部署配置、后台运行、重启和本机控制通道。
- `scripts/backup.mjs`、`windows-task.ps1`、`install-windows-tasks.ps1`、`tunnel.mjs`：每日备份、Windows 任务计划和隧道启动；运行日志与控制文件在 `.mian-runtime/`，不进 Git。
- `docs/搬到VPS.md`：Linux 安装、数据和 Codex 线程迁移、systemd、每日备份及隧道切换。
- `server/src/publicReplyProtocol.ts`、`shared/replyProtocol.mjs`：发给模型的回复约定，以及思绪、气泡、语音、文件标签解析。
- `shared/chatModel.mjs`、`clues.mjs`、`voice.mjs`、`*.d.mts`：共用消息状态、线索/语音规则和类型声明，改模块导出时同步声明。
- `tests/`：单元测试、浏览器端到端测试和测试夹具；按改动选择相关用例，避免重复跑整套。

## 三、工作规则

- 不要做防御性编程，不要反复对比、检查、验证。
- 平时在 feat/clues 分支上改，改完提交并推送到 feat/clues，再合并进 main 并推送。提交信息写清楚做了什么。
- 做完整理一下这次动到的文件。
- 只做要求的事，不顺手改别的功能和样式；整理代码时只清理，不改功能、接口和存储格式，已有数据要能照常读出来。
- 不新增依赖，除非明确要求。
- design-reference 文件夹是设计稿，不要改动；有设计稿的界面照设计稿做。
- server/data 里的用户数据不要提交。
- 外网开放前必须先完成本机密码设置。`/api/auth` 的状态、首次设置和登录是公开入口，其余 `/api`（含文件、图片和语音）及 `/ws` 都经服务端鉴权。Cookie 固定为 HttpOnly、Secure、SameSite=Strict，30 天到期；首次设置只允许直连本机，隧道回环连接不享受本机免登录。
- Codex 只使用 `codexSecurity.ts` 生成的 `mian-workspace` / `mian-read` 权限，禁止联网与提权，关闭宿主 MCP、插件、浏览器和额外文件工具。Windows 使用 MXC，不能退回 `unelevated`；工作目录只由 `MIAN_WORKSPACE_DIR` 控制，网页和导入备份不得扩大权限。

## 四、界面规则

- 文字放不下时用横向滚动（ScrollText），不要用省略号截断。
- 不要左侧粗竖条装饰。
- 不要用中间点连接文字，用两个空格分隔。
- 不要圆形元素，用方形或菱形。
- 不要牛皮纸黄。
- 不要显示数量统计标签。
- 排版紧凑，字距和间距不要留太宽。
- 动画安静克制，不要晃动和弹跳；会变化的文字统一用 AnimatedText 过渡；新出现的气泡和票根用 archive-pop-in。
- 动画只动 transform 和 opacity，不要逐帧改布局，不要在动画里用 blur 和实时滤镜；纸张颗粒用 /grain.png。
- 同类组件复用现有的，不要另写一套：吊牌用 ChoiceTag，票根用 FileTicket 那套，预览用 FilePreview，左滑/下拖删除用 useTicketSwipe。

## 五、常见坑

- 键盘布局统一用 `appViewport.ts` 的 `--app-h`，只在初次加载及宽度/方向变化时重新测量；纸片不用动态视口高度或高度媒体查询缩放。输入内容放进 `KeyboardScroll`，可视视口仅用于滚动聚焦字段并在收键盘后还原；聊天输入栏单独跟随可视视口。
- 首页在路由层保留挂载，离开时暂停视频，返回保留原帧、播放位置和分页；其他页面继续懒加载。`mediaStorage.ts` 按库/表/键缓存媒体 URL，组件卸载不释放，写入或删除时统一替换、通知并释放旧 URL，返回不能重播显影。
- 语音条码固定满高，用 transform 在静态峰值（最低 18%）和实时频谱（15%–70%）之间切换；38 段固定打散、逐段增益和快起慢落，常态增益留余量，只让明显更响的频段接近上限。票根与台词预览每帧共用一次取样，不加正弦或横向传播。密码显示统一复用 `PasswordToggle`，不要另加眼睛图标。

- 回复占位只由本次 `send` 返回的 `turnId` 绑定；HTTP 返回前暂存实时事件和消息快照，绑定后按真实 ID 归组、播放和保存。`replyKey` 仅保持 React 节点身份，不能让其他回合认领占位；已有运行回合时不新建占位，连续用户记录仍合并到待发组。相邻用户组在展示时合成一个头像，原记录格式不变。
- PWA 使用 `manifest.webmanifest` 和蓝猫图标；Safari 与 iOS 主屏幕应用各自保存登录状态，首次从主屏幕打开可能需要重新登录。每次冷启动都画鱼，页面内切换不重播；字体就绪前隐藏文字，首页挂在门后交叉淡化，获准进入后的预载连同收尾最多等 8 秒，超时进入缓存首页并提示。开门过程不启动语音。
- Service worker 只缓存界面、静态资源和字体，绕过 `/api`、WebSocket、鉴权结果及受保护的文件；不能将私人内容放入 Cache Storage。新版安装后等待旧页面关闭，下一次冷启动接管，不在开门过程中刷新；分块失效仍沿用 `lazyImport` 的单次恢复。401 与 WebSocket 4001 立即收起应用并暂停保存和消息重试，重新登录后才续传。
- Codex 权限中的禁网仅限制工具，模型通信在 app-server 进程中进行。完成通知可能早于 `turn/start` 响应，晚到的响应不能重新占用已完成回合；可重试的传输错误继续等待，最终错误结束回合并通知用户。进程重启后恢复原线程，权限仍固定在工作目录。

- 读取走 `api.ts` 的 IndexedDB 缓存与 `watch` 静默更新，断线不清空页面；保存队列按顺序补发，未补发的本地快照不能被旧响应覆盖，聊天仍走 `messageSync`。附件、语音由页面缓存 Blob，头像和首页照片沿用原媒体库；service worker 只缓存前端壳、分块和字体，绕过 `/api`、`/ws`，新版接入懒加载恢复。停服后重新打开页面需 HTTPS 或 localhost，普通局域网 HTTP 不支持 service worker。
- 重新打包后，旧页面可能仍引用已经失效的分块文件；懒加载接入 `pagePreloads.ts` / `lazyImport.ts`，沿用现有预载和一次刷新恢复逻辑。
- 内容撑宽的父层配上百分比子宽度会让票根塌缩；语音票根及包裹层用 `width: 228px; max-width: 100%`，失败退回文字时恢复气泡宽度规则。
- API 缓存依赖稳定前缀：system 只放回复协议、固定顺序的常驻线索和语音规则；时间、触发/语音场景线索、格式提醒放最后一条用户消息末尾，历史不改写，`read_clue` 工具定义和 tools 参数保持固定。
- Codex 的 `baseInstructions` 保持固定，时间和线索走每轮 `additionalContext`；正式会话复用原线程，临时线索挑选线程不能替换它。
- 新消息动画接入 `replyTimeline` / `visualPlayback` 并沿用 `historicalAnimationIds`；刷新、切换会话和重渲染不能重播旧消息，也不能重新生成或自动播放语音。
- 附件空间变化用内容层 FLIP：布局一次到位，原本贴底时只同步一次滚动，再过渡 transform；拖动移动原票根并留等宽占位，避免复制节点、图片重解码和逐帧 React 更新。
- 快速切换文字要清理旧动画，不能留下 opacity 0；关闭纸堆后迟到的请求不能重新打开吊牌，ChoiceTag 的 SVG id 和元素引用必须按实例隔离。
- 删卡片、拔图钉要同步清掉连线；旧数据在 `migrateClues` 清理，绘线时缺少任一端点就跳过，避免整页崩溃。
- 语音试听点 Play 先进入 out，真正出声才进入 playing，结束、停止或失败时一起收回；播放 Promise 等音频播完，所有入口共用 `voicePlayer`。
- 发文件不能编 Markdown、sandbox: 或 file: 链接；API 用 `<mian-file name="文件名.txt">完整内容</mian-file>`，Codex 真正写入当前会话工作目录，文件正文里的空白和标签须原样保留。
- 数据路径统一引用 `config.ts` 的 `dataDirectory`，不要拼接 `process.cwd()`；历史错位目录 `server/server/data-迁移前` 只留作还原，不再写入。Codex 工作目录在项目外，默认是用户目录下的 `MianWorkspace`，每个会话独立子目录。
- 登录状态不放进离线读取队列；收到 401 或 WebSocket 4001 必须收起应用并停止同步。离线只能展示这个浏览器此前已获准且未到期的缓存；退出后不能凭数据缓存自动进入。恢复网络会重新校验会话。
- 测试服务必须显式传 `MIAN_DATA_DIR` 和 `MIAN_WORKSPACE_DIR` 指向临时目录；切换 cwd 不再隔离数据，不能让测试接触真实 `server/data`。
- 当前公网地址是 `https://mian.crab-bless.com`，Cloudflare Tunnel `mian` 指向 `http://127.0.0.1:5173`，配置在用户目录 `.cloudflared/mian.yml`。隧道必须保留公网 Host；转发头不能把外网连接伪装成本机免登录。配置和凭据都不进 Git。
- Windows 任务 `Mian-Service` / `Mian-Tunnel` 在 ASUS 登录后自动运行，沿用该用户 Codex 登录；不是登录前启动。任务不弹窗口、不因切换电池而停止，异常退出后每分钟重试，后端自身崩溃由守护进程 5 秒重启。安装命令为 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-windows-tasks.ps1`。任务运行时阻止闲置睡眠，手动休眠、关机或合盖睡眠仍会中断外网服务。
- `Mian-Backup` 每天本机时间 02:00 运行，允许唤醒、错过后补跑。Windows 默认备份到用户桌面 `Mian备份/每日/YYYY-MM-DD`，Linux 默认 `~/MianBackups/daily`，可用 `MIAN_BACKUP_DIR` 覆盖。只保留最近 14 天内的日期目录，同日不覆盖已有完整备份；旧手工备份不参与清理。备份通过本机控制通道等回复结束、暂停并落盘、完整复制，再恢复服务；不要绕过这个流程直接复制运行中的数据。关机期间不能备份，当前 Windows 任务须用户已登录。
- 本机控制通道只用于启动、重启和备份，不是 HTTP 接口；Linux socket 权限为 0600，控制凭据在 `.mian-runtime`，不能放进前端或 API。测试守护进程还须指定独立 `MIAN_RUNTIME_DIR`、`MIAN_BACKUP_DIR` 和空闲端口。
- 搬家时先停旧机器再复制最终数据和 Codex 线程历史，只让一台机器连接隧道提供聊天。`before-online` 标签的旧代码没有登录保护、使用旧数据路径；恢复该版本必须先关隧道，按外部备份 `说明.txt` 还原。
