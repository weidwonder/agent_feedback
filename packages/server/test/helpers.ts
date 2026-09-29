import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app.ts';
import type { AppContext } from '../src/app.ts';
import { createToken } from '../src/auth.ts';
import type { TokenKind } from '../src/auth.ts';
import { loadConfig } from '../src/config.ts';
import { openDb, run } from '../src/db.ts';
import { setLogWriter } from '../src/http.ts';

setLogWriter(() => {});

export interface TestServer {
  baseUrl: string;
  db: DatabaseSync;
  dataDir: string;
  ctx: AppContext;
  setNow(d: Date): void;
  close(): Promise<void>;
}

/** 起临时 DATA_DIR + 随机端口的服务。默认 TRUST_PROXY=1（用 X-Forwarded-For 区分来源）且 IP 限额放宽。 */
export async function startTestServer(
  opts: { env?: Record<string, string>; now?: Date } = {},
): Promise<TestServer> {
  const dataDir = mkdtempSync(join(tmpdir(), 'af-test-'));
  const db = openDb(dataDir);
  let current = opts.now ?? new Date();
  const config = loadConfig({
    DATA_DIR: dataDir,
    TRUST_PROXY: '1',
    COOKIE_SECURE: '0',
    IP_DAILY_LIMIT: '1000',
    ...opts.env,
  });
  const ctx: AppContext = { db, config, dataDir, now: () => current };
  const server: Server = createServer(createApp(ctx));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    db,
    dataDir,
    ctx,
    setNow(d) {
      current = d;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export function registerSkill(db: DatabaseSync, name: string, enabled = true): number {
  run(db, 'INSERT INTO skills (name, enabled, created_at) VALUES (?, ?, ?)', name, enabled ? 1 : 0, new Date().toISOString());
  return Number(db.prepare('SELECT id FROM skills WHERE name = ?').get(name)!.id);
}

export function makeToken(db: DatabaseSync, kind: TokenKind, name = 't'): string {
  return createToken(db, kind, name, new Date());
}

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** 一份合规的提交请求体，可按字段覆盖。 */
export function validBody(skill: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    skill: { name: skill, version: '2.1.0' },
    moduleVersion: '1.0.0',
    os: 'darwin',
    submittedAt: '2026-09-29T10:00:00.000Z',
    session: {
      sessionId: 's-abc123def456',
      taskSummary: '查询禅道任务',
      userInfo: '后端开发',
      userInfoSource: 'known',
      agentName: 'claude',
      agentVersion: '4.0',
      harnessName: 'claude-code',
      harnessVersion: '2.0',
      relatedSkills: [{ name: 'other-skill', description: '辅助' }],
    },
    items: [
      {
        title: '登录失败',
        description: '调用登录接口返回 500，重试仍失败。',
        type: 'bug',
        impact: 'blocking',
        resolved: false,
        occurrences: 2,
      },
    ],
    ...overrides,
  };
}

export function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export interface SeedOptions {
  skill: string;
  receivedAt?: string;
  moduleVersion?: string;
  agentName?: string;
  harnessName?: string;
  items?: { title?: string; type?: string; impact?: string; resolved?: boolean; status?: string }[];
}

/** 绕过 HTTP 直接造一份提交（可控 received_at），返回反馈内部编号。 */
export function seedSubmission(db: DatabaseSync, opts: SeedOptions): number[] {
  const skillRow = db.prepare('SELECT id FROM skills WHERE name = ?').get(opts.skill);
  const skillId = skillRow ? Number(skillRow.id) : registerSkill(db, opts.skill);
  const receivedAt = opts.receivedAt ?? new Date().toISOString();
  run(
    db,
    `INSERT INTO submissions (skill_id, skill_version, module_version, session_id, task_summary, user_info,
       user_info_source, os, agent_name, agent_version, harness_name, harness_version, related_skills,
       submitted_at, received_at) VALUES (?, '1.0', ?, 's-seed', '任务', '用户', 'known', 'linux', ?, NULL, ?, NULL, '[]', ?, ?)`,
    skillId,
    opts.moduleVersion ?? '1.0.0',
    opts.agentName ?? 'claude',
    opts.harnessName ?? 'claude-code',
    receivedAt,
    receivedAt,
  );
  const submissionId = Number(db.prepare('SELECT last_insert_rowid() AS id').get()!.id);
  const ids: number[] = [];
  for (const item of opts.items ?? [{}]) {
    run(
      db,
      `INSERT INTO feedback (submission_id, title, description, type, impact, resolved, suggested_fix, occurrences, status)
       VALUES (?, ?, '描述', ?, ?, ?, ?, 1, ?)`,
      submissionId,
      item.title ?? '标题',
      item.type ?? 'bug',
      item.impact ?? 'minor',
      item.resolved ? 1 : 0,
      item.resolved ? '建议' : null,
      item.status ?? 'pending',
    );
    ids.push(Number(db.prepare('SELECT last_insert_rowid() AS id').get()!.id));
  }
  return ids;
}

export function count(db: DatabaseSync, table: string): number {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
}

export function makeTempDir(prefix = 'af-tmp-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(dir, { recursive: true });
  return dir;
}
