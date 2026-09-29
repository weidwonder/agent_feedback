# 真实宿主 skill 头部

场景：宿主 skill 的 `SKILL.md` 头部（frontmatter）在真实世界里写法并不统一。提交脚本与注入工具只从这里读宿主名称与版本（spec §4.3、PRD「版本读取」），所以用真实 skill 的头部做输入，比手写的整齐样例更能暴露解析问题。

来源：维护者本机的真实 skill（`~/.claude/skills` 与 `~/projects/skills` 下，2026-09-29 采集）。只截取头部（自首行 `---` 到收尾 `---`）原样保存，正文不入库；无头部的样本保存整个文件。未改动内容，仅按场景语义重命名。不含凭证，无需 `secrets/`。

| 样本 | 覆盖特征标签 | 来源 skill |
|---|---|---|
| `SKILL-名称含冒号-块描述-metadata双引号版本.md` | 名称含冒号 / 描述为折叠块标量 / metadata 下 version 双引号 / metadata 内还有 author 等其他键 / 有 keywords 行内数组 | `ak-tech-graph` |
| `SKILL-无metadata-块描述.md` | 无 metadata / 描述为折叠块标量 | `freshrss` |
| `SKILL-顶层version-metadata无版本-嵌套列表.md` | 顶层 version / metadata 存在但无 version / metadata 内含嵌套列表 | `lark-whiteboard` |
| `SKILL-metadata单引号版本.md` | metadata 下 version 单引号 / 描述超长（约 900 字符） | `agentic-principle` |
| `SKILL-无frontmatter.md` | 文件不以 `---` 开头（仓库根遗留的指向文件） | `word-excel-auto-linker` |

去重说明：另有 3 类真实头部（metadata 双引号版本、无 metadata、顶层 version 且 metadata 无版本）的标签集分别是上表某一行的子集，按淘汰规则未收。

预期（由头部原文手工读出，见使用它们的测试）：

| 样本 | 名称 | 版本 |
|---|---|---|
| 名称含冒号… | `ak:tech-graph` | `1.1.1` |
| 无metadata… | `freshrss` | 无 |
| 顶层version… | `lark-whiteboard` | 无（版本只认 metadata 下的 version） |
| metadata单引号… | `agentic-principle` | `0.10.0` |
| 无frontmatter | 读不到名称 | — |
