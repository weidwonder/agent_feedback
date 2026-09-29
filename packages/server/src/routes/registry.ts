import { LIMITS, charLength } from '@agent-feedback/shared';
import type { AppContext } from '../app.ts';
import { verifyBearer } from '../auth.ts';
import { findSkillByName, queryOne, run } from '../db.ts';
import { readBody, sendError, sendJson } from '../http.ts';
import type { Router } from '../http.ts';

interface OldNameRow {
  current_name: string;
}

function findOldName(ctx: AppContext, name: string): string | null {
  return (
    queryOne<OldNameRow>(
      ctx.db,
      `SELECT k.name AS current_name FROM skill_old_names o JOIN skills k ON k.id = o.skill_id WHERE o.name = ?`,
      name,
    )?.current_name ?? null
  );
}

// 登记与检查接口（登记令牌）。
export function registerRegistryRoutes(router: Router, ctx: AppContext): void {
  const { db } = ctx;

  router.get('/v1/registry/check', (req, res, _params, url) => {
    const auth = verifyBearer(db, req, 'registry', ctx.now());
    if (!auth.ok) return sendError(res, auth.status, auth.code, auth.message);
    const name = url.searchParams.get('name')?.trim();
    if (!name) return sendError(res, 400, 'invalid_field', 'name 缺失，必须提供 skill 名称', 'name');
    const skill = findSkillByName(db, name);
    if (skill) return sendJson(res, 200, { state: 'registered', enabled: skill.enabled === 1 });
    const currentName = findOldName(ctx, name);
    if (currentName) return sendJson(res, 200, { state: 'old_name', currentName });
    sendJson(res, 200, { state: 'unknown' });
  });

  router.post('/v1/registry', async (req, res) => {
    const auth = verifyBearer(db, req, 'registry', ctx.now());
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
    const rawName = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).name : undefined;
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    const len = charLength(name);
    if (len < LIMITS.skillName.min || len > LIMITS.skillName.max) {
      return sendError(
        res,
        400,
        'invalid_field',
        `name 长度不合规，须为 ${LIMITS.skillName.min}–${LIMITS.skillName.max} 字符`,
        'name',
      );
    }
    const existing = findSkillByName(db, name);
    if (existing) return sendJson(res, 200, { name, enabled: existing.enabled === 1, created: false });
    const currentName = findOldName(ctx, name);
    if (currentName) {
      return sendError(res, 409, 'old_name', `${name} 是 ${currentName} 改名前的旧名，请使用现名登记`, 'name');
    }
    run(db, 'INSERT INTO skills (name, enabled, created_at) VALUES (?, 1, ?)', name, ctx.now().toISOString());
    sendJson(res, 200, { name, enabled: true, created: true });
  });
}
