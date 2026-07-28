// Pure, DISPLAY-ONLY derivation for the Unit Leader Hours cell.
//
// Hours completion (approved >= required) is NOT lifecycle completion. There is no automatic
// Active Rotation -> Completed transition in the system (the only writer of students.status =
// 'Completed' is a manual Owner/Admin action), so this helper only DESCRIBES the hours/rotation-timing
// state; it never changes status and never mutates anything. Inputs come entirely from the roster:
//   - hours: { required, approved, pending }
//   - rotationEnd: the canonical rotation end date (YYYY-MM-DD) from cohort_school_rotations, or null
//   - todayYmd: a stable local "today" (YYYY-MM-DD), read once at mount by the caller
//   - status: the stored lifecycle status (e.g. 'Active Rotation')
//
// Returns:
//   - validReq: required is present, finite, and > 0 (so a progress bar / completion is meaningful)
//   - approved: the numeric approved hours, non-finite coerced to 0 (never negative in the bar math)
//   - required: the numeric required when validReq, else null
//   - complete: validReq && approved >= required  (exact equality counts; overage counts)
//   - endFuture: complete AND the rotation end date is strictly in the future
//   - endReached: complete AND the rotation end date is today or past
//   - readyToComplete: endReached AND status is still 'Active Rotation'  (the derived readiness signal)
export function deriveHoursCompletion({ hours, rotationEnd = null, todayYmd = null, status = null } = {}) {
  const hasRequired = hours != null && hours.required != null
  const req = hasRequired ? Number(hours.required) : NaN
  const validReq = Number.isFinite(req) && req > 0
  const approvedRaw = Number(hours?.approved)
  const approved = Number.isFinite(approvedRaw) ? approvedRaw : 0
  const complete = validReq && approved >= req
  const endKnown = Boolean(rotationEnd) && Boolean(todayYmd)
  const endFuture = complete && endKnown && rotationEnd > todayYmd
  const endReached = complete && endKnown && rotationEnd <= todayYmd
  const readyToComplete = endReached && status === 'Active Rotation'
  return { validReq, approved, required: validReq ? req : null, complete, endFuture, endReached, readyToComplete }
}
