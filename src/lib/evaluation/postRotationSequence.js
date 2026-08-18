// src/lib/evaluation/postRotationSequence.js
//
// POST-ROTATION-SEQUENCED-RELEASE-1 - the release order, in one place.
//
// THE SEQUENCE (each step gates the next):
//   1. Student Feedback: Preceptor & Unit   student_preceptor_eval    / post_rotation
//   2. Casey-Fink Post-Rotation Survey      casey_fink_readiness_2024 / post_rotation
//   3. ASPIRE Post-Rotation Evaluation      post_rotation_evaluation  / post_rotation
//
// Steps 2 and 3 are released MANUALLY, per student, by an Owner/Admin. Nothing here
// sends, writes, or schedules anything: it answers "may this be released yet, and if
// not, exactly why".
//
// WHAT COUNTS AS COMPLETED. Only the canonical assignment completion evidence:
// `completed_at` set, or `status === 'completed'` - and `revoked` is checked FIRST,
// so a revoked assignment is never completed. This is byte-for-byte the rule the
// three existing detectors already use (assignmentState in
// studentEvalDueDetection / caseyFinkPostRotationDueDetection /
// postRotationCertDueDetection), so the sequence cannot disagree with the panels.
//
// Explicitly NOT completion: an email delivered or opened, a scheduled date passing,
// an assignment merely released, a student's status, or a file existing.
//
// CERTIFICATE SEMANTICS ARE UNCHANGED. Casey-Fink post-rotation completion remains
// the certificate gate; the ASPIRE Post-Rotation Evaluation stays decoupled from it.
// This module reads no certificate data and changes no certificate behavior.

export const STEP_SLUGS = Object.freeze({
  feedback: 'student_preceptor_eval',
  caseyFink: 'casey_fink_readiness_2024',
  aspire: 'post_rotation_evaluation',
})

export const POST_ROTATION_TIMEPOINT = 'post_rotation'

export const STEP_LABELS = Object.freeze({
  feedback: 'Student Feedback: Preceptor & Unit',
  caseyFink: 'Casey-Fink Post-Rotation Survey',
  aspire: 'ASPIRE Post-Rotation Evaluation',
})

// ── Required program activities ─────────────────────────────────────────────
//
// *** AWAITING OWNER CONFIRMATION - see the report. ***
//
// Repository evidence for these three differs, and none of it is attendance:
//   town_hall        - exists ONLY as an aspire_events CALENDAR TYPE. aspire_events
//                      has cohort_id and NO student_id, so it records that an event
//                      was scheduled, never who attended.
//   interview_bootcamp - no representation anywhere in the repository.
//   resume_review      - no representation. students.resume_url / resume_on_file
//                      record that a FILE exists, which is not a review.
//
// So none of them can be derived from existing data, and this list is a PROPOSAL,
// not a discovered fact. Editing this array is how the Owner confirms the final
// checklist; the gate reads it and nothing else infers requirements.
export const REQUIRED_ACTIVITY_KEYS = Object.freeze([
  'town_hall',
  'interview_bootcamp',
  'resume_review',
])

export const ACTIVITY_LABELS = Object.freeze({
  town_hall: 'Town Hall',
  interview_bootcamp: 'Interview Bootcamp',
  resume_review: 'Resume Review',
})

/**
 * Canonical assignment state. Mirrors the existing detectors exactly.
 * Returns 'revoked' | 'completed' | 'other'.
 */
export function completionState(a) {
  if (!a) return 'other'
  if (a.revoked_at || a.status === 'revoked') return 'revoked'
  if (a.completed_at || a.status === 'completed') return 'completed'
  return 'other'
}

/**
 * The completion evidence for one workflow step, for one student.
 *
 * Picks the EARLIEST completion when several assignments completed (the moment the
 * requirement was first satisfied), and never lets a revoked row supply a date.
 *
 * @returns {{completed: boolean, completedAt: string|null, hasAssignment: boolean, count: number}}
 */
export function stepCompletion(assignments, slug, { timepoint = POST_ROTATION_TIMEPOINT } = {}) {
  const mine = (assignments || []).filter(a => {
    if (!a) return false
    if (slugOf(a) !== slug) return false
    // A null timepoint is accepted only when the caller asks for no timepoint.
    return timepoint == null ? true : a.timepoint === timepoint
  })
  let completedAt = null
  let completed = false
  for (const a of mine) {
    if (completionState(a) !== 'completed') continue
    completed = true
    const t = a.completed_at || null
    if (t && (!completedAt || new Date(t).getTime() < new Date(completedAt).getTime())) {
      completedAt = t
    }
  }
  return { completed, completedAt, hasAssignment: mine.length > 0, count: mine.length }
}

/** Instrument slug off an assignment row, tolerating the embedded-array shape. */
export function slugOf(a) {
  const inst = a?.evaluation_instruments
  const i = Array.isArray(inst) ? inst[0] : inst
  return i?.slug ?? a?.instrument_slug ?? null
}

// ── Step 2: Casey-Fink ──────────────────────────────────────────────────────

/**
 * May the Casey-Fink post-rotation survey be released to this student?
 * The ONLY prerequisite this adds is a completed Student Feedback assignment;
 * the existing hours/in-flow/certificate rules stay where they are.
 */
