# 仓库地图卡 — agent-feedback

## 职责
skill 反馈收集服务的 monorepo：服务端收录与查询、注入到宿主 skill 的提交模块、把模块写进宿主目录并登记的注入工具，以及三者共用的字段契约（packages/shared）。

## 业务域地图

划分维度：按业务能力切；每个域对应一条从提交到处理的链路环节，而不是按包切（提交收录横跨 shared 与 server，反馈模块横跨 shared 与 module）。

| 业务域 | 一句话 | 域卡 |
|---|---|---|
| 提交收录 | 校验并收下一次提交：字段契约、限额、事务落库、拒收计数、到期清理与备份 | `cards/agent-feedback/提交收录.md` |
| 登记 | 哪些 skill 名允许提交：现名、旧名、启停与改名 | `cards/agent-feedback/登记.md` |
| 查询通道 | 维护 agent 用查询令牌取清单、取详情、改状态 | `cards/agent-feedback/查询通道.md` |
| 管理界面 | 维护者的服务端渲染后台：登录、反馈处理、登记、令牌与密码 | `cards/agent-feedback/管理界面.md` |
| 反馈模块 | 随宿主 skill 分发的提交脚本与 agent 规则文件 | `cards/agent-feedback/反馈模块.md` |
| 注入 | 把反馈模块写进宿主 skill 目录并向服务登记的命令行工具 | `cards/agent-feedback/注入.md` |

## 对外入口总览

| 入口 | 类型 | 归属域 |
|---|---|---|
| POST /v1/submissions | HTTP（无令牌，按来源地址限额） | 提交收录 |
| GET /v1/registry/check、POST /v1/registry | HTTP（登记令牌） | 登记 |
| GET /v1/feedback、GET/PATCH /v1/feedback/:id | HTTP（查询令牌） | 查询通道 |
| /admin/* | HTTP（会话 cookie，服务端渲染） | 管理界面 |
| dist/submit.mjs | 宿主目录内的脚本 | 反馈模块 |
| agent-feedback config / inject | CLI | 注入 |

## 跨域陷阱
- 字段契约只有 `packages/shared` 一份：服务端、提交脚本、管理界面不得各写一套校验、长度上限、枚举或中文显示名，要改先改 shared
- 库内时间一律 UTC ISO，业务日与到期口径固定北京时间；换算的权威在 `packages/server/src/time.ts`（管理界面显示格式化例外，见管理界面域卡）

## 上下游
- 上游（谁调我）：宿主 skill 内的提交脚本、维护 agent、维护者浏览器、注入工具
- 下游（我调谁）：宿主 skill 源头文件，见 `engineering-context/dependencies/host-skills.md`

## 确认
2026-09-29｜来源：读过 packages/shared、server、module、injector 的 src 与 module/assets
