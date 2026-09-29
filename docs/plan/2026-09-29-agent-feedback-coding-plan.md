---
lifecycle: active
superseded_by: ''
archived: ''
last_confirmed: '2026-09-29'
authority_refs:
  - packages/shared 导出面（validateSubmission、常量、拒收码、中文显示名）
  - packages/server 内部模块接口（openDb、createApp、runMaintenance、startJobs）
---

# Agent Feedback Coding Plan

> 本文按 RFC 2119 解释规范词。唯一需求来源：`docs/spec/2026-09-29-agent-feedback-eng-spec.md`（下称 spec）。执行者零上下文：动手前 MUST 通读 spec 全文与本任务小节。
> 契约（字段、限制、接口、错误码、路由、CLI）以 spec 为准，本 plan 不复述，只给文件落点、接口签名、测试要求与验证命令。

**Goal:** 交付 spec 的 FR-001–FR-026。
**Architecture:** 单仓 npm workspaces；`shared` 是字段契约唯一出处；`server` 是 `node:http` + `node:sqlite` 单进程；`module` 的提交脚本与 `injector` CLI 用 esbuild 打成零依赖单文件。
**Tech Stack:** TypeScript ^7（只用可擦除语法）、Node ≥ 22.18（开发：内置类型剥离跑测试）、`node:test`、esbuild、`node:sqlite`。
**Worktree:** `/Users/weidwonder/projects/agent_feedback/.worktrees/agent-feedback-v1`
**Task Branch:** `feat/agent-feedback-v1`
**目标主分支:** `main`

## 全局约定（每个任务都 MUST 遵守）

- 源码全部 `.ts`，相对导入带 `.ts` 扩展名（`import { x } from './y.ts'`），跨包导入写包名（`@agent-feedback/shared`）；类型导入用 `import type`；MUST NOT 使用 enum、namespace、参数属性等不可擦除语法。
- 测试文件放各包 `test/*.test.ts`，用 `node:test` 与 `node:assert/strict`；根目录 `npm test` 运行 `node --test packages/*/test/*.test.ts`。
- 零运行时第三方依赖；devDependencies 只允许 `typescript`、`esbuild`、`@types/node`。
- 注释、提示文案、错误 message 用中文；代码标识符用英文。
- 每个任务结束 MUST 跑 `npm run typecheck && npm test`，全部通过再 commit；commit 信息用 conventional commits，不写任何 AI 相关字样。
- 只改本任务 Files 列出的文件；需要改别的任务的文件时停下，在报告里说明。

---

### Task 1：仓库脚手架与 shared 契约包

**Slice:** 校验一份合规/不合规提交载荷 ｜ **依赖：** 无 ｜ **满足:** FR-001

**Files:**
- Create: `package.json`（private，`"type":"module"`，workspaces `packages/*`，scripts：`typecheck`=`tsc -p tsconfig.json --noEmit`，`test`=`node --test packages/*/test/*.test.ts`，`build`=`npm run build --workspaces --if-present`；engines node `>=22.18`）
- Create: `tsconfig.json`（`strict`、`target: ES2023`、`module: NodeNext`、`moduleResolution: NodeNext`、`allowImportingTsExtensions`、`noEmit`、`verbatimModuleSyntax`、`erasableSyntaxOnly`、`types: ["node"]`，include `packages/*/src/**/*.ts`、`packages/*/test/**/*.ts`）
- Create: `packages/shared/package.json`（name `@agent-feedback/shared`，`"type":"module"`，`exports: {".": "./src/index.ts"}`）
- Create: `packages/shared/src/index.ts`、`packages/shared/src/limits.ts`、`packages/shared/src/codes.ts`、`packages/shared/src/labels.ts`、`packages/shared/src/validate.ts`、`packages/shared/src/frontmatter.ts`
- Test: `packages/shared/test/validate.test.ts`、`packages/shared/test/frontmatter.test.ts`
- Modify: `.gitignore` 追加 `dist/`、`data/`

