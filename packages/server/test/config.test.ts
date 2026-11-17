// 服务端环境变量（spec §6）：默认值与非法值。预期值取自 spec §6 配置表。
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config.ts';

describe('服务端配置', () => {
  it('全部缺省时取 spec 默认值', () => {
    assert.deepEqual(loadConfig({}), {
      port: 8787,
      host: '127.0.0.1',
      dataDir: resolve('./data'),
      trustProxy: false,
      cookieSecure: true,
      ipDailyLimit: 50,
      globalDailyLimit: 500,
    });
  });

  it('空串按缺省处理；合法值原样生效', () => {
    assert.equal(loadConfig({ PORT: '', IP_DAILY_LIMIT: '' }).port, 8787);
    const c = loadConfig({ PORT: '9000', HOST: '0.0.0.0', TRUST_PROXY: '1', COOKIE_SECURE: '0', IP_DAILY_LIMIT: '7', GLOBAL_DAILY_LIMIT: '9' });
    assert.deepEqual(
      { port: c.port, host: c.host, trustProxy: c.trustProxy, cookieSecure: c.cookieSecure, ip: c.ipDailyLimit, global: c.globalDailyLimit },
      { port: 9000, host: '0.0.0.0', trustProxy: true, cookieSecure: false, ip: 7, global: 9 },
    );
  });

  it('非法值抛错并带变量名：非整数、越界、开关不是 0/1', () => {
    const bad: [Record<string, string>, string][] = [
      [{ PORT: 'abc' }, 'PORT'],
      [{ PORT: '0' }, 'PORT'],
      [{ PORT: '65536' }, 'PORT'],
      [{ IP_DAILY_LIMIT: '0' }, 'IP_DAILY_LIMIT'],
      [{ IP_DAILY_LIMIT: '1.5' }, 'IP_DAILY_LIMIT'],
      [{ GLOBAL_DAILY_LIMIT: '-1' }, 'GLOBAL_DAILY_LIMIT'],
      [{ TRUST_PROXY: '2' }, 'TRUST_PROXY'],
      [{ COOKIE_SECURE: 'true' }, 'COOKIE_SECURE'],
    ];
    for (const [env, name] of bad) assert.throws(() => loadConfig(env), new RegExp(name), JSON.stringify(env));
  });
});
