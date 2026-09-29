import { LIMITS, validateSubmission } from '@agent-feedback/shared';
import type { ErrorCode } from '@agent-feedback/shared';
import type { AppContext } from '../app.ts';
import { bumpCounter, bumpRejection, getCounter } from '../counters.ts';
import type { RejectionReason } from '../counters.ts';
import { findSkillByName, run, withTransaction } from '../db.ts';
import { clientIp, log, readBody, sendError, sendJson } from '../http.ts';
import type { Router } from '../http.ts';
import { formatFeedbackId } from '../feedback-query.ts';
import { beijingDay } from '../time.ts';

// 提交把关，顺序见 spec §0 / §4.1。
export function registerSubmissionRoutes(router: Router, ctx: AppContext): void {
  const { db, config } = ctx;

  router.post('/v1/submissions', async (req, res) => {
    const now = ctx.now();
    const day = beijingDay(now);
    const ipScope = `ip:${clientIp(req, config.trustProxy)}`;

    const reject = (
      status: number,
      reason: RejectionReason,
      code: ErrorCode,
      message: string,
      field?: string,
    ) => {
      bumpRejection(db, day, reason);
      log('submission_rejected', { level: 'warn', code, status });
      sendError(res, status, code, message, field);
    };

    let raw: Buffer | null;
    try {
      raw = await readBody(req, LIMITS.maxBodyBytes);
    } catch {
      return; // 客户端中断，无人接收响应
    }

    if (raw === null) {
      bumpCounter(db, day, ipScope);
      return reject(413, 'invalid', 'payload_too_large', `请求体超过 ${LIMITS.maxBodyBytes} 字节上限`);
    }

    if (bumpCounter(db, day, ipScope) > config.ipDailyLimit) {
      return reject(429, 'limit', 'ip_limit', `同一来源地址每天最多提交 ${config.ipDailyLimit} 次，请明天再试`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      return reject(400, 'invalid', 'invalid_json', '请求体不是合法的 JSON');
    }

    const result = validateSubmission(parsed);
    if (!result.ok) return reject(400, 'invalid', result.code, result.message, result.field);
    const sub = result.value;

    const skill = findSkillByName(db, sub.skill.name);
    if (!skill || skill.enabled !== 1) {
      return reject(403, 'unregistered', 'skill_not_registered', `skill "${sub.skill.name}" 未登记或已停用`);
    }

    // 事务内先读全站收录数再判上限，避免并发超额。
    const outcome = withTransaction(db, () => {
      if (getCounter(db, day, 'global_accepted') >= config.globalDailyLimit) return null;
      const s = sub.session;
      run(
        db,
        `INSERT INTO submissions (skill_id, skill_version, module_version, session_id, task_summary,
           user_info, user_info_source, os, agent_name, agent_version, harness_name, harness_version,
           related_skills, submitted_at, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        skill.id,
        sub.skill.version ?? null,
        sub.moduleVersion,
        s.sessionId,
        s.taskSummary,
        s.userInfo,
        s.userInfoSource,
        sub.os,
        s.agentName,
        s.agentVersion ?? null,
        s.harnessName,
        s.harnessVersion ?? null,
        JSON.stringify(s.relatedSkills.map((r) => ({ name: r.name, description: r.description ?? '' }))),
        sub.submittedAt,
        now.toISOString(),
      );
      const submissionId = Number(db.prepare('SELECT last_insert_rowid() AS id').get()!.id);
      const insertItem = db.prepare(
        `INSERT INTO feedback (submission_id, title, description, type, impact, resolved, suggested_fix, occurrences)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      );
      const feedbackIds: string[] = [];
      for (const item of sub.items) {
        const row = insertItem.get(
          submissionId,
          item.title,
          item.description,
          item.type,
          item.impact,
          item.resolved ? 1 : 0,
          item.suggestedFix ?? null,
          item.occurrences,
        )!;
        feedbackIds.push(formatFeedbackId(Number(row.id)));
      }
      bumpCounter(db, day, 'global_accepted');
      return { submissionId, feedbackIds };
    });

    if (outcome === null) {
      return reject(429, 'limit', 'global_limit', '今日全站收录已达上限，请明天再试');
    }
    log('submission_accepted', { items: outcome.feedbackIds.length });
    sendJson(res, 201, outcome);
  });
}