**Interfaces（Produces）:**
- `LIMITS`（常量对象：各字段长度上下限、`maxItems: 5`、`maxRelatedSkills: 10`、`maxOccurrences: 1000`、`maxBodyBytes: 65536`）
- `FEEDBACK_TYPES`、`IMPACTS`、`STATUSES`（`['pending','valid','invalid','duplicate','done']`）、`USER_INFO_SOURCES`、`OS_VALUES` 只读元组，以及对应 TS 联合类型 `FeedbackType`、`Impact`、`Status`、`UserInfoSource`、`OsValue`
- `ERROR_CODES` 与类型 `ErrorCode`（spec §2.1 拒收码全集）
- `LABELS`：`{ type: Record<FeedbackType,string>, impact: ..., status: ..., userInfoSource: ... }` 中文显示名
- `interface SessionInput`、`interface ItemInput`、`interface Submission`（spec §2.1 完整请求体）
- `validateSubmission(input: unknown): { ok: true; value: Submission } | { ok: false; code: 'invalid_field' | 'too_many_items'; field: string; message: string }`：返回值中的字符串已 trim；可选空串归一为 `undefined`
- `charLength(s: string): number`（码点计数）
- `NOTICE`（spec §3 的不可信标注固定文本）
- `parseFrontmatter(text: string): { name?: string; version?: string }`（spec §4.3 frontmatter 解析规则；只认顶层 `name` 与 `metadata` 下的 `version`；兼容 CRLF）

**测试要求:** 覆盖 AC-002 列出的全部情形；每种情形断言 `code` 与 `field`；另测码点计数（emoji 计 1）、trim 后为空视为缺失、未知字段（顶层、session 内、item 内）被拒。

**验证:** `npm install && npm run typecheck && npm test` → 全部通过。
**Commit:** `feat(shared): add submission contract and validation`

---

### Checkpoint A：Task 1 之后，Task 2 / 3 / 4 并行

---

### Task 2：收集服务 —— 存储、提交把关、登记与查询接口、定时任务、CLI、部署文件

**Slice:** 提交一条反馈并用查询令牌读回 ｜ **依赖：** Task 1 的 shared 导出 ｜ **满足:** FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-012, FR-013, FR-014, FR-015, FR-016, FR-025

**Files:**
- Create: `packages/server/package.json`（name `@agent-feedback/server`，dependencies `@agent-feedback/shared: "*"`，script `build`=`esbuild src/main.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/server.mjs`）
- Create: `packages/server/src/main.ts`（CLI 分发：`serve` / `set-admin <username>`）
- Create: `packages/server/src/config.ts`（spec §6 配置表；`loadConfig(env): Config`，非法值抛错含变量名）
- Create: `packages/server/src/time.ts`（`beijingDay(d: Date): string`、`beijingDateRangeToUtc(from?: string, to?: string): {fromIso?: string, toIso?: string}`、`monthsAgoUtc(now: Date, months: number): string`，全部固定 +08:00）
- Create: `packages/server/src/db.ts`（`openDb(dataDir: string): DatabaseSync`，执行 spec §2.2 建表；导出查询辅助函数）
- Create: `packages/server/src/http.ts`（极简路由：`createRouter()`、`readBody(req, maxBytes)`、`sendJson`、`sendError(res, status, code, message, field?)`、`clientIp(req, trustProxy)`、`parseCookies`、日志函数 `log(event, fields)`）
- Create: `packages/server/src/auth.ts`（`hashToken`、`generateToken(kind)`（`afq_` / `afr_` + base64url 32 字节）、`verifyBearer(db, req, kind)`、`hashPassword`、`verifyPassword`、会话 `createSession` / `getSession` / `destroySession`）
- Create: `packages/server/src/counters.ts`（`bumpCounter(db, day, scope): number`、`getCounter`、`bumpRejection(db, day, reason)`）
- Create: `packages/server/src/deletions.ts`（`recordDeletion(dataDir, id)`、`applyDeletionLog(db, dataDir): number`、`deleteFeedback(db, dataDir, id)`）
- Create: `packages/server/src/jobs.ts`（`purgeExpired(db, now)`、`backupIfDue(db, dataDir, now)`、`startJobs(ctx)`）
- Create: `packages/server/src/feedback-query.ts`（`listFeedback(db, filters)`、`getFeedback(db, id)`、`setStatus(db, id, status)`、`toFeedbackView(row)`；列表与管理界面共用）
- Create: `packages/server/src/routes/submissions.ts`、`routes/registry.ts`、`routes/feedback-api.ts`、`routes/health.ts`
- Create: `packages/server/src/app.ts`（`createApp(ctx: AppContext): http.RequestListener`；`AppContext = { db, config, dataDir, now: () => Date }`；为 Task 5 预留 `mountAdmin(router, ctx)` 挂载点：Task 2 中实现为空函数文件 `src/admin/index.ts` 导出 `mountAdmin`，Task 5 负责填充）
- Create: `packages/server/deploy/agent-feedback.service`、`packages/server/deploy/Caddyfile.example`、`packages/server/deploy/nginx.conf.example`
- Create: `docs/deploy.md`（frontmatter `lifecycle: active`、`authority_refs`；环境变量表与 spec §6 一致；首次部署：安装 Node ≥22.13、构建、`set-admin`、systemd、反代、生成令牌；备份位置与恢复步骤）
- Test: `packages/server/test/helpers.ts`（起临时 DATA_DIR 与随机端口服务、造令牌、造 skill 的辅助函数）、`test/submissions.test.ts`、`test/registry.test.ts`、`test/feedback-api.test.ts`、`test/jobs.test.ts`、`test/set-admin.test.ts`

