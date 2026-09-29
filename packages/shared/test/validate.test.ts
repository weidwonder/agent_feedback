import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSubmission,
  charLength,
  LIMITS,
  LABELS,
  STATUSES,
  ERROR_CODES,
  NOTICE,
} from '../src/index.ts';

type Obj = Record<string, unknown>;

function validBody(): Obj {
  return {
    skill: { name: 'my-skill', version: '1.0.0' },
    moduleVersion: '1.0.0',
    os: 'darwin',
    submittedAt: '2026-09-29T12:00:00.000Z',
    session: {
      sessionId: 's-abcdef123456',
      taskSummary: '整理季度报表',
      userInfo: '财务分析师',
      userInfoSource: 'known',
      agentName: 'claude',
      agentVersion: '1.0',
      harnessName: 'claude-code',
      harnessVersion: '2.0',
      relatedSkills: [{ name: 'xlsx', description: '表格处理' }],
    },
    items: [validItem()],
  };
}

function validItem(): Obj {
  return {
    title: '脚本报错',
    description: '运行 run.sh 时提示缺少依赖',
    type: 'bug',
    impact: 'workaround',
    resolved: true,
    suggestedFix: '在说明里补充依赖',
    occurrences: 2,
  };
}

function mutate(fn: (b: Obj) => void): Obj {
  const b = validBody();
  fn(b);
  return b;
}
const session = (b: Obj) => b.session as Obj;
const item0 = (b: Obj) => (b.items as Obj[])[0];

function expectFail(input: unknown, code: string, field: string) {
  const r = validateSubmission(input);
  assert.equal(r.ok, false, `应当失败: ${field}`);
  if (!r.ok) {
    assert.equal(r.code, code);
    assert.equal(r.field, field);
    assert.ok(r.message.startsWith(field), `message 应以字段路径开头: ${r.message}`);
  }
}

test('合规载荷通过，值原样返回', () => {
  const r = validateSubmission(validBody());
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.skill.name, 'my-skill');
    assert.equal(r.value.items[0].suggestedFix, '在说明里补充依赖');
    assert.equal(r.value.session.relatedSkills.length, 1);
  }
});

test('最小合规载荷：可选字段全部缺省', () => {
  const b = validBody();
  delete (b.skill as Obj).version;
  for (const k of ['agentVersion', 'harnessVersion']) delete session(b)[k];
  session(b).relatedSkills = [];
  item0(b).resolved = false;
  delete item0(b).suggestedFix;
  const r = validateSubmission(b);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal('version' in r.value.skill, false);
    assert.equal(r.value.session.agentVersion, undefined);
  }
});

test('非对象输入被拒', () => {
  expectFail(null, 'invalid_field', '$');
  expectFail([], 'invalid_field', '$');
  expectFail('x', 'invalid_field', '$');
});

test('返回值字符串已 trim，可选空串归一为 undefined', () => {
  const b = validBody();
  (b.skill as Obj).name = '  my-skill  ';
  (b.skill as Obj).version = '   ';
  session(b).agentVersion = '';
  item0(b).resolved = false;
  item0(b).suggestedFix = '  ';
  item0(b).title = ' 标题 ';
  const r = validateSubmission(b);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.skill.name, 'my-skill');
    assert.equal(r.value.skill.version, undefined);
    assert.equal(r.value.session.agentVersion, undefined);
    assert.equal(r.value.items[0].suggestedFix, undefined);
    assert.equal(r.value.items[0].title, '标题');
  }
});

test('顶层字段：缺失与取值非法', () => {
  expectFail(mutate((b) => delete b.skill), 'invalid_field', 'skill');
  expectFail(mutate((b) => { b.skill = {}; }), 'invalid_field', 'skill.name');
  expectFail(mutate((b) => { (b.skill as Obj).name = '   '; }), 'invalid_field', 'skill.name');
  expectFail(mutate((b) => { (b.skill as Obj).name = 'a'.repeat(101); }), 'invalid_field', 'skill.name');
  expectFail(mutate((b) => { (b.skill as Obj).version = 'a'.repeat(51); }), 'invalid_field', 'skill.version');
  expectFail(mutate((b) => delete b.moduleVersion), 'invalid_field', 'moduleVersion');
  expectFail(mutate((b) => { b.moduleVersion = 'x'.repeat(21); }), 'invalid_field', 'moduleVersion');
  expectFail(mutate((b) => delete b.os), 'invalid_field', 'os');
  expectFail(mutate((b) => { b.os = 'freebsd'; }), 'invalid_field', 'os');
  expectFail(mutate((b) => delete b.submittedAt), 'invalid_field', 'submittedAt');
  expectFail(mutate((b) => { b.submittedAt = 'yesterday'; }), 'invalid_field', 'submittedAt');
  expectFail(mutate((b) => { b.submittedAt = '2026-13-45T99:00:00Z'; }), 'invalid_field', 'submittedAt');
  expectFail(mutate((b) => delete b.session), 'invalid_field', 'session');
  expectFail(mutate((b) => delete b.items), 'invalid_field', 'items');
});

