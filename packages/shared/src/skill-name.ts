import { LIMITS } from './limits.ts';
import { charLength } from './validate.ts';

export type SkillNameResult = { ok: true; value: string } | { ok: false; message: string };

/** skill 名校验：必须是字符串，trim 后 1–100 个字符（按码点计）。 */
export function validateSkillName(raw: unknown): SkillNameResult {
  const { min, max } = LIMITS.skillName;
  const value = typeof raw === 'string' ? raw.trim() : '';
  const len = charLength(value);
  if (len < min || len > max) return { ok: false, message: `名称长度不合规，须为 ${min}–${max} 个字符` };
  return { ok: true, value };
}
