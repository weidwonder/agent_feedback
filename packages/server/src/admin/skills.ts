import type { DatabaseSync } from 'node:sqlite';
import { LIMITS, charLength } from '@agent-feedback/shared';
import { queryAll, queryOne, run, withTransaction } from '../db.ts';
import { beijingDay } from '../time.ts';

export interface SkillListRow {
  id: number;
  name: string;
  enabled: boolean;
  createdAt: string;
  feedbackTotal: number;
  recentCount: number;
  versions: { moduleVersion: string; count: number }[];
}

export interface RejectionRow {
  day: string;
  limit: number;
  unregistered: number;
  invalid: number;
}

const DAY_MS = 86400 * 1000;

/** 登记页列表：近 7 天收录数与模块版本分布均按提交（一次提交算一次收录）统计。 */
export function listSkills(db: DatabaseSync, now: Date): SkillListRow[] {
  const cutoff = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const skills = queryAll<{ id: number; name: string; enabled: number; created_at: string; feedback_total: number }>(
    db,
    `SELECT k.id, k.name, k.enabled, k.created_at,
       (SELECT COUNT(*) FROM feedback f JOIN submissions s ON s.id = f.submission_id WHERE s.skill_id = k.id) AS feedback_total
     FROM skills k ORDER BY k.created_at DESC, k.id DESC`,
  );
  const dist = queryAll<{ skill_id: number; module_version: string; n: number }>(
    db,
    `SELECT skill_id, module_version, COUNT(*) AS n FROM submissions WHERE received_at >= ?
     GROUP BY skill_id, module_version ORDER BY n DESC, module_version DESC`,
    cutoff,
  );
  return skills.map((k) => {
    const versions = dist.filter((d) => d.skill_id === k.id).map((d) => ({ moduleVersion: d.module_version, count: d.n }));
    return {
      id: k.id,
      name: k.name,
      enabled: k.enabled === 1,
      createdAt: k.created_at,
      feedbackTotal: k.feedback_total,
      recentCount: versions.reduce((sum, v) => sum + v.count, 0),
      versions,
    };
  });
}

/** 近 7 个北京自然日（含今天）的拒收次数，没有记录的天补 0，最新的在前。 */
export function recentRejections(db: DatabaseSync, now: Date): RejectionRow[] {
  const days = Array.from({ length: 7 }, (_, i) => beijingDay(new Date(now.getTime() - i * DAY_MS)));
  const rows = queryAll<{ day: string; reason: 'limit' | 'unregistered' | 'invalid'; count: number }>(
    db,
    `SELECT day, reason, count FROM rejections WHERE day >= ?`,
    days[days.length - 1]!,
  );
  return days.map((day) => {
    const out: RejectionRow = { day, limit: 0, unregistered: 0, invalid: 0 };
    for (const r of rows) if (r.day === day) out[r.reason] = r.count;
    return out;
  });
}

/** 启用 ↔ 停用；skill 不存在返回 false。 */
export function toggleSkill(db: DatabaseSync, id: number): boolean {
  return run(db, 'UPDATE skills SET enabled = 1 - enabled WHERE id = ?', id) > 0;
}

export type RenameResult = { ok: true; name: string } | { ok: false; message: string; notFound?: true };

/**
 * 改名：新名 trim 后 1–100 字符；不得等于其他 skill 的现名或旧名。
 * 事务内把原名写入旧名表并更新现名；若新名恰是本 skill 自己的旧名，则从旧名表移除。
 */
export function renameSkill(db: DatabaseSync, id: number, rawName: string, now: Date): RenameResult {
  const name = rawName.trim();
  const len = charLength(name);
  if (len < LIMITS.skillName.min || len > LIMITS.skillName.max) {
    return { ok: false, message: `名称长度不合规，须为 ${LIMITS.skillName.min}–${LIMITS.skillName.max} 个字符` };
  }
  return withTransaction(db, (): RenameResult => {
    const current = queryOne<{ name: string }>(db, 'SELECT name FROM skills WHERE id = ?', id);
    if (!current) return { ok: false, message: '该 skill 不存在', notFound: true };
    if (current.name === name) return { ok: false, message: '新名称与当前名称相同' };
    if (queryOne(db, 'SELECT 1 AS x FROM skills WHERE name = ? AND id != ?', name, id)) {
      return { ok: false, message: `名称 ${name} 已被其他 skill 使用` };
    }
    const old = queryOne<{ skill_id: number }>(db, 'SELECT skill_id FROM skill_old_names WHERE name = ?', name);
    if (old && old.skill_id !== id) return { ok: false, message: `名称 ${name} 是其他 skill 改名前的旧名，不能再用` };
    if (old) run(db, 'DELETE FROM skill_old_names WHERE name = ?', name);
    run(db, 'INSERT INTO skill_old_names (name, skill_id, renamed_at) VALUES (?, ?, ?)', current.name, id, now.toISOString());
    run(db, 'UPDATE skills SET name = ? WHERE id = ?', name, id);
    return { ok: true, name };
  });
}
