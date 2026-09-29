import type { DatabaseSync } from 'node:sqlite';
import type { FeedbackType, Impact, Status } from '@agent-feedback/shared';
import { queryAll, queryOne, run } from './db.ts';
import type { Params } from './db.ts';
import { beijingDateRangeToUtc } from './time.ts';

export interface FeedbackView {
  id: string;
  title: string;
  description: string;
  type: FeedbackType;
  impact: Impact;
  resolved: boolean;
  suggestedFix: string | null;
  occurrences: number;
  status: Status;
  receivedAt: string;
  submission: {
    id: number;
    skill: { name: string; version: string | null };
    moduleVersion: string;
    sessionId: string;
    taskSummary: string;
    userInfo: string;
    userInfoSource: string;
    os: string;
    agentName: string;
    agentVersion: string | null;
    harnessName: string;
    harnessVersion: string | null;
    relatedSkills: { name: string; description: string }[];
    submittedAt: string;
  };
}

export interface FeedbackFilters {
  skill?: string;
  type?: FeedbackType;
  impact?: Impact;
  status?: Status | 'all';
  resolved?: boolean;
  /** 北京时间 YYYY-MM-DD，含两端 */
  from?: string;
  to?: string;
  moduleVersion?: string;
  agentName?: string;
  harnessName?: string;
  limit: number;
  offset: number;
}

interface Row {
  id: number;
  title: string;
  description: string;
  type: FeedbackType;
  impact: Impact;
  resolved: number;
  suggested_fix: string | null;
  occurrences: number;
  status: Status;
  sub_id: number;
  received_at: string;
  skill_version: string | null;
  module_version: string;
  session_id: string;
  task_summary: string;
  user_info: string;
  user_info_source: string;
  os: string;
  agent_name: string;
  agent_version: string | null;
  harness_name: string;
  harness_version: string | null;
  related_skills: string;
  submitted_at: string;
  skill_name: string;
}

const FROM_JOIN = `
  FROM feedback f
  JOIN submissions sub ON sub.id = f.submission_id
  JOIN skills k ON k.id = sub.skill_id`;

const SELECT_VIEW = `
  SELECT f.id, f.title, f.description, f.type, f.impact, f.resolved, f.suggested_fix,
    f.occurrences, f.status, sub.id AS sub_id, sub.received_at, sub.skill_version,
    sub.module_version, sub.session_id, sub.task_summary, sub.user_info, sub.user_info_source,
    sub.os, sub.agent_name, sub.agent_version, sub.harness_name, sub.harness_version,
    sub.related_skills, sub.submitted_at, k.name AS skill_name
  ${FROM_JOIN}`;

/** 对外编号：FB- + id 左补零到 4 位。 */
export function formatFeedbackId(id: number): string {
  return `FB-${String(id).padStart(4, '0')}`;
}

/** 解析对外编号：接受纯数字或 FB-0012；非法返回 null。 */
export function parseFeedbackId(raw: string): number | null {
  const m = /^(?:FB-)?(\d{1,15})$/.exec(raw);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

export function toFeedbackView(row: Row): FeedbackView {
  return {
    id: formatFeedbackId(row.id),
    title: row.title,
    description: row.description,
    type: row.type,
    impact: row.impact,
    resolved: row.resolved === 1,
    suggestedFix: row.suggested_fix,
    occurrences: row.occurrences,
    status: row.status,
    receivedAt: row.received_at,
    submission: {
      id: row.sub_id,
      skill: { name: row.skill_name, version: row.skill_version },
      moduleVersion: row.module_version,
      sessionId: row.session_id,
      taskSummary: row.task_summary,
      userInfo: row.user_info,
      userInfoSource: row.user_info_source,
      os: row.os,
      agentName: row.agent_name,
      agentVersion: row.agent_version,
      harnessName: row.harness_name,
      harnessVersion: row.harness_version,
      relatedSkills: JSON.parse(row.related_skills) as { name: string; description: string }[],
      submittedAt: row.submitted_at,
    },
  };
}

/** 列表：按收录时间倒序；skill 为空表示不限 skill；status 缺省或 all 表示不限状态。 */
export function listFeedback(
  db: DatabaseSync,
  filters: FeedbackFilters,
): { total: number; items: FeedbackView[] } {
  const where: string[] = [];
  const params: Params = [];
  const eq = (col: string, v: string | undefined) => {
    if (v === undefined) return;
    where.push(`${col} = ?`);
    params.push(v);
  };
  eq('k.name', filters.skill);
  eq('f.type', filters.type);
  eq('f.impact', filters.impact);
  if (filters.status !== undefined && filters.status !== 'all') eq('f.status', filters.status);
  if (filters.resolved !== undefined) {
    where.push('f.resolved = ?');
    params.push(filters.resolved ? 1 : 0);
  }
  const { fromIso, toIso } = beijingDateRangeToUtc(filters.from, filters.to);
  if (fromIso) {
    where.push('sub.received_at >= ?');
    params.push(fromIso);
  }
  if (toIso) {
    where.push('sub.received_at < ?');
    params.push(toIso);
  }
  eq('sub.module_version', filters.moduleVersion);
  eq('sub.agent_name', filters.agentName);
  eq('sub.harness_name', filters.harnessName);
  const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
  const total = queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n ${FROM_JOIN}${clause}`, ...params)?.n ?? 0;
  const rows = queryAll<Row>(
    db,
    `${SELECT_VIEW}${clause} ORDER BY sub.received_at DESC, f.id DESC LIMIT ? OFFSET ?`,
    ...params,
    filters.limit,
    filters.offset,
  );
  return { total, items: rows.map(toFeedbackView) };
}

/** 详情 + 同次提交的其他问题编号。 */
export function getFeedback(db: DatabaseSync, id: number): { item: FeedbackView; siblings: string[] } | null {
  const row = queryOne<Row>(db, `${SELECT_VIEW} WHERE f.id = ?`, id);
  if (!row) return null;
  const siblings = queryAll<{ id: number }>(
    db,
    'SELECT id FROM feedback WHERE submission_id = ? AND id != ? ORDER BY id',
    row.sub_id,
    id,
  ).map((r) => formatFeedbackId(r.id));
  return { item: toFeedbackView(row), siblings };
}

/** 改状态（五种状态可任意互改，重复写同一状态幂等）；不存在返回 null。 */
export function setStatus(
  db: DatabaseSync,
  id: number,
  status: Status,
  now: Date = new Date(),
): FeedbackView | null {
  const changed = run(db, 'UPDATE feedback SET status = ?, status_updated_at = ? WHERE id = ?', status, now.toISOString(), id);
  if (changed === 0) return null;
  return getFeedback(db, id)?.item ?? null;
}
