import { createServer } from 'node:http';
import { emitKeypressEvents } from 'node:readline';
import { createApp } from './app.ts';
import type { AppContext } from './app.ts';
import { MIN_PASSWORD_LENGTH, setAdmin } from './auth.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { log } from './http.ts';
import { runMaintenance, startJobs } from './jobs.ts';
import { charLength } from '@agent-feedback/shared';


function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** TTY 下不回显读取一行。 */
function promptHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stderr.write(prompt);
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let value = '';
    const onKey = (str: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new Error('已取消'));
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        process.stderr.write('\n');
        resolve(value);
      } else if (key.name === 'backspace') {
        value = [...value].slice(0, -1).join('');
      } else if (str && !key.ctrl) {
        value += str;
      }
    };
    const cleanup = () => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    process.stdin.on('keypress', onKey);
  });
}

async function readStdinLine(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) return readStdinLine();
  const first = await promptHidden('新密码：');
  const second = await promptHidden('再输入一次：');
  if (first !== second) fail('两次输入的密码不一致');
  return first;
}

async function cmdSetAdmin(args: string[]): Promise<void> {
  const username = args[0]?.trim();
  if (!username) fail('用法：server.mjs set-admin <用户名>（密码从标准输入读取）');
  const config = loadConfig(process.env);
  const password = await readPassword();
  if (charLength(password) < MIN_PASSWORD_LENGTH) fail(`密码至少 ${MIN_PASSWORD_LENGTH} 个字符`);
  const db = openDb(config.dataDir);
  setAdmin(db, username, password, new Date());
  db.close();
  process.stderr.write(`管理员 ${username} 已设置，所有已登录会话已失效\n`);
}

function cmdServe(): void {
  const config = loadConfig(process.env);
  const db = openDb(config.dataDir);
  const ctx: AppContext = { db, config, dataDir: config.dataDir, now: () => new Date() };
  runMaintenance(ctx);
  const stopJobs = startJobs(ctx);
  const server = createServer(createApp(ctx));
  server.listen(config.port, config.host, () => {
    log('startup', { host: config.host, port: config.port, dataDir: config.dataDir });
  });
  const shutdown = () => {
    stopJobs();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    server.closeAllConnections();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'serve') cmdServe();
    else if (command === 'set-admin') await cmdSetAdmin(args);
    else fail('用法：server.mjs serve | set-admin <用户名>');
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

void main();
