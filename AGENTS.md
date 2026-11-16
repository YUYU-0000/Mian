# Mian 项目协作说明

## 一、项目概况

Mian 是手机优先的私人聊天应用，用档案馆、票根和线索墙组织对话，支持文字、图片、文件和语音。前端是 React + Vite + TypeScript，后端是 Node.js + Express，`shared/` 放前后端共用的协议、数据模型和类型声明。

聊天有两条通道：Codex 订阅通道通过本地 `codex app-server` 通信，需要先登录 Codex CLI；OpenAI 兼容 API 通道使用连接中心保存的服务商预设。两条通道共用聊天记录和回复展示。

从仓库根目录启动。首次安装依赖用 `npm.cmd ci`；Windows 双击 `启动Mian.cmd`，脚本通过 `npm.cmd run lan` 重新打包，再提供前端、API 和 WebSocket，手机访问窗口中显示的局域网地址。旧服务还在运行时不会重新打包；改完代码要先关掉旧窗口，再重新启动，手机刷新后才生效。开发时可用 `npm.cmd run dev` 启动热更新。

聊天记录、附件、语音文件、预设和服务器配置保存在 `server/data/`，不进仓库；浏览器另存部分界面偏好和草稿。

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
- `server/data` 按进程工作目录定位，服务从仓库根目录启动；Codex 工作目录在项目外，默认是用户目录下的 `MianWorkspace`，每个会话独立子目录。
