import { FEEDBACK_TYPES, IMPACTS, LABELS, STATUSES } from '@agent-feedback/shared';
import type { FeedbackView } from '../feedback-query.ts';
import { parseFeedbackId } from '../feedback-query.ts';
import type { RejectionRow, SkillListRow } from './skills.ts';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const e = escapeHtml;

/** 北京时间 `MM-DD HH:mm`。 */
export function formatShort(iso: string): string {
  const bj = new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString();
  return `${bj.slice(5, 10)} ${bj.slice(11, 16)}`;
}

/** 北京时间 `YYYY-MM-DD HH:mm`。 */
export function formatFull(iso: string): string {
  const bj = new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString();
  return `${bj.slice(0, 10)} ${bj.slice(11, 16)}`;
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937;background:#f5f6f8}
a{color:#2563eb;text-decoration:none}a:hover{text-decoration:underline}
.shell{display:flex;min-height:100vh}
.side{width:200px;background:#fff;border-right:1px solid #e5e7eb;padding:20px 12px;flex:none}
.brand{font-weight:700;margin:0 8px 16px}
.nav a{display:block;padding:8px 12px;border-radius:6px;color:#374151;margin-bottom:2px}
.nav a.active{background:#eef2ff;color:#1d4ed8;font-weight:600}.nav a:hover{text-decoration:none;background:#f3f4f6}
.main{flex:1;padding:24px 32px;min-width:0}
.head{display:flex;align-items:baseline;gap:12px;margin-bottom:16px}.head h2{margin:0;font-size:20px}
.muted{color:#6b7280}.small{font-size:12px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin-bottom:16px}
.card h3{margin:0 0 12px;font-size:15px}
table{width:100%;border-collapse:collapse;background:#fff}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top}
th{font-size:12px;color:#6b7280;font-weight:600;background:#fafafa}
.badge{display:inline-block;padding:0 8px;border-radius:10px;font-size:12px;background:#e5e7eb;color:#374151;white-space:nowrap}
.badge.blocking,.badge.invalid{background:#fee2e2;color:#b91c1c}
.badge.workaround,.badge.pending{background:#fef3c7;color:#92400e}
.badge.valid,.badge.done{background:#dcfce7;color:#166534}
.badge.off{background:#f3f4f6;color:#6b7280}
input,select,textarea{font:inherit;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;background:#fff}
button,.btn{font:inherit;padding:6px 14px;border:1px solid #1d4ed8;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer;display:inline-block}
button.secondary,.btn.secondary{background:#fff;color:#374151;border-color:#d1d5db}
button.danger{background:#dc2626;border-color:#b91c1c}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:16px}
.custom-range{display:none;gap:8px}
.filters:has(select[name=range] option[value=custom]:checked) .custom-range{display:flex}
.flash{padding:10px 14px;border-radius:6px;background:#dcfce7;color:#166534;margin-bottom:16px}
.flash.error,.field-error{background:#fee2e2;color:#b91c1c}
.field-error{padding:6px 10px;border-radius:6px;margin:8px 0}
.field{margin-bottom:12px}.field label{display:block;margin-bottom:4px;font-weight:600}.field input{width:100%}
.login{max-width:360px;margin:12vh auto}
.kv{display:grid;grid-template-columns:120px 1fr;gap:6px 12px;margin:0}.kv dt{color:#6b7280}.kv dd{margin:0;word-break:break-word}
.text{white-space:pre-wrap;word-break:break-word}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pager{margin-top:12px;display:flex;gap:12px;align-items:center}
.dialog{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);align-items:center;justify-content:center;z-index:10}
.dialog:target{display:flex}
.dialog .box{background:#fff;border-radius:8px;padding:20px 24px;max-width:460px;width:90%}
.dialog .box h3{margin:0 0 8px}
.token{font-family:ui-monospace,Menlo,Consolas,monospace;background:#f3f4f6;padding:10px 12px;border-radius:6px;word-break:break-all;user-select:all}
`;

type NavKey = 'feedback' | 'skills' | 'settings';

function layout(title: string, active: NavKey, body: string): string {
  const nav = (key: NavKey, href: string, label: string) =>
    `<a href="${href}"${active === key ? ' class="active"' : ''}>${label}</a>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)} - Agent Feedback 管理后台</title><style>${CSS}</style></head><body>
<div class="shell"><aside class="side"><p class="brand">Agent Feedback</p>
<nav class="nav">${nav('feedback', '/admin/feedback', '反馈')}${nav('skills', '/admin/skills', 'Skill 登记')}${nav('settings', '/admin/settings', '令牌与设置')}</nav>
<form method="post" action="/admin/logout" style="margin-top:24px"><button class="secondary" type="submit">退出登录</button></form></aside>
<main class="main">${body}</main></div></body></html>`;
}

const flashBox = (msg: string | null, isError = false): string =>
  msg ? `<div class="flash${isError ? ' error' : ''}">${e(msg)}</div>` : '';

export function loginPage(error: string | null): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>登录 - Agent Feedback 管理后台</title><style>${CSS}</style></head><body>
<div class="login"><div class="card"><h3>登录</h3><p class="muted">查看与处理 skill 反馈</p>
<form method="post" action="/admin/login">
<div class="field"><label for="u">账号</label><input id="u" name="username" autocomplete="username" required></div>
<div class="field"><label for="p">密码</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
${error ? `<p class="field-error">${e(error)}</p>` : ''}
<button type="submit" style="width:100%">登录</button></form></div></div></body></html>`;
}

// ---------- 反馈列表 ----------

export interface ListForm {
  skill: string;
  type: string;
  impact: string;
  status: string;
  resolved: string;
  range: string;
  from: string;
  to: string;
  moduleVersion: string;
  agentName: string;
  harnessName: string;
}

export interface ListPageData {
  form: ListForm;
  skillNames: string[];
  items: FeedbackView[];
  total: number;
  page: number;
  pageSize: number;
  flash: string | null;
}

function options(current: string, list: [string, string][]): string {
  return list.map(([v, label]) => `<option value="${e(v)}"${v === current ? ' selected' : ''}>${e(label)}</option>`).join('');
}

function listQuery(form: ListForm, page: number): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) if (v !== '') p.set(k, v);
  if (page > 1) p.set('page', String(page));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function feedbackListPage(d: ListPageData): string {
  const f = d.form;
  const filterForm = `<form class="filters" method="get" action="/admin/feedback">
<select name="skill">${options(f.skill, [['', '全部 Skill'], ...d.skillNames.map((n): [string, string] => [n, n])])}</select>
<select name="type">${options(f.type, [['', '全部类型'], ...FEEDBACK_TYPES.map((v): [string, string] => [v, LABELS.type[v]])])}</select>
<select name="impact">${options(f.impact, [['', '全部影响'], ...IMPACTS.map((v): [string, string] => [v, LABELS.impact[v]])])}</select>
<select name="status">${options(f.status, [['all', '全部状态'], ...STATUSES.map((v): [string, string] => [v, LABELS.status[v]])])}</select>
<select name="resolved">${options(f.resolved, [['', '是否已解决'], ['true', '已解决'], ['false', '未解决']])}</select>
<input name="moduleVersion" placeholder="反馈模块版本" value="${e(f.moduleVersion)}" size="12">
<input name="agentName" placeholder="agent" value="${e(f.agentName)}" size="10">
<input name="harnessName" placeholder="运行环境" value="${e(f.harnessName)}" size="10">
<select name="range">${options(f.range, [['7d', '近 7 天'], ['30d', '近 30 天'], ['6m', '近 6 个月'], ['custom', '自定义起止']])}</select>
<span class="custom-range"><input type="date" name="from" value="${e(f.from)}"><input type="date" name="to" value="${e(f.to)}"></span>
<button type="submit">筛选</button></form>`;

  let table: string;
  if (d.items.length === 0) {
    table = `<div class="card"><p>没有符合条件的反馈</p><p><a href="/admin/feedback?status=all&range=6m">清除全部筛选</a></p></div>`;
  } else {
    const rows = d.items
      .map((it) => {
        const num = parseFeedbackId(it.id) ?? 0;
        return `<tr><td><a href="/admin/feedback/${num}">${e(it.id)}</a></td><td>${e(it.title)}</td><td>${e(it.submission.skill.name)}</td>
<td>${e(LABELS.type[it.type])}</td><td><span class="badge ${it.impact}">${e(LABELS.impact[it.impact])}</span></td>
<td><span class="badge ${it.status}">${e(LABELS.status[it.status])}</span></td><td>${it.resolved ? '是' : '否'}</td><td>${e(formatShort(it.receivedAt))}</td></tr>`;
      })
      .join('');
    table = `<table><thead><tr><th>编号</th><th>标题</th><th>Skill</th><th>类型</th><th>影响</th><th>状态</th><th>已解决</th><th>收录时间</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
  const pager =
    pages > 1
      ? `<div class="pager">${d.page > 1 ? `<a href="/admin/feedback${e(listQuery(f, d.page - 1))}">上一页</a>` : ''}<span class="muted">第 ${d.page} / ${pages} 页</span>${d.page < pages ? `<a href="/admin/feedback${e(listQuery(f, d.page + 1))}">下一页</a>` : ''}</div>`
      : '';

  return layout(
    '反馈',
    'feedback',
    `${flashBox(d.flash)}<div class="head"><h2>反馈</h2><span class="muted small">共 ${d.total} 条</span></div>${filterForm}${table}${pager}`,
  );
}

// ---------- 反馈详情 ----------

export function feedbackDetailPage(item: FeedbackView, siblings: string[], flash: string | null): string {
  const s = item.submission;
  const num = parseFeedbackId(item.id) ?? 0;
  const version = (name: string, v: string | null) => (v ? `${name} ${v}` : name);
  const related =
    s.relatedSkills.length === 0
      ? '<p class="muted">无</p>'
      : `<ul>${s.relatedSkills.map((r) => `<li>${e(r.name)}<span class="muted"> — ${e(r.description)}</span></li>`).join('')}</ul>`;
  const sib =
    siblings.length === 0
      ? '<p class="muted">无</p>'
      : `<ul>${siblings.map((id) => `<li><a href="/admin/feedback/${parseFeedbackId(id) ?? 0}">${e(id)}</a></li>`).join('')}</ul>`;
  const body = `${flashBox(flash)}
<div class="head"><h2>${e(item.id)} ${e(item.title)}</h2><a href="/admin/feedback">返回列表</a></div>
<div class="card"><h3>问题</h3>
<p class="row"><span class="badge">${e(LABELS.type[item.type])}</span><span class="badge ${item.impact}">${e(LABELS.impact[item.impact])}</span><span class="badge ${item.status}">${e(LABELS.status[item.status])}</span></p>
<dl class="kv"><dt>详细描述</dt><dd class="text">${e(item.description)}</dd>
<dt>推荐解法</dt><dd class="text">${item.resolved && item.suggestedFix ? e(item.suggestedFix) : '未解决，无'}</dd>
<dt>本会话出现次数</dt><dd>${item.occurrences}</dd><dt>收录时间</dt><dd>${e(formatFull(item.receivedAt))}</dd></dl></div>
<div class="card"><h3>会话信息</h3>
<dl class="kv"><dt>Skill</dt><dd>${e(version(s.skill.name, s.skill.version))}</dd>
<dt>反馈模块版本</dt><dd>${e(s.moduleVersion)}</dd>
<dt>任务概要</dt><dd class="text">${e(s.taskSummary)}</dd>
<dt>用户信息</dt><dd>${e(LABELS.userInfoSource[s.userInfoSource as 'known' | 'guessed'] ?? s.userInfoSource)}：${e(s.userInfo)}</dd>
<dt>操作系统</dt><dd>${e(s.os)}</dd>
<dt>agent</dt><dd>${e(version(s.agentName, s.agentVersion))}</dd>
<dt>运行环境</dt><dd>${e(version(s.harnessName, s.harnessVersion))}</dd>
<dt>会话编号</dt><dd>${e(s.sessionId)}</dd></dl></div>
<div class="card"><h3>相关 skill</h3>${related}</div>
<div class="card"><h3>同次提交的其他问题</h3>${sib}</div>
<div class="card"><h3>处理</h3><div class="row">
<form method="post" action="/admin/feedback/${num}/status" class="row"><select name="status">${options(item.status, STATUSES.map((v): [string, string] => [v, LABELS.status[v]]))}</select><button type="submit">保存</button></form>
<a class="btn secondary" href="#delete-dialog">删除</a></div></div>
<div class="dialog" id="delete-dialog"><div class="box"><h3>确认删除 ${e(item.id)}？</h3><p>删除后界面和查询通道都查不到，且不可恢复。</p>
<form method="post" action="/admin/feedback/${num}/delete" class="row"><button class="danger" type="submit">确认删除</button><a class="btn secondary" href="#">取消</a></form></div></div>`;
  return layout(item.id, 'feedback', body);
}

// ---------- Skill 登记 ----------

export interface SkillsPageData {
  skills: SkillListRow[];
  rejections: RejectionRow[];
  flash: string | null;
  error: string | null;
  /** 改名失败时回显的 skill id 与输入 */
  renameTarget?: { id: number; value: string };
}

export function skillsPage(d: SkillsPageData): string {
  const dialogs: string[] = [];
  const rows = d.skills
    .map((k) => {
      const dist = k.versions.length === 0 ? '—' : k.versions.map((v) => `${e(v.moduleVersion)} · ${v.count}`).join(' / ');
      const value = d.renameTarget?.id === k.id ? d.renameTarget.value : k.name;
      const row = `<tr><td>${e(k.name)} <a class="small" href="#rename-${k.id}">改名</a></td>
<td><form method="post" action="/admin/skills/${k.id}/toggle" class="row"><span class="badge${k.enabled ? ' valid' : ' off'}">${k.enabled ? '收录中' : '已停用'}</span><button class="secondary" type="submit">${k.enabled ? '停用' : '启用'}</button></form></td>
<td>${e(formatFull(k.createdAt).slice(0, 10))}</td><td>${k.recentCount}</td><td>${dist}</td></tr>`;
      dialogs.push(`<div class="dialog" id="rename-${k.id}"><div class="box"><h3>改名：${e(k.name)}</h3>
<p class="muted">须与宿主 skill 自己声明的名称完全一致。</p>
<p>改名后，${e(k.name)} 的 ${k.feedbackTotal} 条历史反馈都会归到新名称下；仍以旧名称提交的反馈将不再收录。</p>
<form method="post" action="/admin/skills/${k.id}/rename"><div class="field"><input name="name" value="${e(value)}" maxlength="100" required></div>
<div class="row"><button type="submit">确认改名</button><a class="btn secondary" href="#">取消</a></div></form></div></div>`);
      return row;
    })
    .join('');
  const table =
    d.skills.length === 0
      ? '<div class="card"><p>还没有登记任何 skill</p></div>'
      : `<table><thead><tr><th>名称</th><th>收录开关</th><th>登记时间</th><th>近 7 天收录数</th><th>模块版本分布</th></tr></thead><tbody>${rows}</tbody></table>${dialogs.join('')}`;
  const rej = d.rejections
    .map((r) => `<tr><td>${e(r.day)}</td><td>${r.limit}</td><td>${r.unregistered}</td><td>${r.invalid}</td></tr>`)
    .join('');
  return layout(
    'Skill 登记',
    'skills',
    `${flashBox(d.flash)}${flashBox(d.error, true)}<div class="head"><h2>Skill 登记</h2><span class="muted small">新增登记：对 skill 的源头运行注入工具</span></div>
${table}<h3 style="margin-top:24px">近 7 天拒收</h3>
<table><thead><tr><th>日期</th><th>超出限额</th><th>未登记或已停用</th><th>格式不合格</th></tr></thead><tbody>${rej}</tbody></table>`,
  );
}

// ---------- 令牌与设置 ----------

export interface TokenListRow {
  id: number;
  name: string;
  kind: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const KIND_LABEL: Record<string, string> = { query: '查询令牌', registry: '登记令牌' };

export function settingsPage(tokens: TokenListRow[], flash: string | null, error: string | null): string {
  const rows = tokens
    .map(
      (t) => `<tr><td>${e(t.name)}</td><td>${e(KIND_LABEL[t.kind] ?? t.kind)}</td><td>${e(formatFull(t.createdAt))}</td>
<td>${t.lastUsedAt ? e(formatFull(t.lastUsedAt)) : '从未使用'}</td>
<td>${t.revokedAt ? '<span class="badge off">已撤销</span>' : `<form method="post" action="/admin/tokens/${t.id}/revoke"><button class="secondary" type="submit">撤销</button></form>`}</td></tr>`,
    )
    .join('');
  const table =
    tokens.length === 0
      ? '<p class="muted">还没有令牌</p>'
      : `<table><thead><tr><th>名称</th><th>类型</th><th>创建时间</th><th>最近使用</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`;
  const gen = (kind: string, label: string) =>
    `<form method="post" action="/admin/tokens" class="row"><input type="hidden" name="kind" value="${kind}"><input name="name" placeholder="令牌名称" maxlength="100" required><button type="submit">生成${label}</button></form>`;
  return layout(
    '令牌与设置',
    'settings',
    `${flashBox(flash)}${flashBox(error, true)}<div class="head"><h2>令牌与设置</h2></div>
<div class="card"><h3>令牌</h3>${table}<div style="margin-top:16px">${gen('query', '查询令牌')}<div style="height:8px"></div>${gen('registry', '登记令牌')}</div></div>
<div class="card"><h3>修改密码</h3><form method="post" action="/admin/password" style="max-width:360px">
<div class="field"><label>当前密码</label><input type="password" name="current" autocomplete="current-password" required></div>
<div class="field"><label>新密码（至少 12 个字符）</label><input type="password" name="next" autocomplete="new-password" required></div>
<div class="field"><label>确认新密码</label><input type="password" name="confirm" autocomplete="new-password" required></div>
<button type="submit">修改密码</button></form></div>`,
  );
}

export function tokenCreatedPage(name: string, kind: string, token: string): string {
  return layout(
    '令牌已生成',
    'settings',
    `<div class="head"><h2>令牌已生成</h2></div><div class="card"><p>${e(KIND_LABEL[kind] ?? kind)}「${e(name)}」：</p>
<p class="token">${e(token)}</p><p class="muted">令牌只显示这一次，关闭后无法再查看。</p><a class="btn" href="/admin/settings">返回令牌与设置</a></div>`,
  );
}
