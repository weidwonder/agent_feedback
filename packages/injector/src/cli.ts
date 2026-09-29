// agent-feedback 注入工具入口：config --endpoint <url> | inject <dir>
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfigPath, normalizeEndpoint, readConfig, writeConfig } from './config.ts';
import { InjectError, inject } from './inject.ts';

const USAGE = '用法：\n  agent-feedback config --endpoint <地址>   （登记令牌从标准输入读取）\n  agent-feedback inject <skill 源头目录>';

class UsageError extends Error {}

interface Parsed {
  command: string;
  positional: string[];
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): Parsed {
  const [command = '', ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string>();
  const known = new Set(['--endpoint', '--config-path', '--module-dir']);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      if (!known.has(a)) throw new UsageError(`未知参数 ${a}`);
      const v = rest[++i];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`参数 ${a} 缺少值`);
      flags.set(a, v);
    } else {
      positional.push(a);
    }
  }
  return { command, positional, flags };
}

/** 从标准输入读取令牌；TTY 时关闭回显。 */
async function readSecret(): Promise<string> {
  const stdin = process.stdin;
  if (stdin.isTTY) {
    process.stderr.write('登记令牌（输入不回显）：');
    return new Promise((resolveSecret) => {
      let buf = '';
      stdin.setRawMode(true);
      stdin.setEncoding('utf8');
      stdin.resume();
      const onData = (chunk: string): void => {
        for (const ch of chunk) {
          if (ch === '\r' || ch === '\n' || ch === '\x04') {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.off('data', onData);
            process.stderr.write('\n');
            resolveSecret(buf.trim());
            return;
          }
          if (ch === '\x03') {
            stdin.setRawMode(false);
            process.exit(130);
          }
          if (ch === '\x7f' || ch === '\b') buf = buf.slice(0, -1);
          else buf += ch;
        }
      };
      stdin.on('data', onData);
    });
  }
  const chunks: Buffer[] = [];
  for await (const c of stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main(argv: string[]): Promise<void> {
  const { command, positional, flags } = parseArgs(argv);
  const configPath = flags.get('--config-path') ?? defaultConfigPath();

  if (command === 'config') {
    const raw = flags.get('--endpoint');
    if (!raw) throw new UsageError('缺少 --endpoint <地址>');
    const endpoint = normalizeEndpoint(raw);
    if (!endpoint) throw new InjectError(`服务地址 ${raw} 不合法：必须以 http:// 或 https:// 开头`);
    const registryToken = await readSecret();
    if (!registryToken) throw new InjectError('标准输入没有读到登记令牌');
    writeConfig(configPath, { endpoint, registryToken });
    console.log(`已写入本机配置 ${configPath}（权限 0600）：${endpoint}`);
    return;
  }

  if (command === 'inject') {
    if (positional.length !== 1) throw new UsageError('inject 需要且只需要一个 skill 源头目录');
    const cfg = readConfig(configPath);
    // 构建产物 dist/agent-feedback.mjs 与源码 src/cli.ts 相对 packages/module 的层级相同
    const moduleDir = flags.get('--module-dir') ?? fileURLToPath(new URL('../../module', import.meta.url));
    const result = await inject({ dir: resolve(positional[0]), cfg, moduleDir });
    console.log(result.lines.join('\n'));
    return;
  }

  throw new UsageError(command ? `未知命令 ${command}` : '缺少命令');
}

try {
  await main(process.argv.slice(2));
} catch (e) {
  const msg = (e as Error).message;
  console.error(e instanceof UsageError ? `${msg}\n${USAGE}` : msg);
  process.exit(1);
}