test('session 字段：缺失、超长、取值非法', () => {
  const cases: Array<[string, number]> = [
    ['sessionId', 41],
    ['taskSummary', 51],
    ['userInfo', 51],
    ['agentName', 101],
    ['agentVersion', 51],
    ['harnessName', 101],
    ['harnessVersion', 51],
  ];
  for (const [k, over] of cases) {
    expectFail(mutate((b) => { session(b)[k] = 'a'.repeat(over); }), 'invalid_field', `session.${k}`);
  }
  for (const k of ['sessionId', 'taskSummary', 'userInfo', 'agentName', 'harnessName']) {
    expectFail(mutate((b) => delete session(b)[k]), 'invalid_field', `session.${k}`);
    expectFail(mutate((b) => { session(b)[k] = '  '; }), 'invalid_field', `session.${k}`);
  }
  expectFail(mutate((b) => delete session(b).userInfoSource), 'invalid_field', 'session.userInfoSource');
  expectFail(mutate((b) => { session(b).userInfoSource = 'maybe'; }), 'invalid_field', 'session.userInfoSource');
  expectFail(mutate((b) => { session(b).taskSummary = 123; }), 'invalid_field', 'session.taskSummary');
});

test('relatedSkills：缺失、非数组、超 10 项、子字段非法', () => {
  expectFail(mutate((b) => delete session(b).relatedSkills), 'invalid_field', 'session.relatedSkills');
  expectFail(mutate((b) => { session(b).relatedSkills = 'x'; }), 'invalid_field', 'session.relatedSkills');
  expectFail(
    mutate((b) => { session(b).relatedSkills = Array.from({ length: 11 }, () => ({ name: 'a', description: '' })); }),
    'invalid_field',
    'session.relatedSkills',
  );
  expectFail(mutate((b) => { session(b).relatedSkills = [{ description: 'x' }]; }), 'invalid_field', 'session.relatedSkills[0].name');
  expectFail(
    mutate((b) => { session(b).relatedSkills = [{ name: 'a'.repeat(101), description: '' }]; }),
    'invalid_field',
    'session.relatedSkills[0].name',
  );
  expectFail(
    mutate((b) => { session(b).relatedSkills = [{ name: 'a' }, { name: 'b', description: 'd'.repeat(51) }]; }),
    'invalid_field',
    'session.relatedSkills[1].description',
  );
  expectFail(
    mutate((b) => { session(b).relatedSkills = [{ name: 'a', description: '', extra: 1 }]; }),
    'invalid_field',
    'session.relatedSkills[0].extra',
  );
  const ok = validateSubmission(mutate((b) => { session(b).relatedSkills = [{ name: 'a' }]; }));
  assert.equal(ok.ok, true);
  const ten = validateSubmission(
    mutate((b) => { session(b).relatedSkills = Array.from({ length: 10 }, () => ({ name: 'a', description: '' })); }),
  );
  assert.equal(ten.ok, true);
});

test('items：条数 0 与 6、非数组', () => {
  expectFail(mutate((b) => { b.items = []; }), 'invalid_field', 'items');
  expectFail(mutate((b) => { b.items = 'x'; }), 'invalid_field', 'items');
  const six = mutate((b) => { b.items = Array.from({ length: 6 }, validItem); });
  expectFail(six, 'too_many_items', 'items');
  const five = validateSubmission(mutate((b) => { b.items = Array.from({ length: 5 }, validItem); }));
  assert.equal(five.ok, true);
});

