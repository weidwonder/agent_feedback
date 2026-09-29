import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { nodeTooOld } from '../src/node-version.ts';

const here = dirname(fileURLToPath(import.meta.url));
const moduleRoot = join(here, '..');
const repoRoot = join(moduleRoot, '..', '..');
const bundle = join(moduleRoot, 'dist', 'submit.mjs');

type Received = { method?: string; url?: string; body: string };
let server: http.Server;
let port = 0;
let received: Received[] = [];
let respond: (res: http.ServerResponse) => void = (res) => {
  res.writeHead(201, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ submissionId: 7, feedbackIds: [11, 12] }));
};
const tmpDirs: string[] = [];

before(async () => {
  // 用 esbuild 的 JS 接口构建：`node_modules/.bin/esbuild` 在 Windows 上要经 .cmd 包装才能执行
  buildSync({
    entryPoints: [join(moduleRoot, 'src', 'submit.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: bundle,
    logLevel: 'silent',
  });
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString('utf8') });
      respond(res);
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  port = (server.address() as { port: number }).port;
});

after(() => {
  server.close();
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function makeHost(opts: { skillMd?: string | null; config?: object | null } = {}): string {
  const host = mkdtempSync(join(tmpdir(), 'af-host-'));
  tmpDirs.push(host);
  mkdirSync(join(host, 'agent-feedback'));
  const skillMd =
    opts.skillMd === undefined
      ? '---\nname: demo-skill\nmetadata:\n  version: "2.3.1"\n---\n# demo\n'
      : opts.skillMd;
  if (skillMd !== null) writeFileSync(join(host, 'SKILL.md'), skillMd);
  copyFileSync(bundle, join(host, 'agent-feedback', 'submit.mjs'));
  const config =
    opts.config === undefined ? { endpoint: `http://127.0.0.1:${port}`, moduleVersion: '1.0.0' } : opts.config;
  if (config !== null) writeFileSync(join(host, 'agent-feedback', 'config.json'), JSON.stringify(config));
  return host;
}

const validInput = () => ({
  session: {
    taskSummary: '整理周报',
    userInfo: '产品经理',
    userInfoSource: 'guessed',
    agentName: 'Claude Sonnet 5.5',
    harnessName: 'Claude Code',
    relatedSkills: [{ name: 'other-skill', description: '相关能力' }],
  },
  items: [
    {
      title: '命令不存在',
      description: '文档提到的命令在环境里找不到，换了做法仍失败。',
      type: 'bug',
      impact: 'blocking',
      resolved: false,
      occurrences: 2,
    },
  ],
});

// 假服务与被测脚本同处一个进程，必须异步起子进程，否则事件循环被 spawnSync 卡住。
function execute(host: string, input: unknown, args: string[], env: Record<string, string>) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((ok, fail) => {
    const child = spawn(process.execPath, [join(host, 'agent-feedback', 'submit.mjs'), ...args], {
      env: { ...process.env, AGENT_FEEDBACK_DISABLED: '', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', fail);
    child.on('close', (status) => ok({ status, stdout, stderr }));
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}

async function run(host: string, input: unknown, args: string[] = [], env: Record<string, string> = {}) {
  const r = await execute(host, input, args, env);
  assert.equal(r.status, 0, '退出码恒为 0');
  assert.equal(r.stderr, '', 'stderr 必须为空');
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 1, 'stdout 只有一行');
  return JSON.parse(lines[0]);
}

test('成功提交：补齐宿主名称、metadata.version、模块版本、os、时间与会话编号', async () => {
  received = [];
  const out = await run(makeHost(), validInput());
  assert.equal(out.ok, true);
  assert.equal(out.submissionId, 7);
  assert.deepEqual(out.feedbackIds, [11, 12]);
  assert.match(out.sessionId, /^s-[0-9a-f]{12}$/);
  assert.equal(received.length, 1);
  assert.equal(received[0].method, 'POST');
  assert.equal(received[0].url, '/v1/submissions');
  const body = JSON.parse(received[0].body);
  assert.deepEqual(body.skill, { name: 'demo-skill', version: '2.3.1' });
  assert.equal(body.moduleVersion, '1.0.0');
  assert.ok(['darwin', 'linux', 'win32', 'other'].includes(body.os));
  assert.ok(!Number.isNaN(Date.parse(body.submittedAt)));
  assert.equal(body.session.sessionId, out.sessionId);
  assert.equal(body.items.length, 1);
});

test('agent 给出的 sessionId 被沿用', async () => {
  received = [];
  const input = validInput();
  (input.session as Record<string, unknown>).sessionId = 's-abc123abc123';
  const out = await run(makeHost(), input);
  assert.equal(out.sessionId, 's-abc123abc123');
  assert.equal(JSON.parse(received[0].body).session.sessionId, 's-abc123abc123');
});

test('宿主没有 metadata.version 时请求体省略 skill.version', async () => {
  received = [];
  const host = makeHost({ skillMd: '---\nname: demo-skill\nversion: 9.9\n---\n' });
  const out = await run(host, validInput());
  assert.equal(out.ok, true);
  assert.deepEqual(JSON.parse(received[0].body).skill, { name: 'demo-skill' });
});

test('--dry-run 输出完整请求体且不发请求', async () => {
  received = [];
  const out = await run(makeHost(), validInput(), ['--dry-run']);
  assert.equal(out.ok, true);
  assert.equal(out.dryRun, true);
  assert.equal(out.body.skill.name, 'demo-skill');
  assert.equal(out.body.items.length, 1);
  assert.equal(received.length, 0);
});

test('AGENT_FEEDBACK_DISABLED=1 不发请求', async () => {
  received = [];
  const out = await run(makeHost(), validInput(), [], { AGENT_FEEDBACK_DISABLED: '1' });
  assert.deepEqual(out, { ok: false, reason: 'disabled' });
  assert.equal(received.length, 0);
});

test('服务不可达输出 unreachable', async () => {
  const host = makeHost({ config: { endpoint: 'http://127.0.0.1:1', moduleVersion: '1.0.0' } });
  const out = await run(host, validInput());
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'unreachable');
  assert.match(out.sessionId, /^s-/);
});

test('格式错误输出 invalid 并带 code、field、message、sessionId，且不发请求', async () => {
  received = [];
  const input = validInput();
  input.items[0].title = 'x'.repeat(31);
  const out = await run(makeHost(), input);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'invalid');
  assert.equal(out.code, 'invalid_field');
  assert.equal(out.field, 'items[0].title');
  assert.ok(out.message.includes('items[0].title'));
  assert.match(out.sessionId, /^s-/);
  assert.equal(received.length, 0);
});

test('服务拒收输出 rejected 并透传 status、code、message、field', async () => {
  const saved = respond;
  respond = (res) => {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'skill_not_registered', message: '未登记', field: 'skill.name' } }));
  };
  try {
    const out = await run(makeHost(), validInput());
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'rejected');
    assert.equal(out.status, 403);
    assert.equal(out.code, 'skill_not_registered');
    assert.equal(out.field, 'skill.name');
    assert.equal(out.message, '未登记');
    assert.match(out.sessionId, /^s-/);
  } finally {
    respond = saved;
  }
});

