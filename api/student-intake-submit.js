// api/student-intake-submit.js
//
// WS1e-A0: dedicated PUBLIC student-intake submission endpoint for /student-form.
//
// This extracts the public intake write path off the staff-oriented
// api/student-update.js (which WS1e-A will later lock to authenticated staff).
//
// Security model (public, NO staff auth — mirrors the existing public-intake
// pattern, e.g. school-form-submit.js):
//   - Eligibility/binding = the submitter's school_email (fallback personal_email)
//     matching a pre-registered student row WITHIN the single cohort whose
//     accepting_submissions = true. The client never supplies a student_id; the
//     student is resolved server-side by email, so there is no ID-swap vector.
//   - Service-role client is used server-side only, after eligibility checks.
//   - Exact top-level request schema; any unexpected field is rejected. No nested
//     update object. Staff-managed fields (status/cohort/hours/placement/etc.) are
//     never accepted from the client.
//   - status='Form Received' and submitted_via='student_form' are set server-side.
//   - Students who have already advanced past the intake stage cannot be
//     overwritten (protects staff-managed data).
//
// Not a general-purpose student mutation endpoint.

import { createClient } from '@supabase/supabase-js'
import { toLocalDateStr } from '../shared/dateUtils.js'

function getDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role credentials')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// Exact accepted top-level keys (student-entered intake fields only).
const ALLOWED_BODY_KEYS = [
  'school_email',                 // binding key (used to resolve the student; not overwritten)
  'first_name', 'last_name', 'personal_email', 'phone',
  'date_of_birth', 'ssn_last4', 'gender',
  'cs_affiliation', 'cs_department', 'cs_role',
  'prior_healthcare_experience',
  'unit_preference_1', 'unit_preference_2', 'unit_preference_3',
  'cumulative_gpa', 'shift_availability', 'interest_statement',
  'resume_url', 'headshot_url',   // references already produced by the existing upload flow
]

// Statuses for which public intake submission is permitted. Beyond these, the
// applicant has advanced past intake and staff-managed data must not be overwritten.
const INTAKE_ELIGIBLE_STATUSES = ['Pending Outreach', 'Form Sent', 'Form Received']

function findUnexpectedKeys(object, allowedKeys) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return []
  return Object.keys(object).filter(key => !allowedKeys.includes(key))
}

