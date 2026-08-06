// KEITH-P0: persisted usage, token, latency and outcome metadata.
//
// Before this module every Keith metric was a console.log line in ephemeral
// Vercel output, with no user attribution, so "what did Keith cost last month"
// and "who is calling it" were both unanswerable. Token counts existed but were
// never priced, never joined to a profile, and never survived log retention.
//
// WHAT IS RECORDED: request id, who (profile id + role), what kind of request
// (intent, skill, model route, model), how much (rounds, input/output tokens,
// duration), and how it ended (outcome).
//
// WHAT IS NEVER RECORDED: message content. Not the question, not the answer, not
// the resume text, not a summary of any of them. This table answers operational
// questions about volume and cost; it is not a transcript, and it must never
// become one. The insert below has no content-bearing column to put text in even
// if a future caller tried.
//
// Writes are best-effort and never block or fail a user's answer: metering is
// not worth a 500.

export const OUTCOMES = Object.freeze({
  COMPLETED: 'completed',
  RATE_LIMITED: 'rate_limited',
  DENIED: 'denied',
  MISSING_DATA: 'missing_data',
  ERROR: 'error',
});

export async function recordKeithUsage(db, entry) {
  try {
    const row = {
      request_id: entry.requestId || null,
      profile_id: entry.profileId || null,
      role: entry.role || null,
      intent: entry.intent || null,
      skill_id: entry.skillId || null,
      skill_version: Number.isInteger(entry.skillVersion) ? entry.skillVersion : null,
      model: entry.model || null,
      model_route: entry.modelRoute || null,
      rounds: Number.isInteger(entry.rounds) ? entry.rounds : 0,
      input_tokens: Number.isInteger(entry.inputTokens) ? entry.inputTokens : 0,
      output_tokens: Number.isInteger(entry.outputTokens) ? entry.outputTokens : 0,
      duration_ms: Number.isInteger(entry.durationMs) ? entry.durationMs : null,
      outcome: entry.outcome || OUTCOMES.COMPLETED,
      rate_limited: entry.rateLimited === true,
    };
    const { error } = await db.from('keith_requests').insert(row);
    if (error) console.warn('[keith-usage] insert failed', { request_id: row.request_id, code: error.code });
  } catch (err) {
    console.warn('[keith-usage] insert threw', { request_id: entry?.requestId, reason: err?.message });
  }
}

/**
 * Metadata-only audit row for ONE confidential skill invocation.
 * `dataSources` describes WHICH sources were consulted and their versions - for
 * example { resume: { kind: 'resume', object_updated_at: '...', chars: 4211,
 * redactions: { email: 1, phone: 1 } } }. It never contains extracted content.
 */
export async function recordSkillInvocation(db, entry) {
  try {
    const row = {
      skill_id: entry.skillId,
      skill_slug: entry.skillSlug || null,
      skill_version: Number.isInteger(entry.skillVersion) ? entry.skillVersion : null,
      request_id: entry.requestId || null,
      invoked_by: entry.profileId || null,
      invoked_role: entry.role || null,
      cohort_id: entry.cohortId || null,
      student_id: entry.studentId || null,
      invocation_mode: entry.invocationMode || null,
      data_sources: entry.dataSources || {},
      outcome: entry.outcome || OUTCOMES.COMPLETED,
      denial_reason: entry.denialReason || null,
      model: entry.model || null,
      input_tokens: Number.isInteger(entry.inputTokens) ? entry.inputTokens : 0,
      output_tokens: Number.isInteger(entry.outputTokens) ? entry.outputTokens : 0,
      duration_ms: Number.isInteger(entry.durationMs) ? entry.durationMs : null,
    };
    const { error } = await db.from('keith_skill_invocations').insert(row);
    if (error) console.warn('[keith-skill-audit] insert failed', { request_id: row.request_id, code: error.code });
  } catch (err) {
    console.warn('[keith-skill-audit] insert threw', { request_id: entry?.requestId, reason: err?.message });
  }
}
