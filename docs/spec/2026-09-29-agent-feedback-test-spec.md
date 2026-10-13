---
lifecycle: active
superseded_by: ''
archived: ''
last_confirmed: '2026-10-13'
authority_refs:
  - 需求到用例追溯矩阵（§6）
---

# agent-feedback_测试方案 — 反馈收集服务、反馈模块与注入工具

> 只覆盖本仓（四个包：`packages/shared`、`server`、`module`、`injector`；2026-10-13 新增的维护 skill `skills/agent-feedback/` 是纯文档交付物，无测试对象）。功能代码已开发完成。
> 上游：需求真相源 `docs/REQUIREMENTS.md`；设计输入为已归并归档的 PRD `docs/spec/2026-09-29-agent-feedback-PRD.md`、原型 `docs/spec/2026-09-29-agent-feedback-prototype.html`（界面与逐元素说明已用 `preview.mjs extract` 与 `annotations` 取回，共 9 条说明、0 条用户批注）、Overview `docs/spec/2026-09-29-agent-feedback-overview.md`、技术 Spec `docs/spec/2026-09-29-agent-feedback-eng-spec.md`（FR-001–026、AC-001–025）、Coding Plan `docs/plan/2026-09-29-agent-feedback-coding-plan.md`。
> 覆盖度台账：`docs/report/测试场景覆盖度.md`。协作面 solo：单接口部分压缩为关键路径；长链路端到端不压缩，每环中间产物都有断言。
> 代码事实来源（`ctx get-card agent-feedback <域>`，确认日期 2026-09-29）：`engineering-context/cards/agent-feedback/提交收录.md`、`登记.md`、`查询通道.md`、`管理界面.md`、`反馈模块.md`、`注入.md`。卡片没有覆盖的事实读源码，标在句末。

## 纪律（贯穿全文）

- 输入权威等级：PRD 与原型在"用户可见行为"上同级 > 技术 Spec > Coding Plan > 当前实现。冲突与未定义项一律进 §10，标"待确认"，不脑补。
- 预期值来自 spec / PRD 的口径或手工推演的具体值（例如 6 个月零 1 天、第 6 次 429、编号 `FB-0001`），不用被测代码现场重算。
- 测试只挂稳定缝：HTTP 契约、命令行的标准输入输出与退出码、落库与落盘副作用、日志事件名。不断言内部调用次序。
- 异步等待用条件轮询（服务就绪探活）或可控时钟（`mock.timers`、注入的 `now()`），不用固定 sleep。
- 每个新增用例都做过"改坏被测代码 → 变红 → 恢复"的反向自检，结果记在 §11。

## 1. 测试范围

- **覆盖**：
  - 收集服务：`POST /v1/submissions`、`GET /v1/registry/check`、`POST /v1/registry`、`GET /v1/feedback`、`GET/PATCH /v1/feedback/:id`、`GET /healthz`、`/admin/*` 全部路由、`set-admin` 与 `serve` 命令、环境变量校验、定时任务（每小时维护、每分钟备份检查）、删除编号日志与恢复后重删、日志内容。
  - 反馈模块：`submit.mjs` 的标准输入到标准输出契约（构建产物，含旧版 Node 门槛）。
  - 注入工具：`config`、`inject` 命令及回滚。
  - 共用契约：`packages/shared` 的校验、skill 名校验、frontmatter 解析。
  - 交付物：部署文件与配置表一致、上线评测场景清单结构。
  - 长链路：从 `config` 到删除日志重放的真实进程端到端（§8）。
- **不覆盖**：
  - 宿主 agent 与维护 agent 的真实会话行为（何时反馈、静默、禁写清单、会话上限、如实回答、维护 agent 抗注入）：属上线评测，见 `docs/report/上线评测场景.md`，台账登记为缺。
  - 浏览器里的交互（CSS `:target` 确认对话框的打开与取消、页面视觉）：没有浏览器自动化，靠人工点验。
  - 真实 VPS 部署、TLS、systemd 运行、反向代理转发：只测部署文件的内容一致性。
  - 网络层攻击与压测：PRD 风险表明确交给服务器厂商；单实例日收录上限 500，不做性能压测。

## 2. 高风险点分析 + 优先级

隐蔽缺陷清单逐条对照（命中的在第二列写明落点，未命中的写明原因）：

| 清单项 | 是否命中 | 落点 |
|---|---|---|
| PRD 与后端文档不一致 | 是 | §10 项 1–4（均已澄清）：列表"近 7 天"口径、原型与实现的展示差异、CLI 契约缺参数、重复会话编号语义 |
| 状态流转遗漏 / 非法状态可操作 | 是 | 五种状态可任意互改（spec §10 状态机）：风险 R7；停用/旧名/未登记的提交：R4 |
| 接口之间数据传递错误 | 是 | 宿主 SKILL.md → 提交脚本 → 服务端 → 查询接口 → 管理界面的字段传递：R1、L1 |
| 用户/角色/租户/资源归属越权 | 是 | 令牌种类与会话的边界、查询令牌不能做管理动作：R6 |
| 幂等 / 重复提交 / 重试导致数据重复或状态错乱 | 是 | 重复注入、重复登记、重复 PATCH 同状态、重复删除：R8；服务端不去重提交：§10 项 4（已写入 spec §2.1） |
| 并发下库存/余额/额度/次数等竞争 | 是 | 全站与来源地址限额并发：R3 |
| 异步任务/回调/消息延迟导致最终状态不一致 | 是 | 每小时维护、每分钟备份检查的编排；收录后 1 分钟内可查：R9 |
| 删除/取消/撤回/失败/超时后的二次操作 | 是 | 删除后再查、再删、从旧备份恢复后复现：R2；停用后提交：R4 |
| 部分成功/部分失败后的补偿或回滚 | 是 | 注入写文件后登记失败回滚：R8；备份清理单个文件失败不中断整轮：R10；备份写出后改名失败：R14 |
| 前端不可见但接口可直接调用的非法路径 | 是 | 界面没有新增登记入口但接口/路由能否被直接调用；`DELETE /v1/feedback/:id`；PATCH 附带的其他字段：R6 |
| 历史数据/脏数据/边界配置/开关配置下的异常行为 | 是 | 真实宿主 SKILL.md 头部写法不一：R1；环境变量非法值：R11；`AGENT_FEEDBACK_DISABLED` 与旧版 Node：R5 |

| # | 风险点 | 影响 | 可能性 | 优先级 | 对应 §5 用例 |
|---|---|---|---|---|---|
| R1 | 宿主名称与版本读错，导致整批提交被拒收或版本错记 | H | M | P0 | 1, 2 |
| R2 | 已删反馈从旧备份恢复后复现；恢复后新反馈复用已删编号被误删 | H | M | P0 | 3, 4 |
| R3 | 并发提交超额收录或来源地址限额被并发穿透 | H | L | P1 | 5 |
| R4 | 拒收内容被落库（隐私承诺被破坏）；未登记、停用、旧名的提交被收录 | H | M | P0 | 6, 7 |
| R5 | 提交脚本在旧版 Node 或关闭开关时打断使用者任务（非零退出、写标准错误、阻塞等标准输入） | H | M | P0 | 8 |
| R6 | 查询令牌或登记令牌越权做管理动作；管理界面 XSS；跨源 POST | H | M | P0 | 9, 10 |
| R7 | 状态修改两侧（查询通道与管理界面）不一致 | M | M | P1 | 11 |
| R8 | 注入中途失败后宿主目录残留；令牌写进宿主文件 | H | M | P0 | 12 |
| R9 | 定时任务没有按周期执行，或一次异常让后续周期全部停摆 | M | M | P1 | 13 |
| R10 | 备份清理失败中断整轮、或清理异常向外抛出打断维护 | M | M | P1 | 14 |
| R11 | 环境变量非法或部署文件与配置表不一致，服务起不来或限额悄悄变化 | M | L | P2 | 15 |
| R12 | 日志泄露令牌、密码、cookie 或提交内容 | H | L | P1 | 16 |
| R13 | 管理界面列表筛选字段映射错误（9 个字段任意组合应同时满足） | M | M | P1 | 17 |
| R14 | 备份失败或改名失败时残留临时文件、当天反复重试 | M | L | P2 | 18 |

## 3. API 调用模型

代码事实：字段与拒收码见 spec §2.1、§3；把关顺序见 `提交收录.md`（`packages/server/src/routes/submissions.ts#registerSubmissionRoutes`）；令牌校验见 `查询通道.md`（`packages/server/src/auth.ts#verifyBearer`）。所有 JSON 错误体为 `{"error":{"code","message","field?"}}`。

