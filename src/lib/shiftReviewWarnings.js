// src/lib/shiftReviewWarnings.js
//
// SHIFT-LOG-REVIEW-1: client-side preview of the duplicate/overlap warnings the
// review_shift_log RPC enforces server-side (same definitions, so the reviewer
// acknowledges an informed warning rather than retrying after a refusal).
// Unit identity is CANONICAL on both sides: unitNameKey here mirrors the
// database's unit_name_key() - lowercase, all whitespace stripped - so '6NE',
// '6 NE', and case variants are one unit in duplicate detection everywhere.

import { unitNameKey } from './unitNameCanon.js'

export function computeReviewWarnings(shift, allLogs) {
  const others = (allLogs || []).filter(l =>
    l.id !== shift.id &&
    l.shift_date === shift.shift_date &&
    l.lifecycle_state === 'completed' &&
    !['Rejected', 'rejected'].includes(l.status || ''))
  const warnings = []
  if (others.some(l =>
    unitNameKey(l.unit_name) === unitNameKey(shift.unit_name) &&
    parseFloat(l.total_hours) === parseFloat(shift.total_hours))) {
    warnings.push('possible_duplicate')
  }
  if (others.length > 0) warnings.push('same_day_shift')
  return { warnings, sameDayLogs: others }
}

export const WARNING_COPY = {
  same_day_shift: 'Another non-rejected shift exists on this date.',
  possible_duplicate: 'A shift with the same date, unit, and hours already exists - this may be a duplicate.',
}