**Interfaces（Produces，供 Task 5 使用）:**
- `AppContext`、`createApp`、`createRouter` 的路由注册 API：`router.get(path, handler)`、`router.post(path, handler)`、`router.patch(path, handler)`，path 支持 `:param`，handler 签名 `(req, res, params: Record<string,string>, url: URL) => Promise<void> | void`
- `listFeedback(db, filters: FeedbackFilters): { total: number; items: FeedbackView[] }`，`FeedbackFilters = { skill?: string; type?; impact?; status?: Status | 'all'; resolved?: boolean; from?: string; to?: string; moduleVersion?: string; agentName?: string; harnessName?: string; limit: number; offset: number }`
- `getFeedback(db, id: number): { item: FeedbackView; siblings: string[] } | null`、`setStatus(db, id, status): FeedbackView | null`、`deleteFeedback(db, dataDir, id): boolean`
- `hashPassword(pw): string`、`verifyPassword(pw, stored): boolean`、`createSession(db, now): string`（返回明文 id）、`getSession(db, id, now): boolean`、`destroySession(db, id)`、`generateToken(kind): string`、`hashToken(t): string`
- `bumpCounter`、`getCounter`、`bumpRejection`、`beijingDay`

**测试要求:** AC-003、AC-004、AC-005（除管理界面部分）、AC-006、AC-008、AC-009、AC-010、AC-011、AC-012。
**验证:** `npm run typecheck && npm test && npm run build -w @agent-feedback/server` → 通过，生成 `packages/server/dist/server.mjs`；`DATA_DIR=$(mktemp -d) PORT=18787 node packages/server/dist/server.mjs serve &` 后 `curl -s localhost:18787/healthz` 输出 `ok`，随后结束该进程。
**Commit:** `feat(server): add submission intake, registry and query api`

---

### Task 3：反馈模块 —— 提交脚本、FEEDBACK.md、PRIVACY.md

**Slice:** 在临时宿主目录里用 submit.mjs 发出一份合规请求 ｜ **依赖：** Task 1 ｜ **满足:** FR-018, FR-019, FR-020, FR-021

**Files:**
- Create: `packages/module/package.json`（name `@agent-feedback/module`，`version: "1.0.0"`，dependencies shared，script `build`=`esbuild src/submit.ts --bundle --platform=node --format=esm --target=node18 --outfile=dist/submit.mjs`）
- Create: `packages/module/src/submit.ts`（spec §4.3；frontmatter 用 shared 的 `parseFrontmatter`）
- Create: `packages/module/assets/FEEDBACK.md`、`packages/module/assets/PRIVACY.md`、`packages/module/assets/gitignore`（内容 `.runtime/`）
- Test: `packages/module/test/submit.test.ts`（先 `npm run build -w @agent-feedback/module`，再在临时目录布置 `SKILL.md` + `agent-feedback/{submit.mjs,config.json}`，用 `child_process.spawnSync` 喂 stdin 执行；用 `http.createServer` 起本地假服务收请求）

