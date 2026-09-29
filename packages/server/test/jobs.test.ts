import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import { bumpCounter, bumpRejection, getCounter } from '../src/counters.ts';
import { DB_FILE, openDb, run } from '../src/db.ts';
import { applyDeletionLog, deleteFeedback, DELETED_LOG } from '../src/deletions.ts';
import { getFeedback } from '../src/feedback-query.ts';
import { setLogWriter } from '../src/http.ts';
import { backupIfDue, pruneBackups, purgeExpired, runMaintenance } from '../src/jobs.ts';
import { beijingDateRangeToUtc, beijingDay, monthsAgoUtc } from '../src/time.ts';
import { count, makeTempDir, registerSkill, seedSubmission, startTestServer } from './helpers.ts';

describe('时间工具', () => {
  it('beijingDay 按 +08:00 划日', () => {
    assert.equal(beijingDay(new Date('2026-09-29T15:59:59Z')), '2026-09-29');
    assert.equal(beijingDay(new Date('2026-09-29T16:00:00Z')), '2026-09-30');
  });
  it('beijingDateRangeToUtc 含两端（to 转为次日 0 点的开区间上界）', () => {
    assert.deepEqual(beijingDateRangeToUtc('2026-09-10', '2026-09-10'), {
      fromIso: '2026-09-09T16:00:00.000Z',
      toIso: '2026-09-10T16:00:00.000Z',
    });
    assert.deepEqual(beijingDateRangeToUtc(), {});
  });
  it('monthsAgoUtc 按北京日历月回退，日期溢出取月末', () => {
    assert.equal(monthsAgoUtc(new Date('2026-09-29T04:00:00Z'), 6), '2026-03-29T04:00:00.000Z');
    assert.equal(monthsAgoUtc(new Date('2026-08-31T04:00:00Z'), 6), '2026-02-28T04:00:00.000Z');
    assert.equal(monthsAgoUtc(new Date('2026-02-10T04:00:00Z'), 6), '2025-08-10T04:00:00.000Z');
  });
});

describe('到期清理', () => {
  it('收录满 6 个月零 1 天的删除，差 1 天的保留；旧计数与过期会话一并清理', async () => {
    const s = await startTestServer();
    try {
      const now = new Date('2026-09-29T04:00:00Z');
      const cutoff = new Date(monthsAgoUtc(now, 6)).getTime();
      const old = seedSubmission(s.db, { skill: 'sk', receivedAt: new Date(cutoff - 86400 * 1000).toISOString(), items: [{}, {}] });
      const keep = seedSubmission(s.db, { skill: 'sk', receivedAt: new Date(cutoff + 86400 * 1000).toISOString() });
      bumpCounter(s.db, '2026-08-01', 'ip:1.1.1.1');
      bumpCounter(s.db, '2026-09-28', 'ip:1.1.1.1');
      bumpRejection(s.db, '2026-08-01', 'limit');
      run(s.db, "INSERT INTO admin_sessions VALUES ('expired', ?, ?)", '2026-01-01T00:00:00Z', '2026-01-08T00:00:00Z');

      assert.equal(purgeExpired(s.db, now), 2);
      assert.equal(getFeedback(s.db, old[0]!), null);
      assert.equal(getFeedback(s.db, old[1]!), null);
      assert.ok(getFeedback(s.db, keep[0]!));
      assert.equal(count(s.db, 'submissions'), 1);
      assert.equal(getCounter(s.db, '2026-08-01', 'ip:1.1.1.1'), 0);
      assert.equal(getCounter(s.db, '2026-09-28', 'ip:1.1.1.1'), 1);
      assert.equal(count(s.db, 'rejections'), 0);
      assert.equal(count(s.db, 'admin_sessions'), 0);
    } finally {
      await s.close();
    }
  });
});

