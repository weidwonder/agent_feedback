import type { IncomingMessage, ServerResponse } from 'node:http';
import { FEEDBACK_TYPES, IMPACTS, LABELS, STATUSES, charLength } from '@agent-feedback/shared';
import type { Status } from '@agent-feedback/shared';
import type { FeedbackFilters } from '../feedback-query.ts';
import type { AppContext } from '../app.ts';
import {
  DUMMY_PASSWORD_HASH,
  MIN_PASSWORD_LENGTH,
  SESSION_TTL_MS,
  createSession,
  createToken,
  destroySession,
  getSession,
  hashPassword,
  verifyPassword,
} from '../auth.ts';
import { bumpCounter, getCounter } from '../counters.ts';
import { deleteFeedback } from '../deletions.ts';
import { queryAll, queryOne, run } from '../db.ts';
import { formatFeedbackId, getFeedback, listFeedback, parseFeedbackId, setStatus } from '../feedback-query.ts';
import { clientIp, log, parseCookies, readBody } from '../http.ts';
import type { Handler, Router } from '../http.ts';
import { DAY_MS, beijingDay, isValidDay, monthsAgoUtc } from '../time.ts';
import {
  feedbackDetailPage,
  feedbackListPage,
  loginPage,
  notFoundPage,
  settingsPage,
  skillsPage,
  tokenCreatedPage,
} from './views.ts';
import type { ListForm, TokenListRow } from './views.ts';
import { listSkills, recentRejections, renameSkill, toggleSkill } from './skills.ts';

const SESSION_COOKIE = 'af_session';
const SESSION_MAX_AGE_S = SESSION_TTL_MS / 1000;
const LOGIN_FAIL_LIMIT = 20;
const PAGE_SIZE = 20;
const FORM_MAX_BYTES = 64 * 1024;

const SECURITY_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function sendHtml(res: ServerResponse, status: number, html: string, extra: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Length': Buffer.byteLength(html), ...extra });
  res.end(html);
}

function redirect(res: ServerResponse, status: 302 | 303, location: string, extra: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-store', 'Content-Length': 0, ...extra });
  res.end();
}

function sendForbidden(res: ServerResponse, message: string): void {
  sendHtml(res, 403, `<!doctype html><meta charset="utf-8"><title>403</title><p>${message}</p>`);
}

/** POST 表单（application/x-www-form-urlencoded）解析；超限返回 null。 */
async function readForm(req: IncomingMessage): Promise<Record<string, string> | null> {
  const raw = await readBody(req, FORM_MAX_BYTES);
  if (raw === null) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw.toString('utf8'))) out[k] = v;
  return out;
}

