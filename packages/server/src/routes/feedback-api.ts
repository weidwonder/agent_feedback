import { FEEDBACK_TYPES, IMPACTS, LIMITS, NOTICE, QUERY_NOTICE, STATUSES } from '@agent-feedback/shared';
import type { FeedbackType, Impact, Status } from '@agent-feedback/shared';
import type { AppContext } from '../app.ts';
import { verifyBearer } from '../auth.ts';
import { getFeedback, listFeedback, parseFeedbackId, setStatus } from '../feedback-query.ts';
import type { FeedbackFilters } from '../feedback-query.ts';
import { readBody, sendError, sendJson } from '../http.ts';
import type { Router } from '../http.ts';
import { isValidDay } from '../time.ts';

class FilterError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.field = field;
  }
}

function pickEnum<T extends string>(url: URL, field: string, allowed: readonly T[]): T | undefined {
  const v = url.searchParams.get(field);
  if (v === null || v === '') return undefined;
  if (!(allowed as readonly string[]).includes(v)) {
    throw new FilterError(field, `${field} 取值非法，可选：${allowed.join(' / ')}`);
  }
  return v as T;
}

function pickDay(url: URL, field: string): string | undefined {
  const v = url.searchParams.get(field);
  if (v === null || v === '') return undefined;
  if (!isValidDay(v)) throw new FilterError(field, `${field} 必须是 YYYY-MM-DD 格式的日期`);
  return v;
}

function pickInt(url: URL, field: string, def: number, min: number, max: number): number {
  const v = url.searchParams.get(field);
  if (v === null || v === '') return def;
  if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) {
    throw new FilterError(field, `${field} 必须是 ${min}–${max} 之间的整数`);
  }
  return Number(v);
}

const pickText = (url: URL, field: string): string | undefined => url.searchParams.get(field) || undefined;

/** 解析查询通道的筛选参数；非法取值抛 FilterError。 */
function parseFilters(url: URL, skill: string): FeedbackFilters {
  const resolved = pickEnum(url, 'resolved', ['true', 'false'] as const);
  const filters: FeedbackFilters = {
    skill,
    limit: pickInt(url, 'limit', 20, 1, 50),
    offset: pickInt(url, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
  };
  const type = pickEnum<FeedbackType>(url, 'type', FEEDBACK_TYPES);
  const impact = pickEnum<Impact>(url, 'impact', IMPACTS);
  const status = pickEnum<Status>(url, 'status', STATUSES);
  if (type) filters.type = type;
  if (impact) filters.impact = impact;
  if (status) filters.status = status;
  if (resolved) filters.resolved = resolved === 'true';
  const from = pickDay(url, 'from');
  const to = pickDay(url, 'to');
  if (from) filters.from = from;
  if (to) filters.to = to;
  const moduleVersion = pickText(url, 'moduleVersion');
  const agentName = pickText(url, 'agentName');
  const harnessName = pickText(url, 'harnessName');
  if (moduleVersion) filters.moduleVersion = moduleVersion;
  if (agentName) filters.agentName = agentName;
  if (harnessName) filters.harnessName = harnessName;
  return filters;
}

/** 每条反馈自带不可信标注，防止单条被摘出后丢失警示。 */
const withNotice = <T extends object>(item: T): T & { notice: string } => ({ ...item, notice: NOTICE });

// 查询通道（查询令牌）：取清单、取详情、改状态。
export function registerFeedbackApiRoutes(router: Router, ctx: AppContext): void {
  const { db } = ctx;

  router.get('/v1/feedback', (req, res, _params, url) => {
    const auth = verifyBearer(db, req, 'query', ctx.now());
    if (!auth.ok) return sendError(res, auth.status, auth.code, auth.message);
    const skill = url.searchParams.get('skill');
    if (!skill) return sendError(res, 400, 'skill_required', '必须提供 skill 参数（skill 现名）', 'skill');
    let filters: FeedbackFilters;
    try {
      filters = parseFilters(url, skill);
    } catch (err) {
      if (err instanceof FilterError) return sendError(res, 400, 'invalid_field', err.message, err.field);
      throw err;
    }
    const { total, items } = listFeedback(db, filters);
    sendJson(res, 200, { notice: QUERY_NOTICE, total, items: items.map(withNotice) });
  });

  router.get('/v1/feedback/:id', (req, res, params) => {
    const auth = verifyBearer(db, req, 'query', ctx.now());
    if (!auth.ok) return sendError(res, auth.status, auth.code, auth.message);
    const id = parseFeedbackId(params.id!);
    const found = id === null ? null : getFeedback(db, id);
    if (!found) return sendError(res, 404, 'not_found', `反馈 ${params.id} 不存在`);
    sendJson(res, 200, { notice: QUERY_NOTICE, item: withNotice(found.item), siblings: found.siblings });
  });

  router.patch('/v1/feedback/:id', async (req, res, params) => {
    const auth = verifyBearer(db, req, 'query', ctx.now());
    if (!auth.ok) return sendError(res, auth.status, auth.code, auth.message);
    let raw: Buffer | null;
    try {
      raw = await readBody(req, LIMITS.maxBodyBytes);
    } catch {
      return;
    }
    if (raw === null) return sendError(res, 413, 'payload_too_large', '请求体过大');
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      return sendError(res, 400, 'invalid_json', '请求体不是合法的 JSON');
    }
    const status = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).status : undefined;
    if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) {
      return sendError(res, 400, 'invalid_status', `status 取值非法，可选：${STATUSES.join(' / ')}`, 'status');
    }
    const id = parseFeedbackId(params.id!);
    const item = id === null ? null : setStatus(db, id, status as Status, ctx.now());
    if (!item) return sendError(res, 404, 'not_found', `反馈 ${params.id} 不存在`);
    sendJson(res, 200, { notice: QUERY_NOTICE, item: withNotice(item) });
  });
}
