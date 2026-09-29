import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { queryOne, run, withTransaction } from './db.ts';

// 删除编号日志：数据库之外、只追加，备份不含它（spec §2.2）。
export const DELETED_LOG = 'deleted-ids.log';

/** 追加一个已删除的反馈编号并 fsync；写失败抛错（调用方据此不删行）。 */
export function recordDeletion(dataDir: string, id: number): void {
  const fd = openSync(join(dataDir, DELETED_LOG), 'a');
  try {
    writeSync(fd, `${id}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function removeOrphanSubmissions(db: DatabaseSync): void {
  run(db, 'DELETE FROM submissions WHERE id NOT IN (SELECT DISTINCT submission_id FROM feedback)');
}

/**
 * 按日志重删反馈（从旧备份恢复后已删反馈不会复现），返回实际删除的行数。
 * 同时把 feedback 的自增序号抬到日志中最大编号之上，避免恢复后新收录的反馈复用旧编号而被误删。
 */
export function applyDeletionLog(db: DatabaseSync, dataDir: string): number {
  const path = join(dataDir, DELETED_LOG);
  if (!existsSync(path)) return 0;
  const ids = new Set<number>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (/^\d+$/.test(line.trim())) ids.add(Number(line.trim()));
  }
  if (ids.size === 0) return 0;
  const maxId = Math.max(...ids);
  return withTransaction(db, () => {
    let deleted = 0;
    for (const id of ids) deleted += run(db, 'DELETE FROM feedback WHERE id = ?', id);
    removeOrphanSubmissions(db);
    const seq = queryOne<{ seq: number }>(db, "SELECT seq FROM sqlite_sequence WHERE name = 'feedback'");
    if (!seq) run(db, "INSERT INTO sqlite_sequence (name, seq) VALUES ('feedback', ?)", maxId);
    else if (seq.seq < maxId) run(db, "UPDATE sqlite_sequence SET seq = ? WHERE name = 'feedback'", maxId);
    return deleted;
  });
}

/** 删除单条反馈：先写库外日志，再事务内删行；submission 无剩余问题时一并删除。不存在返回 false。 */
export function deleteFeedback(db: DatabaseSync, dataDir: string, id: number): boolean {
  if (!queryOne(db, 'SELECT 1 AS x FROM feedback WHERE id = ?', id)) return false;
  recordDeletion(dataDir, id);
  withTransaction(db, () => {
    run(db, 'DELETE FROM feedback WHERE id = ?', id);
    removeOrphanSubmissions(db);
  });
  return true;
}
