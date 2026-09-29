# 依赖声明：host-skills

> 宿主 skill 群（维护者负责、被注入反馈模块的 skill 源头）。它们不是包依赖，而是注入工具与提交脚本读写的对象；本声明记"本项目用了宿主 skill 的什么"。

- 上游与当前版本：维护者本机的宿主 skill 源头（dw-system 仓、`~/projects/skills/*`），无统一版本
- 确认时间：2026-09-29

## 用到的部分

| 接口名 | 调用点（文件:行） | 注意事项 |
|---|---|---|
| `SKILL.md` frontmatter `name` | `packages/injector/src/inject.ts:64`、`packages/module/src/submit.ts:83`（均经 `packages/shared/src/frontmatter.ts` 解析） | 名称必须由宿主声明，缺失时注入拒绝 |
| `SKILL.md` frontmatter `metadata.version` | `packages/module/src/submit.ts:93` | 只认这一处；其他版本写法视为未声明 |
| `SKILL.md` 正文末尾 | `packages/injector/src/inject.ts:120` | 只追加一句带 `<!-- agent-feedback -->` 标记的引导语 |

## 业务域地图

| 业务域 | 一句话 | 事实卡 |
|---|---|---|
| 分发与门禁 | 宿主 skill 怎么到使用者手里、宿主仓库有哪些会被注入触发的门禁 | `dependencies/host-skills/分发与门禁.md` |
