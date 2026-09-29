// 注入（spec §4.4）：前置检查 → 写模块 → 追加引导语 → 登记；任何失败回滚宿主目录。
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from '@agent-feedback/shared';
import type { InjectorConfig } from './config.ts';
import { checkName, register } from './registry-client.ts';

export const MARKER = '<!-- agent-feedback -->';
const GUIDE =
  '\n\n' +
  MARKER +
  '\n> skill 反馈优化技能，请在用户 skill 处理不顺利、出错时加载：阅读本 skill 目录下的 `agent-feedback/FEEDBACK.md` 并按其规则执行。\n';

export class InjectError extends Error {}

export interface InjectOptions {
  dir: string;
  cfg: InjectorConfig;
  /** 模块源目录：含 assets/{FEEDBACK.md,PRIVACY.md,gitignore}、dist/submit.mjs、package.json */
  moduleDir: string;
}

export interface InjectResult {
  name: string;
  created: boolean;
  enabled: boolean;
  moduleVersion: string;
  lines: string[];
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

function readModuleVersion(moduleDir: string): string {
  const pkgPath = join(moduleDir, 'package.json');
  try {
    const v = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown }).version;
    if (typeof v === 'string' && v) return v;
  } catch {
    // 落到下面统一报错
  }
  throw new InjectError(`读不到反馈模块版本（${pkgPath}）；请先构建 packages/module`);
}

export async function inject(opts: InjectOptions): Promise<InjectResult> {
  const { dir, cfg, moduleDir: src } = opts;
  if (!cfg.endpoint || !cfg.registryToken) {
    throw new InjectError('未配置实例：先运行 agent-feedback config --endpoint <地址>');
  }
  const client = { endpoint: cfg.endpoint, registryToken: cfg.registryToken };

  const skillMdPath = join(dir, 'SKILL.md');
  if (!existsSync(skillMdPath)) {
    throw new InjectError(`${dir} 下没有 SKILL.md；请指定 skill 源头目录`);
  }
  const skillMdOriginal = readFileSync(skillMdPath);
  const name = parseFrontmatter(skillMdOriginal.toString('utf8')).name;
  if (!name) throw new InjectError('SKILL.md 未声明 name，拒绝注入');

  const sources = {
    feedback: join(src, 'assets', 'FEEDBACK.md'),
    privacy: join(src, 'assets', 'PRIVACY.md'),
    gitignore: join(src, 'assets', 'gitignore'),
    submit: join(src, 'dist', 'submit.mjs'),
  };
  for (const p of Object.values(sources)) {
    if (!existsSync(p)) throw new InjectError(`缺少反馈模块文件 ${p}；请先构建 packages/module`);
  }
  const moduleVersion = readModuleVersion(src);

  let check;
  try {
    check = await checkName(client, name);
  } catch (e) {
    throw new InjectError(`检查登记失败：${(e as Error).message}`);
  }
  if (check.state === 'old_name') {
    throw new InjectError(`${name} 是 ${check.currentName} 改名前的旧名；先把宿主声明改成现名`);
  }

  const hostModule = join(dir, 'agent-feedback');
  if (check.state === 'unknown' && existsSync(join(hostModule, 'config.json'))) {
    let existingEndpoint: unknown;
    try {
      existingEndpoint = (JSON.parse(readFileSync(join(hostModule, 'config.json'), 'utf8')) as { endpoint?: unknown }).endpoint;
    } catch {
      existingEndpoint = undefined; // 损坏的旧配置视为不指向当前实例
    }
    if (existingEndpoint === cfg.endpoint) {
      throw new InjectError(`该源头已接入当前实例，但名称 ${name} 不在登记名单中：先在管理界面把登记改成该名称`);
    }
  }

  const backup = join(dir, `.agent-feedback-backup-${Date.now()}`);
  let backedUp = false;
  const rollback = (): void => {
    rmSync(hostModule, { recursive: true, force: true });
    if (backedUp) renameSync(backup, hostModule);
    writeFileSync(skillMdPath, skillMdOriginal);
  };

  try {
    if (existsSync(hostModule)) {
      renameSync(hostModule, backup);
      backedUp = true;
    }
    mkdirSync(hostModule);
    cpSync(sources.feedback, join(hostModule, 'FEEDBACK.md'));
    cpSync(sources.privacy, join(hostModule, 'PRIVACY.md'));
    cpSync(sources.submit, join(hostModule, 'submit.mjs'));
    cpSync(sources.gitignore, join(hostModule, '.gitignore'));
    writeFileSync(join(hostModule, 'config.json'), JSON.stringify({ endpoint: cfg.endpoint, moduleVersion }, null, 2) + '\n');
    if (!skillMdOriginal.toString('utf8').includes(MARKER)) {
      writeFileSync(skillMdPath, Buffer.concat([skillMdOriginal, Buffer.from(GUIDE)]));
    }

    // 不变量 1：写出的文件不得含登记令牌
    const written = [...listFiles(hostModule), skillMdPath];
    if (written.some((f) => statSync(f).isFile() && readFileSync(f).includes(cfg.registryToken!))) {
      rollback();
      throw new InjectError('写出文件含登记令牌，已回滚');
    }
  } catch (e) {
    if (e instanceof InjectError) throw e;
    try {
      rollback();
    } catch (re) {
      throw new InjectError(`写文件失败（${(e as Error).message}），且回滚出错：${(re as Error).message}；请手动检查 ${dir}`);
    }
    throw new InjectError(`写文件失败：${(e as Error).message}；宿主文件已还原`);
  }

  let reg;
  try {
    reg = await register(client, name);
  } catch (e) {
    try {
      rollback();
    } catch (re) {
      throw new InjectError(`登记失败：${(e as Error).message}；回滚也出错：${(re as Error).message}；请手动检查 ${dir}`);
    }
    throw new InjectError(`登记失败：${(e as Error).message}；宿主文件已还原`);
  }

  if (backedUp) rmSync(backup, { recursive: true, force: true });

  const lines = [
    `已注入：${name}`,
    `登记：${reg.created ? '新登记' : '已登记'}；收录状态：${reg.enabled ? '启用' : '停用'}`,
    `模块版本：${moduleVersion}`,
  ];
  if (!reg.enabled) lines.push('该 skill 已停用，需在管理界面启用。');
  lines.push(
    '提示：若宿主仓库有目录白名单、规范句去重、体积预算、变更记录等流程要求，请按该仓库流程补充。',
  );
  return { name, created: reg.created, enabled: reg.enabled, moduleVersion, lines };
}
