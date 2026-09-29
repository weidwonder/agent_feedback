---
lifecycle: active
superseded_by: ''
archived: ''
last_confirmed: '2026-09-29'
authority_refs:
  - 服务端环境变量表
  - 服务端 CLI（serve / set-admin）
  - packages/server/deploy 下的 systemd 单元与反向代理示例
  - 数据目录布局与备份恢复步骤
---

# 部署与运维

收集服务是单进程 Node 程序（`node:http` + `node:sqlite`），无第三方运行时依赖。契约以 `docs/spec/2026-09-29-agent-feedback-eng-spec.md` 为准，本文只写部署与运维步骤。

## 环境变量

全部来自环境变量，启动时校验；非法值启动失败并报出变量名。不支持热加载，改配置需重启。

| 变量 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `PORT` | int | 否 | 8787 | 监听端口 |
| `HOST` | string | 否 | 127.0.0.1 | 监听地址；放在反向代理后面时保持默认 |
| `DATA_DIR` | path | 否 | `./data` | 数据目录：数据库、备份、删除编号日志 |
| `TRUST_PROXY` | 0/1 | 否 | 0 | 为 1 时来源地址取 `X-Forwarded-For` 最后一段；只在服务前面确有反向代理时开启，否则来源地址可被伪造 |
| `COOKIE_SECURE` | 0/1 | 否 | 1 | 管理界面 cookie 带 `Secure`；仅在无 HTTPS 的本地试用时设 0 |
| `IP_DAILY_LIMIT` | int ≥ 1 | 否 | 5 | 同一来源地址每个北京时间自然日最多的提交请求数（含被拒的） |
| `GLOBAL_DAILY_LIMIT` | int ≥ 1 | 否 | 500 | 全站每个北京时间自然日最多收录的提交数 |

## 首次部署

1. 安装 Node ≥ 22.13（`node --version` 确认）。`node:sqlite` 在 Node 22 会打印 `ExperimentalWarning`，无害；systemd 单元已加 `--disable-warning=ExperimentalWarning`。
2. 取得代码并构建（需要联网装开发依赖 `esbuild`、`typescript`）：

   ```sh
   git clone <仓库地址> /opt/agent-feedback && cd /opt/agent-feedback
   npm install
   npm run build -w @agent-feedback/server   # 生成 packages/server/dist/server.mjs
   ```

   构建产物是零依赖单文件；也可以在别处构建后只把 `dist/server.mjs` 拷到服务器。
3. 建服务账号与数据目录：

   ```sh
   useradd --system --home /var/lib/agent-feedback --shell /usr/sbin/nologin agent-feedback
   install -d -o agent-feedback -g agent-feedback -m 700 /var/lib/agent-feedback
   ```
4. 设置管理员账号（密码从标准输入读取，终端下不回显、要求输入两次，至少 12 个字符）：

   ```sh
   sudo -u agent-feedback env DATA_DIR=/var/lib/agent-feedback \
     node --disable-warning=ExperimentalWarning /opt/agent-feedback/packages/server/dist/server.mjs set-admin <用户名>
   ```

   忘记密码时重跑同一条命令；重跑会使所有已登录会话失效。
5. 安装 systemd 单元并启动：

   ```sh
   cp packages/server/deploy/agent-feedback.service /etc/systemd/system/
   # 按需编辑单元里的路径与环境变量
   systemctl daemon-reload && systemctl enable --now agent-feedback
   journalctl -u agent-feedback -f     # 看到 event=startup 即已监听
   ```
6. 配反向代理与 HTTPS：示例见 `packages/server/deploy/Caddyfile.example`、`packages/server/deploy/nginx.conf.example`。代理必须把真实来源地址追加到 `X-Forwarded-For`，并让服务端 `TRUST_PROXY=1`。
7. 验证：`curl -s https://<域名>/healthz` 输出 `ok`；外部可用性探测服务指向这个地址。
8. 生成令牌：浏览器打开 `https://<域名>/admin/login` 登录，在「令牌与设置」页生成登记令牌（给注入工具）和查询令牌（给维护 agent）。完整令牌只显示一次，请立即保存。

## 数据目录布局

| 路径 | 内容 |
|---|---|
| `<DATA_DIR>/feedback.sqlite` | 数据库 |
| `<DATA_DIR>/backups/feedback-YYYYMMDD.sqlite` | 每日备份，保留 7 天 |
| `<DATA_DIR>/deleted-ids.log` | 已删除反馈的编号日志，只追加；不进备份 |

## 定时任务

服务进程内自带，无需 cron：

- 启动时：按删除编号日志重删、执行一次到期清理。
- 每小时：同上。反馈满 6 个月（按收录时间、北京时间）删除；30 天前的计数与拒收统计、过期会话一并清理。
- 每天北京时间 03:00 之后：生成当天备份（`VACUUM INTO`），删除 7 天前的备份。备份失败只记日志（关键字 `backup_failed`），次日重试。

## 日志

写 stdout，由 systemd journal 收集，每行 `key=value`。事件名：`request`、`submission_accepted`、`submission_rejected`、`purge_done`、`backup_done`、`backup_failed`、`deleted_log_applied`、`startup`。日志不含请求体、令牌、密码、cookie。

## 备份恢复

1. `systemctl stop agent-feedback`
2. 挑 `<DATA_DIR>/backups/` 里最新且可用的文件，覆盖数据库：

   ```sh
   cp /var/lib/agent-feedback/backups/feedback-YYYYMMDD.sqlite /var/lib/agent-feedback/feedback.sqlite
   chown agent-feedback:agent-feedback /var/lib/agent-feedback/feedback.sqlite
   ```
3. **不要删除 `deleted-ids.log`。** 服务启动时会按它重删备份里仍存在的已删反馈，并保证之后新收录的反馈不会复用已删编号。
4. `systemctl start agent-feedback`，用 `journalctl` 确认 `event=deleted_log_applied`，再访问 `/healthz`。

恢复会丢失该备份之后不到一天的数据。删除的反馈在备份里最多滞留 7 天（备份滚动删除），恢复时会被日志重删。

## 升级

拉新代码、重新构建、`systemctl restart agent-feedback`。建表语句是幂等的，启动时自动执行。
