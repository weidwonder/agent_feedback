import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { createSession, getSession, verifyPassword } from '../src/auth.ts';
import { openDb } from '../src/db.ts';
import { makeTempDir } from './helpers.ts';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));

describe('set-admin', () => {
  let dir: string;
  before(() => {
    dir = makeTempDir();
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const run = (args: string[], input: string) =>
    spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', MAIN, ...args], {
      input,
      encoding: 'utf8',
      env: { ...process.env, DATA_DIR: dir },
    });

  const readAdmin = () => {
    const db = openDb(dir);
    const row = db.prepare('SELECT username, password_hash FROM admin').get() as { username: string; password_hash: string } | undefined;
    return { db, row };
  };

  it('从标准输入读密码，写入哈希并使旧会话失效；重跑可改密码', () => {
    const first = run(['set-admin', 'boss'], 'correct horse battery\n');
    assert.equal(first.status, 0, first.stderr);
    let { db, row } = readAdmin();
    assert.equal(row?.username, 'boss');
    assert.match(row!.password_hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    assert.ok(!row!.password_hash.includes('correct horse'));
    assert.ok(verifyPassword('correct horse battery', row!.password_hash));
    assert.ok(!verifyPassword('wrong password 12', row!.password_hash));
    const sid = createSession(db, new Date());
    assert.ok(getSession(db, sid, new Date()));
    db.close();

    const second = run(['set-admin', 'boss'], 'another long password\r\n');
    assert.equal(second.status, 0, second.stderr);
    ({ db, row } = readAdmin());
    assert.ok(verifyPassword('another long password', row!.password_hash));
    assert.equal(getSession(db, sid, new Date()), false, '旧会话已失效');
    db.close();
  });

  it('密码不足 12 字符、缺用户名、未知命令都退出码 1 且不改账号', () => {
    assert.equal(run(['set-admin', 'boss'], 'short\n').status, 1);
    assert.equal(run(['set-admin'], 'long enough password\n').status, 1);
    assert.equal(run(['bogus'], '').status, 1);
    const { db, row } = readAdmin();
    assert.ok(verifyPassword('another long password', row!.password_hash));
    db.close();
  });

  it('配置非法时报出变量名并退出 1', () => {
    const res = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', MAIN, 'serve'], {
      encoding: 'utf8',
      env: { ...process.env, DATA_DIR: dir, IP_DAILY_LIMIT: '0' },
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /IP_DAILY_LIMIT/);
  });
});
