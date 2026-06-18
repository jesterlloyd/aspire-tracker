// SHIFT-VIS-1 — Read-only helpers for shift indicators + open-shift duration + a HEDGED
// "clock-out may be overdue" heuristic on the Aggregate "On Campus Now" cards.
//
// This is the single source of truth for the overdue thresholds so later phases
// (CLOCKOUT-DETECT-1 / CLOCKOUT-NUDGE-1) can reuse or review them. NOTHING here writes data,
// touches hours/approved_hours, or changes shift-logging behavior — it only derives display
// values from already-loaded student_shift_logs rows.

// Conservative thresholds: hours an OPEN shift may run before the UI hedges that clock-out
// may be overdue. A false "overdue" is worse than a late one, so unknown shift types use the
// most conservative (largest) value and we never guess the shift type.
export const OVERDUE_THRESHOLD_HOURS = {
  Day:         14,
  Night:       16,
  Mid:         16,
  Variable:    16,
  unspecified: 16,
}

export function overdueThresholdHours(shiftType) {
  return OVERDUE_THRESHOLD_HOURS[shiftType] ?? OVERDUE_THRESHOLD_HOURS.unspecified
}

// The shift type actually being worked for a log row: the completed shift_type when present,
// otherwise the planned_shift_type captured at lifecycle check-in (open shifts). null = unknown
// (never guessed). Values mirror Rotation's vocabulary: 'Day' | 'Night' | 'Mid' | 'Variable'.
export function shiftTypeOf(log) {
  return log?.shift_type || log?.planned_shift_type || null
}

// A row is an OPEN shift only when it is a live lifecycle check-in (clock-in present, not yet
// clocked out). Window/approved fallback rows are NOT open.
export function isOpenShift(log) {
  return log?.lifecycle_state === 'in_progress' && !!log?.checked_in_at
}

// Elapsed milliseconds of an open shift (clock_in → now), or null when not an open shift.
export function openShiftMs(log, now = Date.now()) {
  if (!isOpenShift(log)) return null
  const t = new Date(log.checked_in_at).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, now - t)
}

// Format a duration like "4h 22m" (read-only display; not an hours mutation).
export function formatDuration(ms) {
  if (ms == null) return null
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

// HEDGED heuristic: is an open shift past its shift-type-aware conservative threshold?
export function isClockoutMaybeOverdue(log, now = Date.now()) {
  const ms = openShiftMs(log, now)
  if (ms == null) return false
  const hrs = ms / 3_600_000
  const type = shiftTypeOf(log)
  return hrs >= overdueThresholdHours(type || 'unspecified')
}

// Badge label mirroring Rotation > Unit Pool (EmbedUnitCard) icon vocabulary, so On Campus Now
// and Rotation cannot disagree on how a shift type reads. null → "Shift not specified".
export function shiftBadge(shiftType) {
  switch (shiftType) {
    case 'Day':      return { label: '☀ Day',           tone: 'day' }
    case 'Night':    return { label: '☾ Night',         tone: 'night' }
    case 'Mid':      return { label: '◐ Mid',           tone: 'mid' }
    case 'Variable': return { label: '☀ / ☾ Variable',  tone: 'variable' }
    default:         return { label: 'Shift not specified', tone: 'unspecified' }
  }
}
