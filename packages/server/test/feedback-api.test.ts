import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { NOTICE } from '@agent-feedback/shared';
import { bearer, makeToken, seedSubmission, startTestServer } from './helpers.ts';
import type { TestServer } from './helpers.ts';

interface ListBody {
  notice: string;
  total: number;
  items: { id: string; title: string; status: string }[];
}

describe('查询通道与 healthz', () => {
  let s: TestServer;
  let q: string;
  const ids: Record<string, number> = {};
  before(async () => {
    s = await startTestServer();
    q = makeToken(s.db, 'query');
    // 北京时间 2026-09-10 00:00 = UTC 09-09 16:00；09-10 23:59:59 = UTC 09-10 15:59:59
    ids.a = seedSubmission(s.db, { skill: 'sk', receivedAt: '2026-09-09T16:00:00.000Z', moduleVersion: '1.0.0', agentName: 'claude', harnessName: 'cc', items: [{ title: 'A', type: 'bug', impact: 'blocking', resolved: false }] })[0]!;
    ids.b = seedSubmission(s.db, { skill: 'sk', receivedAt: '2026-09-10T15:59:59.000Z', moduleVersion: '0.9.0', agentName: 'gpt', harnessName: 'codex', items: [{ title: 'B', type: 'friction', impact: 'workaround', resolved: true }, { title: 'B2', type: 'suggestion', impact: 'minor' }] })[0]!;
    ids.c = seedSubmission(s.db, { skill: 'sk', receivedAt: '2026-09-10T16:00:00.000Z', items: [{ title: 'C', status: 'done' }] })[0]!;
    seedSubmission(s.db, { skill: 'other', items: [{ title: 'O' }] });
  });
  after(() => s.close());

  const get = async (qs: string, token: string | null = q) => {
    const res = await fetch(`${s.baseUrl}/v1/feedback${qs}`, { headers: token ? bearer(token) : {} });
    return { status: res.status, body: (await res.json()) as ListBody & { error?: { code: string; field?: string } } };
  };
  const titles = (b: ListBody) => b.items.map((i) => i.title);

  it('/healthz 返回 200 ok', async () => {
    const res = await fetch(`${s.baseUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
  });

  it('缺 skill 400；skill 不存在返回空清单；带不可信标注；按收录时间倒序', async () => {
    const missing = await get('');
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error?.code, 'skill_required');
    const none = await get('?skill=nope');
    assert.equal(none.status, 200);
    assert.equal(none.body.total, 0);
    const all = await get('?skill=sk');
    assert.equal(all.body.notice, NOTICE);
    assert.deepEqual(titles(all.body), ['C', 'B2', 'B', 'A']);
    assert.ok(all.body.items.every((i) => (i as { notice?: string }).notice === NOTICE), '每条反馈都带 notice');
  });

  it('清单 limit 默认 20、上限 50', async () => {
    const big = await startTestServer();
    try {
      const token = makeToken(big.db, 'query');
      for (let i = 0; i < 25; i++) seedSubmission(big.db, { skill: 'many', items: [{ title: `T${i}` }] });
      const list = async (qs: string) =>
        (await (await fetch(`${big.baseUrl}/v1/feedback?skill=many${qs}`, { headers: bearer(token) })).json()) as ListBody;
      const def = await list('');
      assert.equal(def.items.length, 20);
      assert.equal(def.total, 25);
      assert.equal((await list('&limit=50')).items.length, 25);
    } finally {
      await big.close();
    }
  });

  it('9 个筛选字段各自生效', async () => {
    assert.deepEqual(titles((await get('?skill=sk&type=friction')).body), ['B']);
    assert.deepEqual(titles((await get('?skill=sk&impact=blocking')).body), ['A']);
    assert.deepEqual(titles((await get('?skill=sk&status=done')).body), ['C']);
    assert.deepEqual(titles((await get('?skill=sk&resolved=true')).body), ['B']);
    assert.deepEqual(titles((await get('?skill=sk&moduleVersion=0.9.0')).body), ['B2', 'B']);
    assert.deepEqual(titles((await get('?skill=sk&agentName=gpt')).body), ['B2', 'B']);
    assert.deepEqual(titles((await get('?skill=sk&harnessName=codex')).body), ['B2', 'B']);
    assert.deepEqual(titles((await get('?skill=sk&from=2026-09-10')).body), ['C', 'B2', 'B', 'A']);
  });

  it('from/to 按北京时间含两端；可与其他条件组合', async () => {
    assert.deepEqual(titles((await get('?skill=sk&from=2026-09-10&to=2026-09-10')).body), ['B2', 'B', 'A']);
    assert.deepEqual(titles((await get('?skill=sk&from=2026-09-11&to=2026-09-11')).body), ['C']);
    assert.deepEqual(titles((await get('?skill=sk&to=2026-09-09')).body), []);
    assert.deepEqual(titles((await get('?skill=sk&from=2026-09-10&to=2026-09-10&type=bug&impact=blocking')).body), ['A']);
  });

  it('分页：limit/offset 与 total', async () => {
    const page = await get('?skill=sk&limit=2&offset=1');
    assert.equal(page.body.total, 4);
    assert.deepEqual(titles(page.body), ['B2', 'B']);
  });

  it('非法筛选取值 400 invalid_field 并指出字段', async () => {
    for (const [qs, field] of [
      ['type=nope', 'type'], ['impact=x', 'impact'], ['status=all', 'status'], ['resolved=1', 'resolved'],
      ['from=2026-13-01', 'from'], ['to=abc', 'to'], ['limit=0', 'limit'], ['limit=51', 'limit'], ['offset=-1', 'offset'],
    ] as const) {
      const r = await get(`?skill=sk&${qs}`);
      assert.equal(r.status, 400, qs);
      assert.equal(r.body.error?.code, 'invalid_field');
      assert.equal(r.body.error?.field, field);
    }
  });

  it('详情支持数字与 FB- 编号，含同次提交的其他问题；不存在 404', async () => {
    const byNum = await fetch(`${s.baseUrl}/v1/feedback/${ids.b}`, { headers: bearer(q) });
    assert.equal(byNum.status, 200);
    const body = (await byNum.json()) as { notice: string; item: { id: string; title: string }; siblings: string[] };
    assert.equal(body.notice, NOTICE);
    assert.equal((body.item as { notice?: string }).notice, NOTICE);
    assert.equal(body.item.title, 'B');
    assert.equal(body.siblings.length, 1);
    const byFb = await fetch(`${s.baseUrl}/v1/feedback/${body.item.id}`, { headers: bearer(q) });
    assert.equal(byFb.status, 200);
    assert.equal((await fetch(`${s.baseUrl}/v1/feedback/99999`, { headers: bearer(q) })).status, 404);
    assert.equal((await fetch(`${s.baseUrl}/v1/feedback/abc`, { headers: bearer(q) })).status, 404);
  });

  it('PATCH 改状态后读回一致；非法状态 400；幂等；不存在 404', async () => {
    const patch = (id: string | number, body: unknown) =>
      fetch(`${s.baseUrl}/v1/feedback/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...bearer(q) },
        body: JSON.stringify(body),
      });
    for (let i = 0; i < 2; i++) {
      const res = await patch(ids.a!, { status: 'valid' });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { notice: string; item: { status: string; notice?: string } };
      assert.equal(body.item.status, 'valid');
      assert.equal(body.notice, NOTICE);
      assert.equal(body.item.notice, NOTICE);
    }
    assert.equal((await get('?skill=sk&status=valid')).body.items[0]?.title, 'A');
    const bad = await patch(ids.a!, { status: 'closed' });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { error: { code: string } }).error.code, 'invalid_status');
    assert.equal((await patch(99999, { status: 'done' })).status, 404);
    const back = await patch(ids.a!, { status: 'pending' });
    assert.equal(((await back.json()) as { item: { status: string } }).item.status, 'pending');
  });

  it('鉴权：无令牌与无效令牌 401；登记令牌 403', async () => {
    assert.equal((await get('?skill=sk', null)).status, 401);
    assert.equal((await get('?skill=sk', 'afq_bogus')).status, 401);
    assert.equal((await get('?skill=sk', makeToken(s.db, 'registry'))).status, 403);
    const res = await fetch(`${s.baseUrl}/v1/feedback/${ids.a}`, { method: 'PATCH', body: '{"status":"done"}' });
    assert.equal(res.status, 401);
  });

  it('查询令牌不能访问登记接口，不存在的路径 404', async () => {
    const res = await fetch(`${s.baseUrl}/v1/registry/check?name=sk`, { headers: bearer(q) });
    assert.equal(res.status, 403);
    assert.equal((await fetch(`${s.baseUrl}/v1/nothing`)).status, 404);
  });
});