test('服务返回非 JSON 的 5xx 仍输出 rejected', async () => {
  const saved = respond;
  respond = (res) => {
    res.writeHead(502);
    res.end('bad gateway');
  };
  try {
    const out = await run(makeHost(), validInput());
    assert.equal(out.reason, 'rejected');
    assert.equal(out.status, 502);
  } finally {
    respond = saved;
  }
});

test('标准输入不是 JSON 输出 bad_input', async () => {
  const out = await run(makeHost(), 'not json');
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'bad_input');
});

test('标准输入缺 session 或 items 输出 bad_input', async () => {
  assert.equal((await run(makeHost(), { items: [] })).reason, 'bad_input');
  assert.equal((await run(makeHost(), [])).reason, 'bad_input');
});

test('config.json 缺失或无 endpoint 输出 not_configured', async () => {
  assert.equal((await run(makeHost({ config: null }), validInput())).reason, 'not_configured');
  assert.equal((await run(makeHost({ config: { moduleVersion: '1.0.0' } }), validInput())).reason, 'not_configured');
});

test('宿主 SKILL.md 缺失或无 name 输出 host_unreadable', async () => {
  assert.equal((await run(makeHost({ skillMd: null }), validInput())).reason, 'host_unreadable');
  assert.equal((await run(makeHost({ skillMd: '---\ndescription: x\n---\n' }), validInput())).reason, 'host_unreadable');
});

test('模块 .gitignore 资产忽略 .runtime/', async () => {
  const text = readFileSync(join(moduleRoot, 'assets', 'gitignore'), 'utf8');
  assert.ok(text.split(/\r?\n/).includes('.runtime/'));
});

test('nodeTooOld 按主版本判断是否低于 Node 20', () => {
  assert.equal(nodeTooOld('18.20.0'), true);
  assert.equal(nodeTooOld('20.0.0'), false);
  assert.equal(nodeTooOld('22.13.1'), false);
});

