# Capability Registry — 产品能力到权威代码实体的映射

> 精简骨架；完整字段说明与填写指南见 dw-code-facts skill 的 assets/context-layer/capability-registry.md。
> 代码事实层（"信哪个"）的核心资产，**每个装了本体系的项目都维护它**。人工确认。
> 事实以源码为准，PRD 仅作 scope + 业务语境。每条带 freshness 与理由链。
> 只剩【】占位行是**正常起步态**：内容按任务渐进补齐（见 references/代码事实纪律.md §4），
> MUST NOT 因为表是空的就告警、或退回裸 grep 找权威实现。
> 下面两张表**填哪张都算，解析器会合并**（表头首列命中 Capability/能力的表全部解析）：
> 三列是 MUST，十列表里的其余列是 MAY——缺列跳过不报错，没有 freshness 列的条目输出标注「未声明新鲜度」。
> **第三列 MUST NOT 省**——它是最小 schema 里唯一的防误用装置，省掉就挡不住"改错了那个"。

## 最小合法 schema（起步用这个）

| Capability | 权威实现 | 陷阱项（废弃或中间产物） |
|---|---|---|
| 提交收录 | `packages/server/src/routes/submissions.ts`，字段契约 `packages/shared/src/validate.ts`；详见 cards/agent-feedback/提交收录.md | 其他包另写校验或限额数字；编号复用 |
| 登记 | `packages/server/src/routes/registry.ts` 与 `admin/skills.ts#renameSkill`；详见 cards/agent-feedback/登记.md | 旧名提交（不放行）；手改 skills.name 漏写旧名表 |
| 查询通道 | `packages/server/src/routes/feedback-api.ts`，查询逻辑 `feedback-query.ts`；详见 cards/agent-feedback/查询通道.md | 登记令牌与查询令牌混用；清单不带 skill |
| 管理界面 | `packages/server/src/admin/routes.ts`，渲染 `views.ts`；详见 cards/agent-feedback/管理界面.md | 在 views/routes 另算北京时间偏移（改用 time.ts）；POST 路由不套 guarded |
| 反馈模块 | `packages/module/src/submit.ts` 与 `assets/FEEDBACK.md`；详见 cards/agent-feedback/反馈模块.md | 脚本内另写校验；agent 手填自动字段 |
| 注入 | `packages/injector/src/inject.ts#inject`；详见 cards/agent-feedback/注入.md | 对安装副本注入；令牌写入宿主目录 |

## 能力表（完整形态）

| Capability | 业务含义 | 权威仓库 | 权威接口(含版本) | 废弃/中间产物替代 | 兼容窗口 | owner | 测试入口 | freshness(最近确认) | 理由链 |
|---|---|---|---|---|---|---|---|---|---|
| 【能力】 | 【含义】 | 【repo】 | 【POST /v2/xxx】 | 【旧接口不可用】 | 【切点】 | 【owner】 | 【测试入口】 | 【YYYY-MM-DD / PR】 | 【诞生压力】 |
