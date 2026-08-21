// Pure hours-progress derivation for the Unit Leader Hours cell.
//
// The canonical Active Rotation -> Completed transition is owned by the database reconciliation
// function and daily repair sweep. This helper only DESCRIBES hours and future timing; it never
// changes status and never mutates anything. Inputs come entirely from the roster:
//   - hours: { required, approved, pending }
//   - rotationEnd: the canonical rotation end date (YYYY-MM-DD) from cohort_school_rotations, or null
//   - todayYmd: a stable local "today" (YYYY-MM-DD), read once at mount by the caller
//
// Returns:
//   - validReq: required is present, finite, and > 0 (so a progress bar / completion is meaningful)
//   - approved: the numeric approved hours, non-finite coerced to 0 (never negative in the bar math)
//   - required: the numeric required when validReq, else null
//   - complete: validReq && approved >= required  (exact equality counts; overage counts)
//   - endFuture: complete AND the rotation end date is strictly in the future
export function deriveHoursCompletion({ hours, rotationEnd = null, todayYmd = null } = {}) {
  const hasRequired = hours != null && hours.required != null
  const req = hasRequired ? Number(hours.required) : NaN
  const validReq = Number.isFinite(req) && req > 0
  const approvedRaw = Number(hours?.approved)
  const approved = Number.isFinite(approvedRaw) ? approvedRaw : 0
  const complete = validReq && approved >= req
  const endKnown = Boolean(rotationEnd) && Boolean(todayYmd)
  const endFuture = complete && endKnown && rotationEnd > todayYmd
  return { validReq, approved, required: validReq ? req : null, complete, endFuture }
}
