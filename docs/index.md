---
lifecycle: active
superseded_by: ''
archived: ''
last_confirmed: '2026-11-17'
authority_refs:
  - 现行文档入口
---

# 文档索引

现行文档入口，只列现行口径。

- [需求真相源](REQUIREMENTS.md)：已实现的现状：是什么、为什么、有哪些功能、怎么用、明确不做什么、服务质量要求；具体行为规则在 `requirements/` 六个子模块。
- [架构真相源](ARCHITECTURE.md)：四个包与维护 skill 的职责与边界、交互方式与关键约束。
- [Overview](spec/2026-09-29-agent-feedback-overview.md)：顶层架构：模块边界、已定决策 D1–D14、接口清单、失败模型。
- [技术 Spec](spec/2026-09-29-agent-feedback-eng-spec.md)：数据模型、接口契约、核心逻辑、环境变量与验收项，契约的唯一出处。
- [测试方案](spec/2026-09-29-agent-feedback-test-spec.md)：风险驱动的测试设计：API 调用模型、Fixture、需求到用例追溯矩阵、端到端链路、非功能与准出记录。
- [Coding Plan](plan/2026-09-29-agent-feedback-coding-plan.md)：按垂直切片拆分的实现任务与验证命令。
- [反馈前征得同意变更 spec](spec/2026-11-16-consent-feedback-eng-spec.md)：提交前询问、会话停止询问与默认限额的契约及验收。
- [反馈前征得同意 coding plan](plan/2026-11-16-consent-feedback-coding-plan.md)：变更实现的 Task 1–6 与验证要求。
- [维护侧 skill PRD](spec/2026-10-13-maintainer-skill-PRD.md)：新增维护 skill 的变更 PRD（纯 skill 改动，PRD 即 spec）。
- [部署与运维](deploy.md)：首次部署、数据目录、定时任务、日志、备份恢复、注入工具的构建与使用、维护 skill 的获取与安装。
- [查询通道使用说明](query-api.md)：维护 agent 读取反馈的鉴权、分页、不可信文本处理规则与改状态口径。
- [测试场景覆盖度](report/测试场景覆盖度.md)：高风险场景的覆盖状态台账、长链路中间产物断言清单与待向维护者索要的素材。
- [上线评测场景](report/上线评测场景.md)：上线前评测 agent 触发率、误触发率、禁写信息与维护 agent 注入抗性的场景清单与判定口径。
- [评审报告](report/2026-09-29-agent-feedback-review-report.md)：代码评审各轮的结论、处置与"不改"说明。
- [维护 skill 评审报告](report/2026-10-13-maintainer-skill-review-report.md)：新增维护 skill 任务（含积压结算）的评审结论与处置。
- [TODO](TODO.md)：还没做的事的唯一出口。
- [CHANGELOG](../CHANGELOG.md)：面向使用者与维护者的变更记录。
- [归档索引](index-archive.md)：已归并或被取代的文档，只有历史价值。
