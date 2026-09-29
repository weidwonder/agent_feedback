import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSkillName } from '../src/index.ts';

test('validateSkillName：trim 后返回', () => {
  assert.deepEqual(validateSkillName('  my-skill  '), { ok: true, value: 'my-skill' });
});

test('validateSkillName：边界 1 与 100 个码点合规，101 不合规', () => {
  assert.equal(validateSkillName('a').ok, true);
  assert.equal(validateSkillName('😀'.repeat(100)).ok, true);
  assert.equal(validateSkillName('a'.repeat(101)).ok, false);
});

test('validateSkillName：空白、非字符串不合规并给出提示', () => {
  for (const raw of ['', '   ', undefined, null, 5, {}]) {
    const r = validateSkillName(raw);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /1–100/);
  }
});
