# VPS 内网测试与 GitHub Actions

## 已采用的部署方式

- Ubuntu 24.04 x64，Node.js 24.22.1 LTS；VPS Tailscale IP：`<VPS_TAILSCALE_IP>`。
- 应用以独立 `webank` 用户运行，由 `webank.service` 管理，只监听 `127.0.0.1:5173`。
- Tailscale Serve 将 HTTPS 请求转发到应用；不启用 Funnel。
- 测试地址：`https://<your-host>.<tailnet>.ts.net`（需要先启用 Serve，并连接 Tailscale）。
- `/srv/webank/releases/` 保存应用版本；`/srv/webank/current` 指向当前版本。
- `/srv/webank/shared/.wrangler/state` 保存本地 D1 数据；`/srv/webank/shared/.dev.vars` 保存服务端密钥。两者不随部署覆盖。

PR 运行类型检查、自动测试及构建。推送到 main 或在 main 手动运行工作流时，检查成功后连接 Tailscale，将构建和源码上传 VPS。VPS 安装锁文件中的依赖、应用尚未执行的数据库迁移，切换版本并重启。`/api/bank` 健康检查失败会恢复上一版应用；数据库不自动回滚，新迁移必须兼容上一版应用。成功后保留最近三个版本。

`setup-vps.sh` 会设置 `TAILSCALE_SERVE_ORIGIN=https://<your-host>.<tailnet>.ts.net`。仅在该域名下，应用才接受 Serve 注入的 `Tailscale-User-Login` 身份头，用于隔离用户数据。应用必须保持仅监听 loopback，且只能由 Serve 代理；Serve 会清除客户端伪造的 Tailscale 身份头。此模式忽略托管平台的身份头，仍验证 HTTPS Origin 并设置 Secure cookie。未启用该配置时保留原有托管平台登录行为。

## 首次安装服务器

Node.js 应先从官方发布站下载并验证校验和。SSH 到 VPS，在完整源码根目录执行：

```sh
sudo bash deploy/setup-vps.sh
sudo tailscale serve --bg --https=443 http://127.0.0.1:5173
```

如果 Serve 提示未启用，使用它打印的登录链接启用后重试。Serve 的 HTTPS 地址仅供 tailnet 中获准的设备使用。

为 GitHub Actions 单独生成 SSH 密钥。将公钥追加到 `/srv/webank/.ssh/authorized_keys`，前缀使用 `restrict,from="100.64.0.0/10" `，文件权限设为 600、属主 `webank:webank`。私钥只保存到仓库 Actions Secret `VPS_SSH_KEY`，不要提交。此用户仅获准无密码重启 `webank.service`。

## GitHub 与 Tailscale 尚需配置

在 Tailscale 管理控制台中：

1. 添加 `tag:ci`，由管理员管理，例如在现有策略中合并 `"tagOwners": { "tag:ci": ["autogroup:admin"] }`。保留已有策略。
2. 允许 `tag:ci` 访问 `<VPS_TAILSCALE_IP>` 的 TCP 22 端口。使用 grants 的示例：`{"src":["tag:ci"],"dst":["<VPS_TAILSCALE_IP>"],"ip":["tcp:22"]}`。如果已有允许该流量的规则，无须重复添加。
3. 创建 OAuth client，授予 Auth Keys 的写权限，并限定 `tag:ci`。

在本仓库 Settings → Secrets and variables → Actions 添加：

| Secret | 值 |
| --- | --- |
| `TS_OAUTH_CLIENT_ID` | 上述 OAuth Client ID |
| `TS_OAUTH_SECRET` | 上述 OAuth Client Secret |
| `VPS_SSH_KEY` | 专用 Ed25519 私钥完整内容 |

合并工作流后，在 Actions → Check and deploy private VPS → Run workflow 选择 main，验证第一次自动部署。没有配置凭据时，CI 仍可在 PR 上检查，main 的部署步骤会明确报缺失凭据；不能将其视为部署成功。

Actions checkout 自动取得私有仓库代码；VPS 接收构建包，因此不需要保存 GitHub PAT 或私有仓库拉取密钥。

## 配置真实语音

无密钥可使用交互演示。需要真实 Qwen 语音时，由管理员编辑 `/srv/webank/shared/.dev.vars`，填写百炼 API Key 和 Workspace ID，再执行 `sudo systemctl restart webank.service`。不要把密钥填进仓库或聊天。手机访问 HTTPS 地址并允许麦克风。

## 日常维护

```sh
sudo systemctl status webank.service
sudo journalctl -u webank.service -n 100 --no-pager
sudo tailscale serve status
```

更新服务器端部署脚本或服务定义后，需要管理员重新运行 `sudo bash deploy/setup-vps.sh`；工作流不会自行改写系统服务。

健康检查通过后，旧版本清理中的权限或文件系统错误只记录明确警告，不把已运行的应用报告为部署失败；需管理员后续检查遗留版本的权限和磁盘占用。健康检查失败仍执行原回退路径。清理逻辑可在隔离临时目录运行 `python3 deploy/tests/test_deploy.py` 验证。

数据库备份应在停止服务后复制整个 `shared/.wrangler/state`，然后启动服务。应用版本回退不会还原数据库。

官方参考：[Tailscale GitHub Action](https://tailscale.com/docs/integrations/github/github-action)、[Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)。
