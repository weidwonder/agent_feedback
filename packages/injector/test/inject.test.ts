import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { defaultConfigPath } from '../src/config.ts';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const TOKEN = 'afr_secret_token_123';

interface Scenario {
  check: unknown;
  checkStatus: number;
  register: unknown;
  registerStatus: number;
}
let scenario: Scenario;
let server: Server;
let endpoint: string;
const seenAuth: string[] = [];

before(async () => {
  server = createServer((req, res) => {
    seenAuth.push(String(req.headers.authorization));
    const url = new URL(req.url ?? '/', 'http://x');
    let body: unknown = { error: { code: 'not_found', message: 'x' } };
    let status = 404;
    if (req.method === 'GET' && url.pathname === '/v1/registry/check') {
      body = scenario.check;
      status = scenario.checkStatus;
    } else if (req.method === 'POST' && url.pathname === '/v1/registry') {
      body = scenario.register;
      status = scenario.registerStatus;
    }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  assert(addr && typeof addr === 'object');
  endpoint = `http://127.0.0.1:${addr.port}`;
});
after(() => server.close());

let root: string;
let host: string;
let moduleDir: string;
let configPath: string;

function makeModule(dir: string, feedbackText = '反馈规则\n'): void {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'assets', 'FEEDBACK.md'), feedbackText);
  writeFileSync(join(dir, 'assets', 'PRIVACY.md'), '隐私\n');
  writeFileSync(join(dir, 'assets', 'gitignore'), '.runtime/\n');
  writeFileSync(join(dir, 'dist', 'submit.mjs'), '// submit\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'm', version: '1.2.3' }));
}

const SKILL_MD = '---\nname: demo-skill\nmetadata:\n  version: "1.0"\n---\n# Demo\n正文\n';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'af-inject-'));
  host = join(root, 'host');
  moduleDir = join(root, 'module');
  configPath = join(root, 'cfg', 'config.json');
  mkdirSync(host);
  writeFileSync(join(host, 'SKILL.md'), SKILL_MD);
  writeFileSync(join(host, 'other.txt'), 'keep me');
  makeModule(moduleDir);
  scenario = {
    check: { state: 'unknown' },
    checkStatus: 200,
    register: { name: 'demo-skill', enabled: true, created: true },
    registerStatus: 200,
  };
  seenAuth.length = 0;
});

function snapshot(dir: string, rel = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.set(r + '/', '');
      for (const [k, v] of snapshot(dir, r)) out.set(k, v);
    } else {
      out.set(r, readFileSync(join(dir, r)).toString('base64'));
    }
  }
  return out;
}

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}
function run(args: string[], input?: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input ?? '');
  });
}

async function configure(): Promise<void> {
  const r = await run(['config', '--endpoint', endpoint + '/', '--config-path', configPath], TOKEN + '\n');
  assert.equal(r.code, 0, r.stderr);
}
const injectArgs = (): string[] => ['inject', host, '--config-path', configPath, '--module-dir', moduleDir];

// Windows 不支持 POSIX 权限位（chmod 只影响只读属性），配置文件的私密性由用户目录 ACL 保证
const POSIX_MODES = process.platform !== 'win32';

describe('config', () => {
  it('写入本机配置，权限 0600，地址去掉末尾斜杠，令牌来自标准输入', async () => {
    await configure();
    if (POSIX_MODES) assert.equal(statSync(configPath).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')), { endpoint, registryToken: TOKEN });
  });

  it('已存在的宽权限配置文件会被收紧为 0600', { skip: !POSIX_MODES && 'Windows 没有 POSIX 权限位' }, async () => {
    mkdirSync(join(root, 'cfg'));
    writeFileSync(configPath, '{}', { mode: 0o644 });
    chmodSync(configPath, 0o644);
    await configure();
    assert.equal(statSync(configPath).mode & 0o777, 0o600);
  });

  it('非法地址与空令牌被拒绝且不写文件', async () => {
    const bad = await run(['config', '--endpoint', 'ftp://x', '--config-path', configPath], TOKEN);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /不合法/);
    const empty = await run(['config', '--endpoint', endpoint, '--config-path', configPath], '\n');
    assert.equal(empty.code, 1);
    assert.throws(() => statSync(configPath));
  });
});

