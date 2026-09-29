// 时间工具：业务日与到期口径固定北京时间（+08:00），库内时间一律 UTC ISO。
const BEIJING_OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 86400 * 1000;

/** 北京时间自然日 YYYY-MM-DD。 */
export function beijingDay(d: Date): string {
  return new Date(d.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/** 校验 YYYY-MM-DD 是真实存在的日期。 */
export function isValidDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * 北京日期区间（含两端）转 UTC：fromIso 为起始日 00:00 北京时间（含），
 * toIso 为结束日次日 00:00 北京时间（不含，查询用 `< toIso`）。入参 MUST 已通过 isValidDay。
 */
export function beijingDateRangeToUtc(
  from?: string,
  to?: string,
): { fromIso?: string; toIso?: string } {
  const out: { fromIso?: string; toIso?: string } = {};
  if (from) out.fromIso = new Date(`${from}T00:00:00+08:00`).toISOString();
  if (to) out.toIso = new Date(new Date(`${to}T00:00:00+08:00`).getTime() + DAY_MS).toISOString();
  return out;
}

/** 当前北京时间减 N 个日历月（日期溢出取当月最后一天），返回 UTC ISO。 */
export function monthsAgoUtc(now: Date, months: number): string {
  const bj = new Date(now.getTime() + BEIJING_OFFSET_MS);
  const target = new Date(
    Date.UTC(
      bj.getUTCFullYear(),
      bj.getUTCMonth() - months,
      1,
      bj.getUTCHours(),
      bj.getUTCMinutes(),
      bj.getUTCSeconds(),
      bj.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(bj.getUTCDate(), lastDay));
  return new Date(target.getTime() - BEIJING_OFFSET_MS).toISOString();
}

/** 北京时间的小时（0–23）。 */
export function beijingHour(d: Date): number {
  return new Date(d.getTime() + BEIJING_OFFSET_MS).getUTCHours();
}
