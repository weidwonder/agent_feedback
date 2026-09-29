// 注入工具本机配置（spec §2.3）。
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface InjectorConfig {
  endpoint?: string;
  registryToken?: string;
}

export function defaultConfigPath(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'agent-feedback', 'config.json');
  }
  return join(homedir(), '.config', 'agent-feedback', 'config.json');
}

/** 规范化服务地址：必须 http(s) 开头，去掉末尾 `/`；非法返回 null。 */
export function normalizeEndpoint(raw: string): string | null {
  const s = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+/.test(s)) return null;
  return s;
}

/** 配置文件不存在返回空对象；内容损坏抛出中文错误。 */
export function readConfig(path: string): InjectorConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`无法读取本机配置 ${path}：${(e as Error).message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`本机配置 ${path} 不是合法 JSON；请重新运行 node packages/injector/dist/agent-feedback.mjs config`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`本机配置 ${path} 格式不对；请重新运行 node packages/injector/dist/agent-feedback.mjs config`);
  }
  const o = data as Record<string, unknown>;
  const cfg: InjectorConfig = {};
  if (typeof o.endpoint === 'string' && o.endpoint) cfg.endpoint = o.endpoint;
  if (typeof o.registryToken === 'string' && o.registryToken) cfg.registryToken = o.registryToken;
  return cfg;
}

export function writeConfig(path: string, cfg: Required<InjectorConfig>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600); // 文件已存在时 mode 参数不生效
}
