// 管理界面反馈列表：表单参数到筛选条件的映射（9 个筛选字段 + 时间范围），与查询通道同一组筛选语义。
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setAdmin } from '../src/auth.ts';
import { seedSubmission, startTestServer } from './helpers.ts';
import type { TestServer } from './helpers.ts';

const NOW = new Date('2026-09-29T04:00:00Z'); // 北京 2026-09-29 12:00
const DAY = 86400 * 1000;
const ago = (days: number): string => new Date(NOW.getTime() - days * DAY).toISOString();

describe('管理界面列表筛选', () => {
  let ts: TestServer;
  let cookie = '';

  const titlesOf = async (query: string): Promise<string[]> => {
    const res = await fetch(`${ts.baseUrl}/admin/feedback?${query}`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(res.status, 200, query);
    const html = await res.text();
    return [...new Set(html.match(/FLT-[A-Za-z0-9]+/g) ?? [])].sort();
  };

  before(async () => {
    ts = await startTestServer({ now: NOW });
    setAdmin(ts.db, 'boss', 'correct horse battery', NOW);
    const login = await fetch(`${ts.baseUrl}/admin/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ts.baseUrl },
      body: new URLSearchParams({ username: 'boss', password: 'correct horse battery' }).toString(),
    });
    assert.equal(login.status, 303);
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;

    const base = { skill: 'flt', receivedAt: ago(1) };
    seedSubmission(ts.db, { ...base, items: [{ title: 'FLT-A', type: 'bug', impact: 'blocking', resolved: false, status: 'pending' }] });
    seedSubmission(ts.db, { ...base, items: [{ title: 'FLT-B', type: 'bug', impact: 'minor', resolved: true, status: 'pending' }] });
    seedSubmission(ts.db, { ...base, items: [{ title: 'FLT-C', type: 'suggestion', impact: 'blocking', resolved: false, status: 'valid' }] });
    seedSubmission(ts.db, { ...base, moduleVersion: '0.9.0', items: [{ title: 'FLT-D', type: 'friction', impact: 'workaround', resolved: false, status: 'pending' }] });
    seedSubmission(ts.db, { ...base, agentName: 'gpt', items: [{ title: 'FLT-E', type: 'friction', impact: 'workaround', resolved: false, status: 'pending' }] });
    seedSubmission(ts.db, { ...base, harnessName: 'cursor', items: [{ title: 'FLT-F', type: 'missing_capability', impact: 'minor', resolved: false, status: 'pending' }] });
    seedSubmission(ts.db, { skill: 'flt-other', receivedAt: ago(1), items: [{ title: 'FLT-G', type: 'bug', impact: 'blocking', resolved: false, status: 'pending' }] });
    // 不同时间段：3 天前、15 天前、100 天前、300 天前
    for (const [title, days] of [['FLT-T3', 3], ['FLT-T15', 15], ['FLT-T100', 100], ['FLT-T300', 300]] as const) {
      seedSubmission(ts.db, { skill: 'flt-time', receivedAt: ago(days), items: [{ title, status: 'pending' }] });
    }
  });
  after(() => ts.close());

  it('单个筛选字段各自生效（待处理为默认状态）', async () => {
    assert.deepEqual(await titlesOf('skill=flt&type=bug'), ['FLT-A', 'FLT-B']);
    assert.deepEqual(await titlesOf('skill=flt&impact=blocking&status=all'), ['FLT-A', 'FLT-C']);
    assert.deepEqual(await titlesOf('skill=flt&status=valid'), ['FLT-C']);
    assert.deepEqual(await titlesOf('skill=flt&resolved=true'), ['FLT-B']);
    assert.deepEqual(await titlesOf('skill=flt&resolved=false'), ['FLT-A', 'FLT-D', 'FLT-E', 'FLT-F']);
    assert.deepEqual(await titlesOf('skill=flt&moduleVersion=0.9.0'), ['FLT-D']);
    assert.deepEqual(await titlesOf('skill=flt&agentName=gpt'), ['FLT-E']);
    assert.deepEqual(await titlesOf('skill=flt&harnessName=cursor'), ['FLT-F']);
    assert.deepEqual(await titlesOf('skill=flt-other'), ['FLT-G'], 'skill 筛选不串到别的 skill');
  });

  it('多字段组合时结果同时满足全部条件', async () => {
    assert.deepEqual(await titlesOf('skill=flt&type=bug&impact=blocking&resolved=false'), ['FLT-A']);
    assert.deepEqual(await titlesOf('skill=flt&type=friction&impact=workaround&agentName=gpt'), ['FLT-E']);
    assert.deepEqual(await titlesOf('skill=flt&type=bug&impact=blocking&resolved=true'), []);
  });

  it('时间范围：近 7 天 / 近 30 天 / 近 6 个月 / 自定义起止', async () => {
    assert.deepEqual(await titlesOf('skill=flt-time'), ['FLT-T3'], '默认近 7 天');
    assert.deepEqual(await titlesOf('skill=flt-time&range=7d'), ['FLT-T3']);
    assert.deepEqual(await titlesOf('skill=flt-time&range=30d'), ['FLT-T15', 'FLT-T3']);
    assert.deepEqual(await titlesOf('skill=flt-time&range=6m'), ['FLT-T100', 'FLT-T15', 'FLT-T3']);
    // 自定义：北京日期 2026-06-21（100 天前）当天，含两端
    assert.deepEqual(await titlesOf('skill=flt-time&range=custom&from=2026-06-21&to=2026-06-21'), ['FLT-T100']);
    assert.deepEqual(await titlesOf('skill=flt-time&range=custom&to=2026-01-01'), ['FLT-T300'], '只给结束日期');
  });

  it('近 7 / 30 天含今天在内共 7 / 30 个北京自然日：边界毫秒精确', async () => {
    // NOW 为北京 2026-09-29 12:00；近 7 天起点 = 北京 09-23 00:00 = 2026-09-22T16:00:00Z
    const edge = (title: string, iso: string) =>
      seedSubmission(ts.db, { skill: 'flt-edge', receivedAt: iso, items: [{ title, status: 'pending' }] });
    edge('FLT-E7OUT', '2026-09-22T15:59:59.999Z'); // 北京 7 天前（09-22）23:59:59.999
    edge('FLT-E7IN', '2026-09-22T16:00:00.000Z'); // 北京 6 天前（09-23）00:00:00
    edge('FLT-E30OUT', '2026-08-30T15:59:59.999Z'); // 北京 08-30 23:59:59.999
    edge('FLT-E30IN', '2026-08-30T16:00:00.000Z'); // 北京 08-31 00:00:00
    assert.deepEqual(await titlesOf('skill=flt-edge&range=7d'), ['FLT-E7IN']);
    assert.deepEqual(await titlesOf('skill=flt-edge&range=30d'), ['FLT-E30IN', 'FLT-E7IN', 'FLT-E7OUT']);
  });

  it('非法取值回退到默认，页面仍 200 且不报错', async () => {
    assert.deepEqual(await titlesOf('skill=flt&type=bogus&impact=bogus&resolved=maybe&range=1y&from=xx'), ['FLT-A', 'FLT-B', 'FLT-D', 'FLT-E', 'FLT-F']);
  });
});
