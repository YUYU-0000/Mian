# 把 Mian 从笔记本搬到 Linux VPS

下面按 Ubuntu 24.04、普通用户 `mian`、项目目录 `/home/mian/Mian` 写。先准备 VPS，最后停掉笔记本服务并复制数据，再切换隧道。域名仍用 `https://mian.crab-bless.com`。

## 1. 安装 Node、Git 和 Codex

用 VPS 提供商给的 SSH 方式登录。建立普通用户，后续 Mian 和 Codex 都用这个用户运行：

```bash
sudo apt update
sudo apt install -y git curl ca-certificates xz-utils
sudo adduser mian
sudo usermod -aG sudo mian
sudo -iu mian
```

安装 Node 24 LTS。以下从 [Node 官方发行目录](https://nodejs.org/dist/latest-v24.x/) 取当前的 24.x 二进制；x86 VPS 用 `x64`，ARM VPS 把第一行改成 `arm64`。Node 的 LTS 版本见[官方下载页](https://nodejs.org/en/download)。

```bash
NODE_ARCH=x64
NODE_FILE=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | awk -v a="linux-${NODE_ARCH}.tar.xz" '$2 ~ a "$" {print $2}')
curl -fLo "/tmp/$NODE_FILE" "https://nodejs.org/dist/latest-v24.x/$NODE_FILE"
sudo mkdir -p /opt/node24
sudo tar -xJf "/tmp/$NODE_FILE" -C /opt/node24 --strip-components=1
sudo ln -sf /opt/node24/bin/node /usr/local/bin/node
sudo ln -sf /opt/node24/bin/npm /usr/local/bin/npm
sudo ln -sf /opt/node24/bin/npx /usr/local/bin/npx
sudo /opt/node24/bin/npm install -g @openai/codex
```

## 2. 拉取代码，配置 Linux 路径

```bash
cd /home/mian
git clone https://github.com/YUYU-0000/Mian.git
cd Mian
git checkout main
npm ci
cp .env.example .env
nano .env
```

仓库如果要求 GitHub 登录，在终端自行完成授权。`.env` 用下面这些路径，别照搬笔记本的 Windows 路径：

```dotenv
MIAN_DATA_DIR=/home/mian/Mian/server/data
MIAN_WORKSPACE_DIR=/home/mian/MianWorkspace
MIAN_RUNTIME_DIR=/home/mian/Mian/.mian-runtime
MIAN_BACKUP_DIR=/home/mian/MianBackups/daily
MIAN_CODEX_BIN=/opt/node24/bin/codex
MIAN_CODEX_HOME=/home/mian/.codex
MIAN_PORT=5173
MIAN_HOST=127.0.0.1
MIAN_PUBLIC_ORIGIN=https://mian.crab-bless.com
```

```bash
npm run build
mkdir -p /home/mian/MianWorkspace /home/mian/.cloudflared
```

`server/data` 固定按代码位置定位，也能由 `MIAN_DATA_DIR` 覆盖。环境变量优先于 `.env`。旧 `config.json` 里的 Windows 工作目录不会覆盖这里的 `MIAN_WORKSPACE_DIR`。公网只走 Tunnel，不需要开放 VPS 的 5173 端口。

## 3. 安装 cloudflared，准备原隧道

按 [Cloudflare 的 Ubuntu 24.04 软件源](https://pkg.cloudflare.com/index.html) 安装：

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared noble main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update
sudo apt install -y cloudflared
```

笔记本原隧道名是 `mian`，ID 是 `009c4657-2651-42f7-a1a1-2a308d0677b3`。在笔记本 PowerShell 中把这一份隧道凭据传到 VPS，把 `VPS_IP` 换成实际地址：

```powershell
scp "$env:USERPROFILE\.cloudflared\009c4657-2651-42f7-a1a1-2a308d0677b3.json" mian@VPS_IP:/home/mian/.cloudflared/
```

这个 JSON 是凭据，直接通过 SSH 传输，不贴进聊天，不进 Git。运行现有隧道不需要复制账户的 `cert.pem`。

在 VPS 创建 `/home/mian/.cloudflared/mian.yml`：

```yaml
tunnel: 009c4657-2651-42f7-a1a1-2a308d0677b3
credentials-file: /home/mian/.cloudflared/009c4657-2651-42f7-a1a1-2a308d0677b3.json
ingress:
  - hostname: mian.crab-bless.com
    service: http://127.0.0.1:5173
    originRequest:
      httpHostHeader: mian.crab-bless.com
  - service: http_status:404
```

```bash
chmod 700 /home/mian/.cloudflared
chmod 600 /home/mian/.cloudflared/*.json /home/mian/.cloudflared/mian.yml
```

先不启动 VPS 隧道。同一隧道同时连接两台机器会分配流量，两套独立的数据目录不能同时提供聊天服务。原来的 DNS 已指向这个隧道 ID，搬家不用重新创建隧道或 CNAME。[Cloudflare 配置说明](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/)

## 4. 停笔记本，复制最终数据

等正在生成的回复和语音结束。在笔记本 PowerShell 里运行：

```powershell
Set-Location C:\Users\ASUS\Desktop\Mian
Disable-ScheduledTask -TaskName Mian-Backup
Disable-ScheduledTask -TaskName Mian-Tunnel
Disable-ScheduledTask -TaskName Mian-Service
Stop-ScheduledTask -TaskName Mian-Tunnel
node --input-type=module -e "import {control} from './scripts/control.mjs'; await control('pause')"
Stop-ScheduledTask -TaskName Mian-Service
scp -r .\server\data mian@VPS_IP:/home/mian/Mian/server/
scp -r "$env:USERPROFILE\MianWorkspace" mian@VPS_IP:/home/mian/
```

这里复制的是迁移后的 `server/data`，不是 `server/server/data-迁移前`。完整目录包含聊天记录、附件、语音、线索墙、API/语音预设、设置和 `auth.json`。`auth.json` 带登录密码的哈希与有效会话，复制后继续用原来的 Mian 登录。浏览器里的本地草稿和界面偏好仍留在原浏览器中。

Codex 的订阅线程还保存在独立的 Codex 用户目录里。要继续原线程，把笔记本的 Codex 目录也通过 SSH 复制到 VPS；默认路径如下。如果设置过 `MIAN_CODEX_HOME`，改成那个路径：

```powershell
scp -r "$env:USERPROFILE\.codex" mian@VPS_IP:/home/mian/
```

此目录包含私人历史和登录资料，只在自己的两台机器之间传输。它保留线程历史和索引；下一步在 Linux 重新完成 Codex 登录，不依赖 Windows 的凭据存储。无需复制 `node_modules`、`dist`、`.mian-runtime` 或旧数据目录。

## 5. 在 VPS 登录 Codex

仍用 `mian` 用户，在 VPS 运行：

```bash
/opt/node24/bin/codex login --device-auth
```

打开终端给出的页面，自行登录并输入那次的一次性代码。不要把登录资料发给别人。此流程见 [Codex 登录说明](https://learn.chatgpt.com/docs/auth#sign-in-with-device-code)。

```bash
cd /home/mian/Mian
node scripts/check-codex-sandbox.mjs
```

这条命令只用临时标记文件检查工作目录、目录外访问和网络隔离，不发聊天请求。Linux 必须支持 Codex 的文件访问隔离。若失败，处理 VPS 系统或 Codex 版本的兼容问题后再开放服务；不要改成 full access。Mian 固定使用 `mian-workspace` / `mian-read` 权限，允许运行所需系统文件的最小读取，禁止读取工作目录外的私人文件和执行联网命令。[Codex 权限说明](https://learn.chatgpt.com/docs/permissions)

## 6. 设置 systemd 开机运行

用 `sudo nano /etc/systemd/system/mian.service` 写入：

```ini
[Unit]
Description=Mian chat
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=mian
WorkingDirectory=/home/mian/Mian
ExecStart=/opt/node24/bin/node /home/mian/Mian/scripts/service.mjs
Restart=always
RestartSec=5
TimeoutStopSec=60
KillMode=mixed
UMask=0077

[Install]
WantedBy=multi-user.target
```

用 `sudo nano /etc/systemd/system/mian-tunnel.service` 写入：

```ini
[Unit]
Description=Mian Cloudflare Tunnel
Wants=network-online.target mian.service
After=network-online.target mian.service

[Service]
User=mian
ExecStart=/usr/bin/cloudflared tunnel --config /home/mian/.cloudflared/mian.yml run
Restart=always
RestartSec=5
UMask=0077

[Install]
WantedBy=multi-user.target
```

Mian 守护进程在后端退出后 5 秒重新拉起；systemd 在守护进程或隧道退出后重新拉起。路径写在服务文件和 `.env` 中，不依赖 SSH 登录窗口。自定义名称的隧道配置需要显式传 `--config`，参见 [Cloudflare Linux 服务说明](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/as-a-service/linux/)。

## 7. 设置每天凌晨 2 点备份

VPS 时区决定备份时间。想继续北京时间，可运行 `sudo timedatectl set-timezone Asia/Shanghai`。

`sudo nano /etc/systemd/system/mian-backup.service`：

```ini
[Unit]
Description=Mian daily backup

[Service]
Type=oneshot
User=mian
WorkingDirectory=/home/mian/Mian
ExecStart=/opt/node24/bin/node /home/mian/Mian/scripts/backup.mjs
TimeoutStartSec=infinity
UMask=0077
```

`sudo nano /etc/systemd/system/mian-backup.timer`：

```ini
[Unit]
Description=Mian backup at 02:00

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

备份先等当前回复结束，关闭并落盘，再把整个数据目录复制到 `MIAN_BACKUP_DIR/YYYY-MM-DD`，之后恢复服务。同一天已有完整备份就保留原份。只清理该备份目录中超过 14 天保留期的日期目录，不碰手动备份。失败时不把半份复制标记为当天完整备份。

## 8. 启动并把流量切到 VPS

笔记本的 Mian 和隧道此时应保持停止：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mian.service mian-tunnel.service mian-backup.timer
sudo systemctl start mian-backup.service
```

用手机移动网络打开 `https://mian.crab-bless.com`，自行登录并发一条消息，确认实时回复、附件和语音。需要看运行情况时：

```bash
systemctl status mian mian-tunnel mian-backup.timer
journalctl -u mian -u mian-tunnel -n 60 --no-pager
```

## 日常更新、恢复与退回笔记本

更新代码并重新打包：

```bash
cd /home/mian/Mian
git pull --ff-only origin main
npm ci
node scripts/launch.mjs --restart
```

恢复某天数据时，先 `sudo systemctl stop mian-tunnel mian`，把现有 `server/data` 改名留存，再把所选 `MIAN_BACKUP_DIR/YYYY-MM-DD` 整个复制成 `server/data`，保持归属用户 `mian`，最后重新启动两个服务。`MIAN_DATA_DIR` 使用别的位置时，恢复到对应位置。

需要退回笔记本时，先停 VPS 的隧道和 Mian，把 VPS 最新 `server/data` 和 `MianWorkspace` 复制回笔记本，原目录先改名留存。然后在笔记本启用并启动 `Mian-Service`、`Mian-Tunnel`，启用 `Mian-Backup`。始终只让一台机器承接这个域名的聊天流量。

改动前的代码还原标签为 `before-online`，可用 `git switch --detach before-online` 查看或恢复当时代码。这个标签没有外网登录保护，而且当时数据路径是 `server/server/data`；使用它时先关隧道，数据恢复位置按备份目录中的 `说明.txt` 操作。平时恢复数据不需要退回该标签。
