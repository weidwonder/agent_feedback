import {
  FEEDBACK_TYPES,
  IMPACTS,
  LIMITS,
  OS_VALUES,
  USER_INFO_SOURCES,
} from './limits.ts';
import type { FeedbackType, Impact, OsValue, UserInfoSource } from './limits.ts';

export interface RelatedSkill {
  name: string;
  description?: string;
}

export interface SessionInput {
  sessionId: string;
  taskSummary: string;
  userInfo: string;
  userInfoSource: UserInfoSource;
  agentName: string;
  agentVersion?: string;
  harnessName: string;
  harnessVersion?: string;
  relatedSkills: RelatedSkill[];
}

export interface ItemInput {
  title: string;
  description: string;
  type: FeedbackType;
  impact: Impact;
  resolved: boolean;
  suggestedFix?: string;
  occurrences: number;
}

export interface Submission {
  skill: { name: string; version?: string };
  moduleVersion: string;
  os: OsValue;
  submittedAt: string;
  session: SessionInput;
  items: ItemInput[];
}

export type ValidationResult =
  | { ok: true; value: Submission }
  | { ok: false; code: 'invalid_field' | 'too_many_items'; field: string; message: string };

/** 按 Unicode 码点计数（emoji 计 1）。 */
export function charLength(s: string): number {
  return [...s].length;
}

class Fail extends Error {
  code: 'invalid_field' | 'too_many_items';
  field: string;
  constructor(field: string, message: string, code: 'invalid_field' | 'too_many_items' = 'invalid_field') {
    super(message);
    this.code = code;
    this.field = field;
  }
}

type Obj = Record<string, unknown>;

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireObj(v: unknown, path: string): Obj {
  if (v === undefined || v === null) throw new Fail(path, `${path} 缺失，必填`);
  if (!isObj(v)) throw new Fail(path, `${path} 类型不对，应为对象`);
  return v;
}

function rejectUnknown(o: Obj, allowed: readonly string[], prefix: string): void {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) {
      const path = prefix ? `${prefix}.${k}` : k;
      throw new Fail(path, `${path} 未知字段，不允许提交`);
    }
  }
}

/** 读取字符串字段：先 trim，trim 后为空视为缺失。 */
function readStr(
  o: Obj,
  key: string,
  path: string,
  range: { min?: number; max: number },
  required: boolean,
): string | undefined {
  const raw = o[key];
  if (raw === undefined || raw === null) {
    if (required) throw new Fail(path, `${path} 缺失，必填`);
    return undefined;
  }
  if (typeof raw !== 'string') throw new Fail(path, `${path} 类型不对，应为字符串`);
  const s = raw.trim();
  if (s === '') {
    if (required) throw new Fail(path, `${path} 缺失，必填`);
    return undefined;
  }
  const n = charLength(s);
  if (n > range.max) throw new Fail(path, `${path} 超长，最多 ${range.max} 字符（当前 ${n}）`);
  return s;
}

function readEnum<T extends string>(o: Obj, key: string, path: string, values: readonly T[]): T {
  const raw = o[key];
  if (raw === undefined || raw === null) throw new Fail(path, `${path} 缺失，必填`);
  if (typeof raw !== 'string' || !(values as readonly string[]).includes(raw)) {
    throw new Fail(path, `${path} 取值非法，可选：${values.join(' / ')}`);
  }
  return raw as T;
}

function required(v: string | undefined): string {
  // readStr 在 required=true 时不会返回 undefined，这里只为收窄类型。
  if (v === undefined) throw new Error('内部错误：必填字段未返回值');
  return v;
}

function withOptional<T extends object, K extends string>(target: T, key: K, v: string | undefined): void {
  if (v !== undefined) (target as Record<string, unknown>)[key] = v;
}

function validateRelatedSkills(v: unknown, path: string): RelatedSkill[] {
  if (v === undefined || v === null) throw new Fail(path, `${path} 缺失，必填`);
  if (!Array.isArray(v)) throw new Fail(path, `${path} 类型不对，应为数组`);
  if (v.length > LIMITS.maxRelatedSkills) {
    throw new Fail(path, `${path} 条数过多，最多 ${LIMITS.maxRelatedSkills} 项（当前 ${v.length}）`);
  }
  return v.map((entry, i) => {
    const p = `${path}[${i}]`;
    const o = requireObj(entry, p);
    rejectUnknown(o, ['name', 'description'], p);
    const out: RelatedSkill = {
      name: required(readStr(o, 'name', `${p}.name`, LIMITS.relatedSkillName, true)),
    };
    withOptional(out, 'description', readStr(o, 'description', `${p}.description`, LIMITS.relatedSkillDescription, false));
    return out;
  });
}

