// 真实宿主 skill 头部样本（test/fixtures/真实宿主skill头部/）：名称与版本的预期值由头部原文手工读出。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, validateSkillName } from '../src/index.ts';

const dir = fileURLToPath(new URL('../../../test/fixtures/真实宿主skill头部/', import.meta.url));
const read = (name: string): string => readFileSync(dir + name, 'utf8');

// 预期值集中在 expected.json：样本文件名 -> { name, version? }；无头部的样本为 null
const expected: Record<string, { name: string; version?: string } | null> = JSON.parse(read('expected.json'));
const cases: [string, { name?: string; version?: string }][] = Object.entries(expected).map(([file, e]) => [file, e ?? {}]);

for (const [file, expected] of cases) {
  test(`真实头部 ${file}：名称与版本`, () => {
    const fm = parseFrontmatter(read(file));
    assert.equal(fm.name, expected.name);
    assert.equal(fm.version, expected.version);
    if (expected.name !== undefined) assert.deepEqual(validateSkillName(expected.name), { ok: true, value: expected.name });
  });
}