| API ID | 方法+路径 | 鉴权/Header | 参数 | Request Body | Response 关键字段 | 错误响应 | 关键副作用 | 幂等/重试 | 文档缺失项 |
|---|---|---|---|---|---|---|---|---|---|
| API-SUB | `POST /v1/submissions` | 无鉴权；`Content-Type: application/json`；`TRUST_PROXY=1` 时按 `X-Forwarded-For` 最后一段取来源 | — | `{skill{name,version?}, moduleVersion, os, submittedAt, session{…}, items[1..5]}`，字段规则 spec §2.1，未知字段拒收 | 201 `{submissionId, feedbackIds:["FB-0001",…]}` | 413 `payload_too_large`；429 `ip_limit`；400 `invalid_json`/`invalid_field`/`too_many_items`；403 `skill_not_registered`；429 `global_limit`；500 `internal` | 来源地址计数 +1（读体后、解析前）；拒收计数（limit/unregistered/invalid）；收录时 submissions、feedback、`global_accepted` 同一事务 | 非幂等：同一请求重复发送各自落库 | 已澄清，见 spec §2.1 |
| API-CHK | `GET /v1/registry/check?name=` | `Authorization: Bearer <登记令牌>` | `name` | — | 200 `{state:"registered",enabled}` / `{state:"old_name",currentName}` / `{state:"unknown"}` | 400 `invalid_field`（field=`name`）；401；403 | 无（只读；令牌记 `last_used_at`） | 幂等 | — |
| API-REG | `POST /v1/registry` | Bearer 登记令牌 | — | `{"name"}` | 200 `{name,enabled,created}` | 409 `old_name`；400 `invalid_field`；401；403 | 新名写 skills（默认启用）；已存在不改状态 | 幂等（重复登记 `created:false`） | — |
| API-FLIST | `GET /v1/feedback` | Bearer 查询令牌 | `skill`（必填现名）、`type`、`impact`、`status`、`resolved`、`from`、`to`、`moduleVersion`、`agentName`、`harnessName`、`limit`（1–50，默认 20）、`offset` | — | 200 `{notice,total,items:[FeedbackView]}` 按收录时间倒序 | 400 `skill_required`/`invalid_field`；401；403 | 无 | 幂等 | 无（`status=all` 不是查询通道的合法值，仅管理界面使用） |
| API-FGET | `GET /v1/feedback/:id` | Bearer 查询令牌 | `id` 为数字或 `FB-0012` | — | 200 `{notice,item,siblings[]}` | 404 `not_found`；401；403 | 无 | 幂等 | — |
| API-FPATCH | `PATCH /v1/feedback/:id` | Bearer 查询令牌；`Content-Type: application/json` | `id` | `{"status": pending|valid|invalid|duplicate|done}` | 200 `{notice,item}` | 400 `invalid_status`/`invalid_json`；404；401；403 | 写 `status`、`status_updated_at`；只认 `status` | 重复写同状态幂等；后写覆盖先写 | — |
| API-HEALTH | `GET /healthz` | 无 | — | — | 200 文本 `ok` | — | 无 | 幂等 | — |
| API-ADM-AUTH | `GET/POST /admin/login`、`POST /admin/logout` | 无；POST 须同源 | 表单 `username`、`password` | 表单 | 303 到 `/admin/feedback` 并下发 `af_session`（`HttpOnly; SameSite=Strict; Path=/`，`COOKIE_SECURE=1` 时加 `Secure`） | 401（"账号或密码不正确"）；429（当天失败 ≥ 20 次）；403（不同源） | 写 admin_sessions；失败计 `login_fail:<地址>` | 非幂等（每次登录新会话） | — |
| API-ADM-FB | `GET /admin/feedback`、`GET /admin/feedback/:id`、`POST /admin/feedback/:id/status`、`POST /admin/feedback/:id/delete` | Cookie `af_session`；POST 须同源 | 列表 query：查询通道同组字段 + `range`（`7d`/`30d`/`6m`/`custom`）+ `page`；`status` 缺省 `pending`，`all` 为全部 | 状态：表单 `status`；删除：无字段 | 列表 200 HTML；改状态 303 回详情提示"已标记为「X」"；删除 303 回列表提示"已删除 FB-xxxx" | 未登录 302；跨源 403；不存在 404；非法状态 400 | 删除：先追加 `<DATA_DIR>/deleted-ids.log`，再事务内删行 | 重复删除返回 404 | 已澄清，见 spec §4.5 |
| API-ADM-SKILL | `GET /admin/skills`、`POST /admin/skills/:id/toggle`、`POST /admin/skills/:id/rename` | Cookie；POST 同源 | 改名表单 `name` | — | 200 HTML；303 | 改名冲突回显原因；旧名、他人现名冲突 | 改名：原名写 `skill_old_names`，历史反馈归新名 | toggle 非幂等（启停翻转） | 无新增登记路由（`POST /admin/skills` 应 404） |
| API-ADM-SET | `GET /admin/settings`、`POST /admin/tokens`、`POST /admin/tokens/:id/revoke`、`POST /admin/password` | Cookie；POST 同源 | 表单：`kind`、`name`；`current`、`next`、`confirm` | — | 令牌成功页一次性展示完整令牌 | 密码不足 12 字符、两次不一致、当前密码错误均拒绝 | 令牌只存 SHA-256；改密码清空全部会话 | 撤销幂等 | — |
| API-SUBMIT | `node <宿主>/agent-feedback/submit.mjs [--dry-run]` | 环境变量 `AGENT_FEEDBACK_DISABLED=1` 关闭 | 标准输入：`{session, items}` JSON（≤ 256 KiB） | — | 标准输出恰一行 JSON：`{ok:true,submissionId,feedbackIds,sessionId}` / `{ok:true,dryRun:true,body}` / `{ok:false,reason}` | `reason` ∈ `disabled`、`node_too_old`、`bad_input`、`not_configured`、`host_unreadable`、`invalid`、`unreachable`、`rejected`、`internal` | 只向服务端发一次 POST，不落本地文件 | 无状态，不重试 | 无 |
| API-CLI-SERVER | `node packages/server/dist/server.mjs serve` / `set-admin <用户名>` | 环境变量；`set-admin` 从标准输入读密码 | — | — | 退出码 0/1；配置非法时 stderr 含变量名 | — | `set-admin` 写 admin 并清空全部会话 | 重跑覆盖密码 | 无 |
| API-CLI-INJ | `node packages/injector/dist/agent-feedback.mjs config --endpoint <url>` / `inject <目录>` | 登记令牌只从标准输入读 | 可选参数见 spec §3 CLI 契约 | — | 退出码 0/1；stdout 摘要；失败原因打到 stderr | 见 spec §4.4 各 `fail` 分支 | 写模块目录、追加引导语、向服务登记；失败回滚 | 重复注入不重复追加引导语与登记 | `--config-path`、`--module-dir` 已列入 spec §3 CLI 契约（§10 项 3） |

## 4. 测试数据构造方案（Fixture）

真实样本：本系统的运行切片按设计不留提交内容（隐私承诺），没有可脱敏的真实提交；服务端入参由测试构造。唯一可取得的真实输入是宿主 skill 的 `SKILL.md` 头部，已固化到 `test/fixtures/真实宿主skill头部/`（探测既有惯例：`tests/fixtures/`、`tests/data/`、`test/fixtures/` 均不存在，按本次可改动范围放在 `test/fixtures/` 下，含场景说明与覆盖特征标签，已按标签子集淘汰规则去重）。不含凭证，无 `secrets/`。

