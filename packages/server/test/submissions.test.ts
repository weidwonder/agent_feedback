import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { getCounter, getRejectionCount } from '../src/counters.ts';
import { beijingDay } from '../src/time.ts';
import { bearer, count, makeToken, postJson, registerSkill, startTestServer, validBody } from './helpers.ts';
import type { TestServer } from './helpers.ts';

const SKILL = 'zentao-skill';

describe('POST /v1/submissions', () => {
  let s: TestServer;
  let queryToken: string;
  before(async () => {
    s = await startTestServer();
    registerSkill(s.db, SKILL);
    registerSkill(s.db, 'disabled-skill', false);
    queryToken = makeToken(s.db, 'query');
  });
  after(() => s.close());

  const day = () => beijingDay(s.ctx.now());
  const rejections = (r: 'limit' | 'unregistered' | 'invalid') => getRejectionCount(s.db, day(), r);

  it('合规提交返回 201，并能用查询令牌读回', async () => {
    const res = await postJson(s.baseUrl, '/v1/submissions', validBody(SKILL, {
      items: [
        { title: '甲', description: '问题甲', type: 'bug', impact: 'blocking', resolved: false, occurrences: 2 },
        { title: '乙', description: '问题乙', type: 'suggestion', impact: 'minor', resolved: true, suggestedFix: '这样改', occurrences: 1 },
      ],
    }));
    assert.equal(res.status, 201);
    const out = (await res.json()) as { submissionId: number; feedbackIds: string[] };
    assert.equal(out.feedbackIds.length, 2);
    assert.match(out.feedbackIds[0]!, /^FB-\d{4}$/);

    const list = await fetch(`${s.baseUrl}/v1/feedback?skill=${SKILL}`, { headers: bearer(queryToken) });
    assert.equal(list.status, 200);
    const body = (await list.json()) as { total: number; items: { id: string; title: string; submission: Record<string, unknown> }[] };
    assert.equal(body.total, 2);
    const item = body.items.find((i) => i.id === out.feedbackIds[0])!;
    assert.equal(item.title, '甲');
    assert.equal(item.submission.taskSummary, '查询禅道任务');
    assert.equal(item.submission.sessionId, 's-abc123def456');
    assert.deepEqual(item.submission.relatedSkills, [{ name: 'other-skill', description: '辅助' }]);
    assert.equal(getCounter(s.db, day(), 'global_accepted'), 1); // 按提交计数：两条问题只计一次收录
  });

  it('请求体超 64 KiB：413，计 IP 与 invalid 拒收，不落库', async () => {
    const before = count(s.db, 'feedback');
    const inv = rejections('invalid');
    const ipBefore = getCounter(s.db, day(), 'ip:9.9.9.1');
    const big = validBody(SKILL, { padding: 'x'.repeat(70000) });
    const res = await postJson(s.baseUrl, '/v1/submissions', big, { 'X-Forwarded-For': '9.9.9.1' });
    assert.equal(res.status, 413);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'payload_too_large');
    assert.equal(count(s.db, 'feedback'), before);
    assert.equal(rejections('invalid'), inv + 1);
    assert.equal(getCounter(s.db, day(), 'ip:9.9.9.1'), ipBefore + 1);
  });

  it('非法 JSON、字段不合规、条数超限：400 且计 invalid，不落库', async () => {
    const cases: { body: unknown; code: string; field?: string }[] = [
      { body: '{not json', code: 'invalid_json' },
      { body: validBody(SKILL, { moduleVersion: '' }), code: 'invalid_field', field: 'moduleVersion' },
      { body: validBody(SKILL, { extra: 1 }), code: 'invalid_field', field: 'extra' },
      { body: validBody(SKILL, { items: [] }), code: 'invalid_field' },
      {
        body: validBody(SKILL, {
          items: Array.from({ length: 6 }, () => ({ title: 't', description: 'd', type: 'bug', impact: 'minor', resolved: false, occurrences: 1 })),
        }),
        code: 'too_many_items',
      },
    ];
    for (const c of cases) {
      const feedbackBefore = count(s.db, 'feedback');
      const inv = rejections('invalid');
      const res = await postJson(s.baseUrl, '/v1/submissions', c.body);
      assert.equal(res.status, 400, JSON.stringify(c.body).slice(0, 60));
      const err = ((await res.json()) as { error: { code: string; field?: string } }).error;
      assert.equal(err.code, c.code);
      if (c.field) assert.equal(err.field, c.field);
      assert.equal(count(s.db, 'feedback'), feedbackBefore);
      assert.equal(rejections('invalid'), inv + 1);
    }
  });

  it('skill 未登记、已停用、是旧名：403 且计 unregistered', async () => {
    const skillId = registerSkill(s.db, 'renamed-new');
    s.db.prepare("INSERT INTO skill_old_names (name, skill_id, renamed_at) VALUES ('renamed-old', ?, ?)").run(skillId, new Date().toISOString());
    for (const name of ['nobody', 'disabled-skill', 'renamed-old', 'Zentao-Skill']) {
      const feedbackBefore = count(s.db, 'feedback');
      const un = rejections('unregistered');
      const res = await postJson(s.baseUrl, '/v1/submissions', validBody(name));
      assert.equal(res.status, 403, name);
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'skill_not_registered');
      assert.equal(count(s.db, 'feedback'), feedbackBefore);
      assert.equal(rejections('unregistered'), un + 1);
    }
  });

  it('X-Forwarded-For 取最后一段作为来源地址，并去掉 ::ffff: 前缀', async () => {
    await postJson(s.baseUrl, '/v1/submissions', validBody(SKILL), { 'X-Forwarded-For': '1.1.1.1, ::ffff:2.2.2.2' });
    assert.equal(getCounter(s.db, day(), 'ip:2.2.2.2'), 1);
    assert.equal(getCounter(s.db, day(), 'ip:1.1.1.1'), 0);
  });
});

