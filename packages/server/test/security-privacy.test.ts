// 安全与隐私：XSS 转义、令牌越权、日志不含敏感信息、拒收内容不落盘。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { setAdmin } from '../src/auth.ts';
import { setLogWriter } from '../src/http.ts';
import { bearer, count, makeToken, postJson, registerSkill, seedSubmission, startTestServer, validBody } from './helpers.ts';
import type { TestServer } from './helpers.ts';

const PASSWORD = 'correct horse battery';

// 递归列出目录下所有文件（含子目录），避免漏查子目录里的落盘内容
function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFilesRecursive(p));
    else out.push(p);
  }
  return out;
}

describe('安全与隐私', () => {
  let ts: TestServer;
  let cookie = '';
  let queryToken = '';
  let registryToken = '';
  const logs: string[] = [];
  let ipSeq = 0;

  const call = (
    path: string,
    opts: { form?: Record<string, string>; cookie?: string | null; headers?: Record<string, string>; method?: string } = {},
  ): Promise<Response> => {
    const headers: Record<string, string> = { ...opts.headers };
    const c = opts.cookie === undefined ? cookie : opts.cookie;
    if (c) headers.Cookie = c;
    const method = opts.method ?? (opts.form ? 'POST' : 'GET');
    if (method === 'POST') headers.Origin = ts.baseUrl;
    headers['X-Forwarded-For'] = `10.1.0.${++ipSeq}`;
    if (opts.form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return fetch(ts.baseUrl + path, {
      method,
      headers,
      redirect: 'manual',
      ...(opts.form ? { body: new URLSearchParams(opts.form).toString() } : {}),
    });
  };

  before(async () => {
    setLogWriter((line) => logs.push(line));
    ts = await startTestServer();
    setAdmin(ts.db, 'boss', PASSWORD, new Date());
    const res = await call('/admin/login', { form: { username: 'boss', password: PASSWORD }, cookie: null });
    assert.equal(res.status, 303);
    cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
    queryToken = makeToken(ts.db, 'query', 'q');
    registryToken = makeToken(ts.db, 'registry', 'r');
  });
  after(async () => {
    setLogWriter(() => {});
    await ts.close();
  });

  it('提交里的 HTML 在列表、详情、登记页、设置页、登录页与筛选回显中全部被转义', async () => {
    const tag = (k: string) => `<u id=xss-${k}>`;
    const skillName = tag('skill');
    registerSkill(ts.db, skillName);
    const body = validBody(skillName, {
      session: {
        sessionId: 's-xss',
        taskSummary: tag('task'),
        userInfo: tag('user'),
        userInfoSource: 'guessed',
        agentName: tag('agent'),
        harnessName: tag('harness'),
        relatedSkills: [{ name: tag('rel'), description: tag('reldesc') }],
      },
      items: [
        { title: tag('title'), description: tag('desc'), type: 'bug', impact: 'minor', resolved: true, suggestedFix: tag('fix'), occurrences: 1 },
      ],
    });
    const created = await postJson(ts.baseUrl, '/v1/submissions', body);
    assert.equal(created.status, 201);
    const fbId = ((await created.json()) as { feedbackIds: string[] }).feedbackIds[0]!;

    const tokenForm = await call('/admin/tokens', { form: { kind: 'query', name: tag('tokenname') } });
    assert.equal(tokenForm.status, 200);
    const loginFail = await call('/admin/login', { form: { username: tag('loginuser'), password: 'wrong-password-000' }, cookie: null });

    const q = encodeURIComponent(skillName);
    const pages: [string, string][] = [
      ['列表', await (await call(`/admin/feedback?skill=${q}&status=all`)).text()],
      ['详情', await (await call(`/admin/feedback/${fbId}`)).text()],
      ['登记页', await (await call('/admin/skills')).text()],
      ['设置页', await (await call('/admin/settings')).text()],
      ['令牌生成页', await tokenForm.text()],
      ['登录失败页', await loginFail.text()],
      ['筛选回显', await (await call(`/admin/feedback?skill=${tag('q')}&agentName=${tag('qa')}&harnessName=${tag('qh')}`)).text()],
    ];
    for (const [name, html] of pages) {
      assert.ok(!html.includes('<u id=xss-'), `${name}：出现未转义的标签`);
    }
    const detail = pages[1]![1];
    for (const k of ['task', 'user', 'agent', 'harness', 'rel', 'reldesc', 'title', 'desc', 'fix']) {
      assert.ok(detail.includes(`&lt;u id=xss-${k}&gt;`), `详情应含转义后的 ${k}`);
    }
    assert.ok(pages[2]![1].includes('&lt;u id=xss-skill&gt;'));
    assert.ok(pages[3]![1].includes('&lt;u id=xss-tokenname&gt;'));
  });

  it('查询令牌与登记令牌不能代替会话调用任何管理写路由，数据不变', async () => {
    const [fb] = seedSubmission(ts.db, { skill: 'guard-skill', items: [{ title: '守卫问题' }] });
    const skillId = Number((ts.db.prepare("SELECT id FROM skills WHERE name = 'guard-skill'").get() as { id: number }).id);
    const tokensBefore = count(ts.db, 'tokens');
    const targets: [string, Record<string, string>][] = [
      ['/admin/tokens', { kind: 'query', name: 'evil' }],
      [`/admin/skills/${skillId}/toggle`, {}],
      [`/admin/skills/${skillId}/rename`, { name: 'hijacked' }],
      [`/admin/feedback/${fb}/status`, { status: 'invalid' }],
      [`/admin/feedback/${fb}/delete`, {}],
      ['/admin/password', { current: PASSWORD, next: 'brand-new-password-1', confirm: 'brand-new-password-1' }],
    ];
    for (const token of [queryToken, registryToken]) {
      for (const [path, form] of targets) {
        const res = await call(path, { form, cookie: null, headers: bearer(token) });
        assert.equal(res.status, 302, `${path} 应回登录页`);
        assert.equal(res.headers.get('location'), '/admin/login', path);
      }
    }
    assert.equal(count(ts.db, 'tokens'), tokensBefore, '没有生成新令牌');
    const skill = ts.db.prepare('SELECT name, enabled FROM skills WHERE id = ?').get(skillId) as { name: string; enabled: number };
    assert.deepEqual({ ...skill }, { name: 'guard-skill', enabled: 1 });
    const row = ts.db.prepare('SELECT status FROM feedback WHERE id = ?').get(fb!) as { status: string };
    assert.equal(row.status, 'pending');
    // 原密码仍然可用
    assert.equal((await call('/admin/login', { form: { username: 'boss', password: PASSWORD }, cookie: null })).status, 303);
  });

  it('管理界面没有新增登记入口：POST /admin/skills 不存在，登记名单不变', async () => {
    const before = count(ts.db, 'skills');
    const res = await call('/admin/skills', { form: { name: 'sneaky-new-skill' } });
    assert.equal(res.status, 404);
    assert.equal(count(ts.db, 'skills'), before);
  });

  it('查询通道没有删除入口；PATCH 只认 status，附带的其他字段不会改反馈内容', async () => {
    const [fb] = seedSubmission(ts.db, { skill: 'guard-skill', items: [{ title: '原标题' }] });
    const del = await fetch(`${ts.baseUrl}/v1/feedback/${fb}`, { method: 'DELETE', headers: bearer(queryToken) });
    assert.equal(del.status, 404);
    assert.ok(ts.db.prepare('SELECT 1 AS x FROM feedback WHERE id = ?').get(fb!), '反馈仍在');

    const res = await fetch(`${ts.baseUrl}/v1/feedback/${fb}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...bearer(queryToken) },
      body: JSON.stringify({ status: 'done', title: '被篡改', description: '被篡改', type: 'suggestion' }),
    });
    assert.equal(res.status, 200);
    const row = ts.db.prepare('SELECT title, description, type, status FROM feedback WHERE id = ?').get(fb!) as Record<string, string>;
    assert.deepEqual({ ...row }, { title: '原标题', description: '描述', type: 'bug', status: 'done' });
  });

  it('拒收的提交内容不落盘：三类拒收后，数据目录任何文件里都找不到被拒内容；收录的内容能找到（对照）', async () => {
    registerSkill(ts.db, 'privacy-skill');
    const mark = (k: string) => `PRIVMARK-${k}-内容`;
    const withItem = (skill: string, k: string, extra: Record<string, unknown> = {}) =>
      validBody(skill, {
        items: [{ title: mark(k).slice(0, 30), description: mark(k), type: 'bug', impact: 'minor', resolved: false, occurrences: 1 }],
        ...extra,
      });
    // unregistered
    assert.equal((await postJson(ts.baseUrl, '/v1/submissions', withItem('privacy-nobody', 'unreg'))).status, 403);
    // invalid：字段不合规（moduleVersion 为空）
    assert.equal((await postJson(ts.baseUrl, '/v1/submissions', withItem('privacy-skill', 'inv', { moduleVersion: '' }))).status, 400);
    // invalid：非法 JSON 里夹带内容
    assert.equal((await postJson(ts.baseUrl, '/v1/submissions', `{"x":"${mark('badjson')}"`)).status, 400);
    // invalid：超大请求体
    assert.equal((await postJson(ts.baseUrl, '/v1/submissions', withItem('privacy-skill', 'big', { padding: 'x'.repeat(70000) }))).status, 413);
    // 收录的对照
    assert.equal((await postJson(ts.baseUrl, '/v1/submissions', withItem('privacy-skill', 'accepted'))).status, 201);

    const haystack = listFilesRecursive(ts.dataDir).map((f) => readFileSync(f));
    const found = (k: string) => haystack.some((buf) => buf.includes(mark(k)));
    assert.equal(found('accepted'), true, '对照：收录的内容应在数据文件中（否则本检查没有意义）');
    for (const k of ['unreg', 'inv', 'badjson', 'big']) assert.equal(found(k), false, `拒收内容 ${k} 不应落盘`);
  });

  it('日志不含令牌、密码、cookie 与提交内容，但确实有日志输出', async () => {
    logs.length = 0;
    const secretBody = validBody('privacy-skill', {
      items: [{ title: '日志标记', description: 'LOGMARK-描述内容', type: 'bug', impact: 'minor', resolved: false, occurrences: 1 }],
    });
    await postJson(ts.baseUrl, '/v1/submissions', secretBody);
    await postJson(ts.baseUrl, '/v1/submissions', validBody('log-nobody', { session: { ...(secretBody.session as object), taskSummary: 'LOGMARK-拒收内容' } }));
    await fetch(`${ts.baseUrl}/v1/feedback?skill=privacy-skill`, { headers: bearer(queryToken) });
    await fetch(`${ts.baseUrl}/v1/feedback?skill=privacy-skill`, { headers: bearer('afq_wrong-token-value') });
    const login = await call('/admin/login', { form: { username: 'boss', password: PASSWORD }, cookie: null });
    const freshCookie = (login.headers.get('set-cookie') ?? '').split(';')[0]!;
    await call('/admin/feedback', { cookie: freshCookie });
    await call('/admin/login', { form: { username: 'boss', password: 'LOGMARK-wrong-password' }, cookie: null });

    assert.ok(logs.length >= 8, `应有请求日志，实际 ${logs.length} 行`);
    assert.ok(logs.some((l) => l.includes('event=submission_accepted')) && logs.some((l) => l.includes('event=submission_rejected')));
    const all = logs.join('\n');
    const cookieValue = freshCookie.split('=')[1]!;
    for (const secret of [queryToken, registryToken, 'afq_wrong-token-value', PASSWORD, 'LOGMARK', cookieValue, cookie.split('=')[1]!]) {
      assert.ok(!all.includes(secret), `日志不应含 ${secret.slice(0, 12)}…`);
    }
  });
});