// 脚本级回归：用预加载脚本把 process.versions.node 伪装成 18.20.0，直接运行构建产物。
// 标准输入保持打开且不写入：脚本在版本门槛处必须不等标准输入就结束。
// --import 传 file URL：Windows 绝对路径的盘符会被当成 URL 协议而加载失败。
const fakeNode18 = join(here, 'fixtures', 'fake-node18.mjs');

function runAsNode18(host: string, env: Record<string, string>) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((ok, fail) => {
    const child = spawn(process.execPath, ['--import', pathToFileURL(fakeNode18).href, join(host, 'agent-feedback', 'submit.mjs')], {
      env: { ...process.env, AGENT_FEEDBACK_DISABLED: '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const guard = setTimeout(() => {
      child.kill('SIGKILL');
      fail(new Error('脚本在版本门槛处没有结束：仍在等标准输入'));
    }, 8000);
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', fail);
    child.on('close', (status) => {
      clearTimeout(guard);
      ok({ status, stdout, stderr });
    });
  });
}

test('Node 18 环境（预加载伪装版本）：不设开关时 stdout 恰一行 node_too_old，退出码 0，stderr 为空，不读标准输入也结束，不发请求', async () => {
  const host = makeHost();
  const before = received.length;
  const r = await runAsNode18(host, {});
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, '{"ok":false,"reason":"node_too_old"}\n');
  assert.equal(received.length, before, '版本不满足时不得发请求');
});

test('Node 18 环境（预加载伪装版本）：AGENT_FEEDBACK_DISABLED=1 时 reason 为 disabled', async () => {
  const host = makeHost();
  const before = received.length;
  const r = await runAsNode18(host, { AGENT_FEEDBACK_DISABLED: '1' });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, '{"ok":false,"reason":"disabled"}\n');
  assert.equal(received.length, before);
});

test('标准输入超过 256 KiB：输出 bad_input，退出码 0，stderr 为空，不发请求', async () => {
  const host = makeHost();
  const before = received.length;
  const child = spawn(process.execPath, [join(host, 'agent-feedback', 'submit.mjs')], {
    env: { ...process.env, AGENT_FEEDBACK_DISABLED: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => (stdout += c));
  child.stderr.on('data', (c) => (stderr += c));
  child.stdin.on('error', () => {}); // 脚本读到上限就不再读，写端可能收到 EPIPE，属预期
  const closed = new Promise<number | null>((ok) => child.on('close', ok));
  // 语法上合法的 JSON：只有体积超限这一个问题，放宽上限就会得到别的结果
  child.stdin.end(JSON.stringify({ ...validInput(), padding: 'x'.repeat(256 * 1024) }));
  assert.equal(await closed, 0);
  assert.equal(stderr, '');
  const out = JSON.parse(stdout.trim()) as { ok: boolean; reason: string };
  assert.equal(stdout.trim().split('\n').length, 1);
  assert.deepEqual({ ok: out.ok, reason: out.reason }, { ok: false, reason: 'bad_input' });
  assert.equal(received.length, before);
});

// 真实宿主头部样本（test/fixtures/真实宿主skill头部/）：脚本据此补齐 skill.name 与 skill.version。
const realDir = join(repoRoot, 'test', 'fixtures', '真实宿主skill头部');
const realCases: [string, { name: string; version?: string } | null][] = [
  ['SKILL-名称含冒号-块描述-metadata双引号版本.md', { name: 'ak:tech-graph', version: '1.1.1' }],
  ['SKILL-无metadata-块描述.md', { name: 'freshrss' }],
  ['SKILL-顶层version-metadata无版本-嵌套列表.md', { name: 'lark-whiteboard' }],
  ['SKILL-metadata单引号版本.md', { name: 'agentic-principle', version: '0.10.0' }],
  ['SKILL-无frontmatter.md', null],
];
for (const [file, expected] of realCases) {
  test(`真实宿主头部 ${file}：--dry-run 的 skill 字段`, async () => {
    const host = makeHost({ skillMd: readFileSync(join(realDir, file), 'utf8') });
    const before = received.length;
    const out = await run(host, validInput(), ['--dry-run']);
    if (expected === null) {
      assert.deepEqual(out, { ok: false, reason: 'host_unreadable' });
    } else {
      assert.equal(out.ok, true, JSON.stringify(out));
      assert.deepEqual(out.body.skill, expected.version === undefined ? { name: expected.name } : expected, '无 metadata 版本时不带 version');
    }
    assert.equal(received.length, before);
  });
}
