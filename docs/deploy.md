---
lifecycle: active
superseded_by: ''
archived: ''
last_confirmed: '2026-10-13'
authority_refs:
  - packages/server/deploy 下的 systemd 单元与反向代理示例
  - 数据目录布局与备份恢复步骤
  - 注入工具的构建与使用步骤
  - 现网实例的布局与升级记录
  - 维护 skill 的获取与安装约定
---

# 部署与运维

收集服务是单进程 Node 程序（`node:http` + `node:sqlite`），无第三方运行时依赖。契约以 `docs/spec/2026-09-29-agent-feedback-eng-spec.md` 为准（环境变量表见 §6，命令行契约见 §3），本文只写部署与运维步骤。

## 环境变量

全部来自环境变量，启动时校验，改配置需重启。变量名、类型、默认值以 spec §6 的配置表为唯一出处，本文不复述。部署时最常动的三项：`DATA_DIR`（数据目录）、`TRUST_PROXY`（放在反向代理后面且代理追加了 `X-Forwarded-For` 时设 1，否则来源地址可被伪造）、`COOKIE_SECURE`（默认 1；仅无 HTTPS 的本地试用时设 0）。

## 首次部署

1. 服务器运行需要 Node ≥ 22.13（`node --version` 确认）；构建与测试需要 Node ≥ 22.18（内置类型剥离）。构建可以在别处完成，服务器只装运行版本即可。`node:sqlite` 在 Node 22 会打印 `ExperimentalWarning`，无害；systemd 单元已加 `--disable-warning=ExperimentalWarning`。
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
6. 配反向代理与 HTTPS：示例见 `packages/server/deploy/Caddyfile.example`、`packages/server/deploy/nginx.conf.example`。代理必须把真实来源地址追加到 `X-Forwarded-For`，并让服务端 `TRUST_PROXY=1`。nginx 示例已关闭访问日志：代理日志会长期留存提交方的网络地址，而服务端对网络地址只做限额计数、有明确保留期（见 spec §4.2）；改用自己的日志配置时留意这一点。
7. 验证：`curl -s https://<域名>/healthz` 输出 `ok`；外部可用性探测服务指向这个地址。
8. 生成令牌：浏览器打开 `https://<域名>/admin/login` 登录，在「令牌与设置」页生成登记令牌（给注入工具）和查询令牌（给维护 agent）。完整令牌只显示一次，请立即保存。把查询令牌交给维护 agent 时，同时把 `docs/query-api.md` 交给它：处理规则与用法口径在该文件里；装了维护 skill 的场合，规则与用法随 skill 到位（见[维护 skill 的获取与安装](#维护-skill-的获取与安装)），处理规则的家仍在 `docs/query-api.md`。

## 现网实例

| 项 | 值 |
|---|---|
| 服务地址 | `https://fb.weid.fun`（注入工具 `config --endpoint` 填这个；它会写进每个注入的 skill，更换要重新注入） |
| 主机 | 维护者的国内 VPS（Alibaba Cloud Linux 3），运维入口 `ssh root@10.14.0.1` |
| 运行时 | 独立 Node 22 装在 `/opt/agent-feedback/node/`，只供本服务使用；系统自带的 `/usr/bin/node`（v20）由主机上其他服务使用，MUST NOT 为本服务升级 |
| 程序 | 只部署构建产物 `/opt/agent-feedback/server.mjs`（本机 `npm run build` 后上传），服务器上没有源码与依赖 |
| systemd 单元 | `/etc/systemd/system/agent-feedback.service`：由仓库里的单元改写 `ExecStart` 为上面两条路径，其余不变 |
| 数据目录 | `/var/lib/agent-feedback`，属主 `agent-feedback`，权限 700 |
| 反向代理 | 主机已有的 nginx，站点配置 `/etc/nginx/conf.d/fb.weid.fun.conf`；访问日志关闭；改动后先 `nginx -t` 再 `systemctl reload nginx`，同机还有其他站点 |
| 证书 | acme.sh（webroot `/var/www/acme-challenge`，ec-256），安装到 `/etc/ssl/fb.weid.fun/`，续期由 root 的 acme.sh 每日 cron 完成并自动 reload nginx |

升级：本机 `npm run build -w @agent-feedback/server` → 把 `packages/server/dist/server.mjs` 上传覆盖 `/opt/agent-feedback/server.mjs` → `systemctl restart agent-feedback` → `curl -s https://fb.weid.fun/healthz`。

Node 安装包 MUST 以 `nodejs.org/dist/<版本>/SHASUMS256.txt` 核对校验和后再解压；国内镜像曾返回错误页冒充安装包。

主机出站流量经透明代理，连 Let's Encrypt 的 TLS 连接约半数失败，证书签发与续期可能因此失败。首次签发用的是只对该条命令生效的 curl 包装（`--interface eth0` 直连 Let's Encrypt）。续期失败时同样处理，或在代理规则里把 `acme-v02.api.letsencrypt.org` 设为直连。

## 数据目录布局

| 路径 | 内容 |
|---|---|
| `<DATA_DIR>/feedback.sqlite` | 数据库 |
| `<DATA_DIR>/backups/feedback-YYYYMMDD.sqlite` | 每日备份，保留口径见 spec §4.2 |
| `<DATA_DIR>/deleted-ids.log` | 已删除反馈的编号日志，只追加；不进备份 |

## 定时任务

服务进程内自带，无需 cron。启动、每小时清理与每日备份（含保留份数、失败与重启后的重试口径）的定义见 spec §4.2。运维动作：

- 日志出现关键字 `backup_failed`：检查磁盘空间与 `DATA_DIR` 权限；修复后无需手动干预，次日备份照常生成，或重启服务让当天再试一次。连续出现 `backup_failed` 必须当天处理，否则约 7 天后备份目录里没有可用备份。
- 日志出现关键字 `backup_prune_failed`：过期备份清理失败，检查备份目录权限与磁盘；不影响备份与服务，下一次每小时维护会自动重试。

## 日志

写 stdout，由 systemd journal 收集，格式与事件名全集见 spec §7。排障时按事件名过滤，例如 `journalctl -u agent-feedback | grep event=request_error`（请求异常）、`event=job_failed`（定时任务异常）、`event=login_blocked`（登录失败超限）。

## 备份恢复

1. `systemctl stop agent-feedback`
2. 挑 `<DATA_DIR>/backups/` 里最新且可用的文件，覆盖数据库：

   ```sh
   cp /var/lib/agent-feedback/backups/feedback-YYYYMMDD.sqlite /var/lib/agent-feedback/feedback.sqlite
   chown agent-feedback:agent-feedback /var/lib/agent-feedback/feedback.sqlite
   ```
3. **不要删除 `deleted-ids.log`。** 服务启动时会按它重删备份里仍存在的已删反馈，并保证之后新收录的反馈不会复用已删编号。
4. `systemctl start agent-feedback`，用 `journalctl` 确认 `event=deleted_log_applied`，再访问 `/healthz`。

恢复会丢失该备份之后不到一天的数据。删除的反馈在备份里的滞留期见 spec §4.2，恢复时会被日志重删。

## 升级

拉新代码、重新构建、`systemctl restart agent-feedback`。建表语句是幂等的，启动时自动执行。现网实例按上文「现网实例」节内嵌的升级段执行——该实例只部署构建产物、服务器上没有源码。

## 注入工具的构建与使用

注入工具在维护者本机运行，把反馈模块写进宿主 skill 的源头目录并向收集服务登记。

1. 构建（在本仓根目录，Node ≥ 22.18）：

   ```sh
   npm install
   npm run build
   ```

   产物：`packages/injector/dist/agent-feedback.mjs`。
2. 配置实例（令牌从标准输入读取，终端下不回显；写入本机配置文件，权限 0600）：

   ```sh
   node packages/injector/dist/agent-feedback.mjs config --endpoint <服务地址>
   ```

   令牌是管理界面生成的登记令牌。
3. 注入：

   ```sh
   node packages/injector/dist/agent-feedback.mjs inject <skill 源头目录>
   ```

   注入对象必须是 skill 的源头目录，不是安装副本：安装器会整目录覆盖安装副本，注入的内容随之丢失。目录下出现 `agent-feedback/` 子目录，`SKILL.md` 末尾追加引导语，并在服务上登记该 skill 名称。新登记的 skill 默认启用；已登记但被停用的会提示到管理界面启用。
4. 注入后按宿主仓库自己的流程补配套改动，例如目录白名单、规范句去重、体积预算、变更记录。工具完成后会打印这条提示。

重复注入是升级：模块文件覆盖为当前版本，引导语只出现一次。登记失败或写文件出错时，宿主文件恢复到注入前的样子，命令以退出码 1 结束。

## 维护 skill 的获取与安装

维护 skill（`skills/agent-feedback/`）是给维护者的 skill 维护 agent 用的入口：教它给 skill 源头注入反馈模块，以及在 skill 仓库里维护任何 skill 之前先取该 skill 的反馈清单、按处理规则把反馈纳入改进依据。规则与行为口径见 [维护 skill](requirements/维护skill.md)。

1. 把整个 `skills/agent-feedback/` 目录拷贝到目标 skill 仓库的仓库层技能目录（例如 `.claude/skills/agent-feedback/`，按维护 agent 所在环境支持的仓库级技能位置），或维护者自己的全局技能目录。
2. 不要把它加进宿主仓库分发安装器的清单——它是维护侧指引，理由与边界见 [维护 skill](requirements/维护skill.md)。
3. 本仓迭代后重新拷贝覆盖即可升级；覆盖前确认没有本地改动，有则先比对。
4. 交给维护 agent 的位置与凭证约定（查询令牌、本仓位置、服务地址的取法与纪律）见 `skills/agent-feedback/SKILL.md` 的「开始前」表；查询令牌由维护者在管理界面生成后交付。
