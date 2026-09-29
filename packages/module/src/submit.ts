// 提交脚本（spec §4.3）：从标准输入读会话与问题，补齐字段后提交。
// 只向标准输出写一行 JSON，退出码恒为 0，不写标准错误。
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, validateSubmission } from '@agent-feedback/shared';

const MAX_STDIN_BYTES = 256 * 1024;
const TIMEOUT_MS = 10_000;

function emit(result: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(result) + '\n');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_STDIN_BYTES) throw new Error('标准输入超过 256 KiB');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  if (process.env.AGENT_FEEDBACK_DISABLED === '1') {
    emit({ ok: false, reason: 'disabled' });
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readStdin());
  } catch (e) {
    emit({ ok: false, reason: 'bad_input', message: e instanceof Error ? e.message : String(e) });
    return;
  }
  if (!isRecord(raw) || !isRecord(raw.session) || !Array.isArray(raw.items)) {
    emit({ ok: false, reason: 'bad_input', message: '标准输入必须是含 session（对象）与 items（数组）的 JSON' });
    return;
  }

  const dir = dirname(fileURLToPath(import.meta.url));
  let endpoint: string | undefined;
  let moduleVersion: unknown;
  const cfgText = readText(join(dir, 'config.json'));
  if (cfgText !== undefined) {
    try {
      const cfg: unknown = JSON.parse(cfgText);
      if (isRecord(cfg) && typeof cfg.endpoint === 'string' && cfg.endpoint) {
        endpoint = cfg.endpoint;
        moduleVersion = cfg.moduleVersion;
      }
    } catch {
      // 配置损坏按未配置处理
    }
  }
  if (!endpoint) {
    emit({ ok: false, reason: 'not_configured' });
    return;
  }

  const skillMd = readText(join(dir, '..', 'SKILL.md'));
  const host = skillMd === undefined ? {} : parseFrontmatter(skillMd);
  if (!host.name) {
    emit({ ok: false, reason: 'host_unreadable' });
    return;
  }

  const sessionId =
    typeof raw.session.sessionId === 'string' && raw.session.sessionId.trim()
      ? raw.session.sessionId
      : 's-' + randomBytes(6).toString('hex');
  const os = process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32'
    ? process.platform
    : 'other';
  const body = {
    skill: host.version ? { name: host.name, version: host.version } : { name: host.name },
    moduleVersion,
    os,
    submittedAt: new Date().toISOString(),
    session: { ...raw.session, sessionId },
    items: raw.items,
  };

  const v = validateSubmission(body);
  if (!v.ok) {
    emit({ ok: false, reason: 'invalid', code: v.code, field: v.field, message: v.message, sessionId });
    return;
  }

  if (process.argv.includes('--dry-run')) {
    emit({ ok: true, dryRun: true, body: v.value });
    return;
  }

  let res: Response;
  let text: string;
  try {
    res = await fetch(endpoint.replace(/\/+$/, '') + '/v1/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(v.value),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = await res.text();
  } catch {
    emit({ ok: false, reason: 'unreachable', sessionId });
    return;
  }

  let json: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) json = parsed;
  } catch {
    // 非 JSON 响应体：只保留状态码
  }
  if (res.status === 201) {
    emit({ ok: true, submissionId: json.submissionId, feedbackIds: json.feedbackIds, sessionId });
  } else {
    emit({
      ok: false,
      reason: 'rejected',
      status: res.status,
      code: json.code,
      message: json.message,
      field: json.field,
      sessionId,
    });
  }
}

main()
  .catch(() => {
    emit({ ok: false, reason: 'internal' });
  })
  .finally(() => {
    process.exitCode = 0;
  });