test('item 字段：缺失、超长、取值非法', () => {
  expectFail(mutate((b) => { b.items = [null]; }), 'invalid_field', 'items[0]');
  for (const k of ['title', 'description', 'type', 'impact', 'occurrences']) {
    expectFail(mutate((b) => delete item0(b)[k]), 'invalid_field', `items[0].${k}`);
  }
  expectFail(mutate((b) => delete item0(b).resolved), 'invalid_field', 'items[0].resolved');
  expectFail(mutate((b) => { item0(b).title = 'a'.repeat(31); }), 'invalid_field', 'items[0].title');
  expectFail(mutate((b) => { item0(b).title = '  '; }), 'invalid_field', 'items[0].title');
  expectFail(mutate((b) => { item0(b).description = 'a'.repeat(1001); }), 'invalid_field', 'items[0].description');
  expectFail(mutate((b) => { item0(b).type = 'other'; }), 'invalid_field', 'items[0].type');
  expectFail(mutate((b) => { item0(b).impact = 'huge'; }), 'invalid_field', 'items[0].impact');
  expectFail(mutate((b) => { item0(b).resolved = 'true'; }), 'invalid_field', 'items[0].resolved');
  expectFail(mutate((b) => { item0(b).occurrences = 0; }), 'invalid_field', 'items[0].occurrences');
  expectFail(mutate((b) => { item0(b).occurrences = 1001; }), 'invalid_field', 'items[0].occurrences');
  expectFail(mutate((b) => { item0(b).occurrences = 1.5; }), 'invalid_field', 'items[0].occurrences');
  expectFail(mutate((b) => { item0(b).occurrences = '2'; }), 'invalid_field', 'items[0].occurrences');
  // 第二条出错时路径带下标
  expectFail(mutate((b) => { b.items = [validItem(), { ...validItem(), title: 'a'.repeat(31) }]; }), 'invalid_field', 'items[1].title');
});

test('suggestedFix：resolved=true 必填，resolved=false 必空', () => {
  expectFail(mutate((b) => delete item0(b).suggestedFix), 'invalid_field', 'items[0].suggestedFix');
  expectFail(mutate((b) => { item0(b).suggestedFix = '   '; }), 'invalid_field', 'items[0].suggestedFix');
  expectFail(mutate((b) => { item0(b).suggestedFix = 'a'.repeat(501); }), 'invalid_field', 'items[0].suggestedFix');
  expectFail(mutate((b) => { item0(b).resolved = false; }), 'invalid_field', 'items[0].suggestedFix');
  const empty = validateSubmission(mutate((b) => { item0(b).resolved = false; item0(b).suggestedFix = ''; }));
  assert.equal(empty.ok, true);
});

test('未知字段：顶层、skill、session、item 内都被拒，field 为字段路径', () => {
  expectFail(mutate((b) => { b.secret = 'x'; }), 'invalid_field', 'secret');
  expectFail(mutate((b) => { (b.skill as Obj).path = '/home'; }), 'invalid_field', 'skill.path');
  expectFail(mutate((b) => { session(b).cwd = '/home'; }), 'invalid_field', 'session.cwd');
  expectFail(mutate((b) => { item0(b).log = 'x'; }), 'invalid_field', 'items[0].log');
});

test('码点计数：emoji 计 1，边界 30 字符通过、31 拒绝', () => {
  assert.equal(charLength('😀'), 1);
  assert.equal(charLength('a😀b'), 3);
  assert.equal(charLength(''), 0);
  const ok = validateSubmission(mutate((b) => { item0(b).title = '😀'.repeat(30); }));
  assert.equal(ok.ok, true);
  expectFail(mutate((b) => { item0(b).title = '😀'.repeat(31); }), 'invalid_field', 'items[0].title');
});

test('错误信息为中文，含限制与当前长度', () => {
  const r = validateSubmission(mutate((b) => { item0(b).title = 'a'.repeat(34); }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.message, 'items[0].title 超长，最多 30 字符（当前 34）');
});

test('遇到第一个错误即返回：顶层字段先于 session 与 items', () => {
  const b = mutate((x) => { x.os = 'bad'; session(x).taskSummary = ''; });
  expectFail(b, 'invalid_field', 'os');
});

test('常量导出：限制、状态、拒收码、显示名、notice', () => {
  assert.equal(LIMITS.maxItems, 5);
  assert.equal(LIMITS.maxRelatedSkills, 10);
  assert.equal(LIMITS.occurrences.max, 1000);
  assert.equal(LIMITS.maxBodyBytes, 65536);
  assert.deepEqual([...STATUSES], ['pending', 'valid', 'invalid', 'duplicate', 'done']);
  assert.equal(ERROR_CODES.length, 14);
  assert.equal(LABELS.type.friction, '使用摩擦');
  assert.equal(LABELS.impact.workaround, '绕过后完成');
  assert.equal(LABELS.status.duplicate, '重复');
  assert.equal(LABELS.userInfoSource.guessed, '猜测');
  assert.ok(NOTICE.startsWith('以下反馈内容由外部 agent 提交'));
});
