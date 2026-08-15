// src/lib/evaluation/reminderSchedule.js
//
// EVALUATION-REMINDERS-1: when a reminder is owed, and for which survey.
//
// Pure and dependency-free so the rules that decide whether a person receives a
// second, third, or fourth email are directly testable without a database, a
// provider, or a clock. The cron passes `now`; nothing here reads it.
//
// THE SCHEDULE. Reminders land at 7, 14 and 21 days after the ORIGINAL
// successful send (evaluation_assignments.sent_at), and never again. There is
// deliberately no day-28 reminder: the response window is 28 days, so a fourth
// reminder would arrive as the survey closed. The ledger's CHECK constraint
// makes reminder_number 4 unrepresentable in the database as well.
//
// WHAT STOPS A REMINDER. Completion, revocation, a closed response window, a
// non-live status, or an unregistered instrument. `opened_at` deliberately does
// NOT stop one: opening a survey is not finishing it, and treating a peek as
// completion is exactly how a student stops being reminded about work they
// still owe. Only completion closes the requirement.
//
// COVERAGE IS A REGISTRY, AND THE DEFAULT IS NOTHING. An instrument that is not
// listed in REMINDER_WORKFLOWS is never reminded. A new survey therefore has to
// be added here on purpose - it cannot start emailing people by inheriting a
// generic default.

/** Days after the original send at which each reminder is owed. Index + 1 = reminder_number. */
export const REMINDER_DAY_OFFSETS = Object.freeze([7, 14, 21]);

/** The assignment response window (days). Matches WINDOW_DAYS in every send endpoint. */
export const RESPONSE_WINDOW_DAYS = 28;

/**
 * Assignment statuses that still represent an outstanding requirement. Mirrors the
 * guard every submit/validate RPC uses (`status NOT IN ('sent','opened','reminder_due')`),
 * so a reminder is only ever sent for an assignment the survey itself would still accept.
 */
export const LIVE_STATUSES = Object.freeze(['sent', 'opened', 'reminder_due']);

/** Certificate a survey genuinely gates. Anything else must not mention one. */
export const CERTIFICATE_KINDS = Object.freeze({
  STUDENT_COMPLETION: 'student_completion',
  PRECEPTOR_APPRECIATION: 'preceptor_appreciation',
});

/**
 * The registry. Keyed by evaluation_instruments.slug.
 *
 * `certificateFor(timepoint)` encodes the ONLY two real certificate gates in the
 * system, both verified against the issuing SQL functions:
 *   • issue_participation_certificate  requires casey_fink_readiness_2024 + post_rotation + student
 *   • issue_preceptor_certificate      requires preceptor_progress + post_rotation + preceptor
 * post_rotation_evaluation gated a certificate historically; that call was removed
 * (20260710000000_pause_postrotation_eval_certificate_issue), so its reminder must
 * not promise one. student_preceptor_eval never gated anything.
 */
export const REMINDER_WORKFLOWS = Object.freeze({
  casey_fink_readiness_2024: Object.freeze({
    key: 'casey_fink_readiness',
    label: 'Casey-Fink Readiness for Practice Survey',
    respondent: 'student',
    surveyPath: '/evaluation/readiness',
    certificateFor: (timepoint) =>
      (timepoint === 'post_rotation' ? CERTIFICATE_KINDS.STUDENT_COMPLETION : null),
  }),
  post_rotation_evaluation: Object.freeze({
    key: 'post_rotation_evaluation',
    label: 'ASPIRE Post-Rotation Evaluation',
    respondent: 'student',
    surveyPath: '/evaluation/post-rotation',
    // Gates nothing. The invitation template is explicit that it "never mentions
    // or attaches any award"; the reminder holds that line.
    certificateFor: () => null,
  }),
  student_preceptor_eval: Object.freeze({
    key: 'student_preceptor_eval',
    label: 'Preceptor and Unit Feedback',
    respondent: 'student',
    surveyPath: '/evaluation/experience',
    certificateFor: () => null,
  }),
  preceptor_progress: Object.freeze({
    key: 'preceptor_progress',
    label: 'Student Readiness Assessment',
    respondent: 'preceptor',
    surveyPath: '/evaluation/feedback',
    certificateFor: (timepoint) =>
      (timepoint === 'post_rotation' ? CERTIFICATE_KINDS.PRECEPTOR_APPRECIATION : null),
  }),
});

/** Every reason a candidate is not reminded. Sanitized snake_case tokens - they reach the ledger. */
export const SKIP_REASONS = Object.freeze({
  COMPLETED: 'completed',
  REVOKED: 'revoked',
  NOT_LIVE_STATUS: 'not_live_status',
  WINDOW_CLOSED: 'window_closed',
  MISSING_SENT_AT: 'missing_sent_at',
  TOO_EARLY: 'too_early',
  PAST_LAST_REMINDER: 'past_last_reminder',
  UNREGISTERED_INSTRUMENT: 'unregistered_instrument',
  INSTRUMENT_NOT_AUTHORIZED: 'instrument_not_authorized',
});