| Fixture ID | 适用用例 | 数据目标 | 基础实体 | 字段明细 | 构造方式 | 前置状态 | 运行时变量 | 清理策略 |
|---|---|---|---|---|---|---|---|---|
| FX-SERVER | §5 全部服务端用例 | 临时服务：随机端口、临时数据目录、可控时钟 | 服务、库 | `TRUST_PROXY=1`（用 `X-Forwarded-For` 区分来源）、`COOKIE_SECURE=0`、`IP_DAILY_LIMIT=1000`（可按用例覆盖）、`now()` 可注入 | `packages/server/test/helpers.ts#startTestServer` | 空库 | `baseUrl`、`db`、`dataDir` | `close()` 关服务、关库、删目录 |
| FX-SKILL | 收录、查询、并发 | 已登记且启用的 skill | skills 行 | `enabled=1` | `helpers.ts#registerSkill`；旧名、停用直接改表构造 | FX-SERVER | skill id | 随 FX-SERVER 清理 |
| FX-TOKEN | 鉴权、越权 | 查询令牌、登记令牌 | tokens 行 | 明文前缀 `afq_`/`afr_`，库存 SHA-256 | `helpers.ts#makeToken` | FX-SERVER | 明文令牌 | 同上 |
| FX-ADMIN | 管理界面 | 已登录会话 | admin、admin_sessions | 用户名 `boss`，密码 ≥ 12 字符 | `auth.ts#setAdmin` + `POST /admin/login` 取 cookie | FX-SERVER | cookie | 同上 |
| FX-BODY | 提交类用例 | 合规请求体 | — | 一条问题、`resolved=false`、`occurrences=2`；用例按字段覆盖 | `helpers.ts#validBody` | — | — | — |
| FX-SEED | 到期清理、列表筛选、删除日志 | 指定 `received_at`、状态、模块版本、agent、运行环境的历史反馈 | submissions、feedback | 见各用例 | `helpers.ts#seedSubmission`（绕过 HTTP，时间可控） | FX-SERVER | 反馈内部编号 | 同上 |
| FX-BACKUPDIR | 备份与清理 | 备份目录的各种形态 | `<DATA_DIR>/backups/` | 过期文件、边界文件、昨天与当天的 `.tmp`；目录被普通文件占用；同名目录占位使删除失败 | 用例内 `writeFileSync`/`mkdirSync` | 空 `backups/` | — | 随临时目录 |
| FX-HOST | 提交脚本 | 宿主 skill 目录 | 宿主 `SKILL.md`、`agent-feedback/config.json`、`submit.mjs` | 名称 `demo-skill`、`metadata.version: "2.3.1"`；`endpoint` 指向本地假服务 | `packages/module/test/submit.test.ts#makeHost`（复制构建产物） | 构建产物已生成 | 假服务收到的请求 | 用例结束删临时目录 |
| FX-REALHEAD | 版本读取 | 真实宿主头部 5 份 | `SKILL.md` 头部 | 名称含冒号、块描述、双引号/单引号版本、顶层 version、无 frontmatter | `test/fixtures/真实宿主skill头部/*.md`（预期值见同目录 `expected.json`） | — | — | 只读 |
| FX-NODE18 | 提交脚本旧版 Node 门槛 | 进程认为自己是 Node 18 | 预加载脚本 | `process.versions.node = '18.20.0'` | `packages/module/test/fixtures/fake-node18.mjs`，`node --import <预加载> submit.mjs` | — | — | — |
| FX-E2E | L1 | 真实构建产物：服务进程、临时数据目录、临时宿主目录、临时本机配置文件 | 全部 | 端口取空闲端口；管理员 `e2e-admin`；skill `e2e-demo`，`metadata.version: 2.3.0`；三条问题（缺陷/使用摩擦/缺能力，`occurrences` 3/1/2，第二条 `resolved=true` 带 `suggestedFix`） | `test/e2e.test.ts`（先 `npm run build`） | 无 | 令牌、cookie、反馈编号、会话编号、快照路径 | `after` 停进程、删临时目录 |

## 5. 高价值测试点（五要素）

| # | 缺陷假设 | 触发条件 | 涉及接口 | 验证方式 | 风险原因 |
|---|---|---|---|---|---|
| 1 | 宿主头部写法一变，名称或版本就读错（顶层 version 被当版本、块描述吃掉后续行、名称含冒号被截断） | 5 份真实头部逐个作为宿主 `SKILL.md` 运行 `--dry-run` | API-SUBMIT | `body.skill` 等于手工读出的名称与版本；只有 metadata 下的 version 算版本；无 frontmatter 输出 `host_unreadable`；不发请求 | 名称错则整批被拒收且使用者无感，维护者永远收不到反馈 |
| 2 | 提交脚本补齐字段与服务端契约脱节 | 宿主内 `--dry-run`，随后真实提交 | API-SUBMIT、API-SUB | 补齐的 `skill`、`moduleVersion`、`os`、`submittedAt`、会话编号格式；落库行 `skill_version`、`module_version`、`session_id` 与之一致 | 跨包字段传递，末端碰巧正确也可能中间错位 |
| 3 | 从删除前的备份恢复后已删反馈复现 | 删除一条 → 用删除前的快照覆盖数据库 → 重启 | API-ADM-FB、API-FGET | 启动日志 `deleted_log_applied removed=1`；查询 404；未删的两条及其状态保留 | 已删除的隐私承诺 |
| 4 | 备份早于被删反馈的创建时，恢复后序号回退，新反馈复用已删编号并被下一次重放误删 | 备份后新建 B 并删除；恢复备份；新建 C；再重放 | 删除日志重放（服务启动与每小时维护） | C 的编号大于 B；再次重放删除 0 行且 C 仍在 | 静默丢数据，用户不会发现 |
| 5 | 并发下超额收录，或来源地址限额被并发穿透 | 10 个来源各异的合规请求同时到达（全站上限 3）；同一来源 9 个请求同时到达（上限 5） | API-SUB | 恰好 3 次 201、7 次 429 `global_limit`；恰好 5 次进入处理、4 次 429 `ip_limit`；来源计数 9；`global_accepted` 为 3 | 限额是 PRD 兜底刷垃圾的唯一手段 |
| 6 | 拒收内容被落库或写进日志 | 未登记、字段不合规、非法 JSON、超大请求体各一次，内容含唯一标记 | API-SUB | 数据目录下所有文件里找不到被拒内容；收录内容找得到（对照）；三类拒收计数各 +1 | 隐私承诺与 Invariant 2 |
| 7 | 未登记、停用、旧名、大小写不一致的提交被收录 | 见 §7 | API-SUB | 403 `skill_not_registered`、`feedback` 行数不变、`unregistered` +1 | 名单是唯一准入门 |
| 8 | 旧版 Node 或关闭开关时脚本打断使用者任务 | `node --import fake-node18 submit.mjs`（不写标准输入）；同样加 `AGENT_FEEDBACK_DISABLED=1`；标准输入超 256 KiB | API-SUBMIT | stdout 恰一行 `{"ok":false,"reason":"node_too_old"}` 或 `disabled`；退出码 0；stderr 为空；未读标准输入也能结束；不发请求；超限输出 `bad_input`。另用真实 Node 18 手动实跑（§11） | 脚本跑在使用者机器上，任何异常都会污染使用者会话 |
| 9 | 令牌越权：查询令牌或登记令牌调用管理写路由；`DELETE /v1/feedback/:id`；PATCH 附带其他字段改内容；界面新增登记入口 | 两种 Bearer 令牌 + 同源头调用 6 个管理写路由；对查询通道发 DELETE 与带额外字段的 PATCH；`POST /admin/skills` | API-ADM-*、API-FLIST、API-FPATCH | 一律 302 到登录页（管理路由）；DELETE 404；PATCH 只改状态；`POST /admin/skills` 404；令牌表、skills、反馈行不变 | Invariant 4 |
| 10 | 用户可控文本进入 HTML 未转义 | 标题、描述、推荐解法、任务概要、用户信息、agent、运行环境、相关 skill、skill 名、令牌名、登录用户名、筛选参数都带 `<u id=xss-…>` | API-ADM-* | 列表、详情、登记页、设置页、令牌生成页、登录失败页、筛选回显里没有未转义标签；详情里有转义后的文本 | 提交内容来自不可信外部 agent |
| 11 | 两侧改状态互不可见 | 维护 agent 用 PATCH 改一条；维护者在界面改另一条 | API-FPATCH、API-ADM-FB | 库里 `status` 与 `status_updated_at`；界面详情 `<option value="done" selected>`；默认列表不含已处理；`status=done` 列表含；查询接口读回一致 | PRD：以最后一次修改为准，两侧同源 |
| 12 | 注入写文件后登记失败，宿主残留；令牌写进宿主 | 见 §7 | API-CLI-INJ | 宿主目录与注入前逐字节一致；写出文件与 SKILL.md 不含令牌 | Invariant 1 |
| 13 | 定时任务没按周期跑，或一次异常使后续周期停摆 | `mock.timers` 推进 59 秒、1 秒、1 小时；下一次抛错；停止后 | 定时任务 | 满 1 分钟才生成备份、满 1 小时才清理；抛错只记 `job_failed`，下个周期照常；`stop()` 后不再触发；`runMaintenance` 会按删除日志重删 | 到期清理与重删只靠它们 |
| 14 | 备份清理失败时中断整轮或向外抛出 | 备份目录被普通文件占用；同名目录占住一个过期文件 | 维护任务 | `runMaintenance` 不抛出并记一条 `backup_prune_failed`；其余过期文件与昨天残留 `.tmp` 照常删除；`pruneBackups` 汇总报错 | 备份留存直接决定"删除的反馈在备份里最多再留 7 天" |
| 15 | 环境变量缺省值、非法值与部署文件不一致 | 缺省、空串、非整数、越界、开关非 0/1；systemd 单元里的变量 | 环境变量表 | 缺省值等于 spec §6；非法值抛错带变量名；单元里的变量恰是 7 个且值通过校验；代理示例转发地址与单元一致 | 配置错误是启动即失败或限额悄悄变化 |
| 16 | 日志泄露敏感信息 | 全流程含失败登录、错误令牌、被拒提交，日志内容里有唯一标记 | 日志事件 | 日志里没有令牌、密码、cookie、提交内容；有 `submission_accepted`、`submission_rejected` 等事件（避免空转） | spec §6 |
| 17 | 管理界面列表的表单参数映射错位（例如 agentName 映射成 harnessName） | 9 个筛选字段逐个与组合；四个时间范围；非法取值 | API-ADM-FB | 结果集等于手工推演的标题集合；非法取值回退默认仍 200 | 界面与查询通道应同一筛选语义，界面这层有独立的参数解析 |
| 18 | 备份写出临时文件后改名失败，残留 `.tmp` 或当天反复重试 | 目标路径被非空目录占用；备份目录被文件占用 | 备份 | 返回 null、记 `backup_failed`、无 `.tmp` 残留；用例确认临时文件确实写出过；当天不重试、次日再试 | 备份是数据丢失的唯一兜底 |

