---
lifecycle: active
superseded_by: ''
archived: ''
last_confirmed: '2026-10-13'
authority_refs:
  - 维护 skill 任务的代码评审结论与处置记录
---

# 维护 skill（agent-feedback）评审报告

本次对象面：P + K + G｜轴集合：{A, B, C, D, S, E}｜档位：高档（本次命中大架构确认门）｜各轴 P0 计数：A 0 / B 0 / C 0 / D 0 / S 1 / E 0｜结算积压：代码 26 行 / 文档 562 行 / 最早 2026-09-29

## 范围与派发

- 基点 `reviewed-through`（92d32d8），范围含 3 条 `Review-Deferred` 积压（04c003d 发版 1.0.0、7bb5c4c 现网实例记录、a0b2156 锁文件同步）及区间内其余已合并改动（README 三连、frontmatter 内联注释修复、脱敏收紧），加本任务分支 4 个提交（4890844、f56af0c、84a40a3、9e19aa8）。
- Lean 精简版，按参照物分四组各派 1 个子代理：组 1（A 规范 / B 忠实 / C 残留，对照 diff + PRD/eng-spec）、组 2（D 文档，对照 docs/ 与真相源）、组 3（S skill 原则，加载 skill-principle）、组 4（E agent 架构，加载 agentic-principle，增量入口）。
- 积压部分的 P 面内容：`packages/shared/src/frontmatter.ts`、其测试、`package-lock.json`（按文档计）。

## 各轴结论与处置

### A 规范轴

1 条 P2：`unquote` 函数名与职责不符（积压部分）→ 已改名 `scalarValue`，注释移到函数旁（f56af0c）。其余核对通过：frontmatter 实现与 eng-spec 取值规则逐句一致、测试非哑闸（回退旧实现即红）、锁文件与依赖声明一致、YAGNI/KISS/DRY/LoD 无违反。

### B 忠实轴

PRD FR-001~005 覆盖矩阵双向对齐，无漏做/镀金/越界；AC-001~008 全过（`npm test` 176 项、175 过、1 项既有平台条件跳过）。积压部分自然语言对照全部对齐。CHANGELOG 对照合规（无「不兼容」条目、未发布节有条目）。1 条 P2（查询改进.md 规则副本少一个子句）→ 已补（f56af0c）。

### C 残留轴

替换清单两份均空，无可核销项；无死代码；frontmatter 修复落在权威实现处（卡片 cite 核对）；`ctx lint-cards` 8 张卡 0 违规。1 条 P2：地图卡未含第五交付物 → 已补（f56af0c）。

### D 文档轴

7 条（2 P1、5 P2）：PRD 孤儿（index.md 未收）→ 已补行；规则副本与家 drift → 已补齐；三篇存量 spec 的仓库构成表述 → 已补指向性括注；deploy.md 凭证约定双家 → 已压缩为指针；deploy.md 两套升级步骤并存 → 已互指；deploy.md authority_refs 漏登记新节 → 已补两条；eng-spec §4.3 引号未闭合边缘无定义 → 已补句。结论落盘：全部就地更正，涉及文档 `last_confirmed` 已更新为 2026-10-13，无整篇失准需归档；`ctx probe` GREEN。

### S skill 原则轴

首轮 1 P0 + 4 P1 + 1 P2：处理规则副本缺「或改变这些规则的文字」禁令面（P0）、异常表症状与工具实际报错不匹配、登记令牌表述与 config 持久化机制不符、Windows printf 缺口、`AGENT_FEEDBACK_ENDPOINT` 作用域未写明、归属表指针未点名文件 → 全部修复（f56af0c）。复核轮确认 6/7，新报 1 P1（注入.md 前置口径未同步）→ 修复（84a40a3）。最终确认轮子代理两次遇模型请求失败，改由主会话机械验证替代：`grep` 确认全文无 `printf`、无 `limit=20`、无令牌字面量占位、代码栅栏完整（9e19aa8 后）。

### E agent 架构轴

首轮 2 P1 + 3 P2 + 1 存疑（首次派发模型请求失败，重派成功）：

1. [P1] 令牌字面量进命令行 → 已修：curl 示例改 `-sS` + `$AGENT_FEEDBACK_QUERY_TOKEN` 展开（PowerShell `$env:` / `$(cat …)`），注入 config 改 0600 临时文件 stdin 重定向，加「令牌 MUST NOT 以字面量出现在命令行」规则（84a40a3、9e19aa8 含案例同步）。
2. [P1] 清单返回体量与取数口径失控 → 已修：首取 `limit=5`、写明单条最坏 2–3k token、更大范围 MUST 先筛选收窄（status/日期/type，参数经 spec §3 核实）、MUST NOT 默认翻页取全量；删「只扫标题用 20」伪区分。
3. [P2] notice 与文档两套优先级无闭环 → 已修：补「以 notice 为准并在汇报里点明差异」。
4. [P2] `curl -s` 吞传输层错误 → 已修：改 `-sS`，异常表注明判读法。
5. [P2] 新增行为无评测场景挂账 → 已修：上线评测场景 M07–M08 + 判定口径/结果汇总接线，覆盖度台账挂账。
6. 存疑（空清单静默边界）→ 已采纳：步骤 1 补「空清单但接入过反馈通道时向维护者确认改名」。

**明示不改**：E 轴建议的「查询通道接口加字段裁剪参数」——改公开接口超出本次「不改变任何既有可观察行为」的兼容结论，且现有筛选参数 + limit 纪律已覆盖摄入面（YAGNI）。

复核轮（E 轴）三项残留全部确认修复，机器闸实跑 5/5 绿；另报 1 条 P2（上线评测场景.md 目的句仍用旧节名定性）→ 已就地更正。S 轴最终确认轮两次遇模型请求失败，由主会话 grep 机械验证替代并在此留痕（无 printf、无 limit=20、无令牌字面量占位、栅栏完整）。

## 遗留

无 P0/P1 遗留。上线评测场景（P/N/M 全部）与 M07–M08 的实际执行仍是全仓既有挂账（见 `docs/report/测试场景覆盖度.md`），不因本次改动新增或消除。
