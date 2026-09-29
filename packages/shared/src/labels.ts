import type { FeedbackType, Impact, Status, UserInfoSource } from './limits.ts';

// 管理界面使用的中文显示名（spec §2.1）。
export const LABELS: {
  type: Record<FeedbackType, string>;
  impact: Record<Impact, string>;
  status: Record<Status, string>;
  userInfoSource: Record<UserInfoSource, string>;
} = {
  type: { bug: '缺陷', friction: '使用摩擦', missing_capability: '缺能力', suggestion: '建议' },
  impact: { blocking: '阻断', workaround: '绕过后完成', minor: '仅不便' },
  status: { pending: '待处理', valid: '有效', invalid: '无效', duplicate: '重复', done: '已处理' },
  userInfoSource: { known: '已知', guessed: '猜测' },
};
