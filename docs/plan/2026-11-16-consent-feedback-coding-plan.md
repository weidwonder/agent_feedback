---
lifecycle: active
superseded_by: ''
archived: ''
last_confirmed: '2026-11-17'
authority_refs:
  - docs/spec/2026-11-16-consent-feedback-eng-spec.md 的实现任务拆分
---

# Coding Plan — 反馈前征得使用者同意、来源地址限额每天 50 次

依据：`docs/spec/2026-11-16-consent-feedback-eng-spec.md`（下称 spec）。工作目录为本 worktree 根。临时文件只放 `.tmp/<任务名>/`。每个任务完成后单独提交一次。

## Task 1：来源地址限额默认 50

满足：FR-013｜验收：AC-003、AC-004、AC-006

- `packages/server/src/config.ts`：`IP_DAILY_LIMIT` 默认值 5 → 50，下限仍为 1。
- `packages/server/deploy/agent-feedback.service`：`Environment=IP_DAILY_LIMIT=50`。
- `packages/server/test/config.test.ts`、`test/deliverables.test.ts`：默认值断言改为 50。
- `packages/server/test/submissions.test.ts`：新增用例——不设 `IP_DAILY_LIMIT`（传空串覆盖测试夹具的 1000）时，同一来源第 50 次请求不因限额被拒、第 51 次 429 `ip_limit`。
- 验证：`npm run typecheck && npm test`。

## Task 2：反馈模块版本 1.1.0

满足：FR-015｜验收：AC-011

- `packages/module/package.json` 的 `version` → `1.1.0`（只改模块包；其余包与 `package-lock.json` 中对应条目按 npm 规则同步）。
- 在已有注入或交付物测试里断言注入出的宿主 `agent-feedback/config.json` 的 `moduleVersion` 等于模块包版本，且该版本为 `1.1.0`。
- 验证：`npm test`。

## Task 3：改写 `packages/module/assets/FEEDBACK.md`

满足：FR-001–FR-011｜验收：AC-001

按 spec §4.1 逐节改写；写法守 `dw-prose`（只写现状，不写"此前 / 不再 / 改为"之类来历词）。必须包含：询问时机、合并取前 5、询问话术样例、同意判定（全部 / 部分 / 拒绝 / 未回应 / 答非所问 / 别再问）、提交范围不超出询问所列、同意后同轮立即提交、结果一句话告知（含业务化原因示例，不贴原因码）、命令被拒时一句话告知、上下文里找不到同意记录按未同意处理、禁写清单同样适用于询问文字。第 0、5、6、7、9 节除上述必要措辞外不改。第 10 节例子按 spec §4.1 更新。

## Task 4：改写 `packages/module/assets/PRIVACY.md`

满足：FR-012｜验收：AC-002

开头段改为"先列出问题、征得你同意后才发送"；其余收集范围、保留期、关闭方式不变。

## Task 5：现行文档、卡片、评测场景同步

满足：FR-014｜验收：AC-005、AC-010

逐份处理 spec §1 同步清单。`docs/report/上线评测场景.md`：把"反馈"类预期改为"当轮询问 → 同意后提交"，第 50 行与第 65 行的"非询问场景是否提及反馈"列改为"提交是否只发生在明确同意之后"（任何未经同意的提交都算规则违反），评测人员在场景里扮演使用者给出同意或拒绝；新增场景：拒绝、部分同意、未回应、要求别再问、关闭开关下不询问、询问文字含禁写信息的检查；生产限额口径改为每 IP 每天 50 次。卡片 `反馈模块.md`（约束列"全程静默"）与 `提交收录.md`（补默认值 50）刷新确认日期。`docs/TODO.md` 删第 23、24 行。历史评审报告、`lifecycle: merged` 的 PRD 不改。

## Task 6：CHANGELOG

满足：—｜验收：AC-010

`## 未发布` 下：`不兼容`——反馈模块提交前先在当轮回复里列出问题征得使用者同意，同意后提交并告知结果，不再静默提交（模块版本 1.1.0；已接入的 skill 需重新注入）；`变更`——服务端每个来源地址每天默认提交上限 5 → 50，部署示例同步，已部署实例需手动改配置并重启。
