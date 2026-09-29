---
lifecycle: active
superseded_by: ''
archived: ''
last_confirmed: '2026-09-29'
authority_refs:
  - 现行文档入口
---

# 文档索引

现行文档入口，只列现行口径。

- [PRD](spec/2026-09-29-agent-feedback-PRD.md)：需求真相源：目标、非目标、agent 行为规则、提交信息、把关规则、风险与兜底。
- [原型](spec/2026-09-29-agent-feedback-prototype.html)：管理界面的视觉与交互原型。
- [Overview](spec/2026-09-29-agent-feedback-overview.md)：顶层架构：模块边界、已定决策 D1–D14、接口清单、失败模型。
- [技术 Spec](spec/2026-09-29-agent-feedback-eng-spec.md)：数据模型、接口契约、核心逻辑、环境变量与验收项，契约的唯一出处。
- [Coding Plan](plan/2026-09-29-agent-feedback-coding-plan.md)：按垂直切片拆分的实现任务与验证命令。
- [部署与运维](deploy.md)：首次部署、数据目录、定时任务、日志、备份恢复、注入工具的构建与使用。
- [查询通道使用说明](query-api.md)：维护 agent 读取反馈的鉴权、分页、不可信文本处理规则与改状态口径。
- [上线评测场景](report/上线评测场景.md)：上线前评测 agent 触发率、误触发率、禁写信息与维护 agent 注入抗性的场景清单与判定口径。
- [评审报告](report/2026-09-29-agent-feedback-review-report.md)：代码评审各轮的结论、处置与"不改"说明。
- [TODO](TODO.md)：还没做的事的唯一出口。
- [CHANGELOG](../CHANGELOG.md)：面向使用者与维护者的变更记录。
