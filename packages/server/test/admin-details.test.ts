import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setAdmin } from '../src/auth.ts';
import { listSkills } from '../src/admin/skills.ts';
import { seedSubmission, startTestServer } from './helpers.ts';
import type { TestServer } from './helpers.ts';

const PASSWORD = 'correct horse battery';

describe('管理界面细节', () => {
  let ts: TestServer;
  let cookie = '';
  before(async () => {
    ts = await startTestServer();
    setAdmin(ts.db, 'boss', PASSWORD, new Date());
    const res = await fetch(ts.baseUrl + '/admin/login', {
      method: 'POST',
      redirect: 'manual',
      headers: { Origin: ts.baseUrl, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'boss', password: PASSWORD }).toString(),
    });
    assert.equal(res.status, 303);
    cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
  });
  after(() => ts.close());

  it('未知 /admin/* 路径：未登录 302 到登录页，已登录返回 HTML 404 页', async () => {
    const anon = await fetch(ts.baseUrl + '/admin/nope/deeper', { redirect: 'manual' });
    assert.equal(anon.status, 302);
    assert.equal(anon.headers.get('location'), '/admin/login');
    const authed = await fetch(ts.baseUrl + '/admin/nope', { headers: { Cookie: cookie } });
    assert.equal(authed.status, 404);
    assert.match(authed.headers.get('content-type') ?? '', /text\/html/);
    const html = await authed.text();
    assert.ok(html.includes('页面不存在'));
    assert.ok(html.includes('href="/admin/skills"'), '使用统一布局');
  });

  it('近 7 天收录按 7 个北京自然日（含今天），版本分布不限 7 天', () => {
    const now = new Date('2026-09-29T12:00:00Z'); // 北京 09-29 20:00
    // 6 天前（北京 09-23）00:00 = UTC 09-22 16:00：边界内；前一毫秒：边界外
    seedSubmission(ts.db, { skill: 'win', moduleVersion: '2.0.0', receivedAt: '2026-09-22T16:00:00.000Z' });
    seedSubmission(ts.db, { skill: 'win', moduleVersion: '1.0.0', receivedAt: '2026-09-22T15:59:59.999Z' });
    seedSubmission(ts.db, { skill: 'win', moduleVersion: '1.0.0', receivedAt: '2026-05-01T00:00:00.000Z' });
    const row = listSkills(ts.db, now).find((r) => r.name === 'win')!;
    assert.equal(row.recentCount, 1);
    assert.deepEqual(row.versions, [
      { moduleVersion: '1.0.0', count: 2 },
      { moduleVersion: '2.0.0', count: 1 },
    ]);
  });
});
