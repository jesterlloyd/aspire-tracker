// src/lib/preceptorProjection.js
//
// PRECEPTOR-ASSIGNMENT-PROJECTION-1: the ONE definition of what a student's
// primary-preceptor projection is, shared by the client so App state can be
// patched with exactly what the database trigger just wrote.
//
// CANONICAL SOURCE. students.preceptor_id is the authoritative identity; the
// linked preceptors row supplies the name, the email, and the shift. Nothing
// here infers a shift from the unit, the student's availability preference, or
// anything else - a preceptor with no shift yields a BLANK student shift.
//
// VOCABULARY. preceptors.shift_type is CHECK-constrained to
// Day | Night | Mid | Variable, so the student projection uses exactly that
// set. (api/lib/normalizeAssignedShift.js is a DIFFERENT, narrower mapping used
// for shift-log DEFAULTING, where Variable is deliberately unmappable and
// becomes null; both read the same canonical column for their own purpose.)

export const CANONICAL_SHIFTS = Object.freeze(['Day', 'Night', 'Mid', 'Variable'])

/**
 * The student's assigned shift for a given preceptor record.
 * Anything absent, blank, or outside the canonical set projects to '' (blank),
 * never to a guess and never to a stale previous value.
 */
export function projectedShift(preceptor) {
  const raw = preceptor?.shift_type
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  return CANONICAL_SHIFTS.includes(trimmed) ? trimmed : ''
}

/**
 * The full student patch for an assignment to `preceptor`.
 * Passing null/undefined produces the CLEARED projection, so replacing or
 * clearing a preceptor can never leave the previous one's name, email, or
 * shift behind.
 */
export function preceptorProjection(preceptor) {
  if (!preceptor || !preceptor.id) {
    return { preceptor_id: null, matched_preceptor: '', preceptor_email: '', shift_assigned: '' }
  }
  return {
    preceptor_id: preceptor.id,
    matched_preceptor: preceptor.full_name || '',
    preceptor_email: preceptor.email || '',
    shift_assigned: projectedShift(preceptor),
  }
}

/**
 * Apply the projection to the canonical students collection (App useState).
 * Returns a NEW array so React re-renders; returns the input untouched when
 * the target is not present or the input is unusable.
 */
export function applyPreceptorProjection(students, studentId, preceptor) {
  if (!Array.isArray(students) || !studentId) return students
  if (!students.some(s => s.id === studentId)) return students
  const patch = preceptorProjection(preceptor)
  return students.map(s => (s.id === studentId ? { ...s, ...patch } : s))
}