export function caseyFinkPrerequisite(assignments) {
  const feedback = stepCompletion(assignments, STEP_SLUGS.feedback)
  if (feedback.completed) {
    return { ok: true, reason: null, code: null, feedback }
  }
  const code = !feedback.hasAssignment
    ? 'feedback_missing'
    : 'feedback_incomplete'
  return { ok: false, code, reason: PREREQ_REASONS[code], feedback }
}

// ── Step 3: ASPIRE Post-Rotation Evaluation ─────────────────────────────────

/**
 * Reduce the append-only activity ledger to the CURRENT state per activity.
 *
 * The ledger never updates or deletes: a correction is a new 'reverse' row, so
 * the effective state of an activity is simply its most recent event. Ordering
 * is by created_at, with the row's own order as a stable tiebreak, so two events
 * written in the same millisecond still resolve deterministically.
 *
 * @param events [{ activity_key, action, completed_at, created_at, recorded_by_name }]
 * @returns Map<activity_key, { completed, completedAt, recordedByName, at }>
 */
export function currentActivityState(events) {
  const byKey = new Map()
  // Ordering must be DETERMINISTIC, including when two events share a created_at
  // (two staff acting in the same millisecond, or a rapid double action). Array
  // arrival order is NOT a valid tiebreak: PostgreSQL returns tied rows in
  // arbitrary order, so the same two rows could yield opposite verdicts on
  // successive reads. The row id is unique and stable, so it settles every tie
  // the same way for every reader, forever.
  const ordered = (events || [])
    .filter(e => e && e.activity_key)
    .slice()
    .sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime()
      const tb = new Date(b.created_at || 0).getTime()
      if (ta !== tb) return ta - tb
      return String(a.id || '').localeCompare(String(b.id || ''))
    })
  for (const e of ordered) {
    // Last write wins, so a later 'reverse' undoes an earlier 'complete' and a
    // later 'complete' re-establishes it. Nothing is mutated to achieve this.
    byKey.set(e.activity_key, {
      completed: e.action !== 'reverse',
      completedAt: e.action === 'reverse' ? null : (e.completed_at || null),
      recordedByName: e.recorded_by_name || null,
      at: e.created_at || null,
    })
  }
  return byKey
}

/**
 * May the ASPIRE Post-Rotation Evaluation be released?
 * Requires Student Feedback completed, Casey-Fink completed, AND every required
 * program activity completed. Each unmet prerequisite reports itself separately so
 * the panel can show a specific reason rather than one vague refusal.
 *
 * @param assignments  the student's evaluation assignments
 * @param activityCompletions  [{ activity_key, completed_at }] for this student
 * @param requiredKeys  defaults to REQUIRED_ACTIVITY_KEYS
 */
export function aspirePrerequisites(assignments, activityCompletions = [], requiredKeys = REQUIRED_ACTIVITY_KEYS) {
  const feedback = stepCompletion(assignments, STEP_SLUGS.feedback)
  const caseyFink = stepCompletion(assignments, STEP_SLUGS.caseyFink)

  // The ledger is append-only, so the current state is the reduction of its
  // events - never the mere existence of a row.
  const state = currentActivityState(activityCompletions)
  const activities = (requiredKeys || []).map(key => {
    const cur = state.get(key) || null
    return {
      key,
      label: ACTIVITY_LABELS[key] || key,
      completed: !!(cur && cur.completed && cur.completedAt),
      completedAt: cur && cur.completed ? cur.completedAt : null,
      recordedByName: cur && cur.completed ? cur.recordedByName : null,
    }
  })

  const unmet = []
  if (!feedback.completed) {
    unmet.push({
      code: feedback.hasAssignment ? 'feedback_incomplete' : 'feedback_missing',
      label: STEP_LABELS.feedback,
    })
  }
  if (!caseyFink.completed) {
    unmet.push({
      code: caseyFink.hasAssignment ? 'casey_fink_incomplete' : 'casey_fink_missing',
      label: STEP_LABELS.caseyFink,
    })
  }
  for (const a of activities) {
    if (!a.completed) unmet.push({ code: 'activity_incomplete', label: a.label, activityKey: a.key })
  }

  return {
    ok: unmet.length === 0,
    unmet: unmet.map(u => ({ ...u, reason: reasonFor(u) })),
    reason: unmet.length === 0 ? null : reasonFor(unmet[0]),
    feedback,
    caseyFink,
    activities,
  }
}

export const PREREQ_REASONS = Object.freeze({
  feedback_missing:
    'Student Feedback: Preceptor & Unit has not been released to this student yet, so it cannot have been completed.',
  feedback_incomplete:
    'Student Feedback: Preceptor & Unit has been released but the student has not completed it yet.',
  casey_fink_missing:
    'The Casey-Fink Post-Rotation Survey has not been released to this student yet.',
  casey_fink_incomplete:
    'The Casey-Fink Post-Rotation Survey has been released but the student has not completed it yet.',
})

function reasonFor(u) {
  if (u.code === 'activity_incomplete') {
    return `${u.label} is not recorded as completed for this student.`
  }
  return PREREQ_REASONS[u.code] || 'A prerequisite step is not complete.'
}

/** One short line for a queue row / filter chip. */
export function prerequisiteSummary(result) {
  if (!result) return ''
  if (result.ok) return 'All prerequisites complete'
  const n = result.unmet ? result.unmet.length : 1
  return n === 1 ? '1 prerequisite outstanding' : `${n} prerequisites outstanding`
}
