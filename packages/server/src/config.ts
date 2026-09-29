import { resolve } from 'node:path';

// 服务端配置（spec §6）：全部来自环境变量，启动时校验，非法值抛错并带变量名。
export interface Config {
  port: number;
  host: string;
  dataDir: string;
  trustProxy: boolean;
  cookieSecure: boolean;
  ipDailyLimit: number;
  globalDailyLimit: number;
}

type Env = Record<string, string | undefined>;

function readInt(env: Env, name: string, def: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  if (!/^-?\d+$/.test(raw.trim())) throw new Error(`${name} 必须是整数（当前 "${raw}"）`);
  const n = Number(raw.trim());
  if (n < min || n > max) throw new Error(`${name} 必须在 ${min}–${max} 之间（当前 ${n}）`);
  return n;
}

function readFlag(env: Env, name: string, def: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  if (raw.trim() === '1') return true;
  if (raw.trim() === '0') return false;
  throw new Error(`${name} 只能是 0 或 1（当前 "${raw}"）`);
}

export function loadConfig(env: Env): Config {
  const host = env.HOST === undefined || env.HOST === '' ? '127.0.0.1' : env.HOST;
  const dataDir = resolve(env.DATA_DIR === undefined || env.DATA_DIR === '' ? './data' : env.DATA_DIR);
  return {
    port: readInt(env, 'PORT', 8787, 1, 65535),
    host,
    dataDir,
    trustProxy: readFlag(env, 'TRUST_PROXY', false),
    cookieSecure: readFlag(env, 'COOKIE_SECURE', true),
    ipDailyLimit: readInt(env, 'IP_DAILY_LIMIT', 5, 1, Number.MAX_SAFE_INTEGER),
    globalDailyLimit: readInt(env, 'GLOBAL_DAILY_LIMIT', 500, 1, Number.MAX_SAFE_INTEGER),
  };
}
