import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter } from '../src/index.ts';

test('读取顶层 name 与 metadata.version', () => {
  const t = '---\nname: my-skill\ndescription: x\nmetadata:\n  author: a\n  version: 1.2.3\n---\n# 正文\n';
  assert.deepEqual(parseFrontmatter(t), { name: 'my-skill', version: '1.2.3' });
});

test('兼容 CRLF 与成对引号', () => {
  const t = '---\r\nname: "my-skill"\r\nmetadata:\r\n  version: \'2.0\'\r\n---\r\n';
  assert.deepEqual(parseFrontmatter(t), { name: 'my-skill', version: '2.0' });
});

test('只认 metadata 下的 version，顶层 version 与正文中的 name 不算', () => {
  const t = '---\nversion: 9\nname: a\n---\nname: b\nmetadata:\n  version: 3\n';
  assert.deepEqual(parseFrontmatter(t), { name: 'a' });
});

test('缩进的 name 不算顶层；metadata 结束后的缩进 version 不算', () => {
  const t = '---\nmetadata:\n  name: x\nother:\n  version: 5\n---\n';
  assert.deepEqual(parseFrontmatter(t), {});
});

test('没有 frontmatter 或未以 --- 开头返回空对象', () => {
  assert.deepEqual(parseFrontmatter('# 标题\nname: a\n'), {});
  assert.deepEqual(parseFrontmatter(''), {});
});

test('name 值为空视为缺失', () => {
  assert.deepEqual(parseFrontmatter('---\nname:\n---\n'), {});
});
