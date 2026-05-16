// shiftLogValidation.js
// Determines whether a new shift log should be auto-accepted or flagged for review.
// Imported by ShiftLogPage.jsx; no Supabase calls here (caller passes data in).

export const SHIFT_LOG_STATUSES = {
  AUTO_ACCEPTED:  'Auto-Accepted',
  PENDING_REVIEW: 'Pending Review',
  APPROVED:       'Approved',
  REJECTED:       'Rejected',
  EDITED:         'Edited',
}

const ACCEPTED_STATUSES = [SHIFT_LOG_STATUSES.AUTO_ACCEPTED, SHIFT_LOG_STATUSES.APPROVED]

const MAX_SHIFT_HOURS = 13
const MIN_SHIFT_HOURS = 1

/**
 * Evaluate a shift log submission against business rules.
 * @param {{ shiftLog, student, existingLogs, cohort }} params
 * @returns {{ status: string, reviewReason: string|null }}
 */
export function validateShiftLog({ shiftLog, student, existingLogs = [], cohort }) {
  const reasons = []

  // 1. Required fields
  if (!shiftLog.shift_date || !shiftLog.total_hours) {
    reasons.push('Missing required fields (date or hours)')
  }

  // 2. Student must be placed or in active rotation
  const validStatuses = ['Placed', 'Active Rotation']
  if (student?.status && !validStatuses.includes(student.status)) {
    reasons.push(`Student status is "${student.status}" — not yet Placed or Active Rotation`)
  }

  // 3. Shift duration within limits
  const h = parseFloat(shiftLog.total_hours) || 0
  if (h > MAX_SHIFT_HOURS) {
    reasons.push(`Shift duration ${h}h exceeds normal maximum (${MAX_SHIFT_HOURS}h)`)
  }
  if (h < MIN_SHIFT_HOURS) {
    reasons.push(`Shift duration ${h}h is below normal minimum (${MIN_SHIFT_HOURS}h)`)
  }

  // 4. Would exceed required hours
  const acceptedHours = existingLogs
    .filter(l => ACCEPTED_STATUSES.includes(l.status))
    .reduce((sum, l) => sum + parseFloat(l.total_hours || 0), 0)
  const required = parseFloat(student?.hours_required) || 90
  if (h > 0 && acceptedHours + h > required) {
    const over = (acceptedHours + h - required).toFixed(1)
    reasons.push(`Would exceed required hours by ${over}h (required: ${required}h, logged: ${acceptedHours}h, this shift: ${h}h)`)
  }

  // 5. Daily total would exceed 24 h
  const dailyAccepted = existingLogs
    .filter(l => l.shift_date === shiftLog.shift_date && ACCEPTED_STATUSES.includes(l.status))
    .reduce((sum, l) => sum + parseFloat(l.total_hours || 0), 0)
  if (dailyAccepted + h > 24) {
    reasons.push(`Daily total would exceed 24h (existing: ${dailyAccepted}h + this shift: ${h}h)`)
  }

  // 6. Shift date is in the future
  const today = new Date().toISOString().split('T')[0]
  if (shiftLog.shift_date > today) {
    reasons.push(`Shift date ${shiftLog.shift_date} is in the future`)
  }

  // 7. Outside rotation window (term_dates parsing)
  if (student?.term_dates) {
    const parts = student.term_dates.split(/[-–—to]+/).map(s => s.trim())
    if (parts.length >= 2) {
      const start = Date.parse(parts[0])
      const end   = Date.parse(parts[1])
      const sd    = Date.parse(shiftLog.shift_date)
      if (!isNaN(start) && !isNaN(end) && !isNaN(sd) && (sd < start || sd > end)) {
        reasons.push(`Shift date ${shiftLog.shift_date} is outside rotation window (${parts[0]} – ${parts[1]})`)
      }
    }
  }

  // 8. Unit and preceptor both differ from assigned
  if (shiftLog.is_diff_unit && shiftLog.unit_and_preceptor_mismatch) {
    reasons.push(`Different unit AND different preceptor from assignment`)
  }

  if (reasons.length === 0) {
    return { status: SHIFT_LOG_STATUSES.AUTO_ACCEPTED, reviewReason: null }
  }
  return { status: SHIFT_LOG_STATUSES.PENDING_REVIEW, reviewReason: reasons.join('; ') }
}