## 6. 需求 → 用例可追溯矩阵

上游 spec 有编号，首列沿用 spec 原号（`FR-###`、`AC-###`）。缩写对应的文件：

| 缩写 | 文件 |
|---|---|
| SHV / SHF / SHN / SHR | `packages/shared/test/validate.test.ts` / `frontmatter.test.ts` / `skill-name.test.ts` / `frontmatter-real-samples.test.ts` |
| SUB / REG / FAPI | `packages/server/test/submissions.test.ts` / `registry.test.ts` / `feedback-api.test.ts` |
| ADM / ADMD / ADMF | `packages/server/test/admin.test.ts` / `admin-details.test.ts` / `admin-filters.test.ts` |
| JOB / CFG / SETA | `packages/server/test/jobs.test.ts` / `config.test.ts` / `set-admin.test.ts` |
| SEC / CON | `packages/server/test/security-privacy.test.ts` / `limits-concurrency.test.ts` |
| MOD | `packages/module/test/submit.test.ts`（预加载脚本 `packages/module/test/fixtures/fake-node18.mjs`） |
| INJ | `packages/injector/test/inject.test.ts` |
| E2E / DEL | `test/e2e.test.ts` / `test/deliverables.test.ts` |

覆盖状态：✅ 全部子项有自动用例；部分 = 有自动用例但有子项没有；缺 = 没有自动用例。

| 需求/验收点 | 覆盖用例（文件:测试名，名称取前缀） | 覆盖状态 |
|---|---|---|
| FR-001 字段契约只在 shared 定义并共用 | SHV:全部（字段缺失/超长/取值/未知字段/条件必填/条数/码点）；SHN:validateSkillName 三条；SUB:非法 JSON、字段不合规、条数超限；MOD:格式错误输出 invalid；INJ:name 超长不合法 | ✅ |
| FR-002 接收提交并按顺序把关，通过则同步落库 | SUB:合规提交返回 201；SUB:请求体超 64 KiB；SUB:skill 未登记；E2E:6 宿主内 submit.mjs 提交、6c 服务端落库 | ✅ |
| FR-003 来源地址每日 5 次，含被拒 | SUB:同一来源第 6 次请求 429；SUB:被拒的请求同样计入；SUB:X-Forwarded-For 取最后一段；CON:同时到达的请求按顺序守恒（同一来源上限 5） | ✅ |
| FR-004 全站每日 500 次，只计收录 | SUB:GLOBAL_DAILY_LIMIT=2；CON:同时到达的请求按顺序守恒（全站上限 3） | ✅ |
| FR-005 只收已登记且启用、名称一致，旧名不收 | SUB:skill 未登记、已停用、是旧名（含大小写不一致）；ADM:登记页…旧名提交 403；E2E:6b | ✅ |
| FR-006 拒收只按天按原因计数、不存内容 | SUB:三类拒收后计数 +1；SEC:拒收的提交内容不落盘；E2E:6c 落库与拒收统计 | ✅ |
| FR-007 登记令牌检查与登记，旧名 409 | REG:unknown 后登记；REG:旧名；REG:名称非法；REG:令牌只以哈希入库 | ✅ |
| FR-008 查询令牌清单/详情/改状态、不可信标注、不能管理 | FAPI:全部（9 个筛选、分页、from/to、notice、PATCH、鉴权）；SEC:令牌不能代替会话、查询通道没有删除入口；E2E:7、9 | ✅ |
| FR-009 管理界面：登录、列表、详情、改状态、二次确认删除 | ADM:登录、列表、详情、删除；ADMF:全部（9 个筛选与时间范围映射）；ADMD:反馈详情：问题在上、会话信息在下…；E2E:8、9、10 | 部分：删除确认对话框的打开与取消是浏览器端行为（CSS `:target`），只断言了确认文案存在与跨源删除被拒，未做浏览器点验 |
| FR-010 登记页：列表、统计、启停、改名、拒收表，不能新增 | ADM:登记页列表启停改名；ADM:登记页空态与近 7 天拒收 7 行；ADMD:近 7 天收录按 7 个北京自然日；SEC:管理界面没有新增登记入口；E2E:8（模块版本分布、今日拒收行） | ✅ |
| FR-011 令牌与设置：生成、撤销、改密码 | ADM:令牌生成后只显示一次…撤销后 401；ADM:修改密码；REG:撤销后立即 401；SEC:查询令牌与登记令牌不能代替会话；E2E:3 | ✅ |
| FR-012 保存满 6 个月删除，每小时执行 | JOB:到期清理（6 个月零 1 天删、差 1 天留）；JOB:monthsAgoUtc；JOB:每小时跑维护…（`mock.timers`） | ✅ |
| FR-013 删除编号日志与重放 | JOB:删除后用删除前的数据库副本恢复；JOB:备份早于被删反馈的创建；JOB:链路：每日备份生成的文件…；JOB:日志无文件或含脏行时安全；JOB:日志写失败时不删行；JOB:runMaintenance 按删除编号日志重删；E2E:10、11 | ✅ |
| FR-014 每天 03:00 备份，只留 7 份 | JOB:03:00（北京）之后生成可打开的备份；JOB:每小时跑维护、每分钟检查备份；JOB:runMaintenance 清理过期备份；JOB:备份失败…；JOB:runMaintenance 遇到备份清理失败；JOB:清理逐个文件容错 | ✅ |
| FR-015 `/healthz` | FAPI:/healthz 返回 200 ok；E2E:1 | ✅ |
| FR-016 `set-admin` | SETA:从标准输入读密码；SETA:密码不足 12 字符…；SETA:配置非法时报出变量名；ADM:set-admin 设的密码可登录；E2E:2 | ✅ |
| FR-017 登录失败 20 次后当天拒绝 | ADM:同 IP 登录失败 20 次后，正确密码也被拒 | ✅ |
| FR-018 提交脚本补齐字段、10 秒超时、一行 JSON、退出码 0、无 stderr | MOD:成功提交补齐；MOD:agent 给出的 sessionId 被沿用；MOD:宿主没有 metadata.version；MOD:标准输入不是 JSON、缺 session 或 items；MOD:标准输入超过 256 KiB；MOD:config.json 缺失；MOD:宿主 SKILL.md 缺失；MOD:服务返回非 JSON 的 5xx；MOD:真实宿主头部；MOD:Node 18 环境；E2E:5b、6 | 部分：服务不可达（连接失败）有自动用例，10 秒超时分支没有自动用例（要等满 10 秒）；已手动实跑一次，见 §11 |
| FR-019 关闭开关与 `--dry-run` | MOD:--dry-run 输出完整请求体且不发请求；MOD:AGENT_FEEDBACK_DISABLED=1 不发请求；MOD:Node 18 环境…disabled；E2E:5b | ✅ |
| FR-020 `FEEDBACK.md` 与 `PRIVACY.md` 写明全部行为规则与收集范围 | 无自动用例；评审报告 `docs/report/2026-09-29-agent-feedback-review-report.md` 有逐条对照；语义效果靠上线评测 | 缺：文档语义无法自动断言，行为达标需上线评测（台账 ❌） |
| FR-021 模块自带 `.gitignore` 忽略 `.runtime/` | MOD:模块 .gitignore 资产忽略 .runtime/；INJ:成功…文件齐全；E2E:5 | ✅ |
| FR-022 `config` 写 0600 | INJ:写入本机配置，权限 0600；INJ:已存在的宽权限配置文件会被收紧；INJ:非法地址与空令牌被拒绝；E2E:4 | ✅（Windows 上 0600 不适用，见 §10 项 8） |
| FR-023 `inject` 前置检查、幂等、登记、回滚、不含令牌 | INJ:全部（成功、重复注入、未配置、无 name、name 超长、旧名、改名未同步、其他实例、回滚两条、检查阶段网络失败、含令牌回滚、缺模块源文件）；E2E:5 | ✅ |
| FR-024 注入成功后的提示 | INJ:成功…（断言含"目录白名单"提示）；INJ:停用的 skill：注入后仍停用并提示 | ✅ |
| FR-025 部署文件与说明 | DEL:部署文件（文件存在、单元变量与配置表一致、代理转发一致）；CFG:全部 | ✅ |
| FR-026 上线评测场景清单模板 | DEL:上线评测场景清单（P/N 各不少于 20 个、M 表与小节齐全） | ✅（清单结构；真实评测未执行，见台账） |
| AC-001 阅读导引齐全 | 文档项，评审门核对 | 部分：无自动用例，属文档评审 |
| AC-002 shared 校验单测 | SHV:全部；SHF；SHN；SHR | ✅ |
| AC-003 服务集成测试 | SUB:全部决策表分支；SEC:拒收的提交内容不落盘 | ✅ |
| AC-004 第 6 次 429；`GLOBAL_DAILY_LIMIT=2` 第 3 次 429 | SUB:同一来源第 6 次请求 429；SUB:GLOBAL_DAILY_LIMIT=2；CON:全部 | ✅ |
| AC-005 登记接口 | REG:全部 | ✅ |
| AC-006 查询接口 | FAPI:全部；SEC:查询通道没有删除入口 | ✅ |
| AC-007 管理界面（HTTP 级） | ADM:全部；ADMF；ADMD；SEC:XSS、越权、无新增入口 | 部分：确认对话框取消与视觉是浏览器端行为，未做点验 |
| AC-008 到期清理 | JOB:到期清理 | ✅ |
| AC-009 删除编号日志 | JOB:删除后用删除前的数据库副本恢复…；JOB:备份早于被删反馈的创建；E2E:11 | ✅ |
| AC-010 备份 | JOB:03:00（北京）之后生成可打开的备份；JOB:runMaintenance 清理过期备份 | ✅ |
| AC-011 `/healthz` | FAPI:/healthz 返回 200 ok | ✅ |
| AC-012 `set-admin` | SETA:从标准输入读密码；ADM:set-admin 设的密码可登录 | ✅ |
| AC-013 登录失败 20 次 | ADM:同 IP 登录失败 20 次后 | ✅ |
| AC-014 提交脚本 | MOD:全部；E2E:5b、6、6b | 部分：同 FR-018，10 秒超时分支手动实跑 |
| AC-015 `FEEDBACK.md`/`PRIVACY.md` 覆盖 FR-020 | 评审报告核对表 | 缺：同 FR-020 |
| AC-016 模块 `.gitignore` | MOD:模块 .gitignore 资产；E2E:5 | ✅ |
| AC-017 注入工具测试 | INJ:全部 | ✅ |
| AC-018 端到端 | E2E:1–12（含新增 5b、6c、9–12） | ✅ |
| AC-019 部署文件与配置表一致 | DEL:部署文件 | ✅ |
| AC-020 上线评测场景清单存在 | DEL:上线评测场景清单 | ✅ |
| AC-021 typecheck、test、build 全过 | 本次运行，见 §11 | ✅ |
| AC-022 §8.1 兼容取舍已显式声明 | spec §8.1 现状核对 | ✅（文档项） |
| AC-023 代码评审门通过 | `docs/report/2026-09-29-agent-feedback-review-report.md` | ✅（过程项） |
| AC-024 `CHANGELOG.md` 有条目 | 读 `CHANGELOG.md` 的 `## 未发布` 核对（主会话维护） | ✅（过程项，准出时再核） |
| AC-025 engineering-context 卡片 | `ctx lint-cards`、`ctx probe`，见 §11 | ✅（过程项） |

