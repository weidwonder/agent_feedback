// 交付物一致性：部署文件与 spec §6 配置表一致，上线评测场景清单结构齐全。预期值取自 spec §6 与 §11 AC-019 / AC-020。
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../packages/server/src/config.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

// spec §6 配置表的 7 个变量
const SPEC_ENV_NAMES = ['PORT', 'HOST', 'DATA_DIR', 'TRUST_PROXY', 'COOKIE_SECURE', 'IP_DAILY_LIMIT', 'GLOBAL_DAILY_LIMIT'];

describe('部署文件（AC-019）', () => {
  it('部署说明、systemd 单元与两份反向代理示例都存在', () => {
    for (const p of ['docs/deploy.md', 'packages/server/deploy/agent-feedback.service', 'packages/server/deploy/Caddyfile.example', 'packages/server/deploy/nginx.conf.example']) {
      assert.ok(existsSync(join(ROOT, p)), `缺少 ${p}`);
    }
  });

  it('systemd 单元里设置的环境变量恰是 spec 配置表的 7 个变量，且值能通过服务端配置校验', () => {
    const unit = read('packages/server/deploy/agent-feedback.service');
    const env: Record<string, string> = {};
    for (const m of unit.matchAll(/^Environment=([A-Z_]+)=(.*)$/gm)) env[m[1]!] = m[2]!.trim();
    assert.deepEqual(Object.keys(env).sort(), [...SPEC_ENV_NAMES].sort());
    const cfg = loadConfig(env);
    assert.equal(cfg.ipDailyLimit, 5);
    assert.equal(cfg.globalDailyLimit, 500);
    assert.equal(cfg.cookieSecure, true);
    assert.equal(cfg.trustProxy, true, '示例前置反向代理，须开 TRUST_PROXY');
    // 单元里写死的数据目录路径与可写目录一致
    assert.match(unit, new RegExp(`ReadWritePaths=${cfg.dataDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });

  it('两份代理示例都转发到单元里的监听地址，并带上来源地址头', () => {
    const unit = read('packages/server/deploy/agent-feedback.service');
    const port = /^Environment=PORT=(\d+)$/m.exec(unit)![1]!;
    const host = /^Environment=HOST=(\S+)$/m.exec(unit)![1]!;
    assert.match(read('packages/server/deploy/Caddyfile.example'), new RegExp(`reverse_proxy ${host}:${port}`));
    const nginx = read('packages/server/deploy/nginx.conf.example');
    assert.match(nginx, new RegExp(`proxy_pass http://${host}:${port}`));
    assert.match(nginx, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for/);
  });
});

describe('上线评测场景清单（AC-020）', () => {
  const doc = read('docs/report/上线评测场景.md');
  const rows = (prefix: string): number => (doc.match(new RegExp(`^\\| ${prefix}\\d+ \\|`, 'gm')) ?? []).length;

  it('该反馈与不该反馈场景各不少于 20 个，维护 agent 场景表存在', () => {
    assert.ok(rows('P') >= 20, `该反馈场景 ${rows('P')} 个`);
    assert.ok(rows('N') >= 20, `不该反馈场景 ${rows('N')} 个`);
    assert.ok(rows('M') >= 1, '缺少维护 agent 读注入样本场景');
  });

  it('含判定口径与结果汇总小节', () => {
    for (const h of ['## 判定口径与公式', '## 该反馈场景', '## 不该反馈场景', '## 维护 agent 读注入样本场景', '## 结果汇总']) {
      assert.ok(doc.includes(h), `缺少小节「${h}」`);
    }
  });
});
