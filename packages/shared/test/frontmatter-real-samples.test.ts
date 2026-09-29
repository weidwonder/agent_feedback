// 真实宿主 skill 头部样本（test/fixtures/真实宿主skill头部/）：名称与版本的预期值由头部原文手工读出。
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, validateSkillName } from '../src/index.ts';

const dir = fileURLToPath(new URL('../../../test/fixtures/真实宿主skill头部/', import.meta.url));
const read = (name: string): string => readFileSync(dir + name, 'utf8');

// 预期值集中在 expected.json：样本文件名 -> { name, version? }；无头部的样本为 null
const expected: Record<string, { name: string; version?: string } | null> = JSON.parse(read('expected.json'));
// 防漏登记：expected.json 的键集合必须等于样本目录下 SKILL-*.md 的文件名集合
test('expected.json 登记的样本与目录下 SKILL-*.md 一致', () => {
  const files = readdirSync(dir).filter((f) => /^SKILL-.*\.md$/.test(f)).sort();
  assert.ok(files.length > 0);
  assert.deepEqual(Object.keys(expected).sort(), files);
});
const cases: [string, { name?: string; version?: string }][] = Object.entries(expected).map(([file, e]) => [file, e ?? {}]);

for (const [file, expected] of cases) {
  test(`真实头部 ${file}：名称与版本`, () => {
    const fm = parseFrontmatter(read(file));
    assert.equal(fm.name, expected.name);
    assert.equal(fm.version, expected.version);
    if (expected.name !== undefined) assert.deepEqual(validateSkillName(expected.name), { ok: true, value: expected.name });
  });
}