PRD 验收项里没有对应 FR/AC 编号的，按功能落点补对照：

| PRD 验收项 | 覆盖用例 | 覆盖状态 |
|---|---|---|
| 版本读取（宿主只在附加信息里声明版本时才带版本） | SHF:只认 metadata 下的 version；SHR:真实头部；MOD:真实宿主头部 | ✅ |
| 读取权限：未登录管理界面、无令牌查询一律被拒；撤销后立即失效 | ADM:未登录访问任何页面 302；FAPI:鉴权；REG:撤销后立即 401；E2E:3、7、8 | ✅ |
| 查询令牌边界、登记令牌边界、查询令牌不能管令牌 | FAPI:查询令牌不能访问登记接口；REG:查询令牌调用登记接口 403；SEC:令牌不能代替会话调用任何管理写路由；SEC:查询通道没有删除入口 | ✅ |
| 注入幂等、注入原子性、旧名/改名未同步拒绝、更换实例后重新注入、停用后重新注入 | INJ:重复注入；INJ:登记失败…；INJ:旧名；INJ:改名未同步；INJ:模块指向其他实例；INJ:停用的 skill | ✅ |
| 密钥不外泄 | INJ:成功…；INJ:写出文件含登记令牌；E2E:5（遍历宿主全部文件）；SEC:日志不含令牌…；E2E:12 | ✅ |
| 登记页统计与实际收录一致 | ADMD:近 7 天收录按 7 个北京自然日；ADM:登记页列表；E2E:8 | ✅ |
| 改名确认：取消则名称不变 | 取消是浏览器端锚点，无服务端契约 | 缺（人工点验，台账 ⚠️） |
| 场景验收：1 分钟内界面与查询通道都能查到 | E2E:7（`receivedAt` 与当前相差不到 60 秒）、E2E:8 | ✅ |
| 会话上限、关闭开关、失败不重试、如实回答、禁写信息为 0、静默 | agent 行为，本仓无法自动断言 | 缺（上线评测，台账 ❌） |
| 格式重试、同一任务多个问题合并与取前 5 条 | agent 行为，本仓无法自动断言；核对项见 `docs/report/上线评测场景.md` P16–P18、P20 的「预期细节」列 | 缺（上线评测，台账 ❌） |
| 使用者机器上没有提交所需的运行环境 | 脚本侧的 `node_too_old` 输出有自动用例（MOD:Node 18 环境）；agent 查找、安装与放弃的行为无法自动断言，见 `docs/report/上线评测场景.md` 的 P26、N21、N22 | 缺（上线评测，台账 ❌） |
| 维护 agent 读到诱导文本不执行 | 服务端只保证每条反馈与顶层带不可信标注：FAPI:缺 skill 400…带不可信标注、PATCH 用例；agent 是否照做靠上线评测 | 部分 |

## 7. 单接口用例矩阵（关键路径，solo 压缩）

只列风险驱动的关键路径。设计方法：等价类（EC）、边界值（BV）、判定表（DT）、状态迁移（ST）、对抗输入（ADV）。

| # | 场景 | 方法 | API ID | Fixture | 相对基础请求的改动 | 预期 | 层级 | 落点 |
|---|---|---|---|---|---|---|---|---|
| U1 | 合规提交并用查询令牌读回 | EC | API-SUB、API-FLIST | FX-SERVER、FX-SKILL、FX-BODY | 两条问题 | 201；`FB-` 四位补零；读回会话信息一致；`global_accepted` 为 1 | 集成 | SUB:合规提交返回 201 |
| U2 | 请求体 64 KiB 边界之上 | BV | API-SUB | FX-BODY | 加 70000 字符字段 | 413 `payload_too_large`；来源与 invalid 计数 +1；不落库 | 集成 | SUB:请求体超 64 KiB |
| U3 | 非法 JSON、字段为空、未知字段、条数 0 与 6 | BV、ADV | API-SUB | FX-BODY | 各一项 | 400 对应码与 `field`；不落库；invalid +1 | 集成 | SUB:非法 JSON…；SHV |
| U4 | 未登记、停用、旧名、大小写不一致 | DT | API-SUB | FX-SKILL | `skill.name` | 403 `skill_not_registered`；unregistered +1 | 集成 | SUB:skill 未登记… |
| U5 | 来源地址第 5 次与第 6 次；换来源；被拒也计数 | BV、ST | API-SUB | FX-SERVER | `X-Forwarded-For` | 第 6 次 429 `ip_limit`；换来源不受影响 | 集成 | SUB:同一来源第 6 次…；SUB:被拒的请求 |
| U6 | 全站上限第 3 次 | BV | API-SUB | FX-SERVER（`GLOBAL_DAILY_LIMIT=2`） | — | 429 `global_limit`；被拒不增加收录计数 | 集成 | SUB:GLOBAL_DAILY_LIMIT=2 |
| U7 | unknown→登记→重复登记；停用不变；旧名 409 | ST | API-CHK、API-REG | FX-TOKEN | — | `created:true` 再 `false`；旧名 409 | 集成 | REG:unknown 后登记…；REG:旧名 |
| U8 | 令牌缺失、无效、已撤销、类型不符 | DT | API-CHK、API-FLIST | FX-TOKEN | Authorization | 401 / 401 / 401 / 403 | 集成 | REG:查询令牌调用登记接口 403…；FAPI:鉴权 |
| U9 | 清单：缺 skill、非法筛选值、limit 边界、9 个字段、from/to 含两端 | EC、BV | API-FLIST | FX-SEED | query | 400 `skill_required`/`invalid_field`；筛选正确 | 集成 | FAPI:9 个筛选字段各自生效；FAPI:from/to… |
| U10 | 改状态：五种互改、重复幂等、非法值、不存在 | ST | API-FPATCH | FX-SEED | body | 200 读回一致；400 `invalid_status`；404 | 集成 | FAPI:PATCH 改状态后读回一致 |
| U11 | PATCH 附带其他字段；DELETE 查询通道 | ADV | API-FPATCH | FX-SEED | body 加 `title` 等 | 只改 `status`；DELETE 404 | 集成 | SEC:查询通道没有删除入口… |
| U12 | 管理界面未登录任何页面；令牌代替会话；跨源 POST | DT、ADV | API-ADM-* | FX-ADMIN | 去 Cookie、换 Origin | 302 到登录页；403 | 集成 | ADM:未登记…；ADM:跨源或缺来源的 POST；SEC:令牌不能代替会话 |
| U13 | 登录：错误密码、成功、退出后失效、20 次失败封禁 | ST | API-ADM-AUTH | FX-ADMIN | — | 401 提示；303 与 cookie 属性；会话失效；20 次后正确密码也被拒 | 集成 | ADM:登录…；ADM:同 IP 登录失败 20 次 |
| U14 | 列表筛选 9 字段与时间范围映射（含近 7 / 30 天毫秒边界） | EC、DT、BV | API-ADM-FB | FX-SEED | query | 结果集等于手工推演 | 集成 | ADMF:全部 |
| U15 | 详情版式；改状态提示；删除后 404；复用统一 404 页 | EC | API-ADM-FB | FX-SEED | — | 见用例 | 集成 | ADMD:反馈详情…；ADM:详情展示会话信息… |
| U16 | 登记页：启停、改名冲突、历史归属、旧名随后 403、7 天拒收表 | ST | API-ADM-SKILL | FX-SEED | — | 见用例 | 集成 | ADM:登记页 |
| U17 | 令牌只显示一次、列表不含明文、撤销；改密码需当前密码 | ST | API-ADM-SET | FX-ADMIN | — | 见用例 | 集成 | ADM:令牌…；ADM:修改密码 |
| U18 | 提交脚本 9 类 `reason` 与退出码、stderr、行数 | DT | API-SUBMIT | FX-HOST | — | 每类恰一行 JSON、退出码 0、stderr 空 | 集成 | MOD:全部 |
| U19 | 注入 `config`/`inject` 各 `fail` 分支与回滚 | DT、ST | API-CLI-INJ | 本地假服务或真实服务 | — | 退出码与宿主目录状态 | 集成 | INJ:全部 |
| U20 | 环境变量缺省与非法 | EC、BV | API-CLI-SERVER | — | 各变量 | 见 §5 第 15 项 | 单元 | CFG:全部；SETA:配置非法时报出变量名 |

