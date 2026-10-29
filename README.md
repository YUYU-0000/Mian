# Mian Chat v0.1

一个手机优先的聊天前端，后面接本地的 `codex app-server`（通过 stdio）。界面像一个“档案室”：每段对话是一张档案票，可以归档、分支、切换。

A mobile-first chat UI backed by a local Node bridge to `codex app-server` over stdio. Each conversation is styled as an archive ticket that can be filed, branched and switched.

> 这个项目是一个人做的，做着做着没力气了，但不想让它就这么停下。如果你觉得有意思，欢迎帮忙一起做完。
>
> This is a one-person project that ran out of steam. Help finishing it is very welcome.

---

## 已经做好的 / What works

- **聊天**：发消息、流式回复、气泡显示，回复里可以有“思考中”的状态和公开的思绪片段
- **工具调用时间线**：Codex 执行命令、读文件时，会按步骤显示出来，结果转成好读的文字
- **多对话**：可以新建对话、从某条对话分支出去、在不同对话之间切换，切换有过渡动画
- **档案抽屉**：对话以“档案票”的样子收在抽屉里，支持手势拉开/收起、置顶、归档
- **用量统计**：显示每段对话用掉的 token 数
- **手机访问**：Windows 上双击 `启动Mian.cmd`，同一个局域网里的手机可以直接打开
- **测试**：`tests/` 里有单元测试和浏览器端到端测试

## 还没做完的 / What's missing

- **连接中心页面**：已经能保存工作目录、sandbox、模型，也能测试连接；但“可执行文件”固定写死成 `codex`，“超时”还是灰的不能填。设计稿在 `design-reference/连接中心维护中.html`
- **设置界面**：`design-reference/设置界面维护中.html` 是一张能点的设计稿，有字体、壁纸、语音、存储四个档案袋。壁纸能上传并存在浏览器里；字体的保存/测试、语音试听（预留给 ElevenLabs）都还是空接口，存储那一格还没有内容，也还没接进正式的 React 前端
- **只支持 Codex**：现在后端只接了 `codex app-server`，没有接别的模型或 API
- **只在 Windows 上测过**：启动脚本是 `.cmd`，macOS / Linux 需要自己 `npm run dev`
- **局域网访问没有登录验证**：只适合在自己家的网络里用

## 设计参考 / Design reference

`design-reference/` 里是四张静态 HTML 设计稿（主界面、对话界面、连接中心、设置界面），新做页面时可以照着它的风格来。

---

## 运行 / Development

需要先装 Node.js 和 npm，并且 `codex` 命令能在终端里直接用（先登录好 Codex CLI）。

```powershell
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173`。后端 API 只监听 `127.0.0.1:8787`。

## 检查 / Checks

```powershell
npm run typecheck
npm run build
```

接近正式环境的运行方式：先 build，再 `npm start`，Node 服务会在 `127.0.0.1:8787` 提供 `client/dist`。

## 手机访问 / LAN access

Windows 启动脚本会从自己所在的位置找到项目目录。默认是 `127.0.0.1`；要让手机访问，把环境变量 `MIAN_LAN_IP` 设成电脑的局域网 IP。

## 隐私 / Privacy

环境变量文件、凭据、对话数据、浏览器配置、日志、备份、构建产物和依赖都留在本地，不会进 Git。测试里的消息和路径都是编出来的示例。

Environment files, credentials, conversation data, browser profiles, logs, backups, generated builds and dependencies stay local and are excluded from Git. Test messages and paths are synthetic fixtures.

## 想帮忙？ / Contributing

开一个 Issue 说说你想做哪部分，或者直接发 Pull Request。接别的模型、把连接中心做完整，是最需要人手的地方。

Open an issue or send a pull request. Supporting other backends and finishing the Connections page are where help is needed most.
