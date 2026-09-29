import type { DatabaseSync } from 'node:sqlite';
import { queryOne, run } from './db.ts';

export type RejectionReason = 'limit' | 'unregistered' | 'invalid';

/** 计数 +1 并返回新值。scope：`ip:<地址>`、`global_accepted`、`login_fail:<地址>`。 */
export function bumpCounter(db: DatabaseSync, day: string, scope: string): number {
  run(
    db,
    `INSERT INTO counters (day, scope, count) VALUES (?, ?, 1)
     ON CONFLICT(day, scope) DO UPDATE SET count = count + 1`,
    day,
    scope,
  );
  return getCounter(db, day, scope);
}

export function getCounter(db: DatabaseSync, day: string, scope: string): number {
  return queryOne<{ count: number }>(db, 'SELECT count FROM counters WHERE day = ? AND scope = ?', day, scope)?.count ?? 0;
}

/** 拒收只按天、按原因计数，不保存内容。 */
export function bumpRejection(db: DatabaseSync, day: string, reason: RejectionReason): void {
  run(
    db,
    `INSERT INTO rejections (day, reason, count) VALUES (?, ?, 1)
     ON CONFLICT(day, reason) DO UPDATE SET count = count + 1`,
    day,
    reason,
  );
}

export function getRejectionCount(db: DatabaseSync, day: string, reason: RejectionReason): number {
  return queryOne<{ count: number }>(db, 'SELECT count FROM rejections WHERE day = ? AND reason = ?', day, reason)?.count ?? 0;
}
