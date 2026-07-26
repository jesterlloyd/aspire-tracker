// src/lib/onCampusRows.js
//
// Pure display fields for one PORTAL "On Campus Now" live-shift row, reusing the canonical
// shiftStatus helpers so the portal card cannot disagree with the staff card on shift badges,
// open-duration, or the hedged overdue wording. It returns only presentational values; the
// caller adds the avatar node, click handler, key, and aria-label.
//
// The portal activity row exposes `state` ('in_progress' | 'completed'); the shiftStatus
// helpers read `lifecycle_state`, so a small shim bridges them. `now` is passed in (the moment
// the activity data loaded) and never read from the clock here, keeping callers pure.

import {
  shiftBadge, shiftTypeOf, isOpenShift, openShiftMs, formatDuration, isClockoutMaybeOverdue,
} from './shiftStatus.js'

export function buildLiveShiftDisplay(shift, now) {
  const shim = {
    lifecycle_state: shift?.state,
    checked_in_at: shift?.checked_in_at,
    shift_type: shift?.shift_type,
    planned_shift_type: null,
  }
  const open = isOpenShift(shim)
  const overdue = open && isClockoutMaybeOverdue(shim, now)
  const unit = shift?.unit_key || shift?.unit_name || 'Unit not set'
  return {
    name: shift?.student_name || 'A student',
    // Missing preceptor: no " · with …" suffix (the safe fallback), never a crash.
    subLabel: `${unit}${shift?.preceptor_name ? ` · with ${shift.preceptor_name}` : ''}`,
    badge: shiftBadge(shiftTypeOf(shim)),
    statusText: open
      ? (overdue ? 'Clock-out may be overdue' : `Open ${formatDuration(openShiftMs(shim, now))}`)
      : (shift?.hours != null ? `${shift.hours} hrs logged` : null),
    statusWarn: overdue,
  }
}