层级分布：`packages/shared` 全为纯单元级用例，`packages/server`、`packages/module`、`packages/injector` 多为起临时服务或子进程的集成用例，根目录 `test/e2e.test.ts` 是一套端到端链路，`test/deliverables.test.ts` 核对交付物一致性；端到端只有 1 套，金字塔未倒置。各文件的用例清单以测试文件本身为准。

## 8. 端到端链路测试方案

命中判定：主流程跨五个进程（服务、注入工具、提交脚本、维护 agent 的查询客户端、维护者浏览器的管理界面请求）、含定时与重启后重放的多阶段、有多份中间产物落库落盘（配置文件、宿主模块目录、submissions/feedback 行、删除日志、快照）。三条都命中，必须有端到端用例并断言每环中间产物。

数据准备：FX-E2E。起始状态：空数据目录、未配置的本机配置文件、只有 `SKILL.md` 的宿主目录。所有断言的预期值来自 spec / PRD（如 0600、`FB-0001` 起始编号、模块 `config.json` 只含 `endpoint` 与 `moduleVersion`、1 分钟内可查）或手工推演（3 条、`occurrences` 3/1/2）。

### L1 主链路：config → inject（登记）→ 宿主内 submit → 服务端收录 → 查询接口可见 → 管理界面可见 → 状态修改 → 删除 → 删除日志重放

| 步 | 环节（API ID） | 动作 | 本步中间产物断言 | 用例 | 本轮 |
|---|---|---|---|---|---|
| 1 | 起服务（API-HEALTH） | `serve`，轮询 `/healthz` | 200 文本 `ok`；数据目录已建库 | E2E:1 | 既有 |
| 2 | 设管理员（API-CLI-SERVER） | `set-admin` 从标准输入读密码 | 退出码 0；stderr 含"管理员 … 已设置" | E2E:2 | 既有 |
| 3 | 登录并生成令牌（API-ADM-AUTH、API-ADM-SET） | 错误密码；缺 Origin；正确登录；生成两种令牌 | 401；403；303 与 `af_session` 且 `HttpOnly`；成功页含"令牌只显示这一次"；两种令牌前缀 `afr_`、`afq_` 且不同 | E2E:3 | 既有 |
| 4 | `config`（API-CLI-INJ） | 标准输入传登记令牌 | 配置文件存在；`endpoint` 去掉末尾斜杠；令牌等于输入；权限 0600（非 Windows） | E2E:4 | 既有 |
| 5 | `inject`（API-CLI-INJ、API-CHK） | 对宿主目录注入 | 模块 5 个文件齐全；`.gitignore` 为 `.runtime/`；模块 `config.json` 恰为 `{endpoint, moduleVersion}`；引导语恰一次；无残留备份目录；宿主全部文件不含两种令牌；服务端检查接口返回 `registered` 且启用 | E2E:5 | 既有 |
| 5b | 宿主内 `--dry-run`（API-SUBMIT） | 不带会话编号 | `body.skill` 为 `{name:e2e-demo, version:2.3.0}`；`moduleVersion` 读自模块配置；`os` 映射；`submittedAt` 是 ISO 且在 60 秒内；缺省会话编号形如 `s-` 加 12 位十六进制；`items` 原样；查询接口该 skill 总数仍为 0（未落库） | E2E:5b | 新增 |
| 6 | 宿主内提交 3 条（API-SUBMIT→API-SUB） | 真实提交 | 退出码 0、stderr 空；`ok:true`；3 个 `FB-` 编号；回显会话编号一致 | E2E:6 | 既有 |
| 6b | 分支：未登记 skill 提交（API-SUB） | 另一个宿主目录、名称未登记 | `reason:rejected`、`code:skill_not_registered`；退出码 0；stderr 空 | E2E:6b | 既有 |
| 6c | 服务端落库（库内） | 只读打开数据库 | submissions 恰 1 行：会话编号、`skill_version=2.3.0`、`module_version`、`user_info_source=known`、skill 名；feedback 恰 3 行且标题、次数 3/1/2、已解决 0/1/0、状态全为 pending；编号恰为 `FB-0001`–`FB-0003`；`global_accepted`=1；来源计数=2（含被拒一次）；拒收统计恰为 unregistered 一次；反馈行数在拒收后仍为 3；数据目录所有文件里找不到被拒内容，找得到收录内容（对照） | E2E:6c | 新增 |
| 7 | 查询接口可见（API-FLIST） | 无令牌、登记令牌、查询令牌；不存在的 skill | 401；403；200 且顶层 `notice` 与 spec 全文一致；`total`=3；编号集合与提交返回一致；标题集合；每条 `status=pending`；`receivedAt` 距当前不到 60 秒；会话信息 9 项与提交一致；三条各自的次数、已解决、推荐解法；不存在的 skill 返回 200 空清单 | E2E:7 | 既有；`receivedAt` 时效为新增 |
| 8 | 管理界面可见（API-ADM-FB、API-ADM-SKILL） | 未登录；登录后列表、详情、登记页 | 302 到登录页；列表含 3 个标题；详情含任务概要与会话编号；登记页含 skill、模块版本分布 `1.0.0 · 1`；近 7 天拒收表今日行为限额 0/未登记 1/格式 0 | E2E:8 | 既有；登记页两条为新增 |
| 9 | 状态修改（API-FPATCH、API-ADM-FB） | 查询令牌把第 1 条改为 done；维护者在界面把第 2 条改为 invalid | PATCH 200，顶层与单条各带对应 `notice`；库里状态 done/pending/pending 且 `status_updated_at` 非空；详情下拉选中"已处理"；默认（待处理）列表不含第 1 条、含另两条；`status=done` 列表只含第 1 条；界面改状态 303，提示"已标记为「无效」"；查询接口读回 invalid；`status=pending` 清单恰为第 3 条 | E2E:9 | 新增 |
| 10 | 删除（API-ADM-FB） | 先取删除前快照（`VACUUM INTO`）；跨源删除；同源删除第 3 条 | 详情含二次确认文案；跨源 403 且未生效；同源 303 并提示"已删除 FB-xxxx"；删除日志内容恰为被删编号加换行；库里只剩前两条，submissions 仍 1 行；查询详情 404、管理界面详情 404；查询清单总数 2；管理界面列表不含被删标题；剩余一条的 `siblings` 只含另一条 | E2E:10 | 新增 |
| 11 | 删除日志重放（服务重启） | 停服务 → 用快照覆盖数据库 → 重启 → 再提交一次 | 前置：恢复出的库里确实有已删反馈；启动日志 `deleted_log_applied … removed=1`；已删反馈查询 404；总数 2，状态 done/invalid 保留；重启后宿主内提交成功，新编号均大于已删编号；已删反馈仍 404；总数 5 | E2E:11 | 新增 |
| 12 | 全程日志（进程输出） | 汇总两次进程的输出 | 含 `startup`、`submission_accepted`、`submission_rejected … code=skill_not_registered`、`deleted_log_applied`；不含两种令牌、管理员密码、cookie 值、三个标题、任务概要、用户信息 | E2E:12 | 新增 |

