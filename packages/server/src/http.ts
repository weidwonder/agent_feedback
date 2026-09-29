import type { IncomingMessage, ServerResponse } from 'node:http';

export type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  url: URL,
) => Promise<void> | void;

export interface Router {
  get(path: string, handler: Handler): void;
  post(path: string, handler: Handler): void;
  patch(path: string, handler: Handler): void;
  /** 命中返回路由模式（用于日志），未命中返回 null。 */
  handle(req: IncomingMessage, res: ServerResponse): Promise<string | null>;
}

interface Route {
  method: string;
  pattern: string;
  segments: string[];
  handler: Handler;
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
  // 末段为 `*` 时匹配其后任意多段（至少一段），须注册在具体路由之后。
  const wildcard = pattern[pattern.length - 1] === '*';
  if (wildcard ? actual.length < pattern.length : pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length - (wildcard ? 1 : 0); i++) {
    const p = pattern[i]!;
    const a = actual[i]!;
    if (p.startsWith(':')) {
      try {
        params[p.slice(1)] = decodeURIComponent(a);
      } catch {
        return null;
      }
    } else if (p !== a) {
      return null;
    }
  }
  return params;
}

const splitPath = (p: string): string[] => p.split('/').filter((s) => s !== '');

export function createRouter(): Router {
  const routes: Route[] = [];
  const add = (method: string) => (path: string, handler: Handler) => {
    routes.push({ method, pattern: path, segments: splitPath(path), handler });
  };
  return {
    get: add('GET'),
    post: add('POST'),
    patch: add('PATCH'),
    async handle(req, res) {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const actual = splitPath(url.pathname);
      for (const route of routes) {
        if (route.method !== req.method) continue;
        const params = matchSegments(route.segments, actual);
        if (!params) continue;
        await route.handler(req, res, params, url);
        return route.pattern;
      }
      return null;
    },
  };
}

/**
 * 读取请求体。超过 maxBytes 时立即停止缓冲并返回 null；余下数据丢弃式排空
 * （超过 16 倍上限则断开连接），调用方可以照常回 413。
 */
export function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let over = false;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      over = true;
      settle(() => resolve(null));
    }
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (over) {
        if (total > maxBytes * 16) req.destroy();
        return;
      }
      if (total > maxBytes) {
        over = true;
        chunks.length = 0;
        settle(() => resolve(null));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => settle(() => resolve(Buffer.concat(chunks))));
    req.on('error', (err) => settle(() => reject(err)));
    req.on('close', () => settle(() => reject(new Error('客户端中断了请求'))));
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export function sendText(res: ServerResponse, status: number, text: string): void {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

export function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  field?: string,
): void {
  const error: { code: string; message: string; field?: string } = { code, message };
  if (field !== undefined) error.field = field;
  sendJson(res, status, { error });
}

/** 来源地址：TRUST_PROXY=1 取 X-Forwarded-For 最后一段，否则取套接字地址；去掉 ::ffff: 前缀。 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  let ip: string | undefined;
  if (trustProxy) {
    const header = req.headers['x-forwarded-for'];
    const value = Array.isArray(header) ? header.join(',') : header;
    if (value) {
      const last = value.split(',').pop()?.trim();
      if (last) ip = last;
    }
  }
  ip ??= req.socket.remoteAddress ?? 'unknown';
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

let logWriter: (line: string) => void = (line) => {
  process.stdout.write(line + '\n');
};

/** 替换日志输出（测试用于静音）。 */
export function setLogWriter(writer: (line: string) => void): void {
  logWriter = writer;
}

/** 结构化日志：每行 key=value。调用方 MUST NOT 传入令牌、密码、cookie、请求体。 */
export function log(event: string, fields: Record<string, string | number | boolean | undefined> = {}): void {
  try {
    const { level = 'info', ...rest } = fields;
    const parts = [`ts=${new Date().toISOString()}`, `level=${level}`, `event=${event}`];
    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined) continue;
      const s = String(v);
      parts.push(`${k}=${/^[\w.:\-/]*$/.test(s) ? s : JSON.stringify(s)}`);
    }
    logWriter(parts.join(' '));
  } catch {
    // 日志写失败不影响主流程
  }
}
