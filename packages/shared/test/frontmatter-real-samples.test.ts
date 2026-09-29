// 真实宿主 skill 头部样本（test/fixtures/真实宿主skill头部/）：名称与版本的预期值由头部原文手工读出。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, validateSkillName } from '../src/index.ts';

const dir = fileURLToPath(new URL('../../../test/fixtures/真实宿主skill头部/', import.meta.url));
const read = (name: string): string => readFileSync(dir + name, 'utf8');

const cases: [string, { name?: string; version?: string }][] = [
  ['SKILL-名称含冒号-块描述-metadata双引号版本.md', { name: 'ak:tech-graph', version: '1.1.1' }],
  ['SKILL-无metadata-块描述.md', { name: 'freshrss' }],
  ['SKILL-顶层version-metadata无版本-嵌套列表.md', { name: 'lark-whiteboard' }],
  ['SKILL-metadata单引号版本.md', { name: 'agentic-principle', version: '0.10.0' }],
  ['SKILL-无frontmatter.md', {}],
];

for (const [file, expected] of cases) {
  test(`真实头部 ${file}：名称与版本`, () => {
    const fm = parseFrontmatter(read(file));
    assert.equal(fm.name, expected.name);
    assert.equal(fm.version, expected.version);
    if (expected.name !== undefined) assert.deepEqual(validateSkillName(expected.name), { ok: true, value: expected.name });
  });
}
