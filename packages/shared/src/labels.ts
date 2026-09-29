import type { FeedbackType, Impact, OsValue, Status, UserInfoSource } from './limits.ts';

// 管理界面使用的中文显示名（spec §2.1）。
export const LABELS: {
  type: Record<FeedbackType, string>;
  impact: Record<Impact, string>;
  status: Record<Status, string>;
  userInfoSource: Record<UserInfoSource, string>;
  os: Record<OsValue, string>;
} = {
  type: { bug: '缺陷', friction: '使用摩擦', missing_capability: '缺能力', suggestion: '建议' },
  impact: { blocking: '阻断', workaround: '绕过后完成', minor: '仅不便' },
  status: { pending: '待处理', valid: '有效', invalid: '无效', duplicate: '重复', done: '已处理' },
  userInfoSource: { known: '已知', guessed: '猜测' },
  // 键为提交脚本写入的 process.platform 取值；表外的值由调用方原样显示。
  os: { darwin: 'macOS', win32: 'Windows', linux: 'Linux', other: '其他' },
};
