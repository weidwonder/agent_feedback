// 并发下的额度守恒：同时到达的提交不超额、计数不丢。
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getCounter, getRejectionCount } from '../src/counters.ts';
import { beijingDay } from '../src/time.ts';
import { count, postJson, registerSkill, startTestServer, validBody } from './helpers.ts';

const codeOf = async (res: Response): Promise<string> => ((await res.json()) as { error: { code: string } }).error.code;

describe('并发额度', () => {
  it('全站上限 3：10 个来源各异的合规请求同时到达，恰好收录 3 次，其余 429 global_limit，被拒的不计入收录', async () => {
    const s = await startTestServer({ env: { GLOBAL_DAILY_LIMIT: '3' } });
    try {
      registerSkill(s.db, 'race-skill');
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => postJson(s.baseUrl, '/v1/submissions', validBody('race-skill'), { 'X-Forwarded-For': `20.0.0.${i + 1}` })),
      );
      const statuses = results.map((r) => r.status);
      assert.equal(statuses.filter((c) => c === 201).length, 3);
      assert.equal(statuses.filter((c) => c === 429).length, 7);
      for (const r of results.filter((x) => x.status === 429)) assert.equal(await codeOf(r), 'global_limit');
      const day = beijingDay(s.ctx.now());
      assert.equal(count(s.db, 'submissions'), 3);
      assert.equal(count(s.db, 'feedback'), 3);
      assert.equal(getCounter(s.db, day, 'global_accepted'), 3);
      assert.equal(getRejectionCount(s.db, day, 'limit'), 7);
    } finally {
      await s.close();
    }
  });

  it('同一来源上限 5：9 个请求同时到达，恰好 5 个进入处理，其余 429 ip_limit，来源计数为 9', async () => {
    const s = await startTestServer({ env: { IP_DAILY_LIMIT: '5' } });
    try {
      registerSkill(s.db, 'race-skill');
      const results = await Promise.all(
        Array.from({ length: 9 }, () => postJson(s.baseUrl, '/v1/submissions', validBody('race-skill'), { 'X-Forwarded-For': '30.0.0.1' })),
      );
      const statuses = results.map((r) => r.status);
      assert.equal(statuses.filter((c) => c === 201).length, 5);
      assert.equal(statuses.filter((c) => c === 429).length, 4);
      for (const r of results.filter((x) => x.status === 429)) assert.equal(await codeOf(r), 'ip_limit');
      const day = beijingDay(s.ctx.now());
      assert.equal(getCounter(s.db, day, 'ip:30.0.0.1'), 9);
      assert.equal(count(s.db, 'feedback'), 5);
      assert.equal(getRejectionCount(s.db, day, 'limit'), 4);
    } finally {
      await s.close();
    }
  });
});