**FEEDBACK.md 编写要求:** 动手前 MUST 加载 `skill-principle` skill（找不到时读 `~/.claude/skills/skill-principle/SKILL.md`）按其对指令文本的要求写；MUST 覆盖 PRD `docs/spec/2026-09-29-agent-feedback-PRD.md` §反馈模块：agent 的行为规则 的全部条目与 §提交的信息 两张表的填写说明，以及 spec FR-020 列表；给出完整调用示例（heredoc 传 JSON，含全部字段）、结果处理（ok:false 各 reason 的动作：invalid 修正后最多重试一次；其余放弃且本会话不再提交；unreachable 不计入 2 次）、运行环境查找与安装步骤（先 `node --version`（≥20 可用）→ 再找 `agent-feedback/.runtime/node*/bin/node`（Windows 为 `.runtime\node*\node.exe`）→ 都没有时尝试一次把官方 Node 发行包下载解压到 `agent-feedback/.runtime/`，国内网络优先 `https://npmmirror.com/mirrors/node/`，失败或被拒就放弃且本会话不再尝试）；禁写清单；"使用者直接问起时如实说明"；"不向使用者提及反馈"。文本 SHOULD ≤ 250 行。
**PRIVACY.md 编写要求:** 面向使用者，业务语言；列收集字段、不收集的内容、保留 6 个月及删除后备份最多滞留 7 天、用途（只供 skill 维护者改进 skill，不用于训练）、关闭方法 `AGENT_FEEDBACK_DISABLED=1`。

**测试要求:** AC-014、AC-016（`.gitignore` 资产内容）。
**验证:** `npm run typecheck && npm test && npm run build -w @agent-feedback/module` → 通过，生成 `packages/module/dist/submit.mjs`，`head -c 200` 确认无 `import` 第三方包。
**Commit:** `feat(module): add silent submit script and agent feedback rules`

---

### Task 4：注入工具 CLI

**Slice:** 对临时宿主目录注入并在本地服务登记 ｜ **依赖：** Task 1；运行时读取 Task 3 的产物路径（测试中用假模块文件） ｜ **满足:** FR-022, FR-023, FR-024

**Files:**
- Create: `packages/injector/package.json`（name `@agent-feedback/injector`，dependencies shared，script `build`=`esbuild src/cli.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/agent-feedback.mjs`）
- Create: `packages/injector/src/cli.ts`（参数解析：`config --endpoint <url>`、`inject <dir>`；`--config-path <p>` 与 `--module-dir <p>` 两个隐藏参数仅供测试覆盖默认路径）
- Create: `packages/injector/src/config.ts`（`defaultConfigPath()`、`readConfig(path)`、`writeConfig(path, cfg)`（0600））
- Create: `packages/injector/src/registry-client.ts`（`checkName(cfg, name)`、`register(cfg, name)`，fetch + 10 秒超时，错误转成中文原因）
- Create: `packages/injector/src/inject.ts`（spec §4.4；模块源文件默认位置：相对 `dist/agent-feedback.mjs` 的 `../../module/assets/*` 与 `../../module/dist/submit.mjs`，模块版本读 `../../module/package.json`）
- frontmatter 解析 MUST 用 shared 的 `parseFrontmatter`，MUST NOT 另写一份
- Test: `packages/injector/test/inject.test.ts`（临时宿主目录、临时配置文件、本地假登记服务，覆盖 AC-017 全部情形）

**测试要求:** AC-017。
**验证:** `npm run typecheck && npm test && npm run build -w @agent-feedback/injector` → 通过。
**Commit:** `feat(injector): add config and inject commands`

---

### Checkpoint B：Task 2–4 之后

- [ ] `npm run typecheck && npm test && npm run build` 全部通过
- [ ] frontmatter 解析只存在于 shared 一处

---

### Task 5：管理界面

**Slice:** 登录后在列表看到一条反馈并标为有效 ｜ **依赖：** Task 2 的 `AppContext`、路由 API、`listFeedback`/`getFeedback`/`setStatus`/`deleteFeedback`、auth 与 counters 函数 ｜ **满足:** FR-009, FR-010, FR-011, FR-017

