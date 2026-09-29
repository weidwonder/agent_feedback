// 登记服务客户端（spec §3）：fetch + 10 秒超时，错误转成中文原因。
export interface ClientConfig {
  endpoint: string;
  registryToken: string;
}

export type CheckResult =
  | { state: 'registered'; enabled: boolean }
  | { state: 'old_name'; currentName: string }
  | { state: 'unknown' };

export interface RegisterResult {
  name: string;
  enabled: boolean;
  created: boolean;
}

const TIMEOUT_MS = 10_000;

async function call(cfg: ClientConfig, path: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(cfg.endpoint + path, {
      ...init,
      headers: {
        authorization: `Bearer ${cfg.registryToken}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const err = e as Error;
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`连接 ${cfg.endpoint} 超时（${TIMEOUT_MS / 1000} 秒）`);
    }
    const cause = (err.cause as Error | undefined)?.message;
    throw new Error(`无法连接 ${cfg.endpoint}：${cause ?? err.message}`);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // 非 JSON 响应，按状态码报错
  }
  if (res.ok) {
    if (typeof body !== 'object' || body === null) {
      throw new Error(`服务返回了无法识别的响应（HTTP ${res.status}）`);
    }
    return body;
  }
  const errObj = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const code = typeof errObj?.code === 'string' ? errObj.code : '';
  const message = typeof errObj?.message === 'string' ? errObj.message : '';
  if (res.status === 401) throw new Error('登记令牌无效或已撤销（HTTP 401）');
  if (res.status === 403) throw new Error('令牌类型不符：需要登记令牌（HTTP 403）');
  if (res.status === 409 && code === 'old_name') throw new Error(message || '该名称是改名前的旧名');
  throw new Error(`服务返回 HTTP ${res.status}${code ? ` ${code}` : ''}${message ? `：${message}` : ''}`);
}

export async function checkName(cfg: ClientConfig, name: string): Promise<CheckResult> {
  const body = (await call(cfg, `/v1/registry/check?name=${encodeURIComponent(name)}`, { method: 'GET' })) as Record<string, unknown>;
  if (body.state === 'registered' && typeof body.enabled === 'boolean') {
    return { state: 'registered', enabled: body.enabled };
  }
  if (body.state === 'old_name' && typeof body.currentName === 'string') {
    return { state: 'old_name', currentName: body.currentName };
  }
  if (body.state === 'unknown') return { state: 'unknown' };
  throw new Error('服务返回了无法识别的检查结果');
}

export async function register(cfg: ClientConfig, name: string): Promise<RegisterResult> {
  const body = (await call(cfg, '/v1/registry', { method: 'POST', body: JSON.stringify({ name }) })) as Record<string, unknown>;
  if (typeof body.name === 'string' && typeof body.enabled === 'boolean' && typeof body.created === 'boolean') {
    return { name: body.name, enabled: body.enabled, created: body.created };
  }
  throw new Error('服务返回了无法识别的登记结果');
}
