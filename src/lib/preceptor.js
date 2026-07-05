/**
 * resolvePreceptor - dual-read with free-text fallback.
 *
 * Returns a normalized object regardless of whether the student has a
 * linked preceptors row (source: 'normalized') or only free-text fields
 * (source: 'free_text'). Components always render the same shape.
 */
export function resolvePreceptor(student, preceptors) {
  if (student?.preceptor_id) {
    const preceptor = preceptors?.find(p => p.id === student.preceptor_id)
    if (preceptor) {
      return {
        source: 'normalized',
        name: preceptor.full_name,
        email: preceptor.email,
        unit_name: preceptor.unit_name,
        shift_type: preceptor.shift_type,
        record: preceptor,
      }
    }
  }
  return {
    source: 'free_text',
    name: student?.matched_preceptor || '',
    email: student?.preceptor_email || '',
    unit_name: null,
    shift_type: null,
    record: null,
  }
}