**Files:**
- Modify: `packages/server/src/admin/index.ts`（实现 `mountAdmin`）
- Create: `packages/server/src/admin/views.ts`（layout、escapeHtml、各页面渲染函数；内联 CSS 仿原型中性基线：卡片、表格、徽标、左侧导航、`:target` 对话框）
- Create: `packages/server/src/admin/routes.ts`（spec §3 管理界面路由表全部路由；Origin 同源校验；登录失败计数）
- Create: `packages/server/src/admin/skills.ts`（登记页查询：近 7 天收录、模块版本分布、拒收 7 天；启停；改名事务）
- Test: `packages/server/test/admin.test.ts`（HTTP 级：用 fetch + 手动携带 cookie 与 Origin 头）

**视觉参照:** 原型 `docs/spec/2026-09-29-agent-feedback-prototype.html`，用 `node ~/.claude/skills/dw-prd/scripts/preview.mjs extract <原型>` 与 `annotations <原型>` 读取，MUST NOT 通读 HTML。
**测试要求:** AC-007、AC-013。
**验证:** `npm run typecheck && npm test && npm run build` → 通过。
**Commit:** `feat(server): add admin console`

---

### Task 6：端到端测试、评测模板、CHANGELOG、卡片

**Slice:** 从零部署到维护 agent 读回反馈的整条链路 ｜ **依赖：** Task 2–5 ｜ **满足:** FR-026（其余为 AC-018/AC-024/AC-025 的交付物）

**Files:**
- Create: `test/e2e.test.ts`（根目录；按 AC-018 步骤；构建产物用 `npm run build` 后的 dist；`set-admin` 通过 stdin 喂密码；令牌通过管理界面 HTTP 生成）；`package.json` 的 `test` 脚本改为同时包含 `test/*.test.ts`
- Create: `docs/report/上线评测场景.md`（frontmatter；20 个该反馈 + 20 个不该反馈场景的表：编号、场景描述、预期（反馈/不反馈）、实际、是否含禁写信息；判定口径与计算公式；执行方法：用 `--dry-run` 检查请求体）
- Create: `CHANGELOG.md`（`## 未发布` → `### 新增` 条目：收集服务、管理界面、查询通道、反馈模块、注入工具）
- Create: `engineering-context/cards/agent-feedback.md`（地图卡）与域卡 `engineering-context/cards/agent-feedback/{提交收录,登记,查询通道,管理界面,反馈模块,注入}.md`；更新 `engineering-context/capability-registry.md` 最小 schema 表；把 `engineering-context/dependencies/host-skills.md` 调用点改成真实 `文件:行`；跑 `node ~/.claude/skills/dw-code-facts/scripts/ctx/src/cli.js lint-cards` 无违规
**验证:** `npm run typecheck && npm test && npm run build` → 通过。
**Commit:** `test: add end-to-end flow` / `docs: add launch evaluation template and changelog`

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `node:sqlite` 在 Node 22 输出实验性警告 | L | 服务启动时 `process.removeAllListeners('warning')` 不做；部署说明写明警告无害；systemd 单元加 `--disable-warning=ExperimentalWarning` |
| 并行任务改到同一文件 | M | Files 明确归属；共用逻辑全部在 Task 1 的 shared 里先落地 |
| 类型剥离不支持某些 TS 语法 | M | 全局约定禁止不可擦除语法；`erasableSyntaxOnly` 由 tsc 把关 |
| 管理界面与原型偏差 | L | 原型为临时视觉假设；结构与文案以 spec §4.5 为准 |

## 替换清单核销

无被取代物。

## 完成与自动合并

- [ ] 代码评审门通过（按 `dw-review-gate` 判对象面推轴，逐轴子代理报告，P0/P1 清零）
- [ ] 需求覆盖核销：FR-001–FR-026 均被至少一个 Task 的 `满足:` 引用
- [ ] 测试 spec 与测试阶段（Step 8–10）完成
- [ ] 任务分支已吸收最新 main 并重新验证；worktree 干净
- [ ] `merge-gate="direct"`：主工作树 `git merge --no-ff feat/agent-feedback-v1`，合并后跑 `npm install && npm test`，移除 worktree
