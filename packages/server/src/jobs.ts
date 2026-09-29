import { mkdirSync, readdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { AppContext } from './app.ts';
import { applyDeletionLog } from './deletions.ts';
import { run, withTransaction } from './db.ts';
import { log } from './http.ts';
import { DAY_MS, beijingDay, beijingHour, monthsAgoUtc } from './time.ts';

const RETENTION_MONTHS = 6;
const COUNTER_RETENTION_DAYS = 30;
const BACKUP_KEEP_DAYS = 7;
const BACKUP_HOUR_BEIJING = 3;
const BACKUP_FILE = /^feedback-(\d{8})\.sqlite$/;
const BACKUP_TMP_FILE = /^feedback-(\d{8})\.sqlite\.tmp$/;

/** 到期清理：删收录满 6 个日历月的提交及其反馈，删 30 天前的计数与拒收统计，删过期会话。返回删除的反馈条数。 */
export function purgeExpired(db: DatabaseSync, now: Date): number {
  const cutoff = monthsAgoUtc(now, RETENTION_MONTHS);
  const oldestDay = beijingDay(new Date(now.getTime() - COUNTER_RETENTION_DAYS * DAY_MS));
  return withTransaction(db, () => {
    const expired = 'SELECT id FROM submissions WHERE received_at < ?';
    const deleted = run(db, `DELETE FROM feedback WHERE submission_id IN (${expired})`, cutoff);
    run(db, 'DELETE FROM submissions WHERE received_at < ?', cutoff);
    run(db, 'DELETE FROM counters WHERE day < ?', oldestDay);
    run(db, 'DELETE FROM rejections WHERE day < ?', oldestDay);
    run(db, 'DELETE FROM admin_sessions WHERE expires_at < ?', now.toISOString());
    return deleted;
  });
}

/**
 * 清理备份目录：删除日期不晚于 7 天前的备份（只留当天与前 6 天共 7 份），
 * 以及日期早于今天（北京时间）的残留临时文件（进程崩溃遗留的完整副本）；当天的临时文件可能正在写入，不动。
 * 目录不存在视为无事可做。
 */
export function pruneBackups(dataDir: string, now: Date): void {
  const dir = join(dataDir, 'backups');
  if (!existsSync(dir)) return;
  const today = beijingDay(now).replaceAll('-', '');
  const oldest = beijingDay(new Date(now.getTime() - BACKUP_KEEP_DAYS * DAY_MS)).replaceAll('-', '');
  for (const name of readdirSync(dir)) {
    const backup = BACKUP_FILE.exec(name);
    if (backup && backup[1]! <= oldest) {
      rmSync(join(dir, name), { force: true });
      continue;
    }
    const stale = BACKUP_TMP_FILE.exec(name);
    if (stale && stale[1]! < today) rmSync(join(dir, name), { force: true });
  }
}

let failedBackupTarget: string | null = null;

/**
 * 每天北京时间 03:00 之后当天尚无备份时生成 `backups/feedback-YYYYMMDD.sqlite`。
 * 返回新备份路径；未到时间、已备份或失败返回 null。过期备份的清理不在此处，见 `runMaintenance`。
 * 失败只记日志并清掉残缺的临时文件，且当天不再重试（记在进程内，次日再试）。
 */
export function backupIfDue(db: DatabaseSync, dataDir: string, now: Date): string | null {
  if (beijingHour(now) < BACKUP_HOUR_BEIJING) return null;
  const dir = join(dataDir, 'backups');
  const compact = beijingDay(now).replaceAll('-', '');
  const target = join(dir, `feedback-${compact}.sqlite`);
  if (failedBackupTarget === target) return null;
  const tmp = `${target}.tmp`;
  try {
    mkdirSync(dir, { recursive: true });
    if (existsSync(target)) return null;
    rmSync(tmp, { force: true });
    db.prepare('VACUUM INTO ?').run(tmp);
    renameSync(tmp, target);
    log('backup_done', { file: `feedback-${compact}.sqlite` });
    return target;
  } catch (err) {
    failedBackupTarget = target;
    try {
      rmSync(tmp, { force: true });
    } catch {
      // 临时路径清不掉时不掩盖原始错误
    }
    log('backup_failed', { level: 'error', message: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** 启动与每小时都做的维护：按删除编号日志重删 + 到期清理 + 过期备份与残留临时文件清理（后者失败只记日志）。 */
export function runMaintenance(ctx: AppContext): void {
  const removed = applyDeletionLog(ctx.db, ctx.dataDir);
  log('deleted_log_applied', { removed });
  const purged = purgeExpired(ctx.db, ctx.now());
  log('purge_done', { purged });
  try {
    pruneBackups(ctx.dataDir, ctx.now());
  } catch (err) {
    log('backup_prune_failed', { level: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

/** 启动定时任务（每小时维护、每分钟检查备份），返回停止函数。任务异常只记日志。 */
export function startJobs(ctx: AppContext): () => void {
  const guarded = (fn: () => void) => () => {
    try {
      fn();
    } catch (err) {
      log('job_failed', { level: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };
  const hourly = setInterval(guarded(() => runMaintenance(ctx)), 3600 * 1000);
  const minutely = setInterval(guarded(() => void backupIfDue(ctx.db, ctx.dataDir, ctx.now())), 60 * 1000);
  hourly.unref();
  minutely.unref();
  return () => {
    clearInterval(hourly);
    clearInterval(minutely);
  };
}
