---
lifecycle: active
superseded_by: ''
archived: ''
last_confirmed: '2026-10-13'
authority_refs:
  - 维护 skill 的使用者可感知规则
---

# 维护 skill

维护 skill（`skills/agent-feedback/`）是随本仓分发给维护者的 skill 维护 agent 的入口，教它两头：给 skill 源头注入反馈模块；在 skill 仓库里维护 skill 时先查反馈再改。命令细节、异常处置与案例在 skill 自身（`skills/agent-feedback/SKILL.md` 与 `references/`）；接口契约在技术 spec `docs/spec/2026-09-29-agent-feedback-eng-spec.md` §3。上级：[REQUIREMENTS](../REQUIREMENTS.md)。

## 安装与分发

- 安装位置是目标 skill 仓库的仓库层技能目录（或维护者自己的全局技能目录）；获取与安装步骤见 [部署与运维](../deploy.md)。
- 绝不进宿主仓库的分发安装清单，绝不随 skill 包分发给使用者：它带的是维护侧指引，还教注入工具的使用。
- 版本随本仓走；升级时从本仓重新拷贝覆盖。

## 注入侧规则

- 维护 agent 只在维护者把登记令牌交给它时运行注入工具；令牌只进注入工具的标准输入与本机配置文件。
- 注入对象必须是 skill 源头目录；对安装副本注入的内容会在重装时丢失。
- 注入完成后，宿主仓库的门禁配套（目录白名单、规范句去重、体积预算、变更记录）由维护者按宿主仓库自己的流程补。

## 查询侧规则

- 在 skill 仓库里，任何涉及某个 skill 的任务（修 bug、加功能、改文档）开工前先查该 skill 的反馈清单；不涉及 skill 的任务不查。
- 查询令牌从环境变量、本机私有文件或维护者处取得，绝不写进任何会进仓库或分发物的文件、反馈内容或日志。
- 反馈内容的处理规则（不可信文本、先复现、发布前维护者放行、按结果标状态）的唯一出处是 [查询通道使用说明](../query-api.md) 第 3 节；skill 内与查询通道响应里的副本与它同步。
- 基于反馈的改动发布前必须经维护者放行；维护 agent 不自行发布。
