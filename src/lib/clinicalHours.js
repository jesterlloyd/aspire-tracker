// HOURS-COMPLETE-1: the one determination of "has this student finished their
// required clinical hours?".
//
// WHY THIS MODULE EXISTS
// The green "Complete" badge in Rotation Activity was computed inline, and the
// same parseFloat(approved_hours) / parseFloat(hours_required) arithmetic was
// repeated in ClinicalHoursPanel, OverviewTab and ShiftLogPage. When the
// Action Center needed the same answer - to stop asking a finished student to
// log more shifts - the choice was to write the formula a fifth time or to
// give the existing one a name. This is the name.
//
// The arithmetic is unchanged from what Rotation Activity already displayed,
// deliberately: whatever the badge says is what every other surface must say.
//
// EDGE CASE THAT MATTERS: hours_required of 0, null, or unparseable means the
// requirement is UNKNOWN, not "already met". pct stays 0 and complete stays
// false, so an unknown requirement keeps a student monitored rather than
// silently exempting them. Suppression must be earned by real data.

/** Percent of required hours reached before a student reads as "nearing". */
export const NEARING_PCT = 85

const num = (v) => {
  const n = parseFloat(v || 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * Clinical-hours progress for one student row.
 * @param {object} student - needs { hours_required, approved_hours }
 * @returns {{required:number, approved:number, remaining:number, pct:number,
 *            complete:boolean, nearComplete:boolean, known:boolean}}
 */
export function hoursProgress(student) {
  const required = num(student?.hours_required)
  const approved = num(student?.approved_hours)
  const known = required > 0
  // Capped at 100 exactly as Rotation Activity capped it, so a student over
  // their requirement reads as 100%, never 110%.
  const pct = known ? Math.min(100, (approved / required) * 100) : 0
  return {
    required,
    approved,
    remaining: Math.max(0, required - approved),
    pct,
    // pct is capped, so >= 100 is equivalent to approved >= required, and it
    // stays true for a student who worked beyond their requirement.
    complete: pct >= 100,
    nearComplete: pct >= NEARING_PCT && pct < 100,
    known,
  }
}

/**
 * True when a student has finished their required hours and is therefore no
 * longer expected to keep logging shifts. The Action Center's weekly-logging
 * monitor consumes exactly this, so the badge and the task cannot disagree.
 */
export function hasCompletedRequiredHours(student) {
  return hoursProgress(student).complete
}

// ── HOME-1 (Owner, 2026-09-24): pace against the rotation window ─────────────
// "Behind on hours" had no rule before the home page needed one. The Owner chose
// option A: expected hours to date are the required hours times the fraction of
// the school's rotation window that has elapsed, and a student is BEHIND when
// their approved hours fall more than BEHIND_TOLERANCE_PCT of the requirement
// below that expectation. Ahead of the window, or without a known window, no
// judgement is made: pace is unknown, never "behind".
//
// One rule, read by Needs you (Placement and rotation), the Cohort pulse bar,
// and anything else that says "on track" or "behind". Pure.

/** How far below the expected pace a student may fall, as a percent of required hours. */
export const BEHIND_TOLERANCE_PCT = 10

const dayNum = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''))
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN
}

/**
 * @param {object} student - { hours_required, approved_hours, status }
 * @param {{ start: string|null, end: string|null }} window - the student's school rotation window
 * @param {string} today - local 'YYYY-MM-DD'
 * @returns {{ known: boolean, elapsedPct: number, expectedHours: number, pace: 'complete'|'on_track'|'behind'|'unknown', pastMidpoint: boolean, deficit: number }}
 */
export function hoursPace(student, window = {}, today) {
  const p = hoursProgress(student)
  const start = dayNum(window?.start), end = dayNum(window?.end), now = dayNum(today)
  const windowKnown = Number.isFinite(start) && Number.isFinite(end) && end > start && Number.isFinite(now)
  if (!p.known) return { known: false, elapsedPct: 0, expectedHours: 0, pace: 'unknown', pastMidpoint: false, deficit: 0 }
  if (p.complete) return { known: true, elapsedPct: windowKnown ? clamp01((now - start) / (end - start)) * 100 : 100, expectedHours: p.required, pace: 'complete', pastMidpoint: true, deficit: 0 }
  if (!windowKnown || now < start) return { known: true, elapsedPct: 0, expectedHours: 0, pace: 'unknown', pastMidpoint: p.pct >= 50, deficit: 0 }
  const elapsed = clamp01((now - start) / (end - start))
  const expected = p.required * elapsed
  const deficit = Math.max(0, expected - p.approved)
  const behind = deficit > p.required * (BEHIND_TOLERANCE_PCT / 100)
  return {
    known: true,
    elapsedPct: elapsed * 100,
    expectedHours: expected,
    pace: behind ? 'behind' : 'on_track',
    pastMidpoint: p.pct >= 50,
    deficit,
  }
}

function clamp01(n) { return Math.max(0, Math.min(1, n)) }
