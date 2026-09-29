---
name: agentic-principle
description: 设计、编排与评审 Agentic 系统的架构原则。判断一个需求该做成纯程序、单 Agent Chat、单 Agentic、父子 Agentic 还是 Agentic 工作流，并据此设计系统提示词、工具与 Skill 体系、多 Agent 协作链路、运行时边界（终止条件、步数与成本上限、重试与幂等、记忆与租户隔离、延迟与成本预算）、安全边界（自主级别、审批闸门、注入防护）与测试评测方案；也用于在既有平台上增量新增 skill 或工具、Review 已实现的 Agent 项目，以及定位已上线 Agent 的行为异常。当用户提到 设计或编排 agent、多 agent 协作、子代理拆解、agentic 工作流、agent loop 或 harness 工程、agent 架构选型、系统提示词设计、agent 提示词太长或注意力涣散、agent 停不下来或死循环、agent 重试与超时与幂等、agent 记忆或 RAG 怎么设计、多租户数据隔离、token 成本与延迟预算、agent 输出被截断、工具或 MCP 返回太长吃满上下文、要不要把文件内容直接塞进提示词、agent 能不能自己拍板执行、提示词注入防护、给现有 agent 加工具或 skill、agent 工作流怎么测、评审 agent 项目、agent 行为异常或跑偏、agent 不调工具、agent 结论凭空出现、agent 上线后行为突然变了、怎么排查 agent 问题、怎么看 agent 的对话记录或 trace、agent 出问题没有现场可查、要不要留中间结果快照、怎么回放某一个环节、agent 调试模式怎么设计、后台 agent 怎么收集反馈、怎么知道提示词哪里写歧义了、agent 说不清被什么误导、复盘模式、bias 上报、debug agent、design agent architecture、review agent system 时使用。不用于与 Agent 架构无关的业务代码实现；不生成插件形态的 agent 配置文件（那是 agent-creator / agent-development 的职责）；不审查 Skill 本身的写法质量（那是 skill-principle 的职责）。
metadata:
  version: '0.10.0'
---