describe('inject', () => {
  it('成功：文件齐全、引导语一次、config.json 不含令牌、带 Bearer 登记令牌', async () => {
    await configure();
    const r = await run(injectArgs());
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /demo-skill/);
    assert.match(r.stdout, /新登记/);
    assert.match(r.stdout, /1\.2\.3/);
    assert.match(r.stdout, /目录白名单/);
    const m = join(host, 'agent-feedback');
    assert.deepEqual(readdirSync(m).sort(), ['.gitignore', 'FEEDBACK.md', 'PRIVACY.md', 'config.json', 'submit.mjs']);
    assert.equal(readFileSync(join(m, '.gitignore'), 'utf8'), '.runtime/\n');
    assert.deepEqual(JSON.parse(readFileSync(join(m, 'config.json'), 'utf8')), { endpoint, moduleVersion: '1.2.3' });
    const skill = readFileSync(join(host, 'SKILL.md'), 'utf8');
    assert.equal(skill.split('<!-- agent-feedback -->').length - 1, 1);
    assert.ok(skill.endsWith('\n\n<!-- agent-feedback -->\n> skill反馈优化技能，请在用户skill处理不顺利、出错时候加载：阅读本 skill 目录下的 `agent-feedback/FEEDBACK.md` 并按其规则执行。\n'));
    assert.ok(skill.startsWith(SKILL_MD));
    assert.ok(seenAuth.every((h) => h === `Bearer ${TOKEN}`));
    for (const f of [...readdirSync(m).map((n) => join(m, n)), join(host, 'SKILL.md')]) {
      assert.ok(!readFileSync(f, 'utf8').includes(TOKEN));
    }
    assert.ok(!readdirSync(host).some((n) => n.startsWith('.agent-feedback-backup-')));
  });

  it('重复注入不重复追加引导语，并升级模块文件', async () => {
    await configure();
    assert.equal((await run(injectArgs())).code, 0);
    scenario.check = { state: 'registered', enabled: true };
    scenario.register = { name: 'demo-skill', enabled: true, created: false };
    writeFileSync(join(moduleDir, 'dist', 'submit.mjs'), '// submit v2\n');
    const r = await run(injectArgs());
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /已登记/);
    const skill = readFileSync(join(host, 'SKILL.md'), 'utf8');
    assert.equal(skill.split('<!-- agent-feedback -->').length - 1, 1);
    assert.equal(readFileSync(join(host, 'agent-feedback', 'submit.mjs'), 'utf8'), '// submit v2\n');
    assert.ok(!readdirSync(host).some((n) => n.startsWith('.agent-feedback-backup-')));
  });

  it('未配置实例：退出码 1，不改任何文件', async () => {
    const before = snapshot(host);
    const r = await run(injectArgs());
    assert.equal(r.code, 1);
    assert.match(r.stderr, /未配置实例/);
    assert.deepEqual(snapshot(host), before);
  });

  it('没有 SKILL.md 或无 name：拒绝，不改文件', async () => {
    await configure();
    writeFileSync(join(host, 'SKILL.md'), '---\ndescription: x\n---\n正文\n');
    const before = snapshot(host);
    const r = await run(injectArgs());
    assert.equal(r.code, 1);
    assert.match(r.stderr, /未声明 name/);
    assert.deepEqual(snapshot(host), before);

    rmSync(join(host, 'SKILL.md'));
    const r2 = await run(injectArgs());
    assert.equal(r2.code, 1);
    assert.match(r2.stderr, /没有 SKILL\.md/);
  });

  it('name 超长不合法：拒绝并说明原因，不写文件、不登记', async () => {
    await configure();
    writeFileSync(join(host, 'SKILL.md'), `---\nname: ${'x'.repeat(101)}\n---\n正文\n`);
    const before = snapshot(host);
    seenAuth.length = 0;
    const r = await run(injectArgs());
    assert.equal(r.code, 1);
    assert.match(r.stderr, /name 不合法/);
    assert.match(r.stderr, /1–100/);
    assert.deepEqual(snapshot(host), before);
    assert.equal(seenAuth.length, 0, '未发起任何检查或登记请求');
  });

  it('旧名：拒绝并提示现名', async () => {
    await configure();
    scenario.check = { state: 'old_name', currentName: 'new-skill' };
    const before = snapshot(host);
    const r = await run(injectArgs());
    assert.equal(r.code, 1);
    assert.match(r.stderr, /new-skill/);
    assert.deepEqual(snapshot(host), before);
  });

  it('改名未同步：未登记 + 模块指向当前实例 → 拒绝', async () => {
    await configure();
    mkdirSync(join(host, 'agent-feedback'));
    writeFileSync(join(host, 'agent-feedback', 'config.json'), JSON.stringify({ endpoint, moduleVersion: '1.0.0' }));
    const before = snapshot(host);
    const r = await run(injectArgs());
    assert.equal(r.code, 1);
    assert.match(r.stderr, /管理界面/);
    assert.deepEqual(snapshot(host), before);
  });

  it('模块指向其他实例：新登记并覆盖模块', async () => {
    await configure();
    mkdirSync(join(host, 'agent-feedback'));
    writeFileSync(join(host, 'agent-feedback', 'config.json'), JSON.stringify({ endpoint: 'https://other.example.com', moduleVersion: '0.9.0' }));
    writeFileSync(join(host, 'agent-feedback', 'stale.txt'), 'stale');
    const r = await run(injectArgs());
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /新登记/);
    assert.deepEqual(JSON.parse(readFileSync(join(host, 'agent-feedback', 'config.json'), 'utf8')).endpoint, endpoint);
    assert.throws(() => statSync(join(host, 'agent-feedback', 'stale.txt')));
  });

  it('登记失败：宿主目录与注入前逐字节一致（全新注入）', async () => {
    await configure();
    scenario.registerStatus = 500;
    scenario.register = { error: { code: 'internal', message: 'boom' } };
    const before = snapshot(host);
    const r = await run(injectArgs());
    assert.equal(r.code, 1);
    assert.match(r.stderr, /登记失败/);
    assert.match(r.stderr, /已还原/);
    assert.deepEqual(snapshot(host), before);
  });

  it('登记失败：升级场景下旧模块与旧 SKILL.md 原样恢复', async () => {
    await configure();
    mkdirSync(join(host, 'agent-feedback'));
    writeFileSync(join(host, 'agent-feedback', 'config.json'), JSON.stringify({ endpoint: 'https://other.example.com' }));
    writeFileSync(join(host, 'agent-feedback', 'FEEDBACK.md'), '旧版\r\n');
    writeFileSync(join(host, 'SKILL.md'), SKILL_MD + '<!-- agent-feedback -->\n旧引导\n');
    scenario.registerStatus = 401;
    scenario.register = { error: { code: 'unauthorized', message: 'x' } };
    const before = snapshot(host);
    const r = await run(injectArgs());
    assert.equal(r.code, 1);
    assert.match(r.stderr, /令牌无效/);
    assert.deepEqual(snapshot(host), before);
  });

  it('检查阶段网络失败：退出码 1，不改文件', async () => {
    await configure();
    const dead = createServer();
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r));
    const addr = dead.address();
    assert(addr && typeof addr === 'object');
    const deadPort = addr.port;
    await new Promise<void>((r) => dead.close(() => r()));
    writeFileSync(configPath, JSON.stringify({ endpoint: `http://127.0.0.1:${deadPort}`, registryToken: TOKEN }));
    const before = snapshot(host);
    const r = await run(injectArgs());
    assert.equal(r.code, 1);
    assert.match(r.stderr, /无法连接/);
    assert.deepEqual(snapshot(host), before);
  });

  it('写出文件含登记令牌：回滚并退出码 1', async () => {
    await configure();
    makeModule(moduleDir, `泄露 ${TOKEN}\n`);
    const before = snapshot(host);
    const r = await run(injectArgs());
    assert.equal(r.code, 1);
    assert.match(r.stderr, /含登记令牌，已回滚/);
    assert.deepEqual(snapshot(host), before);
    assert.equal(seenAuth.filter((h) => h).length, 1); // 只有检查请求，未登记
  });

  it('停用的 skill：注入后仍停用并提示', async () => {
    await configure();
    scenario.check = { state: 'registered', enabled: false };
    scenario.register = { name: 'demo-skill', enabled: false, created: false };
    const r = await run(injectArgs());
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /停用/);
    assert.match(r.stdout, /需在管理界面启用/);
  });

  it('缺少模块源文件：拒绝且不改宿主', async () => {
    await configure();
    rmSync(join(moduleDir, 'dist', 'submit.mjs'));
    const before = snapshot(host);
    const r = await run(injectArgs());
    assert.equal(r.code, 1);
    assert.match(r.stderr, /缺少反馈模块文件/);
    assert.deepEqual(snapshot(host), before);
  });
});

describe('本机配置默认路径', () => {
  it('win32：位于 %APPDATA%\\agent-feedback\\config.json', { skip: process.platform !== 'win32' }, () => {
    assert.equal(defaultConfigPath(), join(process.env.APPDATA!, 'agent-feedback', 'config.json'));
  });

  it('非 win32：位于 ~/.config/agent-feedback/config.json', { skip: process.platform === 'win32' }, () => {
    assert.equal(defaultConfigPath(), join(homedir(), '.config', 'agent-feedback', 'config.json'));
  });
});