const str = (v) => (typeof v === 'string' ? v.trim() : '')

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'internal_error' })
  }

  const requestId = `req_${Math.random().toString(36).slice(2, 10)}`
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}

  // ── Exact-schema enforcement: reject any unexpected/staff-managed field ─────
  const unexpected = findUnexpectedKeys(body, ALLOWED_BODY_KEYS)
  if (unexpected.length > 0) {
    return res.status(400).json({ error: 'invalid_request', field: unexpected[0], message: 'Unexpected field.' })
  }

  // ── Minimal validation of binding + required student-entered fields ─────────
  const schoolEmail = str(body.school_email)
  if (!schoolEmail || !schoolEmail.includes('@') || !schoolEmail.includes('.')) {
    return res.status(400).json({ error: 'invalid_request', field: 'school_email', message: 'A valid school email is required.' })
  }
  const firstName = str(body.first_name)
  const lastName  = str(body.last_name)
  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'invalid_request', field: 'first_name', message: 'First and last name are required.' })
  }
  if (str(body.ssn_last4) && !/^\d{4}$/.test(str(body.ssn_last4))) {
    return res.status(400).json({ error: 'invalid_request', field: 'ssn_last4', message: 'SSN last 4 must be 4 digits.' })
  }
  let gpa = null
  if (body.cumulative_gpa !== undefined && body.cumulative_gpa !== null && body.cumulative_gpa !== '') {
    gpa = Number(body.cumulative_gpa)
    if (!Number.isFinite(gpa) || gpa < 0 || gpa > 4.5) {
      return res.status(400).json({ error: 'invalid_request', field: 'cumulative_gpa', message: 'Enter a valid GPA.' })
    }
  }

  const db = getDb()

  // ── Eligibility 1: exactly one cohort must be accepting submissions ─────────
  // 0 → 403 not_accepting; 1 → proceed; >1 → 409 ambiguous_cohort (never pick a row).
  const { data: acceptingCohorts, error: cohortErr } = await db
    .from('cohorts')
    .select('id')
    .eq('accepting_submissions', true)
  if (cohortErr) return res.status(500).json({ error: 'internal_error' })
  if (!acceptingCohorts || acceptingCohorts.length === 0) {
    return res.status(403).json({ error: 'not_accepting', message: 'This form is not currently accepting submissions. Please contact the ASPIRE team.' })
  }
  if (acceptingCohorts.length > 1) {
    console.log('[student-intake-submit] multiple accepting cohorts', { request_id: requestId, count: acceptingCohorts.length })
    return res.status(409).json({ error: 'ambiguous_cohort', message: 'Submissions are temporarily unavailable. Please contact the ASPIRE team.' })
  }
  const cohortId = acceptingCohorts[0].id

  // ── Eligibility 2: the submitted email must resolve to EXACTLY ONE student ──
  // within the cohort, across school_email AND personal_email. No first-match
  // fallback: collect the distinct matching student IDs and require exactly one.
  // (ilike without wildcards = case-insensitive exact match.)
  const cleanEmail = schoolEmail.toLowerCase()
  const { data: bySchool, error: e1 } = await db
    .from('students').select('id, cohort_id, status')
    .eq('cohort_id', cohortId).ilike('school_email', cleanEmail)
  const { data: byPersonal, error: e2 } = await db
    .from('students').select('id, cohort_id, status')
    .eq('cohort_id', cohortId).ilike('personal_email', cleanEmail)
  if (e1 || e2) return res.status(500).json({ error: 'internal_error' })

  const matched = new Map()
  ;(bySchool   || []).forEach(s => matched.set(s.id, s))
  ;(byPersonal || []).forEach(s => matched.set(s.id, s))
  const matchedIds = [...matched.keys()]
  if (matchedIds.length === 0) {
    return res.status(404).json({ error: 'not_found', message: 'We could not find your information for the current cycle. Please contact the ASPIRE team to confirm your school email on file.' })
  }
  if (matchedIds.length > 1) {
    console.log('[student-intake-submit] ambiguous student match', { request_id: requestId, matchCount: matchedIds.length })
    return res.status(409).json({ error: 'ambiguous_student', message: 'We could not uniquely identify your record. Please contact the ASPIRE team.' })
  }
  const student = matched.get(matchedIds[0])

  // ── Submission-state protection: do not overwrite advanced/staff-managed records
  const currentStatus = student.status || 'Pending Outreach'
  if (!INTAKE_ELIGIBLE_STATUSES.includes(currentStatus)) {
    return res.status(409).json({ error: 'already_processed', message: 'Your application has already progressed. Please contact the ASPIRE team to update your details.' })
  }

  // ── Build the exact intake update (allow-listed student-entered fields only) ─
  // name is composed server-side; submitted_via and status are server-controlled.
  const updates = {
    first_name: firstName,
    last_name: lastName,
    name: `${firstName} ${lastName}`,
    personal_email: str(body.personal_email),
    phone: str(body.phone),
    date_of_birth: str(body.date_of_birth) || null,
    ssn_last4: str(body.ssn_last4),
    gender: str(body.gender),
    cs_affiliation: str(body.cs_affiliation),
    cs_department: str(body.cs_department),
    cs_role: str(body.cs_role),
    prior_healthcare_experience: str(body.prior_healthcare_experience),
    unit_preference_1: str(body.unit_preference_1),
    unit_preference_2: str(body.unit_preference_2),
    unit_preference_3: str(body.unit_preference_3),
    cumulative_gpa: gpa,
    shift_availability: str(body.shift_availability),
    interest_statement: str(body.interest_statement),
    submitted_via: 'student_form',
    status: 'Form Received',
  }
  if (str(body.resume_url))   updates.resume_url   = str(body.resume_url)
  if (str(body.headshot_url)) updates.headshot_url = str(body.headshot_url)

  // Field write + status transition in a single update (no separate status write).
  const { error: updateErr } = await db.from('students').update(updates).eq('id', student.id)
  if (updateErr) {
    console.log('[student-intake-submit] update failed', { request_id: requestId, errorCode: updateErr.code })
    return res.status(500).json({ error: 'internal_error' })
  }

  // form_received event — server-derived context; created_by is a server label.
  // Best-effort + deduplicated (non-transactional with the update above; the
  // student write is preserved even if event logging fails).
  try {
    const { data: existingEvent } = await db
      .from('program_events')
      .select('id')
      .eq('student_id', student.id)
      .eq('cohort_id', student.cohort_id)
      .eq('event_type', 'form_received')
      .limit(1)
      .maybeSingle()
    if (!existingEvent) {
      const { error: logErr } = await db.from('program_events').insert({
        student_id: student.id,
        cohort_id: student.cohort_id,
        event_type: 'form_received',
        event_date: toLocalDateStr(),
        notes: 'Student submitted /student-form',
        created_by: 'Student Intake Form',
      })
      if (logErr) console.warn('[student-intake-submit] event log error', { request_id: requestId, errorCode: logErr.code })
    }
  } catch (logEx) {
    console.warn('[student-intake-submit] event log threw', { request_id: requestId })
  }

  console.log('[student-intake-submit] submission accepted', { request_id: requestId, cohortId: student.cohort_id })
  return res.status(200).json({ success: true })
}
