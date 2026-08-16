// src/lib/shiftLifecycle.js
//
// STUDENT-SHIFT-LOG-MANAGEMENT-1: the single predicate for "does this shift
// still count as something that happened?".
//
// A student can now WITHDRAW their own entry, which sets
// lifecycle_state='voided'. Every totals recompute and the staff-review
// queries already filter on lifecycle_state='completed', so those inherited
// the rule for free. The surfaces that read shift rows more loosely - support
// alerts, "last shift logged", unit activity, on-campus fallback - did not,
// and a withdrawn entry must not raise an alert, become someone's latest
// shift, or look like recent activity.
//
// Withdrawn entries stay VISIBLE on history surfaces, clearly labelled; this
// predicate governs whether they still drive anything.

export const VOIDED = 'voided'

/** True when the student withdrew this entry. */
export function isVoidedShift(log) {
  return (log?.lifecycle_state || '') === VOIDED
}

/**
 * True when a shift row should still influence derived state (alerts, latest
 * shift, activity, automation). Rows with no lifecycle value are legacy
 * pre-lifecycle rows and count, exactly as they always have.
 */
export function shiftDrivesState(log) {
  return !isVoidedShift(log)
}

/** Convenience: drop withdrawn entries from a list before deriving anything. */
export function withoutVoided(logs) {
  return (logs || []).filter(shiftDrivesState)
}