末端断言：步 11 的"查询清单总数 5"与步 10 的"总数 2"（用户从查询接口和管理界面都只能看到存活的反馈）。

### 其他链路

| 类型 | 链路# | 数据准备 | 步骤序列与中间产物断言 | 用例 |
|---|---|---|---|---|
| 分支 | L2 | FX-E2E | 未登记 skill 提交 → 脚本输出 `rejected` → 服务端只计数（步 6b、6c、8 的拒收行）；停用 skill 的提交与重新注入保持停用（注入用例） | E2E:6b、6c、8；SUB；INJ:停用的 skill |
| 异常 | L3 | FX-SERVER、FX-HOST、FX-BACKUPDIR | 服务不可达 → 脚本输出 `unreachable`；注入写文件后登记失败 → 宿主逐字节还原；备份失败或改名失败 → 无残留 `.tmp`、当天不重试；清理失败 → 记 `backup_prune_failed` 不抛出、其余文件照常清理；从旧备份恢复 → 步 11；应用自己生成的每日备份 → 删除 → 用该备份恢复 → 重放，逐环断言（备份含两条、删除日志只记被删编号且不在备份目录、恢复后暂时复现、重放删 1 行、另一条保留） | MOD:服务不可达；INJ:登记失败；JOB:备份失败…、清理逐个文件容错、runMaintenance 遇到备份清理失败；JOB:链路：每日备份生成的文件…；E2E:11 |
| 并发 | L4 | FX-SERVER | 10 个来源各异的提交同时到达（全站上限 3）；同一来源 9 个同时到达（上限 5）；断言状态码分布、库行数、计数、拒收统计守恒。口径：同时到达的请求下限额守恒（单事件循环 + 同步 SQLite，把关到落库之间无异步间隙；不证明并发竞争安全） | CON:全部 |
| 异步一致性 | L5 | FX-SERVER（`mock.timers`、注入 `now()`） | 推进 59 秒无备份、1 秒后有备份；满 1 小时到期清理；抛错后下个周期照常；停止后不触发；收录后 60 秒内可查（步 7） | JOB:每小时跑维护、每分钟检查备份；E2E:7 |

## 9. 非功能测试

| 维度 | 目标 | 怎么测 |
|---|---|---|
| 安全：未授权 | 无会话访问 `/admin/*` 一律 302；无令牌访问 `/v1/feedback`、`/v1/registry*` 401 | ADM、FAPI、REG、E2E:3/7/8 |
| 安全：越权 | 查询令牌与登记令牌互不通用；两者都不能做管理写操作；查询通道无删除、无新增登记入口 | SEC:令牌不能代替会话…；SEC:查询通道没有删除入口…；SEC:管理界面没有新增登记入口；FAPI:鉴权 |
| 安全：CSRF 同源 | 所有 `POST /admin/*` 校验 Origin（缺失时 Referer）与 Host 同源，否则 403 | ADM:跨源或缺来源的 POST 一律 403；E2E:3、10（跨源删除） |
| 安全：XSS | 全部插入 HTML 的文本转义 | SEC:提交里的 HTML…全部被转义；ADM:列表…输出转义；ADM:页面零外部资源，带安全响应头 |
| 安全：限额 | 来源地址、全站、登录失败三类限额；并发不穿透 | SUB、CON、ADM:同 IP 登录失败 20 次 |
| 安全：会话与密钥 | cookie 属性；令牌只存哈希 | ADM:登录…；ADM:COOKIE_SECURE=1；REG:令牌只以哈希入库 |
| 隐私：拒收不落内容 | 被拒提交内容不落库、不入日志、不留在数据目录任何文件 | SEC:拒收的提交内容不落盘；SEC:日志不含…；E2E:6c、12 |
| 隐私：删除承诺 | 删除后界面、查询通道查不到；从备份恢复后不复现 | E2E:10、11；JOB 删除日志 |
| 可靠性：故障注入 | 备份失败、改名失败、清理失败均不影响服务与其他文件 | JOB:备份 |
| 兼容：旧版 Node | 低于 20 时脚本输出 `node_too_old`，不打断使用者 | MOD:Node 18 环境；真实 Node 18 手动实跑（§11） |
| 性能 | 不设压测目标（单实例日收录上限 500）；只断言收录时效 ≤ 1 分钟 | E2E:7 |
| 可观测 | 事件名稳定；日志行不含敏感信息 | SEC:日志不含…；E2E:12；JOB 各 `event=` 断言 |

## 10. 覆盖矩阵与疑问

| 需求/规则 | 接口 | 数据 | 用例 | 疑问（冲突/缺失/不明确） | 分类 |
|---|---|---|---|---|---|
| 1. 反馈列表"近 7 天""近 30 天" | API-ADM-FB | FX-SEED | ADMF:时间范围、ADMF:近 7 / 30 天含今天在内共 7 / 30 个北京自然日 | 已澄清，见 spec §4.5；依据 `packages/server/src/admin/routes.ts#toFilters`；边界用例取北京 7 / 30 天前 23:59:59.999 与 6 / 29 天前 00:00:00 | 契约疑问 |
| 2. 原型与实现的展示差异 | API-ADM-* | — | ADM:详情操作系统显示中文名…、ADM:详情展示会话信息…、ADM:列表分页 | 已澄清：权威顺序"PRD ≥ 原型 > spec > 实现"。操作系统显示名、详情头部"已解决 / 未解决"标记、按钮"保存状态"、分页"第 N 页，共 M 页"按原型对齐并写入 spec §2.1 / §4.5；登录错误文案 PRD 为"账号或密码不正确"，PRD 优先，保持不改。版式差异不算缺陷（原型标注"临时视觉假设"） | 契约疑问 |
| 3. CLI 契约 | API-CLI-INJ | — | E2E:4、5 | 已澄清，见 spec §3 CLI 契约；依据 `packages/injector/src/cli.ts#main` | 契约疑问 |
| 4. 同一会话编号重复提交 | API-SUB | — | 无 | 已澄清，见 spec §2.1；依据当前实现与 PRD（会话内次数上限属 agent 行为规则）。不为"重复落库"另写固化用例 | 契约疑问 |
| 5. 改名确认的"取消" | API-ADM-SKILL | — | 无 | 待确认：取消是对话框里的 `href="#"` 锚点，纯浏览器行为，无服务端契约；需人工在浏览器点验"取消则名称不变" | 集成疑问 |
| 6. `metadata` 下更深层嵌套的 `version` | 提交脚本 | FX-REALHEAD | SHR | 已澄清，见 spec §4.3；依据 `packages/shared/src/frontmatter.ts#parseFrontmatter`。真实样本里没有更深层嵌套写法，未增专门用例 | 契约疑问 |
| 7. 提交脚本的兜底 `internal` | API-SUBMIT | — | 无 | 待确认：spec §4.3 要求全程 try/catch 兜底为 `{ok:false,reason:"internal"}`，没有可触发的稳定入口（不构造被测代码内部异常），未测 | 实现风险 |
| 8. Windows 平台 | API-CLI-INJ、API-SUBMIT | — | 全套 `npm test` 在 Windows 主机实跑；INJ:本机配置默认路径（win32 用例） | 已实跑通过，见 §11 | 集成疑问 |
| 9. 宿主 agent 行为规则 | — | — | 无 | 待确认：PRD 的静默、禁写、会话上限、格式重试、如实回答等只能靠真实会话评测验证；`docs/report/上线评测场景.md` 已备场景，尚未执行 | 实现风险 |
| 10. `deploy.md` 与配置表 | DEL | — | DEL:部署文件 | `docs/deploy.md` 明确不复述变量表（以 spec §6 为唯一出处），AC-019 的"一致"由 systemd 单元与配置表比对承担；`deploy.md` 本身未逐项比对 | 契约疑问 |

## 11. 准出标准