/** Whole days elapsed between two instants (floored). Returns null for unusable input. */
export function daysSince(fromIso, now) {
  if (!fromIso) return null;
  const from = new Date(fromIso).getTime();
  const to = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.floor((to - from) / 86400000);
}

/**
 * Which reminder (if any) is owed at `days` after the original send?
 * 7-13 -> 1, 14-20 -> 2, 21-27 -> 3, and nothing at all from day 28 on.
 */
export function reminderNumberForAge(days) {
  if (!Number.isFinite(days)) return null;
  if (days < REMINDER_DAY_OFFSETS[0]) return null;
  if (days >= RESPONSE_WINDOW_DAYS) return null;
  let n = null;
  for (let i = 0; i < REMINDER_DAY_OFFSETS.length; i++) {
    if (days >= REMINDER_DAY_OFFSETS[i]) n = i + 1;
  }
  return n;
}

/** The workflow for an instrument slug, or null when the instrument is not covered. */
export function workflowForSlug(slug) {
  return REMINDER_WORKFLOWS[String(slug || '')] || null;
}

/** The certificate a given assignment genuinely gates, or null. */
export function certificateKindFor(slug, timepoint) {
  const wf = workflowForSlug(slug);
  return wf ? wf.certificateFor(timepoint) : null;
}

/**
 * Decide one assignment.
 *
 * @param {object} o
 * @param {object} o.assignment  evaluation_assignments row
 * @param {object} o.instrument  { slug, permission_status } for the assignment's instrument
 * @param {Date}   o.now
 * @returns {{ due: boolean, reminderNumber: number|null, reason: string|null, workflow: object|null }}
 */
export function classifyAssignment({ assignment, instrument, now }) {
  const no = (reason) => ({ due: false, reminderNumber: null, reason, workflow: null });
  if (!assignment) return no(SKIP_REASONS.UNREGISTERED_INSTRUMENT);

  // Completion first: it is the authoritative stop condition, and it outranks
  // everything else that could be said about the row.
  if (assignment.completed_at || assignment.status === 'completed') return no(SKIP_REASONS.COMPLETED);
  if (assignment.revoked_at || assignment.status === 'revoked') return no(SKIP_REASONS.REVOKED);
  if (!LIVE_STATUSES.includes(assignment.status)) return no(SKIP_REASONS.NOT_LIVE_STATUS);

  const workflow = workflowForSlug(instrument?.slug);
  if (!workflow) return no(SKIP_REASONS.UNREGISTERED_INSTRUMENT);
  // An instrument whose permission lapsed cannot be answered (the validate RPC
  // rejects it), so reminding someone to answer it would be a dead link.
  if (instrument.permission_status !== 'authorized') return no(SKIP_REASONS.INSTRUMENT_NOT_AUTHORIZED);

  if (!assignment.sent_at) return no(SKIP_REASONS.MISSING_SENT_AT);

  // The response window is authoritative even if it disagrees with day counting:
  // a shortened or extended expires_at wins over the nominal 28 days.
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (assignment.expires_at && new Date(assignment.expires_at).getTime() <= nowMs) {
    return no(SKIP_REASONS.WINDOW_CLOSED);
  }

  const days = daysSince(assignment.sent_at, now);
  if (days === null) return no(SKIP_REASONS.MISSING_SENT_AT);
  if (days < REMINDER_DAY_OFFSETS[0]) return no(SKIP_REASONS.TOO_EARLY);

  const reminderNumber = reminderNumberForAge(days);
  if (!reminderNumber) return no(SKIP_REASONS.PAST_LAST_REMINDER);

  return { due: true, reminderNumber, reason: null, workflow };
}

/**
 * Classify a batch. Returns the claim candidates plus a per-reason tally for the
 * run report (counts only - no identifiers leave here beyond assignment ids).
 */
export function selectReminderCandidates({ assignments = [], instrumentsById = new Map(), now }) {
  const candidates = [];
  const skipped = [];
  for (const assignment of assignments) {
    const instrument = instrumentsById.get?.(assignment.instrument_id)
      || instrumentsById[assignment.instrument_id]
      || null;
    const verdict = classifyAssignment({ assignment, instrument, now });
    if (verdict.due) {
      candidates.push({
        assignment_id: assignment.id,
        reminder_number: verdict.reminderNumber,
        workflowKey: verdict.workflow.key,
      });
    } else {
      skipped.push({ assignment_id: assignment.id, reason: verdict.reason });
    }
  }
  return { candidates, skipped };
}

/** Count skip reasons into a flat tally for cron_runs.details. */
export function tallyReasons(skipped = []) {
  const out = {};
  for (const s of skipped) out[s.reason] = (out[s.reason] || 0) + 1;
  return out;
}
