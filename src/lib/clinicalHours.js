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