describe('提交限额', () => {
  it('未配置来源限额：前 50 次收录，第 51 次 429 ip_limit', async () => {
    const s = await startTestServer({ env: { IP_DAILY_LIMIT: '' } });
    try {
      registerSkill(s.db, SKILL);
      const h = { 'X-Forwarded-For': '3.3.3.50' };
      for (let i = 1; i <= 50; i++) {
        assert.equal((await postJson(s.baseUrl, '/v1/submissions', validBody(SKILL), h)).status, 201, `第 ${i} 次`);
      }
      const res = await postJson(s.baseUrl, '/v1/submissions', validBody(SKILL), h);
      assert.equal(res.status, 429);
      const err = ((await res.json()) as { error: { code: string; message: string } }).error;
      assert.equal(err.code, 'ip_limit');
      assert.match(err.message, /50/);
      const day = beijingDay(s.ctx.now());
      assert.equal(getCounter(s.db, day, 'ip:3.3.3.50'), 51);
      assert.equal(getRejectionCount(s.db, day, 'limit'), 1);
      assert.equal(count(s.db, 'submissions'), 50);
    } finally {
      await s.close();
    }
  });

  it('显式配置限额 5：同一来源第 6 次请求 429 ip_limit，计 limit 拒收；换来源不受影响', async () => {
    const s = await startTestServer({ env: { IP_DAILY_LIMIT: '5' } });
    try {
      registerSkill(s.db, SKILL);
      const h = { 'X-Forwarded-For': '3.3.3.3' };
      for (let i = 0; i < 5; i++) {
        assert.equal((await postJson(s.baseUrl, '/v1/submissions', validBody(SKILL), h)).status, 201);
      }
      const res = await postJson(s.baseUrl, '/v1/submissions', validBody(SKILL), h);
      assert.equal(res.status, 429);
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'ip_limit');
      assert.equal(getRejectionCount(s.db, beijingDay(s.ctx.now()), 'limit'), 1);
      assert.equal(count(s.db, 'submissions'), 5);
      const other = await postJson(s.baseUrl, '/v1/submissions', validBody(SKILL), { 'X-Forwarded-For': '4.4.4.4' });
      assert.equal(other.status, 201);
    } finally {
      await s.close();
    }
  });

  it('被拒的请求（含无效提交）同样计入 IP 次数', async () => {
    const s = await startTestServer({ env: { IP_DAILY_LIMIT: '2' } });
    try {
      registerSkill(s.db, SKILL);
      assert.equal((await postJson(s.baseUrl, '/v1/submissions', '{bad')).status, 400);
      assert.equal((await postJson(s.baseUrl, '/v1/submissions', '{bad')).status, 400);
      assert.equal((await postJson(s.baseUrl, '/v1/submissions', validBody(SKILL))).status, 429);
    } finally {
      await s.close();
    }
  });

  it('GLOBAL_DAILY_LIMIT=2：第 3 次合规提交 429 global_limit，且不增加收录计数', async () => {
    const s = await startTestServer({ env: { GLOBAL_DAILY_LIMIT: '2' } });
    try {
      registerSkill(s.db, SKILL);
      const day = beijingDay(s.ctx.now());
      assert.equal((await postJson(s.baseUrl, '/v1/submissions', validBody(SKILL))).status, 201);
      assert.equal((await postJson(s.baseUrl, '/v1/submissions', validBody(SKILL))).status, 201);
      const feedbackBefore = count(s.db, 'feedback');
      const res = await postJson(s.baseUrl, '/v1/submissions', validBody(SKILL));
      assert.equal(res.status, 429);
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'global_limit');
      assert.equal(getCounter(s.db, day, 'global_accepted'), 2);
      assert.equal(count(s.db, 'feedback'), feedbackBefore);
      assert.equal(getRejectionCount(s.db, day, 'limit'), 1);
      // 次日恢复
      s.setNow(new Date(s.ctx.now().getTime() + 86400 * 1000));
      assert.equal((await postJson(s.baseUrl, '/v1/submissions', validBody(SKILL))).status, 201);
    } finally {
      await s.close();
    }
  });
});
