import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { run } from '../src/db.ts';
import { bearer, makeToken, postJson, registerSkill, startTestServer } from './helpers.ts';
import type { TestServer } from './helpers.ts';

describe('登记接口', () => {
  let s: TestServer;
  let reg: string;
  before(async () => {
    s = await startTestServer();
    reg = makeToken(s.db, 'registry');
  });
  after(() => s.close());

  const check = async (name: string, token = reg) => {
    const res = await fetch(`${s.baseUrl}/v1/registry/check?name=${encodeURIComponent(name)}`, { headers: bearer(token) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it('unknown 后登记 created:true，重复登记 created:false 且停用状态不变', async () => {
    assert.deepEqual((await check('my-skill')).body, { state: 'unknown' });
    const first = await postJson(s.baseUrl, '/v1/registry', { name: 'my-skill' }, bearer(reg));
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { name: 'my-skill', enabled: true, created: true });
    assert.deepEqual((await check('my-skill')).body, { state: 'registered', enabled: true });

    run(s.db, "UPDATE skills SET enabled = 0 WHERE name = 'my-skill'");
    const again = await postJson(s.baseUrl, '/v1/registry', { name: 'my-skill' }, bearer(reg));
    assert.deepEqual(await again.json(), { name: 'my-skill', enabled: false, created: false });
    assert.deepEqual((await check('my-skill')).body, { state: 'registered', enabled: false });
  });

  it('旧名：检查返回 old_name 与现名，登记 409', async () => {
    const id = registerSkill(s.db, 'new-name');
    s.db.prepare("INSERT INTO skill_old_names (name, skill_id, renamed_at) VALUES ('old-name', ?, ?)").run(id, new Date().toISOString());
    assert.deepEqual((await check('old-name')).body, { state: 'old_name', currentName: 'new-name' });
    const res = await postJson(s.baseUrl, '/v1/registry', { name: 'old-name' }, bearer(reg));
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'old_name');
  });

  it('名称非法返回 400 invalid_field', async () => {
    for (const body of [{}, { name: '  ' }, { name: 'x'.repeat(101) }, { name: 5 }]) {
      const res = await postJson(s.baseUrl, '/v1/registry', body, bearer(reg));
      assert.equal(res.status, 400);
    }
    assert.equal((await fetch(`${s.baseUrl}/v1/registry/check`, { headers: bearer(reg) })).status, 400);
  });

  it('查询令牌调用登记接口 403；无令牌与无效令牌 401；撤销后立即 401', async () => {
    const q = makeToken(s.db, 'query');
    assert.equal((await check('x', q)).status, 403);
    assert.equal((await postJson(s.baseUrl, '/v1/registry', { name: 'x' }, bearer(q))).status, 403);
    assert.equal((await fetch(`${s.baseUrl}/v1/registry/check?name=x`)).status, 401);
    assert.equal((await check('x', 'afr_bogus')).status, 401);

    const temp = makeToken(s.db, 'registry', 'temp');
    assert.equal((await check('x', temp)).status, 200);
    run(s.db, "UPDATE tokens SET revoked_at = ? WHERE name = 'temp'", new Date().toISOString());
    const res = await check('x', temp);
    assert.equal(res.status, 401);
    assert.equal((res.body.error as { code: string }).code, 'unauthorized');
  });

  it('令牌只以哈希入库，使用后记录最近使用时间', async () => {
    const token = makeToken(s.db, 'registry', 'audit');
    await check('x', token);
    const row = s.db.prepare("SELECT token_hash, last_used_at FROM tokens WHERE name = 'audit'").get()!;
    assert.notEqual(row.token_hash, token);
    assert.ok(row.last_used_at);
  });
});
