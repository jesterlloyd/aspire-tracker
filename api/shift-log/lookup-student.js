// api/shift-log/lookup-student.js
//
// POST /api/shift-log/lookup-student
// Body: { "school_email": "<student school email>" }
//
// Looks up a student by registered school email (exact, case-insensitive),
// evaluates Shift Log lifecycle eligibility (cohort not Archived AND status
// 'Active Rotation'), and returns safe student fields plus any open in_progress
// shift. Read-only.
//
// NOT dormant: ShiftLogPage and the shift-log lifecycle both call this. The
// signed-in Student Portal now has its own create path (api/portal/my-shift-lifecycle.js,
// STUDENT-SHIFT-TAB-1) that delegates every write to the public handlers; this page
// stays for students without a portal account.
// Logging never includes the plain email or student name.

import { randomUUID } from 'crypto'
import { lookupStudentByEmail } from '../lib/shiftLogLookup.js'
import supabaseAdmin from '../../lib/server/evaluation/supabase_admin.js'
import { consumePublicRateLimit, SHIFT_LOOKUP_LIMITS, TOO_MANY_REQUESTS } from '../lib/publicRateLimit.js'

export default async function handler(req, res) {
  const requestId = `req_${randomUUID().slice(0, 8)}`
  const startTime = Date.now()

  if (req.method !== 'POST') {
    logRequest(requestId, 'method_not_allowed', null, Date.now() - startTime)
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  let body
  try {
    body = (req.body && typeof req.body === 'object') ? req.body : JSON.parse(req.body || '{}')
  } catch {
    logRequest(requestId, 'invalid_request', null, Date.now() - startTime)
    return res.status(400).json({ error: 'invalid_request', message: 'Invalid JSON' })
  }

  const schoolEmail = body?.school_email
  if (!schoolEmail || typeof schoolEmail !== 'string' || !schoolEmail.trim()) {
    logRequest(requestId, 'invalid_request', null, Date.now() - startTime)
    return res.status(400).json({ error: 'invalid_request', message: 'school_email is required' })
  }


  // S-09 / S-11: this endpoint identifies a student by school email alone, with no
  // token, so the throttle is the control that stops an anonymous caller walking a
  // school's address space. Fails closed, and runs before any lookup so a refused
  // caller learns nothing about the address they tried.
  if (!(await consumePublicRateLimit(supabaseAdmin, req, SHIFT_LOOKUP_LIMITS))) {
    return res.status(429).json({ error: 'rate_limited', message: TOO_MANY_REQUESTS })
  }
  try {
    const result = await lookupStudentByEmail(schoolEmail)

    const outcome =
      result.error === 'ambiguous_student_email' ? 'ambiguous_email'
      : !result.found                            ? 'not_found'
      : result.eligible                          ? 'found_eligible'
      :                                            'found_ineligible'

    logRequest(requestId, outcome, result.student?.id || null, Date.now() - startTime)
    return res.status(200).json(result)
  } catch (err) {
    logRequest(requestId, 'error', null, Date.now() - startTime, err.message)
    return res.status(500).json({ error: 'internal_error' })
  }
}

// PII-free structured log line. Never logs school_email or full_name.
function logRequest(requestId, outcome, studentId, duration, errorMessage) {
  const parts = [`[shift-log/lookup]`, `req=${requestId}`, `outcome=${outcome}`]
  if (studentId) parts.push(`student=${studentId}`)
  parts.push(`duration=${duration}ms`)
  if (errorMessage) parts.push(`error="${errorMessage}"`)
  console.log(parts.join(' '))
}
