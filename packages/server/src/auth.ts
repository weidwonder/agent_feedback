import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { queryOne, run } from './db.ts';

export type TokenKind = 'query' | 'registry';

export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
export const MIN_PASSWORD_LENGTH = 12;
const PREFIX: Record<TokenKind, string> = { query: 'afq_', registry: 'afr_' };

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export const hashToken = sha256;

/** 生成令牌明文：前缀 + 32 字节随机数的 base64url。库里只存 hashToken 的结果。 */
export function generateToken(kind: TokenKind): string {
  return PREFIX[kind] + randomBytes(32).toString('base64url');
}

/** 新建令牌并入库，返回明文（只此一次可见）。 */
export function createToken(db: DatabaseSync, kind: TokenKind, name: string, now: Date): string {
  const token = generateToken(kind);
  run(
    db,
    'INSERT INTO tokens (name, kind, token_hash, created_at) VALUES (?, ?, ?, ?)',
    name,
    kind,
    hashToken(token),
    now.toISOString(),
  );
  return token;
}

export type BearerResult =
  | { ok: true; tokenId: number }
  | { ok: false; status: 401 | 403; code: 'unauthorized' | 'forbidden'; message: string };

/** 校验 Bearer 令牌：缺失/无效/已撤销 → 401；类型不符 → 403；通过则记录最近使用时间。 */
export function verifyBearer(
  db: DatabaseSync,
  req: IncomingMessage,
  kind: TokenKind,
  now: Date = new Date(),
): BearerResult {
  const unauthorized: BearerResult = {
    ok: false,
    status: 401,
    code: 'unauthorized',
    message: '缺少有效令牌：请在 Authorization 头携带 Bearer 令牌',
  };
  const header = req.headers.authorization;
  if (!header) return unauthorized;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return unauthorized;
  const row = queryOne<{ id: number; kind: string }>(
    db,
    'SELECT id, kind FROM tokens WHERE token_hash = ? AND revoked_at IS NULL',
    hashToken(match[1]!),
  );
  if (!row) return unauthorized;
  if (row.kind !== kind) {
    return { ok: false, status: 403, code: 'forbidden', message: '该令牌类型无权调用此接口' };
  }
  run(db, 'UPDATE tokens SET last_used_at = ? WHERE id = ?', now.toISOString(), row.id);
  return { ok: true, tokenId: row.id };
}

/** 密码哈希：scrypt(N=16384, r=8, p=1)，16 字节盐，64 字节输出，格式 scrypt$<saltHex>$<hashHex>。 */
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** 用户名不存在时也要跑一次 scrypt，避免响应时间泄露用户名是否正确。 */
export const DUMMY_PASSWORD_HASH = hashPassword('dummy-password-for-timing');

export function verifyPassword(pw: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[2]!, 'hex');
  if (expected.length !== 64) return false;
  const actual = scryptSync(pw, Buffer.from(parts[1]!, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}

/** 写入（或覆盖）管理员账号并清空所有会话。 */
export function setAdmin(db: DatabaseSync, username: string, password: string, now: Date): void {
  run(
    db,
    `INSERT INTO admin (id, username, password_hash, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username,
       password_hash = excluded.password_hash, updated_at = excluded.updated_at`,
    username,
    hashPassword(password),
    now.toISOString(),
  );
  run(db, 'DELETE FROM admin_sessions');
}

/** 新建管理会话，返回明文 id（放 cookie）；库里只存 SHA-256，有效期 7 天。 */
export function createSession(db: DatabaseSync, now: Date): string {
  const id = randomBytes(32).toString('base64url');
  run(
    db,
    'INSERT INTO admin_sessions (id_hash, created_at, expires_at) VALUES (?, ?, ?)',
    sha256(id),
    now.toISOString(),
    new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  );
  return id;
}

export function getSession(db: DatabaseSync, id: string, now: Date): boolean {
  const row = queryOne<{ expires_at: string }>(
    db,
    'SELECT expires_at FROM admin_sessions WHERE id_hash = ?',
    sha256(id),
  );
  return row !== null && row.expires_at > now.toISOString();
}

export function destroySession(db: DatabaseSync, id: string): void {
  run(db, 'DELETE FROM admin_sessions WHERE id_hash = ?', sha256(id));
}