function validateSession(v: unknown): SessionInput {
  const p = 'session';
  const o = requireObj(v, p);
  rejectUnknown(
    o,
    ['sessionId', 'taskSummary', 'userInfo', 'userInfoSource', 'agentName', 'agentVersion', 'harnessName', 'harnessVersion', 'relatedSkills'],
    p,
  );
  const s: SessionInput = {
    sessionId: required(readStr(o, 'sessionId', `${p}.sessionId`, LIMITS.sessionId, true)),
    taskSummary: required(readStr(o, 'taskSummary', `${p}.taskSummary`, LIMITS.taskSummary, true)),
    userInfo: required(readStr(o, 'userInfo', `${p}.userInfo`, LIMITS.userInfo, true)),
    userInfoSource: readEnum(o, 'userInfoSource', `${p}.userInfoSource`, USER_INFO_SOURCES),
    agentName: required(readStr(o, 'agentName', `${p}.agentName`, LIMITS.agentName, true)),
    harnessName: required(readStr(o, 'harnessName', `${p}.harnessName`, LIMITS.harnessName, true)),
    relatedSkills: [],
  };
  withOptional(s, 'agentVersion', readStr(o, 'agentVersion', `${p}.agentVersion`, LIMITS.agentVersion, false));
  withOptional(s, 'harnessVersion', readStr(o, 'harnessVersion', `${p}.harnessVersion`, LIMITS.harnessVersion, false));
  s.relatedSkills = validateRelatedSkills(o.relatedSkills, `${p}.relatedSkills`);
  return s;
}

function validateItem(v: unknown, i: number): ItemInput {
  const p = `items[${i}]`;
  const o = requireObj(v, p);
  rejectUnknown(o, ['title', 'description', 'type', 'impact', 'resolved', 'suggestedFix', 'occurrences'], p);
  const title = required(readStr(o, 'title', `${p}.title`, LIMITS.title, true));
  const description = required(readStr(o, 'description', `${p}.description`, LIMITS.description, true));
  const type = readEnum(o, 'type', `${p}.type`, FEEDBACK_TYPES);
  const impact = readEnum(o, 'impact', `${p}.impact`, IMPACTS);
  if (o.resolved === undefined || o.resolved === null) throw new Fail(`${p}.resolved`, `${p}.resolved 缺失，必填`);
  if (typeof o.resolved !== 'boolean') throw new Fail(`${p}.resolved`, `${p}.resolved 类型不对，应为布尔值`);
  const resolved = o.resolved;
  const fixPath = `${p}.suggestedFix`;
  const suggestedFix = readStr(o, 'suggestedFix', fixPath, LIMITS.suggestedFix, resolved);
  if (!resolved && suggestedFix !== undefined) {
    throw new Fail(fixPath, `${fixPath} 不应填写，resolved 为 false 时必须缺失或为空`);
  }
  const occ = o.occurrences;
  if (occ === undefined || occ === null) throw new Fail(`${p}.occurrences`, `${p}.occurrences 缺失，必填`);
  if (typeof occ !== 'number' || !Number.isInteger(occ)) {
    throw new Fail(`${p}.occurrences`, `${p}.occurrences 类型不对，应为整数`);
  }
  if (occ < LIMITS.occurrences.min || occ > LIMITS.occurrences.max) {
    throw new Fail(`${p}.occurrences`, `${p}.occurrences 超出范围，应在 ${LIMITS.occurrences.min}–${LIMITS.occurrences.max} 之间（当前 ${occ}）`);
  }
  const item: ItemInput = { title, description, type, impact, resolved, occurrences: occ };
  withOptional(item, 'suggestedFix', suggestedFix);
  return item;
}

function validateItems(v: unknown): ItemInput[] {
  if (v === undefined || v === null) throw new Fail('items', 'items 缺失，必填');
  if (!Array.isArray(v)) throw new Fail('items', 'items 类型不对，应为数组');
  if (v.length < LIMITS.minItems) throw new Fail('items', `items 条数不足，至少 ${LIMITS.minItems} 条（当前 ${v.length}）`);
  if (v.length > LIMITS.maxItems) {
    throw new Fail('items', `items 条数过多，最多 ${LIMITS.maxItems} 条（当前 ${v.length}）`, 'too_many_items');
  }
  return v.map((it, i) => validateItem(it, i));
}

function validateSkill(v: unknown): Submission['skill'] {
  const o = requireObj(v, 'skill');
  rejectUnknown(o, ['name', 'version'], 'skill');
  const skill: Submission['skill'] = {
    name: required(readStr(o, 'name', 'skill.name', LIMITS.skillName, true)),
  };
  withOptional(skill, 'version', readStr(o, 'version', 'skill.version', LIMITS.skillVersion, false));
  return skill;
}

function validateSubmittedAt(o: Obj): string {
  const s = required(readStr(o, 'submittedAt', 'submittedAt', { max: 64 }, true));
  if (!ISO_8601.test(s) || Number.isNaN(Date.parse(s))) {
    throw new Fail('submittedAt', 'submittedAt 格式不对，应为 ISO 8601 时间');
  }
  return s;
}

/** 校验完整提交载荷（spec §2.1）；遇到第一个错误即返回。 */
export function validateSubmission(input: unknown): ValidationResult {
  try {
    if (!isObj(input)) throw new Fail('$', '$ 类型不对，请求体应为对象');
    rejectUnknown(input, ['skill', 'moduleVersion', 'os', 'submittedAt', 'session', 'items'], '');
    const skill = validateSkill(input.skill);
    const moduleVersion = required(readStr(input, 'moduleVersion', 'moduleVersion', LIMITS.moduleVersion, true));
    const os = readEnum(input, 'os', 'os', OS_VALUES);
    const submittedAt = validateSubmittedAt(input);
    const session = validateSession(input.session);
    const items = validateItems(input.items);
    return { ok: true, value: { skill, moduleVersion, os, submittedAt, session, items } };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, code: e.code, field: e.field, message: e.message };
    throw e;
  }
}