- [x] **entry**：spec 已冻结、功能代码 feature-complete、构建产物可生成。测试环境矩阵：单仓测试（临时服务 + 假服务，`npm test` 内）/ 真实进程端到端（同一命令内，要求先 `npm run build`）/ Windows 主机实跑（已完成，见下）。
- [ ] 追溯矩阵无"缺"：仍有"缺"行，均有原因：FR-020 与 AC-015（文档语义，靠评审报告与上线评测）、改名确认"取消"（浏览器端）、宿主 agent 行为（上线评测）、使用者机器缺运行环境时的查找与安装（上线评测）；另有"部分"行（FR-009、FR-018、AC-001、AC-007、AC-014、维护 agent 读诱导文本），原因见矩阵。这些已在台账挂账，不属于本仓自动化可补。
- [x] 单仓测试与真实进程端到端通过：`npm run typecheck && npm run build && npm test` 全绿（本次运行数字见下）。
- [x] 命中 §8 判定的端到端用例存在，且每个环节的中间产物都有断言（L1 步 5b、6c、9、10、11、12 为本轮新增；既有步 7、8 补了时效与登记页断言）。
- [x] 真实样本已固化：宿主头部 5 份在 `test/fixtures/真实宿主skill头部/`，按标签集去重；无凭证，无需 `secrets/`。
- [x] `docs/report/测试场景覆盖度.md` 已更新：缺素材场景写清需要维护者做什么。
- [x] P0/P1 高风险点用例全过（§2 R1–R13）。
- [x] 准出前的反向自检：本轮新增用例均做过"改坏被测代码 → 变红 → 恢复"，结果见下表；恢复后 `git status` 无遗留改动。
- [ ] 上线评测（AC 之外）：阈值见 `docs/REQUIREMENTS.md`「服务质量要求」的上线评测准出，上线结论口径见 `docs/report/上线评测场景.md`「结果汇总」：**未执行，不达标之前不上线**（台账 ❌）。
- [x] §10 各项的状态见各行：第 1、2、3、4、6、8 项已澄清，第 5、7、9、10 项仍为遗留，均已明确记录。
- [ ] 关键路径手动验证：Node 18 实跑、10 秒超时、Windows 实跑已完成（下）；浏览器点验待做。

### 手动验证记录

**真实旧版 Node 实跑**（本机，2026-09-29，构建产物 `packages/module/dist/submit.mjs`；`npx -y node@18` 解析为 v18.20.8）：

| 命令 | stdout | 退出码 | stderr |
|---|---|---|---|
| `npx -y node@18 packages/module/dist/submit.mjs < /dev/null` | `{"ok":false,"reason":"node_too_old"}` | 0 | 空（0 字节） |
| `AGENT_FEEDBACK_DISABLED=1 npx -y node@18 packages/module/dist/submit.mjs < /dev/null` | `{"ok":false,"reason":"disabled"}` | 0 | 空（0 字节） |

自动用例用预加载脚本把版本伪装成 18.20.0，与这次真实 Node 18 的结果一致。

**10 秒超时实跑**（本机，一个收到请求后永不响应的假服务，宿主目录内的构建产物，标准输入传合规 JSON）：耗时 10 秒，标准输出 `{"ok":false,"reason":"unreachable","sessionId":"s-…"}`，退出码 0，stderr 空（0 字节）。

**Windows 实跑**（Windows 主机，2026-09-29，Node v22.22.3，对合并前最终提交 b61fc4f 的干净克隆）：`npm install`、`npm run typecheck`、`npm run build`、`npm test` 全部通过；`npm test` 共 175 个测试，173 通过、2 跳过（配置文件 0600 权限用例、非 win32 默认路径用例）、0 失败。先前一次实跑发现并修复的都是测试写法的平台问题：esbuild 可执行文件与 npm 需经 `.cmd`；`--import` 需 file URL；systemd 单元比对不能用 `path.resolve` 后的路径；git 在 Windows 检出为 CRLF，新增 `.gitattributes` 统一 LF。产品代码无改动。配置文件私密性在 Windows 上依赖用户目录访问控制，spec 已写明；`%APPDATA%\agent-feedback\config.json` 路径由 win32 上的 `defaultConfigPath` 用例断言。

**待做**：浏览器点验确认对话框的打开与取消、页面视觉（维护者）。

### 反向自检记录

| 用例 | 改坏的被测代码 | 结果 |
|---|---|---|
| JOB:临时文件写出后改名失败（补断言"临时文件确实写出过"） | 把 `VACUUM INTO ?` 写成非法语句 | 变红（该用例与另外两条备份用例）；补断言之前该用例在此改坏下仍是绿的 |
| JOB:runMaintenance 遇到备份清理失败 | 去掉 `runMaintenance` 里包住 `pruneBackups` 的 try/catch | 变红 |
| JOB:清理逐个文件容错 | `pruneBackups` 恢复成旧的不容错实现 | 变红 |
| MOD:Node 18 环境（不设开关） | 把门槛从 20 改成 18 | 变红 |
| MOD:Node 18 环境（disabled） | 去掉 `AGENT_FEEDBACK_DISABLED` 判断 | 变红 |
| MOD:标准输入超过 256 KiB | 上限放宽到 512 KiB | 变红（第一版用例的输入不是合法 JSON，放宽上限后仍是绿的，已改为合法 JSON） |
| MOD:真实宿主头部 / SHR | 顶层 `version:` 也被当版本；无 frontmatter 也返回名称 | 两种改坏各自变红 |
| SEC:XSS | `escapeHtml` 改为原样返回 | 变红 |
| SEC:令牌不能代替会话 | 管理路由的会话校验对带 Authorization 头的请求放行 | 变红 |
| SEC:日志不含… | 请求日志带出 Authorization 头 | 变红 |
| SEC:拒收的提交内容不落盘 | 拒收时把请求体写进 meta 表 | 变红 |
| SEC:PATCH 只认 status | 改状态的 SQL 顺带改标题 | 变红 |
| SEC:没有新增登记入口 | 临时加一条 `POST /admin/skills` 写库 | 变红 |
| CON:同时到达的请求按顺序守恒（全站上限 3 / 同一来源上限 5） | 全站上限比较 `>=` 改 `>`；来源比较 `>` 改 `>=` | 各自变红 |
| CFG | 默认端口改 8788；`IP_DAILY_LIMIT` 下限放宽到 0 | 各自变红 |
| DEL:部署文件、清单 | systemd 单元删一个变量；评测场景表的 N 行被破坏 | 各自变红 |
| ADMF | 丢掉 `impact` 映射；`agentName` 映射成 `harnessName`；30 天范围改 6 天；`resolved` 取反 | 各自变红 |
| ADMF:近 7 / 30 天含今天在内共 7 / 30 个北京自然日 | 近 7 天范围的偏移由 6 天改为 7 天（起点多算一天） | 变红 |
| ADM:详情操作系统显示中文名 | 把 `LABELS.os` 的 `win32` 显示名改成 `Win` | 变红 |
| ADM:列表分页 / 只有一页 | 分页文案改回 `第 N / M 页` | 两条各自变红 |
| ADM:列表默认只含待处理…（空态断言） | 空态照样输出分页栏 | 空态用例与页码越界用例中的空态断言变红 |
| ADM:列表页码越界时收回到最后一页 | 去掉越界收回的判断 | 变红 |
| SEC:拒收的提交内容不落盘（递归扫描） | 未登记 skill 的拒收内容写进 `DATA_DIR` 的子目录 | 变红（递归扫描才能发现子目录里的落盘） |
| SHR / MOD:expected.json 登记的样本与目录下 SKILL-*.md 一致 | 把 `expected.json` 清空为 `{}` | 两个包内的登记一致性用例各自变红（其余逐样本用例随之消失，不再哑绿） |
| ADM:详情展示会话信息（已解决标记、保存状态） | 去掉详情头部的已解决 / 未解决徽标；按钮文案改回`保存` | 各自变红 |
| INJ:本机配置默认路径 | 非 win32 分支的 `.config` 改成 `.cfg` | 变红（win32 用例在 Windows 主机上执行，Mac 上跳过） |
| ADMD:反馈详情：问题在上、会话信息在下… | 交换问题卡与会话信息卡的顺序 | 变红 |
| JOB:备份早于被删反馈的创建 | 重放时不再抬高自增序号 | 变红（既有的删除日志用例在此改坏下仍是绿的：它的备份含被删编号，序号本来就够高，这条抬序号的代码路径此前没有用例） |
| JOB:每小时跑维护、每分钟检查备份 | 每小时改每两小时；去掉定时任务的异常兜底 | 各自变红 |
| JOB:链路：每日备份生成的文件 → 删除 → 恢复 → 重放 | 重放不再删行；备份生成时把反馈表清空 | 各自变红 |
| JOB:runMaintenance 按删除编号日志重删 | `runMaintenance` 不再重放删除日志 | 变红 |
| E2E:5b、6c、9、10、11、12 | 删除日志重放不删行；删除不写日志；请求日志带出 Authorization；拒收内容落盘；提交脚本不带 `skill.version` | 分别使步 11、步 10 与 11、步 12、步 6c、步 5b 与 6c 与 7 变红 |

### 本轮运行结果

- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm test`：见交付汇报（含总数）；连续三次运行无失败、无波动。
- `ctx lint-cards`、`ctx probe`：见交付汇报。
