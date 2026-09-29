import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';

// 建表（spec §2.2）。feedback 与 submissions 用 AUTOINCREMENT：编号永不复用，
// 这样删除编号日志重放时不会误删之后新收录、恰好复用了旧编号的反馈。
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS skill_old_names (
  name TEXT PRIMARY KEY, skill_id INTEGER NOT NULL REFERENCES skills(id), renamed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, skill_id INTEGER NOT NULL REFERENCES skills(id),
  skill_version TEXT, module_version TEXT NOT NULL, session_id TEXT NOT NULL,
  task_summary TEXT NOT NULL, user_info TEXT NOT NULL, user_info_source TEXT NOT NULL,
  os TEXT NOT NULL, agent_name TEXT NOT NULL, agent_version TEXT,
  harness_name TEXT NOT NULL, harness_version TEXT, related_skills TEXT NOT NULL,
  submitted_at TEXT NOT NULL, received_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT, submission_id INTEGER NOT NULL REFERENCES submissions(id),
  title TEXT NOT NULL, description TEXT NOT NULL, type TEXT NOT NULL, impact TEXT NOT NULL,
  resolved INTEGER NOT NULL, suggested_fix TEXT, occurrences INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', status_updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_feedback_submission ON feedback(submission_id);
CREATE INDEX IF NOT EXISTS idx_submissions_skill_received ON submissions(skill_id, received_at);
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('query','registry')),
  token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS admin (
  id INTEGER PRIMARY KEY CHECK (id = 1), username TEXT NOT NULL, password_hash TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_sessions (
  id_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS counters (
  day TEXT NOT NULL, scope TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (day, scope));
CREATE TABLE IF NOT EXISTS rejections (
  day TEXT NOT NULL, reason TEXT NOT NULL CHECK (reason IN ('limit','unregistered','invalid')),
  count INTEGER NOT NULL, PRIMARY KEY (day, reason));
`;

export const DB_FILE = 'feedback.sqlite';

export function openDb(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, DB_FILE), { timeout: 5000 });
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export type Params = SQLInputValue[];

/** 查询多行；行类型由调用方声明。 */
export function queryAll<T>(db: DatabaseSync, sql: string, ...params: Params): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

/** 查询单行；无行返回 null。 */
export function queryOne<T>(db: DatabaseSync, sql: string, ...params: Params): T | null {
  return (db.prepare(sql).get(...params) as unknown as T | undefined) ?? null;
}

/** 执行写语句并返回受影响行数。 */
export function run(db: DatabaseSync, sql: string, ...params: Params): number {
  return Number(db.prepare(sql).run(...params).changes);
}

/** 立即事务：fn 抛错则回滚并重新抛出。 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 回滚失败时保留原始错误
    }
    throw err;
  }
}

export interface SkillRow {
  id: number;
  name: string;
  enabled: number;
  created_at: string;
}

export function findSkillByName(db: DatabaseSync, name: string): SkillRow | null {
  return queryOne<SkillRow>(db, 'SELECT id, name, enabled, created_at FROM skills WHERE name = ?', name);
}
