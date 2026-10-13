// 解析 SKILL.md 头部 frontmatter：只认顶层 name 与 metadata 下的 version（spec §4.3）。
/** 取 YAML 标量值：引号内原样保留（不支持 '' 与 \" 转义）；引号外"行首或空白后的 #"起为注释；引号未闭合按普通标量处理。 */
function scalarValue(v: string): string {
  const s = v.trim();
  if (s[0] === '"' || s[0] === "'") {
    const end = s.indexOf(s[0], 1);
    if (end > 0) return s.slice(1, end);
  }
  return s.replace(/(^|\s)#.*$/, '').trim();
}

export function parseFrontmatter(text: string): { name?: string; version?: string } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0] !== '---') return {};
  const result: { name?: string; version?: string } = {};
  let inMetadata = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimEnd() === '---') break;
    if (line.trim() === '') continue;
    const indented = /^\s/.test(line);
    if (!indented) {
      inMetadata = /^metadata:\s*$/.test(line);
      const m = /^name:(.*)$/.exec(line);
      if (m) {
        const v = scalarValue(m[1]);
        if (v) result.name = v;
      }
    } else if (inMetadata) {
      const m = /^\s+version:(.*)$/.exec(line);
      if (m) {
        const v = scalarValue(m[1]);
        if (v) result.version = v;
      }
    }
  }
  return result;
}
