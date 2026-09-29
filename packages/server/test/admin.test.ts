import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { setAdmin } from '../src/auth.ts';
import { DELETED_LOG } from '../src/deletions.ts';
import { bumpRejection } from '../src/counters.ts';
import { beijingDay } from '../src/time.ts';
import { bearer, makeToken, postJson, registerSkill, seedSubmission, startTestServer, validBody } from './helpers.ts';
import type { TestServer } from './helpers.ts';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const PASSWORD = 'correct horse battery';

describe('管理界面', () => {
  let ts: TestServer;
  let cookie = '';
  let ipSeq = 0;

  const call = (
    path: string,
    opts: { method?: string; form?: Record<string, string>; cookie?: string | null; origin?: string | null; ip?: string; headers?: Record<string, string> } = {},
  ): Promise<Response> => {
    const headers: Record<string, string> = { ...opts.headers };
    const c = opts.cookie === undefined ? cookie : opts.cookie;
    if (c) headers.Cookie = c;
    const method = opts.method ?? (opts.form ? 'POST' : 'GET');
    if (method === 'POST' && opts.origin !== null) headers.Origin = opts.origin ?? ts.baseUrl;
    if (opts.ip) headers['X-Forwarded-For'] = opts.ip;
    if (opts.form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return fetch(ts.baseUrl + path, {
      method,
      headers,
      redirect: 'manual',
      ...(opts.form ? { body: new URLSearchParams(opts.form).toString() } : {}),
    });
  };
  const freshIp = () => `10.0.0.${++ipSeq}`;
  const cookieOf = (res: Response): string => {
    const raw = res.headers.get('set-cookie') ?? '';
    return raw.split(';')[0]!;
  };
  const login = async (password = PASSWORD, ip = freshIp()): Promise<Response> =>
    call('/admin/login', { form: { username: 'boss', password }, cookie: null, ip });

  before(async () => {
    ts = await startTestServer();
    setAdmin(ts.db, 'boss', PASSWORD, new Date());
    const res = await login();
    assert.equal(res.status, 303);
    cookie = cookieOf(res);
  });
  after(() => ts.close());

  it('未登录访问任何页面 302 到登录页，Bearer 令牌不能代替会话', async () => {
    for (const path of ['/admin', '/admin/feedback', '/admin/feedback/1', '/admin/skills', '/admin/settings']) {
      const res = await call(path, { cookie: null });
      assert.equal(res.status, 302, path);
      assert.equal(res.headers.get('location'), '/admin/login');
    }
    const q = makeToken(ts.db, 'query');
    const res = await call('/admin/settings', { cookie: null, headers: bearer(q) });
    assert.equal(res.status, 302);
    const post = await call('/admin/tokens', { form: { kind: 'query', name: 'x' }, cookie: null, headers: bearer(q) });
    assert.equal(post.status, 302);
    assert.equal((await (await call('/admin/login', { cookie: null })).text()).includes('登录'), true);
  });

  it('登录：错误密码提示、成功下发 HttpOnly cookie，退出后会话失效', async () => {
    const bad = await login('wrong password 12');
    assert.equal(bad.status, 401);
    assert.match(await bad.text(), /账号或密码不正确/);
    const wrongUser = await call('/admin/login', { form: { username: 'nobody', password: PASSWORD }, cookie: null, ip: freshIp() });
    assert.equal(wrongUser.status, 401);

    const ok = await login();
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), '/admin/feedback');
    const setCookie = ok.headers.get('set-cookie')!;
    assert.match(setCookie, /^af_session=[\w-]{43};/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.doesNotMatch(setCookie, /Secure/);
    const c = cookieOf(ok);
    assert.equal((await call('/admin/feedback', { cookie: c })).status, 200);
    const out = await call('/admin/logout', { method: 'POST', cookie: c });
    assert.equal(out.status, 303);
    assert.equal((await call('/admin/feedback', { cookie: c })).status, 302);
  });

  it('COOKIE_SECURE=1 时 cookie 带 Secure', async () => {
    const secure = await startTestServer({ env: { COOKIE_SECURE: '1' } });
    try {
      setAdmin(secure.db, 'boss', PASSWORD, new Date());
      const res = await fetch(secure.baseUrl + '/admin/login', {
        method: 'POST',
        redirect: 'manual',
        headers: { Origin: secure.baseUrl, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: 'boss', password: PASSWORD }).toString(),
      });
      assert.match(res.headers.get('set-cookie')!, /; Secure/);
    } finally {
      await secure.close();
    }
  });

  it('set-admin 设的密码可登录，且旧会话失效（AC-012 登录部分）', async () => {
    const other = await startTestServer();
    try {
      const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', MAIN, 'set-admin', 'alice'], {
        input: 'a long enough password\n',
        encoding: 'utf8',
        env: { ...process.env, DATA_DIR: other.dataDir },
      });
      assert.equal(r.status, 0, r.stderr);
      const post = (password: string) =>
        fetch(other.baseUrl + '/admin/login', {
          method: 'POST',
          redirect: 'manual',
          headers: { Origin: other.baseUrl, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ username: 'alice', password }).toString(),
        });
      assert.equal((await post('bad password 1234')).status, 401);
      const ok = await post('a long enough password');
      assert.equal(ok.status, 303);
      const sid = cookieOf(ok);
      assert.equal((await fetch(other.baseUrl + '/admin/feedback', { headers: { Cookie: sid }, redirect: 'manual' })).status, 200);
      const again = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', MAIN, 'set-admin', 'alice'], {
        input: 'another long password\n',
        encoding: 'utf8',
        env: { ...process.env, DATA_DIR: other.dataDir },
      });
      assert.equal(again.status, 0, again.stderr);
      assert.equal((await fetch(other.baseUrl + '/admin/feedback', { headers: { Cookie: sid }, redirect: 'manual' })).status, 302);
    } finally {
      await other.close();
    }
  });

  it('同 IP 登录失败 20 次后，正确密码也被拒（AC-013），其他 IP 不受影响', async () => {
    const ip = '203.0.113.9';
    for (let i = 0; i < 20; i++) {
      const res = await login('wrong password 12', ip);
      assert.equal(res.status, 401);
    }
    const blocked = await login(PASSWORD, ip);
    assert.equal(blocked.status, 429);
    assert.match(await blocked.text(), /今天登录失败次数过多，请明天再试/);
    assert.equal(blocked.headers.get('set-cookie'), null);
    assert.equal((await login(PASSWORD, '203.0.113.10')).status, 303);
  });

  it('跨源或缺来源的 POST 一律 403，同源 Referer 可代替 Origin', async () => {
    const id = seedSubmission(ts.db, { skill: 'origin-skill' })[0]!;
    const form = { status: 'valid' };
    assert.equal((await call(`/admin/feedback/${id}/status`, { form, origin: 'http://evil.example' })).status, 403);
    assert.equal((await call(`/admin/feedback/${id}/status`, { form, origin: null })).status, 403);
    assert.equal((await call('/admin/login', { form: { username: 'boss', password: PASSWORD }, cookie: null, origin: 'null' })).status, 403);
    const viaReferer = await call(`/admin/feedback/${id}/status`, { form, origin: null, headers: { Referer: `${ts.baseUrl}/admin/feedback/${id}` } });
    assert.equal(viaReferer.status, 303);
    const row = ts.db.prepare('SELECT status FROM feedback WHERE id = ?').get(id) as { status: string };
    assert.equal(row.status, 'valid');
  });

  it('列表默认只含待处理，可按状态、skill 筛选，输出转义，空结果有清除链接', async () => {
    const [pendingId] = seedSubmission(ts.db, { skill: 'list-skill', items: [{ title: '<script>alert(1)</script>' }] });
    seedSubmission(ts.db, { skill: 'list-skill', items: [{ title: '已确认问题', status: 'valid' }] });
    seedSubmission(ts.db, { skill: 'other-list-skill', items: [{ title: '别家问题' }] });
    seedSubmission(ts.db, { skill: 'list-skill', receivedAt: '2020-01-01T00:00:00.000Z', items: [{ title: '很久以前的问题' }] });

    const def = await (await call('/admin/feedback?skill=list-skill')).text();
    assert.ok(def.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!def.includes('<script>alert(1)'));
    assert.ok(!def.includes('已确认问题'));
    assert.ok(!def.includes('别家问题'));
    assert.ok(!def.includes('很久以前的问题'), '默认近 7 天');
    assert.ok(def.includes(`FB-${String(pendingId).padStart(4, '0')}`));

    const all = await (await call('/admin/feedback?skill=list-skill&status=all&range=custom&from=2019-01-01')).text();
    assert.ok(all.includes('已确认问题') && all.includes('很久以前的问题'));

    const empty = await (await call('/admin/feedback?skill=nope')).text();
    assert.ok(empty.includes('没有符合条件的反馈') && empty.includes('清除全部筛选'));
    assert.equal((await call('/admin/feedback?page=abc&type=bogus&from=xx')).status, 200);
  });

  it('列表分页：每页 20 条', async () => {
    seedSubmission(ts.db, {
      skill: 'page-skill',
      items: Array.from({ length: 25 }, (_, i) => ({ title: `分页问题${i}` })),
    });
    const p1 = await (await call('/admin/feedback?skill=page-skill')).text();
    assert.equal((p1.match(/分页问题\d+/g) ?? []).length, 20);
    assert.ok(p1.includes('第 1 / 2 页'));
    const p2 = await (await call('/admin/feedback?skill=page-skill&page=2')).text();
    assert.equal((p2.match(/分页问题\d+/g) ?? []).length, 5);
  });

  it('详情展示会话信息与同次提交的其他问题；改状态后提示；删除后查不到', async () => {
    const [a, b] = seedSubmission(ts.db, { skill: 'detail-skill', items: [{ title: '问题甲', resolved: true }, { title: '问题乙' }] });
    const page = await (await call(`/admin/feedback/${a}`)).text();
    for (const expect of ['问题甲', '任务', '已知：用户', 'detail-skill 1.0', '反馈模块版本', 'claude', 'claude-code', 's-seed', '建议', `/admin/feedback/${b}`]) {
      assert.ok(page.includes(expect), expect);
    }
    assert.ok((await (await call(`/admin/feedback/${b}`)).text()).includes('未解决，无'));

    const marked = await call(`/admin/feedback/${a}/status`, { form: { status: 'valid' } });
    assert.equal(marked.status, 303);
    const location = marked.headers.get('location')!;
    assert.ok((await (await call(location)).text()).includes('已标记为「有效」'));
    assert.equal((await call(`/admin/feedback/${a}/status`, { form: { status: 'bogus' } })).status, 400);
    assert.equal((await call('/admin/feedback/999999/status', { form: { status: 'valid' } })).status, 404);

    const del = await call(`/admin/feedback/${a}/delete`, { form: {} });
    assert.equal(del.status, 303);
    assert.ok((await (await call(del.headers.get('location')!)).text()).includes(`已删除 FB-${String(a).padStart(4, '0')}`));
    assert.equal((await call(`/admin/feedback/${a}`)).status, 404);
    assert.ok(readFileSync(join(ts.dataDir, DELETED_LOG), 'utf8').includes(String(a)));
    assert.equal((await call(`/admin/feedback/${b}`)).status, 200, '同次提交的其他问题保留');
  });

  it('登记页：列表、启停、改名冲突与历史归属、旧名提交 403', async () => {
    ts.db.prepare('DELETE FROM skills WHERE id NOT IN (SELECT skill_id FROM submissions)').run();
    seedSubmission(ts.db, { skill: 'ren-a', moduleVersion: '1.0.0', items: [{}, {}] });
    seedSubmission(ts.db, { skill: 'ren-a', moduleVersion: '1.0.0' });
    seedSubmission(ts.db, { skill: 'ren-a', moduleVersion: '0.9.0' });
    const idA = Number((ts.db.prepare("SELECT id FROM skills WHERE name = 'ren-a'").get() as { id: number }).id);
    const idB = registerSkill(ts.db, 'ren-b');

    const page = await (await call('/admin/skills')).text();
    assert.ok(page.includes('1.0.0 · 2 / 0.9.0 · 1'), '模块版本分布');
    assert.ok(page.includes('新增登记：对 skill 的源头运行注入工具'));
    assert.ok(page.includes('ren-a 的 4 条历史反馈都会归到新名称下'));

    // 启停：停用后提交被拒
    assert.equal((await call(`/admin/skills/${idB}/toggle`, { form: {} })).status, 303);
    assert.equal(Number((ts.db.prepare('SELECT enabled FROM skills WHERE id = ?').get(idB) as { enabled: number }).enabled), 0);
    assert.equal((await call(`/admin/skills/${idB}/toggle`, { form: {} })).status, 303);
    assert.equal(Number((ts.db.prepare('SELECT enabled FROM skills WHERE id = ?').get(idB) as { enabled: number }).enabled), 1);

    // 冲突：他人现名、空名、超长、原名
    for (const name of ['ren-b', '   ', 'x'.repeat(101), 'ren-a']) {
      const res = await call(`/admin/skills/${idA}/rename`, { form: { name } });
      assert.equal(res.status, 400, name);
      assert.match(await res.text(), /改名失败/);
    }

    // 成功改名
    const ok = await call(`/admin/skills/${idA}/rename`, { form: { name: '  ren-a2  ' } });
    assert.equal(ok.status, 303);
    const q = makeToken(ts.db, 'query');
    const list = (await (await fetch(`${ts.baseUrl}/v1/feedback?skill=ren-a2`, { headers: bearer(q) })).json()) as { total: number };
    assert.equal(list.total, 4, '历史反馈归新名');
    const oldList = (await (await fetch(`${ts.baseUrl}/v1/feedback?skill=ren-a`, { headers: bearer(q) })).json()) as { total: number };
    assert.equal(oldList.total, 0);
    const oldNames = ts.db.prepare('SELECT name FROM skill_old_names WHERE skill_id = ?').all(idA) as { name: string }[];
    assert.deepEqual(oldNames.map((r) => r.name), ['ren-a']);

    // 旧名提交 403；他人不能改成别人的旧名
    const sub = await postJson(ts.baseUrl, '/v1/submissions', validBody('ren-a'), { 'X-Forwarded-For': freshIp() });
    assert.equal(sub.status, 403);
    const clash = await call(`/admin/skills/${idB}/rename`, { form: { name: 'ren-a' } });
    assert.equal(clash.status, 400);

    // 改回自己的旧名：允许，并从旧名表移除，同时新旧名互换
    assert.equal((await call(`/admin/skills/${idA}/rename`, { form: { name: 'ren-a' } })).status, 303);
    const after = ts.db.prepare('SELECT name FROM skill_old_names WHERE skill_id = ? ORDER BY name').all(idA) as { name: string }[];
    assert.deepEqual(after.map((r) => r.name), ['ren-a2']);
    assert.equal((await call('/admin/skills/99999/rename', { form: { name: 'zzz' } })).status, 404);
  });

  it('登记页：空态与近 7 天拒收 7 行', async () => {
    const empty = await startTestServer();
    try {
      setAdmin(empty.db, 'boss', PASSWORD, new Date());
      const now = new Date('2026-09-29T12:00:00Z');
      empty.setNow(now);
      bumpRejection(empty.db, beijingDay(now), 'limit');
      bumpRejection(empty.db, beijingDay(now), 'limit');
      bumpRejection(empty.db, beijingDay(new Date(now.getTime() - 86400_000)), 'invalid');
      const l = await fetch(empty.baseUrl + '/admin/login', {
        method: 'POST',
        redirect: 'manual',
        headers: { Origin: empty.baseUrl, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: 'boss', password: PASSWORD }).toString(),
      });
      const html = await (await fetch(empty.baseUrl + '/admin/skills', { headers: { Cookie: cookieOf(l) } })).text();
      assert.ok(html.includes('还没有登记任何 skill'));
      assert.ok(html.includes('<td>2026-09-29</td><td>2</td><td>0</td><td>0</td>'));
      assert.ok(html.includes('<td>2026-09-28</td><td>0</td><td>0</td><td>1</td>'));
      assert.equal((html.match(/<td>2026-\d\d-\d\d<\/td>/g) ?? []).length, 7);
    } finally {
      await empty.close();
    }
  });

  it('令牌：生成后完整令牌只显示一次，列表不含明文，撤销后立即 401', async () => {
    const res = await call('/admin/tokens', { form: { kind: 'query', name: '维护 agent' } });
    assert.equal(res.status, 200);
    const html = await res.text();
    const token = /afq_[\w-]{43}/.exec(html)?.[0];
    assert.ok(token, '成功页展示完整令牌');
    assert.ok(html.includes('令牌只显示这一次，关闭后无法再查看'));

    const settings = await (await call('/admin/settings')).text();
    assert.ok(settings.includes('维护 agent') && !settings.includes(token));
    seedSubmission(ts.db, { skill: 'token-skill' });
    const ok = await fetch(`${ts.baseUrl}/v1/feedback?skill=token-skill`, { headers: bearer(token) });
    assert.equal(ok.status, 200);

    const row = ts.db.prepare("SELECT id FROM tokens WHERE name = '维护 agent'").get() as { id: number };
    const revoke = await call(`/admin/tokens/${row.id}/revoke`, { form: {} });
    assert.equal(revoke.status, 303);
    assert.equal((await fetch(`${ts.baseUrl}/v1/feedback?skill=token-skill`, { headers: bearer(token) })).status, 401);
    assert.ok((await (await call('/admin/settings')).text()).includes('已撤销'));

    const reg = await call('/admin/tokens', { form: { kind: 'registry', name: '注入' } });
    assert.match(await reg.text(), /afr_[\w-]{43}/);
    assert.equal((await call('/admin/tokens', { form: { kind: 'other', name: 'x' } })).status, 400);
    assert.equal((await call('/admin/tokens', { form: { kind: 'query', name: '  ' } })).status, 400);
  });

  it('修改密码：需当前密码、至少 12 字符、两次一致；成功后旧密码失效', async () => {
    const own = await startTestServer();
    try {
      setAdmin(own.db, 'boss', PASSWORD, new Date());
      const post = (path: string, form: Record<string, string>, c?: string) =>
        fetch(own.baseUrl + path, {
          method: 'POST',
          redirect: 'manual',
          headers: { Origin: own.baseUrl, 'Content-Type': 'application/x-www-form-urlencoded', ...(c ? { Cookie: c } : {}) },
          body: new URLSearchParams(form).toString(),
        });
      const c = cookieOf(await post('/admin/login', { username: 'boss', password: PASSWORD }));
      const wrongCurrent = await post('/admin/password', { current: 'nope nope nope', next: 'brand new password', confirm: 'brand new password' }, c);
      assert.equal(wrongCurrent.status, 400);
      assert.match(await wrongCurrent.text(), /当前密码不正确/);
      assert.equal((await post('/admin/password', { current: PASSWORD, next: 'short', confirm: 'short' }, c)).status, 400);
      assert.equal((await post('/admin/password', { current: PASSWORD, next: 'brand new password', confirm: 'different one here' }, c)).status, 400);
      const ok = await post('/admin/password', { current: PASSWORD, next: 'brand new password', confirm: 'brand new password' }, c);
      assert.equal(ok.status, 303);
      const fresh = cookieOf(ok);
      assert.equal((await fetch(own.baseUrl + '/admin/settings', { headers: { Cookie: fresh }, redirect: 'manual' })).status, 200);
      assert.equal((await fetch(own.baseUrl + '/admin/settings', { headers: { Cookie: c }, redirect: 'manual' })).status, 302);
      assert.equal((await post('/admin/login', { username: 'boss', password: PASSWORD })).status, 401);
      assert.equal((await post('/admin/login', { username: 'boss', password: 'brand new password' })).status, 303);
    } finally {
      await own.close();
    }
  });

  it('页面零外部资源，带安全响应头', async () => {
    const res = await call('/admin/feedback');
    assert.match(res.headers.get('content-security-policy')!, /default-src 'none'/);
    const html = await res.text();
    assert.doesNotMatch(html, /https?:\/\//);
  });
});