describe('删除编号日志', () => {
  let dir: string;
  before(() => {
    dir = makeTempDir();
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('删除后用删除前的数据库副本恢复并重启，反馈仍不可查，新收录不受误伤', () => {
    let db = openDb(dir);
    const [a, b] = seedSubmission(db, { skill: 'sk', items: [{ title: 'A' }, { title: 'B' }] });
    const [c] = seedSubmission(db, { skill: 'sk', items: [{ title: 'C' }] });
    db.prepare('VACUUM INTO ?').run(join(dir, 'before-delete.sqlite'));

    assert.equal(deleteFeedback(db, dir, c!), true);
    assert.equal(deleteFeedback(db, dir, c!), false);
    assert.equal(count(db, 'submissions'), 1, '无剩余问题的 submission 一并删除');
    assert.equal(readFileSync(join(dir, DELETED_LOG), 'utf8'), `${c}\n`);
    db.close();

    copyFileSync(join(dir, 'before-delete.sqlite'), join(dir, DB_FILE));
    db = openDb(dir);
    assert.ok(getFeedback(db, c!), '恢复后旧库里仍有该反馈');
    assert.equal(applyDeletionLog(db, dir), 1);
    assert.equal(getFeedback(db, c!), null);
    assert.ok(getFeedback(db, a!));
    assert.ok(getFeedback(db, b!));
    assert.equal(count(db, 'submissions'), 1);

    // 恢复后新收录的反馈不会复用已删编号，再次重放不会误删
    const [d] = seedSubmission(db, { skill: 'sk', items: [{ title: 'D' }] });
    assert.ok(d! > c!);
    assert.equal(applyDeletionLog(db, dir), 0);
    assert.ok(getFeedback(db, d!));
    db.close();
  });

  it('日志无文件或含脏行时安全', () => {
    const empty = makeTempDir();
    try {
      const db = openDb(empty);
      assert.equal(applyDeletionLog(db, empty), 0);
      writeFileSync(join(empty, DELETED_LOG), 'abc\n\n-3\n');
      assert.equal(applyDeletionLog(db, empty), 0);
      db.close();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('日志写失败时不删行', () => {
    const d = makeTempDir();
    try {
      const db = openDb(d);
      const [id] = seedSubmission(db, { skill: 'sk' });
      mkdirSync(join(d, DELETED_LOG)); // 日志位置被目录占用，追加写必然失败
      assert.throws(() => deleteFeedback(db, d, id!));
      assert.ok(getFeedback(db, id!));
      db.close();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('备份', () => {
  it('03:00（北京）之后生成可打开的备份，当天不重复，并只保留 7 份备份', () => {
    const d = makeTempDir();
    try {
      const db = openDb(d);
      registerSkill(db, 'sk');
      const backups = join(d, 'backups');
      const now = new Date('2026-09-29T19:30:00Z'); // 北京 09-30 03:30

      assert.equal(backupIfDue(db, d, new Date('2026-09-29T18:59:00Z')), null, '北京 02:59 未到点');
      const made = backupIfDue(db, d, now);
      assert.equal(made, join(backups, 'feedback-20260930.sqlite'));
      const copy = new DatabaseSync(made!);
      assert.equal(Number(copy.prepare('SELECT COUNT(*) AS n FROM skills').get()!.n), 1);
      copy.close();
      assert.equal(backupIfDue(db, d, now), null, '当天已备份');

      // 7 天前（含）的被删，6 天前（边界）保留：当天与前 6 天共 7 份
      writeFileSync(join(backups, 'feedback-20260923.sqlite'), 'old');
      writeFileSync(join(backups, 'feedback-20260924.sqlite'), 'kept');
      rmSync(made!);
      assert.ok(backupIfDue(db, d, now));
      pruneBackups(d, now);
      assert.equal(existsSync(join(backups, 'feedback-20260923.sqlite')), false);
      assert.equal(existsSync(join(backups, 'feedback-20260924.sqlite')), true);
      assert.deepEqual(readdirSync(backups).sort(), ['feedback-20260924.sqlite', 'feedback-20260930.sqlite']);
      db.close();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('临时文件写出后改名失败：返回 null、记 backup_failed，且不留 .tmp', () => {
    const d = makeTempDir();
    const logs: string[] = [];
    setLogWriter((line) => logs.push(line));
    try {
      const db = openDb(d);
      const backups = join(d, 'backups');
      const now = new Date('2027-01-01T19:30:00Z'); // 北京 2027-01-02 03:30
      const target = join(backups, 'feedback-20270102.sqlite');
      // 模拟检查之后目标路径被占成非空目录：VACUUM 已写出临时文件，renameSync 必然失败
      const racing = {
        prepare(sql: string) {
          const stmt = db.prepare(sql);
          return {
            run(...args: unknown[]) {
              const result = (stmt.run as (...a: unknown[]) => unknown)(...args);
              mkdirSync(target);
              writeFileSync(join(target, 'occupant'), 'x');
              return result;
            },
          };
        },
      } as unknown as DatabaseSync;

      assert.equal(backupIfDue(racing, d, now), null);
      assert.ok(logs.some((l) => l.includes('event=backup_failed')), '记了 backup_failed');
      assert.deepEqual(
        readdirSync(backups).filter((n) => n.endsWith('.tmp')),
        [],
        '临时文件已清理',
      );
      db.close();
    } finally {
      setLogWriter(() => {});
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('runMaintenance 清理过期备份与往日残留的临时文件，当天的临时文件不动', async () => {
    const s = await startTestServer({ now: new Date('2027-01-01T19:30:00Z') }); // 北京 2027-01-02 03:30
    try {
      const backups = join(s.dataDir, 'backups');
      mkdirSync(backups);
      writeFileSync(join(backups, 'feedback-20260101.sqlite'), 'expired');
      writeFileSync(join(backups, 'feedback-20261226.sqlite'), 'expired-boundary'); // 7 天前，删
      writeFileSync(join(backups, 'feedback-20261227.sqlite'), 'kept'); // 6 天前，留
      writeFileSync(join(backups, 'feedback-20270101.sqlite.tmp'), 'crashed'); // 昨天的残留，删
      writeFileSync(join(backups, 'feedback-20270102.sqlite.tmp'), 'writing'); // 当天，留
      runMaintenance(s.ctx);
      assert.deepEqual(readdirSync(backups).sort(), ['feedback-20261227.sqlite', 'feedback-20270102.sqlite.tmp']);
    } finally {
      await s.close();
    }
  });

  it('未到备份时间时 backupIfDue 不清理任何文件', () => {
    const d = makeTempDir();
    try {
      const db = openDb(d);
      const backups = join(d, 'backups');
      mkdirSync(backups);
      writeFileSync(join(backups, 'feedback-20260101.sqlite'), 'expired');
      assert.equal(backupIfDue(db, d, new Date('2026-09-29T18:59:00Z')), null, '北京 02:59');
      assert.deepEqual(readdirSync(backups), ['feedback-20260101.sqlite']);
      db.close();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('备份失败只返回 null 不抛错', () => {
    const d = makeTempDir();
    try {
      const db = openDb(d);
      writeFileSync(join(d, 'backups'), 'not a dir'); // 备份目录位置被文件占用
      assert.equal(backupIfDue(db, d, new Date('2026-09-29T19:30:00Z')), null);
      db.close();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('备份失败当天不再重试，次日再试', () => {
    const d = makeTempDir();
    try {
      const db = openDb(d);
      writeFileSync(join(d, 'backups'), 'not a dir');
      assert.equal(backupIfDue(db, d, new Date('2026-09-29T19:30:00Z')), null);
      rmSync(join(d, 'backups')); // 故障排除后，当天仍不重试
      assert.equal(backupIfDue(db, d, new Date('2026-09-29T20:30:00Z')), null);
      assert.equal(existsSync(join(d, 'backups')), false, '当天没有再尝试创建备份目录');
      const next = backupIfDue(db, d, new Date('2026-09-30T19:30:00Z')); // 北京 10-01 03:30
      assert.equal(next, join(d, 'backups', 'feedback-20261001.sqlite'));
      db.close();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