/** Origin（缺失时 Referer）必须与请求 Host 同源。 */
function sameOrigin(req: IncomingMessage): boolean {
  const source = req.headers.origin ?? req.headers.referer;
  const host = req.headers.host;
  if (!source || !host) return false;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

function sessionCookie(value: string, maxAge: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

const text = (form: Record<string, string>, key: string): string => form[key] ?? '';

function parseListForm(url: URL): ListForm {
  const get = (k: string) => url.searchParams.get(k) ?? '';
  const oneOf = (k: string, allowed: readonly string[], def: string) => (allowed.includes(get(k)) ? get(k) : def);
  const day = (k: string) => (isValidDay(get(k)) ? get(k) : '');
  return {
    skill: get('skill'),
    type: oneOf('type', FEEDBACK_TYPES, ''),
    impact: oneOf('impact', IMPACTS, ''),
    status: oneOf('status', [...STATUSES, 'all'], 'pending'),
    resolved: oneOf('resolved', ['true', 'false'], ''),
    range: oneOf('range', ['7d', '30d', '6m', 'custom'], '7d'),
    from: day('from'),
    to: day('to'),
    moduleVersion: get('moduleVersion'),
    agentName: get('agentName'),
    harnessName: get('harnessName'),
  };
}

function toFilters(form: ListForm, now: Date, page: number): FeedbackFilters {
  const f: FeedbackFilters = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, status: form.status as Status | 'all' };
  if (form.skill) f.skill = form.skill;
  if (form.type) f.type = form.type as FeedbackFilters['type'];
  if (form.impact) f.impact = form.impact as FeedbackFilters['impact'];
  if (form.resolved) f.resolved = form.resolved === 'true';
  if (form.moduleVersion) f.moduleVersion = form.moduleVersion;
  if (form.agentName) f.agentName = form.agentName;
  if (form.harnessName) f.harnessName = form.harnessName;
  if (form.range === 'custom') {
    if (form.from) f.from = form.from;
    if (form.to) f.to = form.to;
  } else if (form.range === '6m') {
    f.from = beijingDay(new Date(monthsAgoUtc(now, 6)));
  } else {
    f.from = beijingDay(new Date(now.getTime() - (form.range === '30d' ? 29 : 6) * DAY_MS));
  }
  return f;
}

interface AdminRow {
  username: string;
  password_hash: string;
}

export function registerAdminRoutes(router: Router, ctx: AppContext): void {
  const { db, config } = ctx;

  const sessionId = (req: IncomingMessage): string | undefined => parseCookies(req)[SESSION_COOKIE];
  const loggedIn = (req: IncomingMessage): boolean => {
    const id = sessionId(req);
    return id !== undefined && getSession(db, id, ctx.now());
  };

  /** POST 先验同源（403），页面路由再验会话（未登录 302 到登录页）。 */
  const guarded =
    (handler: Handler, opts: { public?: boolean } = {}): Handler =>
    async (req, res, params, url) => {
      if (req.method === 'POST' && !sameOrigin(req)) return sendForbidden(res, '请求来源不合法');
      if (!opts.public && !loggedIn(req)) return redirect(res, 302, '/admin/login');
      await handler(req, res, params, url);
    };

  const formOr413 = async (req: IncomingMessage, res: ServerResponse): Promise<Record<string, string> | null> => {
    let form: Record<string, string> | null;
    try {
      form = await readForm(req);
    } catch {
      return null;
    }
    if (form === null) sendHtml(res, 413, '<!doctype html><meta charset="utf-8"><p>请求体过大</p>');
    return form;
  };

  // ---------- 登录 / 退出 ----------

  router.get('/admin', guarded((_req, res) => redirect(res, 302, '/admin/feedback')));

  router.get(
    '/admin/login',
    guarded((_req, res) => sendHtml(res, 200, loginPage(null)), { public: true }),
  );

  router.post(
    '/admin/login',
    guarded(async (req, res) => {
      const form = await formOr413(req, res);
      if (form === null) return;
      const ip = clientIp(req, config.trustProxy);
      const now = ctx.now();
      const day = beijingDay(now);
      const scope = `login_fail:${ip}`;
      if (getCounter(db, day, scope) >= LOGIN_FAIL_LIMIT) {
        log('login_blocked', { ip });
        return sendHtml(res, 429, loginPage('今天登录失败次数过多，请明天再试'));
      }
      const admin = queryOne<AdminRow>(db, 'SELECT username, password_hash FROM admin WHERE id = 1');
      // 无论用户名对错都跑一次 scrypt，再合并判断，避免时序泄露用户名。
      const passwordOk = verifyPassword(text(form, 'password'), admin?.password_hash ?? DUMMY_PASSWORD_HASH);
      const ok = admin !== null && text(form, 'username') === admin.username && passwordOk;
      if (!ok) {
        bumpCounter(db, day, scope);
        log('login_failed', { ip });
        return sendHtml(res, 401, loginPage('账号或密码不正确'));
      }
      const id = createSession(db, now);
      redirect(res, 303, '/admin/feedback', { 'Set-Cookie': sessionCookie(id, SESSION_MAX_AGE_S, config.cookieSecure) });
    }, { public: true }),
  );

  router.post(
    '/admin/logout',
    guarded((req, res) => {
      const id = sessionId(req);
      if (id) destroySession(db, id);
      redirect(res, 303, '/admin/login', { 'Set-Cookie': sessionCookie('', 0, config.cookieSecure) });
    }, { public: true }),
  );

  // ---------- 反馈 ----------

  router.get(
    '/admin/feedback',
    guarded((_req, res, _params, url) => {
      const form = parseListForm(url);
      const pageRaw = url.searchParams.get('page') ?? '';
      let page = /^\d{1,6}$/.test(pageRaw) && Number(pageRaw) >= 1 ? Number(pageRaw) : 1;
      const now = ctx.now();
      let { total, items } = listFeedback(db, toFilters(form, now, page));
      // 页码越界（总数 > 0 却落在最后一页之后）时收回到最后一页
      const lastPage = Math.ceil(total / PAGE_SIZE);
      if (total > 0 && page > lastPage) {
        page = lastPage;
        ({ total, items } = listFeedback(db, toFilters(form, now, page)));
      }
      const skillNames = queryAll<{ name: string }>(db, 'SELECT name FROM skills ORDER BY name').map((r) => r.name);
      const deleted = url.searchParams.get('deleted');
      const deletedId = deleted ? parseFeedbackId(deleted) : null;
      sendHtml(
        res,
        200,
        feedbackListPage({
          form,
          skillNames,
          items,
          total,
          page,
          pageSize: PAGE_SIZE,
          flash: deletedId ? `已删除 ${formatFeedbackId(deletedId)}` : null,
        }),
      );
    }),
  );

  const notFound = (res: ServerResponse) =>
    sendHtml(res, 404, notFoundPage('反馈不存在'));

  router.get(
    '/admin/feedback/:id',
    guarded((_req, res, params, url) => {
      const id = parseFeedbackId(params.id!);
      const found = id === null ? null : getFeedback(db, id);
      if (!found) return notFound(res);
      const marked = url.searchParams.get('marked');
      const flash = marked && (STATUSES as readonly string[]).includes(marked) ? `已标记为「${LABELS.status[marked as Status]}」` : null;
      sendHtml(res, 200, feedbackDetailPage(found.item, found.siblings, flash));
    }),
  );

  router.post(
    '/admin/feedback/:id/status',
    guarded(async (req, res, params) => {
      const form = await formOr413(req, res);
      if (form === null) return;
      const status = text(form, 'status');
      const id = parseFeedbackId(params.id!);
      if (!(STATUSES as readonly string[]).includes(status)) {
        return sendHtml(res, 400, '<!doctype html><meta charset="utf-8"><p>状态取值非法</p>');
      }
      if (id === null || !setStatus(db, id, status as Status, ctx.now())) return notFound(res);
      redirect(res, 303, `/admin/feedback/${id}?marked=${status}`);
    }),
  );

  router.post(
    '/admin/feedback/:id/delete',
    guarded((_req, res, params) => {
      const id = parseFeedbackId(params.id!);
      if (id === null || !deleteFeedback(db, ctx.dataDir, id)) return notFound(res);
      redirect(res, 303, `/admin/feedback?status=all&range=6m&deleted=${formatFeedbackId(id)}`);
    }),
  );

  // ---------- Skill 登记 ----------

  const renderSkills = (
    res: ServerResponse,
    status: number,
    extra: { flash?: string | null; error?: string | null; renameTarget?: { id: number; value: string } } = {},
  ): void => {
    const now = ctx.now();
    sendHtml(
      res,
      status,
      skillsPage({
        skills: listSkills(db, now),
        rejections: recentRejections(db, now),
        flash: extra.flash ?? null,
        error: extra.error ?? null,
        ...(extra.renameTarget ? { renameTarget: extra.renameTarget } : {}),
      }),
    );
  };

  router.get(
    '/admin/skills',
    guarded((_req, res, _params, url) => {
      renderSkills(res, 200, { flash: url.searchParams.get('renamed') === '1' ? '已改名' : null });
    }),
  );

  const numericId = (params: Record<string, string>): number | null =>
    /^\d{1,15}$/.test(params.id!) ? Number(params.id) : null;

  router.post(
    '/admin/skills/:id/toggle',
    guarded((_req, res, params) => {
      const id = numericId(params);
      if (id === null || !toggleSkill(db, id)) return renderSkills(res, 404, { error: '该 skill 不存在' });
      redirect(res, 303, '/admin/skills');
    }),
  );

  router.post(
    '/admin/skills/:id/rename',
    guarded(async (req, res, params) => {
      const form = await formOr413(req, res);
      if (form === null) return;
      const id = numericId(params);
      if (id === null) return renderSkills(res, 404, { error: '该 skill 不存在' });
      const result = renameSkill(db, id, text(form, 'name'), ctx.now());
      if (!result.ok) {
        return renderSkills(res, result.notFound ? 404 : 400, {
          error: `改名失败：${result.message}`,
          renameTarget: { id, value: text(form, 'name') },
        });
      }
      redirect(res, 303, '/admin/skills?renamed=1');
    }),
  );

  // ---------- 令牌与设置 ----------

  const listTokens = (): TokenListRow[] =>
    queryAll<{ id: number; name: string; kind: string; created_at: string; last_used_at: string | null; revoked_at: string | null }>(
      db,
      'SELECT id, name, kind, created_at, last_used_at, revoked_at FROM tokens ORDER BY id DESC',
    ).map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      createdAt: t.created_at,
      lastUsedAt: t.last_used_at,
      revokedAt: t.revoked_at,
    }));

  router.get(
    '/admin/settings',
    guarded((_req, res, _params, url) => {
      const flashes: Record<string, string> = { revoked: '令牌已撤销', password: '密码已修改' };
      sendHtml(res, 200, settingsPage(listTokens(), flashes[url.searchParams.get('ok') ?? ''] ?? null, null));
    }),
  );

  router.post(
    '/admin/tokens',
    guarded(async (req, res) => {
      const form = await formOr413(req, res);
      if (form === null) return;
      const kind = text(form, 'kind');
      const name = text(form, 'name').trim();
      const len = charLength(name);
      if (kind !== 'query' && kind !== 'registry') {
        return sendHtml(res, 400, settingsPage(listTokens(), null, '令牌类型非法'));
      }
      if (len < 1 || len > 100) {
        return sendHtml(res, 400, settingsPage(listTokens(), null, '令牌名称须为 1–100 个字符'));
      }
      const token = createToken(db, kind, name, ctx.now());
      sendHtml(res, 200, tokenCreatedPage(name, kind, token));
    }),
  );

  router.post(
    '/admin/tokens/:id/revoke',
    guarded((_req, res, params) => {
      const id = numericId(params);
      const changed =
        id === null ? 0 : run(db, 'UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', ctx.now().toISOString(), id);
      if (changed === 0) return sendHtml(res, 404, settingsPage(listTokens(), null, '令牌不存在或已撤销'));
      redirect(res, 303, '/admin/settings?ok=revoked');
    }),
  );

  router.post(
    '/admin/password',
    guarded(async (req, res) => {
      const form = await formOr413(req, res);
      if (form === null) return;
      const fail = (message: string) => sendHtml(res, 400, settingsPage(listTokens(), null, message));
      const admin = queryOne<AdminRow>(db, 'SELECT username, password_hash FROM admin WHERE id = 1');
      if (!admin || !verifyPassword(text(form, 'current'), admin.password_hash)) return fail('当前密码不正确');
      const next = text(form, 'next');
      if (charLength(next) < MIN_PASSWORD_LENGTH) return fail(`新密码至少 ${MIN_PASSWORD_LENGTH} 个字符`);
      if (next !== text(form, 'confirm')) return fail('两次输入的新密码不一致');
      const now = ctx.now();
      run(db, 'UPDATE admin SET password_hash = ?, updated_at = ? WHERE id = 1', hashPassword(next), now.toISOString());
      // 改密码后所有旧会话失效，为当前浏览器换发新会话。
      run(db, 'DELETE FROM admin_sessions');
      const id = createSession(db, now);
      redirect(res, 303, '/admin/settings?ok=password', {
        'Set-Cookie': sessionCookie(id, SESSION_MAX_AGE_S, config.cookieSecure),
      });
    }),
  );

  // ---------- 未知 /admin/* 路径（须最后注册） ----------

  const unknownAdminPath = guarded((_req, res) => sendHtml(res, 404, notFoundPage()));
  router.get('/admin/*', unknownAdminPath);
  router.post('/admin/*', unknownAdminPath);
}
