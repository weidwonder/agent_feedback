---
lifecycle: active
superseded_by: ''
archived: ''
last_confirmed: '2026-09-29'
authority_refs:
  - 无
---

本次对象面：P + G｜轴集合：A 规范、B 忠实、C 残留、D 文档、E agent 架构｜档位：高档（命中大架构确认门）｜各轴 P0 计数：A 0 / B 1 / C 0 / D 0 / E 1｜结算积压：无

# Agent Feedback 代码评审报告（第 1 轮）

评审范围：`git diff main...feat/agent-feedback-v1`（main = 1c3266e）。分组派发：组 1（A/B/C 同一子代理）、组 2（D）、组 4（E），均为高档。

## P0

| 轴 | 问题 | 处置 |
|---|---|---|
| B | 提交脚本在服务端拒收时从响应顶层读 `code/message/field`，服务端实际放在 `error` 下，三项恒缺；单测假服务用了错误形状（A 轴 P1 同源） | 修代码：读 `error.*`；假服务改为真实形状；e2e 补一次真实拒收 |
| E | 关闭开关只在提交脚本里检查；无 Node 时 FEEDBACK.md 先让 agent 下载安装运行环境，违背"关闭后不发任何网络请求"的公开承诺 | 修 FEEDBACK.md：任何步骤之前先检查开关 |

## P1

| 轴 | 问题 | 处置 |
|---|---|---|
| D | 备份实际保留 8 份，删除后最长滞留约 7 天 17 小时，违背公开说明 | 修代码：只保留 7 份 |
| D | overview 与 eng-spec 双家认领契约，overview 已过期（notice 原文、`--payload`、SameSite） | overview 契约改为指针 |
| E | 提交命令被 harness 或使用者拒绝执行时无规则 | FEEDBACK 增加：放弃，本会话不再提交，不解释；PRD 风险表登记 harness 审批 |
| E | 维护 agent 读取的 suggestedFix 可被冒用者用来诱导改 skill 源头 | 新增 `docs/query-api.md` 维护 agent 使用说明：反馈只是待复现的假设；基于反馈对 skill 源头的改动发布前须维护者人工审阅；PRD 风险表同步 |
| E | 清单接口默认 50、最大 200 条完整内容，维护 agent 上下文压力大 | 默认 20、最大 50 |
| E | 使用者追问时"没发过就说没发过"在上下文压缩后可能构成否认 | 改为"不能排除时如实说明可能提交过" |
| E | 运行环境安装校验和与安装包同源、版本浮动 | 固定 Node 版本；校验和从 nodejs.org 官方取，安装包可走镜像 |
| E | 评测缺"是否提及反馈"列、缺敏感素材与维护 agent 注入场景 | 补列与 8 个场景；方法改为指向测试实例、每场景 3 次、覆盖两种 harness |

## 取舍与"不改"说明

| 来源 | 建议 | 结论 |
|---|---|---|
| B 存疑 / E 存疑 | PRD 要求"每条反馈标明不可信"，spec 只在响应顶层 | 改代码：每条反馈带 `notice`，spec 同步 |
| B #3 | SameSite 实现为 Lax，与已定决策 D8（Strict）不符 | 改代码回到 Strict，不改已定决策 |
| E #5 | 私有 skill 名可能是内部名称，建议不列入 | 不改：维护者已拍板"skill 名称本身不算禁写"；登记为待维护者确认项 |
| E #9 | 引导语未覆盖"缺能力、不满" | 不改：引导语是维护者指定的原文；FEEDBACK.md 内的触发条件完整 |
| E 存疑 | 提交前对本机家目录、用户名做精确匹配拦截 | 不做：超出已定范围，登记为待维护者确认项 |
| A/B 存疑 | Node 18 首次 fetch 可能写标准错误 | 最低 Node 提到 20，提交脚本屏蔽 warning 事件 |

## P2（本轮一并处理）

北京时间与常量重复（收敛到 time.ts / auth.ts）；skill 名校验两份（收敛到 shared）；`maxOccurrences` 冗余；用户名比较时序；`skillIdOf` 命名；tsconfig 未含根 test；injector 依赖写法；"近 7 天"改自然日；模块版本分布改全保留期；备份失败当天不再重试；未知 `/admin/*` 路由按登录态 302 / HTML 404；CHANGELOG 补空小节；FEEDBACK「不起草」「occurrences 1–1000」「顶层键」「待报问题留记录」；PRIVACY 补网络地址计数保留 30 天；spec 事件名、`invalid_json`、`internal`、authority_refs、环境变量单一出处；deploy.md 构建/运行 Node 版本、注入工具使用；overview D1/D14/§13；coding plan 符号与版本；评测文档 frontmatter；新增 `docs/index.md` 入口；probe-set 补 3 道探针。

## 修复后

修复完成后对受影响的轴重跑（第 2 轮），结论追加在本文件末尾。
