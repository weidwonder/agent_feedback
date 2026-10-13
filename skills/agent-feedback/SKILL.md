---
name: agent-feedback
description: 维护者自建 skill 反馈通道的维护侧入口：在 skill 仓库里维护、改进或修某个 skill 的问题之前，先取该 skill 的反馈清单作为改进依据；或把反馈模块接入（注入）skill 源头目录并在服务端登记。当用户要改进 skill、修 skill 的问题、查看某个 skill 收到的反馈、给 skill 接入或注入反馈通道时使用。不负责使用 skill 时的反馈提交（那由随 skill 分发的 agent-feedback 模块负责），也不负责收集服务的部署运维与管理界面操作。
metadata:
  version: "1.0.0"
---

# agent-feedback：skill 反馈通道的维护侧入口

给维护者的 skill 维护 agent 用，教两件事：

1. **查反馈改进**：在 skill 仓库里开工任何涉及某个 skill 的任务前，先取它的反馈清单，把反馈纳入改进依据。
2. **注入**：把反馈模块放进 skill 源头目录、追加引导语，并在收集服务上登记该 skill。

本文按 RFC 2119 解释 MUST / MUST NOT / SHOULD / MAY。

**非目标**：使用 skill 时的反馈提交由随 skill 分发的 `agent-feedback/` 反馈模块负责（规则在宿主 skill 内的 `agent-feedback/FEEDBACK.md`），不归本 skill；收集服务的部署运维与管理界面操作（登记停用改名、删反馈、生成令牌）由维护者本人做；本 skill 不自动发布任何改动——基于反馈的改动发布前 MUST 把改动、对应的反馈编号与复现结果交维护者放行。

## 路由

| 什么时候 | 读什么 |
|---|---|
| 在 skill 仓库里开始任何涉及某个 skill 的任务（修 bug、加功能、改文档） | [references/查询改进.md](references/查询改进.md) |
| 维护者要求给某个 skill 源头接入或升级反馈模块（注入） | [references/注入.md](references/注入.md)；前置：注入 MUST 由维护者发起（维护 agent 只在维护者交托时运行注入工具），实例未配置时需维护者提供登记令牌 |

## 开始前：位置与凭证

| 要什么 | 取法（按顺序取第一个命中的） | 纪律 |
|---|---|---|
| agent_feedback 仓库（注入工具与反馈模块模板的家） | 环境变量 `AGENT_FEEDBACK_REPO` → 默认 `~/projects/agent_feedback`（Windows 为 `D:/projects/agent_feedback`）→ 都找不到问维护者 | 注入流程都在该仓库内构建运行；本 skill 不携带工具链副本 |
| 查询令牌 | 环境变量 `AGENT_FEEDBACK_QUERY_TOKEN` → 本机文件 `~/.config/agent-feedback/query-token`（Windows 为 `%APPDATA%\agent-feedback\query-token`，内容只有令牌一行，权限 0600）→ 都没有就向维护者索取 | MUST NOT 写进任何会进仓库或分发给使用者的文件，MUST NOT 写进反馈内容或日志 |
| 登记令牌（仅注入用） | 首次配置实例时由维护者提供：config 子命令从标准输入读入，写入本机 config.json 后复用（已就绪无需再索取） | 同上；它不是查询令牌，两者 MUST NOT 混用 |
| 服务地址 | 默认 `https://fb.weid.fun`，环境变量 `AGENT_FEEDBACK_ENDPOINT` 覆盖 | 地址会写进被注入的 skill，不是秘密；环境变量只作用于你发起的请求与 config 实参，注入工具只读本机 config.json |

## 归属表

| 事实 | 家 |
|---|---|
| 维护 agent 处理反馈的规则（不可信文本、先复现、放行、标状态）与查询/改状态的操作步骤 | [references/查询改进.md](references/查询改进.md)；与收集服务每次响应顶层的 `notice` 运行时副本同源，运行时有出入以 `notice` 为准 |
| 注入工具的命令、前置判定与异常处置 | [references/注入.md](references/注入.md) |
| 查询/登记接口的字段全集、状态码、限额数字 | agent_feedback 仓库 `docs/spec/2026-09-29-agent-feedback-eng-spec.md` §3（维护者核对用；本 skill 只带操作所需的最小契约） |
| 使用者 agent 的提交规则 | 宿主 skill 内 `agent-feedback/FEEDBACK.md` |
