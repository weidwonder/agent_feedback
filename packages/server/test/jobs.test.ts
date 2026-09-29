import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it, mock } from 'node:test';
import { bumpCounter, bumpRejection, getCounter } from '../src/counters.ts';
import { DB_FILE, openDb, run } from '../src/db.ts';
import { applyDeletionLog, deleteFeedback, DELETED_LOG } from '../src/deletions.ts';
import { getFeedback } from '../src/feedback-query.ts';
import { setLogWriter } from '../src/http.ts';
import { backupIfDue, pruneBackups, purgeExpired, runMaintenance, startJobs } from '../src/jobs.ts';
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

  it('链路：每日备份生成的文件 → 删除反馈 → 用该备份恢复 → 重放删除日志，已删反馈不复现', () => {
    const d = makeTempDir();
    try {
      let db = openDb(d);
      const [keep, gone] = seedSubmission(db, { skill: 'sk', items: [{ title: '留' }, { title: '删' }] });
      const backup = backupIfDue(db, d, new Date('2026-09-29T19:30:00Z')); // 北京 09-30 03:30，应用自己生成的备份
      assert.equal(backup, join(d, 'backups', 'feedback-20260930.sqlite'));
      const copy = new DatabaseSync(backup!);
      assert.equal(Number(copy.prepare('SELECT COUNT(*) AS n FROM feedback').get()!.n), 2, '备份里含两条反馈');
      copy.close();

      assert.equal(deleteFeedback(db, d, gone!), true);
      assert.equal(readFileSync(join(d, DELETED_LOG), 'utf8'), `${gone}\n`, '删除日志在库外，只记被删编号');
      assert.equal(existsSync(join(d, 'backups', DELETED_LOG)), false, '备份目录不含删除日志');
      db.close();

      copyFileSync(backup!, join(d, DB_FILE)); // 用备份覆盖数据库
      db = openDb(d);
      assert.ok(getFeedback(db, gone!), '恢复后已删反馈暂时复现');
      assert.equal(applyDeletionLog(db, d), 1);
      assert.equal(getFeedback(db, gone!), null);
      assert.ok(getFeedback(db, keep!));
      db.close();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('备份早于被删反馈的创建：恢复重放后编号序号被抬过已删编号，新收录不复用已删编号、也不被下一次重放误删', () => {
    const d = makeTempDir();
    try {
      let db = openDb(d);
      const [a] = seedSubmission(db, { skill: 'sk', items: [{ title: 'A' }] });
      db.prepare('VACUUM INTO ?').run(join(d, 'early-backup.sqlite')); // 此时只有反馈 A
      const [b] = seedSubmission(db, { skill: 'sk', items: [{ title: 'B' }] }); // 备份之后才创建，编号紧随 A
      assert.equal(b, a! + 1);
      assert.equal(deleteFeedback(db, d, b!), true);
      db.close();

      copyFileSync(join(d, 'early-backup.sqlite'), join(d, DB_FILE));
      db = openDb(d);
      assert.equal(getFeedback(db, b!), null, '恢复出来的库里本来就没有 B');
      assert.equal(applyDeletionLog(db, d), 0, '没有可删的行');
      const [c] = seedSubmission(db, { skill: 'sk', items: [{ title: 'C' }] });
      assert.ok(c! > b!, `新收录编号 ${c} 必须大于已删编号 ${b}`);
      assert.equal(applyDeletionLog(db, d), 0, '再次重放不会误删新反馈');
      assert.ok(getFeedback(db, c!));
      assert.ok(getFeedback(db, a!));
      db.close();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
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
      let tmpWritten = false;
      // 模拟检查之后目标路径被占成非空目录：VACUUM 已写出临时文件，renameSync 必然失败
      const racing = {
        prepare(sql: string) {
          const stmt = db.prepare(sql);
          return {
            run(...args: unknown[]) {
              const result = (stmt.run as (...a: unknown[]) => unknown)(...args);
              tmpWritten = existsSync(`${target}.tmp`); // 钉住：走到改名这一步之前，临时文件确实写出过
              mkdirSync(target);
              writeFileSync(join(target, 'occupant'), 'x');
              return result;
            },
          };
        },
      } as unknown as DatabaseSync;

      assert.equal(backupIfDue(racing, d, now), null);
      assert.equal(tmpWritten, true, 'VACUUM 确实写出过临时文件（否则本用例没有测到改名失败）');
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

  it('runMaintenance 遇到备份清理失败：记 backup_prune_failed 且不抛出，到期清理照常完成', async () => {
    const s = await startTestServer({ now: new Date('2027-01-01T19:30:00Z') });
    const logs: string[] = [];
    setLogWriter((line) => logs.push(line));
    try {
      writeFileSync(join(s.dataDir, 'backups'), 'not a dir'); // 备份目录位置被普通文件占用，读目录必然抛错
      assert.doesNotThrow(() => runMaintenance(s.ctx));
      assert.ok(logs.some((l) => l.includes('event=purge_done')), '清理失败之前的到期清理已完成');
      const failed = logs.filter((l) => l.includes('event=backup_prune_failed'));
      assert.equal(failed.length, 1);
      assert.match(failed[0]!, /level=error/);
    } finally {
      setLogWriter(() => {});
      await s.close();
    }
  });

  it('清理逐个文件容错：一个删不掉不影响其余过期文件，本轮结束后汇总报错并记 backup_prune_failed', async () => {
    const s = await startTestServer({ now: new Date('2027-01-01T19:30:00Z') }); // 北京 2027-01-02 03:30
    const logs: string[] = [];
    setLogWriter((line) => logs.push(line));
    try {
      const backups = join(s.dataDir, 'backups');
      mkdirSync(backups);
      // 字典序在前的过期名字被目录占用（rm 非递归删目录必然失败），后面的过期文件必须仍被删
      mkdirSync(join(backups, 'feedback-20260101.sqlite'));
      writeFileSync(join(backups, 'feedback-20260101.sqlite', 'occupant'), 'x');
      writeFileSync(join(backups, 'feedback-20261226.sqlite'), 'expired-boundary'); // 7 天前，应删
      writeFileSync(join(backups, 'feedback-20261231.sqlite.tmp'), 'crashed'); // 昨天残留，应删
      writeFileSync(join(backups, 'feedback-20261227.sqlite'), 'kept'); // 6 天前，留

      assert.throws(() => pruneBackups(s.dataDir, s.ctx.now()), /1 个备份文件清理失败.*feedback-20260101\.sqlite/);
      assert.deepEqual(readdirSync(backups).sort(), ['feedback-20260101.sqlite', 'feedback-20261227.sqlite']);

      logs.length = 0;
      assert.doesNotThrow(() => runMaintenance(s.ctx));
      assert.equal(logs.filter((l) => l.includes('event=backup_prune_failed')).length, 1, '记了一条汇总事件');
      assert.deepEqual(readdirSync(backups).sort(), ['feedback-20260101.sqlite', 'feedback-20261227.sqlite']);
    } finally {
      setLogWriter(() => {});
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

describe('定时任务编排', () => {
  it('runMaintenance 按删除编号日志重删，并记 deleted_log_applied', async () => {
    const s = await startTestServer();
    const logs: string[] = [];
    setLogWriter((line) => logs.push(line));
    try {
      const [keep, gone] = seedSubmission(s.db, { skill: 'sk', items: [{ title: '留' }, { title: '删' }] });
      writeFileSync(join(s.dataDir, DELETED_LOG), `${gone}\n`); // 库外日志里有、库里还在：模拟恢复旧备份后的状态
      runMaintenance(s.ctx);
      assert.equal(getFeedback(s.db, gone!), null);
      assert.ok(getFeedback(s.db, keep!));
      assert.ok(logs.some((l) => /event=deleted_log_applied.*removed=1/.test(l)));
    } finally {
      setLogWriter(() => {});
      await s.close();
    }
  });

  it('每小时跑维护、每分钟检查备份；任务抛错只记 job_failed，下一周期照常；停止后不再触发', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    const s = await startTestServer({ now: new Date('2027-01-01T19:30:00Z') }); // 北京 2027-01-02 03:30
    const logs: string[] = [];
    setLogWriter((line) => logs.push(line));
    let stop: (() => void) | undefined;
    try {
      const expired = seedSubmission(s.db, { skill: 'sk', receivedAt: '2026-01-01T00:00:00.000Z' })[0]!; // 早于 6 个月
      stop = startJobs(s.ctx);

      mock.timers.tick(59 * 1000);
      assert.equal(existsSync(join(s.dataDir, 'backups')), false, '一分钟未到，备份检查还没触发');
      mock.timers.tick(1000);
      assert.equal(existsSync(join(s.dataDir, 'backups', 'feedback-20270102.sqlite')), true, '满一分钟：北京 03:30 已过 03:00，生成当天备份');
      assert.ok(getFeedback(s.db, expired), '维护任务是每小时，不在第一分钟触发');

      mock.timers.tick(3600 * 1000);
      assert.equal(getFeedback(s.db, expired), null, '满一小时：到期清理已执行');
      assert.ok(logs.some((l) => l.includes('event=purge_done')));

      // 任务抛错：now() 抛出 → job_failed，之后恢复正常仍会执行
      const realNow = s.ctx.now;
      s.ctx.now = () => {
        throw new Error('boom');
      };
      mock.timers.tick(60 * 1000);
      assert.equal(logs.filter((l) => l.includes('event=job_failed')).length, 1);
      s.ctx.now = realNow;
      logs.length = 0;
      mock.timers.tick(3600 * 1000);
      assert.ok(logs.some((l) => l.includes('event=purge_done')), '抛错之后下一周期照常执行');

      stop();
      stop = undefined;
      logs.length = 0;
      mock.timers.tick(2 * 3600 * 1000);
      assert.equal(logs.length, 0, '停止后不再触发');
    } finally {
      stop?.();
      mock.timers.reset();
      setLogWriter(() => {});
      await s.close();
    }
  });
});
