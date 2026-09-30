// Shared with the residency sender. Preserve its existing address validation and
// personal fallback; do not infer employment from legacy students.ngrp_outcome.
import { validStudentEmail } from './studentEmailLifecycle.js'

export function currentResidencyOutcome(outcomes) {
  const rows = Array.isArray(outcomes) ? outcomes : outcomes ? [outcomes] : []
  const latest = rows.filter(row => row?.hired_at)
    .sort((a, b) => String(b.hired_at).localeCompare(String(a.hired_at)))[0]
  return latest && !latest.separated_at ? latest : null
}

export function hiredResidencyEmail(outcome, student) {
  if (!outcome?.hired_at || outcome?.separated_at) return null
  if (validStudentEmail(outcome.cs_email)) return {
    email: outcome.cs_email.trim(), type: 'cedars', preferredType: 'cedars',
    fallbackUsed: false, warning: null, reason: 'Hired resident; Cedars-Sinai email preferred.',
  }
  if (validStudentEmail(student?.personal_email)) return {
    email: student.personal_email.trim(), type: 'personal', preferredType: 'cedars',
    fallbackUsed: true, warning: 'Cedars-Sinai email missing or invalid, using personal email.',
    reason: 'Cedars-Sinai email missing or invalid, using personal email.',
  }
  return {
    email: null, type: 'missing', preferredType: 'cedars', fallbackUsed: false,
    warning: 'No valid Cedars-Sinai or personal email on file, cannot send.',
    reason: 'No valid Cedars-Sinai or personal email on file.',
  }
}
