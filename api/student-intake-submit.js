/* global process */
// api/student-intake-submit.js
//
// WS1e-A0: dedicated PUBLIC student-intake submission endpoint for /student-form.
//
// This extracts the public intake write path off the staff-oriented
// api/student-update.js (which WS1e-A will later lock to authenticated staff).
//
// Security model (public, NO staff auth - mirrors the existing public-intake
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
import { normalizeEmailForLookup } from '../src/lib/emailUtils.js'
import { sanitizeWeekdays, sanitizeIsoDates, coerceBoolOrNull } from '../src/lib/availability.js'
import { STUDENT_FORM_ACK_VERSION } from '../src/lib/studentFormAck.js'
// STUDENT-PORTAL-PROFILE-1: the intake-eligible statuses now live in the shared
// canonical lock module, used identically by the portal profile endpoint.
import { isStudentProfileLocked } from '../src/lib/studentProfileLock.js'
// PHASE0B-WAVE-D: cohort and student resolution shared with student-intake-lookup.js
import { resolveAcceptingCohort, resolveStudentByEmail } from './lib/intakeStudentLookup.js'
import { checkLengths, LIMITS } from './lib/fieldLimits.js'
// S-03: a stored file reference must be the canonical path for THIS student, not any string the
// browser sends. See lib/server/studentFiles.js validateStoredFileRefForStudent.
import { validateStoredFileRefForStudent } from '../lib/server/studentFiles.js'

function getDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role credentials')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// Exact accepted top-level keys (student-entered intake fields only).
const ALLOWED_BODY_KEYS = [
  'school_email',                 // binding key (used to resolve the student; not overwritten)
  'first_name', 'last_name', 'preferred_first_name', 'personal_email', 'phone',
  'date_of_birth', 'ssn_last4', 'gender',
  'cs_affiliation', 'cs_department', 'cs_role',
  'prior_healthcare_experience',
  'unit_preference_1', 'unit_preference_2', 'unit_preference_3',
  'cumulative_gpa', 'shift_availability', 'interest_statement',
  'resume_url', 'headshot_url',   // references already produced by the existing upload flow
  // AVAILABILITY-CANON-1B: student-owned rotation availability (all student-entered).
  'unavailable_weekdays', 'unavailable_weekdays_reason', 'personal_blackout_dates',
  'weekends_available', 'nights_available', 'preferred_days', 'availability_notes',
  'availability_ack',
  // STUDENT-FORM-INFORMATION-ACKNOWLEDGMENT: client sends checkbox + typed name only.
  'privacy_ack', 'privacy_ack_name',
]

function findUnexpectedKeys(object, allowedKeys) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return []
  return Object.keys(object).filter(key => !allowedKeys.includes(key))
}

const str = (v) => (typeof v === 'string' ? v.trim() : '')

// Required-documents rule, enforced server-side (the browser gate can be bypassed). A resume/headshot
// counts when an INCOMING path is present OR one is already durably on the student's record, so a
// returning student who already uploaded one document only needs to supply the missing one. Uses the
// canonical stored references (resume_url / headshot_url), never display labels, and returns a safe
// { field, message } (no storage internals) or null when satisfied. Messages MUST stay in parity with
// src/lib/studentDocuments.js DOCUMENT_MESSAGES (api/ cannot import src/; a test guards the parity).
export function checkDocumentsRequired(body, student) {
  const hasResume   = !!(str(body?.resume_url)   || str(student?.resume_url))
  const hasHeadshot = !!(str(body?.headshot_url) || str(student?.headshot_url))
  if (!hasResume && !hasHeadshot) return { field: 'resume_url',   message: 'Upload your resume and headshot before submitting.' }
  if (!hasResume)   return { field: 'resume_url',   message: 'Upload your resume before submitting.' }
  if (!hasHeadshot) return { field: 'headshot_url', message: 'Upload your headshot before submitting.' }
  return null
}

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

  // S-06 LENGTH CAPS: most student-entered fields were unbounded. Rejected with a message naming
  // the field, never truncated. unavailable_weekdays_reason and availability_notes previously used
  // a silent .slice(); the SAME limits are kept, but an over-length value is now reported instead
  // of quietly losing the tail the student wrote.
  const tooLong = checkLengths([
    ['school_email',                'School email',                body.school_email,                LIMITS.EMAIL],
    ['first_name',                  'First name',                  body.first_name,                  LIMITS.NAME],
    ['last_name',                   'Last name',                   body.last_name,                   LIMITS.NAME],
    ['preferred_first_name',        'Preferred first name',        body.preferred_first_name,        LIMITS.NAME],
    ['personal_email',              'Personal email',              body.personal_email,              LIMITS.EMAIL],
    ['phone',                       'Phone number',                body.phone,                       LIMITS.PHONE],
    ['date_of_birth',               'Date of birth',               body.date_of_birth,               LIMITS.DATE],
    ['gender',                      'Gender',                      body.gender,                      LIMITS.ROLE],
    ['cs_affiliation',              'Cedars-Sinai affiliation',    body.cs_affiliation,              LIMITS.IDENTITY],
    ['cs_department',               'Cedars-Sinai department',     body.cs_department,               LIMITS.IDENTITY],
    ['cs_role',                     'Cedars-Sinai role',           body.cs_role,                     LIMITS.IDENTITY],
    ['prior_healthcare_experience', 'Prior healthcare experience', body.prior_healthcare_experience, LIMITS.NARRATIVE],
    ['unit_preference_1',           'First unit preference',       body.unit_preference_1,           LIMITS.IDENTITY],
    ['unit_preference_2',           'Second unit preference',      body.unit_preference_2,           LIMITS.IDENTITY],
    ['unit_preference_3',           'Third unit preference',       body.unit_preference_3,           LIMITS.IDENTITY],
    ['shift_availability',          'Shift availability',          body.shift_availability,          LIMITS.SHORT],
    ['interest_statement',          'Interest statement',          body.interest_statement,          LIMITS.LONG_NARRATIVE],
    ['unavailable_weekdays_reason', 'Reason for unavailability',   body.unavailable_weekdays_reason, LIMITS.SHORT],
    ['availability_notes',          'Availability notes',          body.availability_notes,          LIMITS.NOTES],
    ['resume_url',                  'Resume',                      body.resume_url,                  LIMITS.SHORT],
    ['headshot_url',                'Headshot',                    body.headshot_url,                LIMITS.SHORT],
  ])
  if (tooLong) {
    return res.status(400).json({ error: 'invalid_request', field: tooLong.field, message: tooLong.message })
  }

  // AVAILABILITY-CANON-1B: the availability acknowledgment is REQUIRED to submit.
  if (body.availability_ack !== true) {
    return res.status(400).json({ error: 'invalid_request', field: 'availability_ack', message: 'Please acknowledge the availability statement to submit.' })
  }

  // STUDENT-FORM-INFORMATION-ACKNOWLEDGMENT: checkbox required; typed name trim-non-empty (1–120),
  // NO exact-name match. Version + timestamp are SERVER-set below (never trusted from the client).
  const privacyAckName = str(body.privacy_ack_name)
  if (body.privacy_ack !== true || privacyAckName.length < 1 || privacyAckName.length > 120) {
    return res.status(400).json({ error: 'invalid_request', field: 'privacy_ack', message: 'Please complete the Student Information Use Acknowledgment before submitting.' })
  }

  const db = getDb()

  // ── Eligibility 1: exactly one cohort must be accepting submissions ─────────
  // 0 → 403 not_accepting; 1 → proceed; >1 → 409 ambiguous_cohort (never pick a row).
  // PHASE0B-WAVE-D: shared with student-intake-lookup.js (identical semantics).
  const cohortResult = await resolveAcceptingCohort(db)
  if (cohortResult.failure) {
    if (cohortResult.failure.error === 'ambiguous_cohort') {
      console.log('[student-intake-submit] multiple accepting cohorts', { request_id: requestId })
    }
    const { status, ...rest } = cohortResult.failure
    return res.status(status).json(rest)
  }
  const cohortId = cohortResult.cohortId

  // ── Eligibility 2: the submitted email must resolve to EXACTLY ONE student ──
  // within the cohort, across school_email AND personal_email. No first-match
  // fallback. Normalized (case/whitespace/zero-width); escaped ilike =
  // case-insensitive EXACT match (no % / _ wildcard broadening).
  // PHASE0B-WAVE-D: shared with student-intake-lookup.js (identical semantics).
  // Include the canonical document references so the requirement below can honor a document already
  // durably on file (a returning student who uploaded one document only needs to supply the other).
  const studentResult = await resolveStudentByEmail(db, cohortId, schoolEmail, 'id, cohort_id, status, interview_scheduled_date, cs_cedars_status, resume_url, headshot_url')
  if (studentResult.failure) {
    if (studentResult.failure.error === 'ambiguous_student') {
      console.log('[student-intake-submit] ambiguous student match', { request_id: requestId })
    }
    const { status, ...rest } = studentResult.failure
    return res.status(status).json(rest)
  }
  const student = studentResult.student

  // ── Submission-state protection: do not overwrite advanced/staff-managed records.
  // STUDENT-PORTAL-PROFILE-1: the shared canonical lock (same intake-eligible statuses
  // as before, plus interview_scheduled_date failing closed - a booked interview locks
  // the profile even if status lags).
  if (isStudentProfileLocked(student)) {
    return res.status(409).json({ error: 'already_processed', message: 'Your application has already progressed. Please contact the ASPIRE team to update your details.' })
  }

  // ── Documents required: both resume and headshot must be durably referenced (server authority) ──
  const missingDoc = checkDocumentsRequired(body, student)
  if (missingDoc) {
    return res.status(400).json({ error: 'documents_required', field: missingDoc.field, message: missingDoc.message })
  }

  // ── Build the exact intake update (allow-listed student-entered fields only) ─
  // name is composed server-side; submitted_via and status are server-controlled.
  const updates = {
    first_name: firstName,
    last_name: lastName,
    name: `${firstName} ${lastName}`,
    // STUDENT-PREFERRED-FIRST-NAME-1A: optional; blank → null. Does NOT affect the composed `name`.
    preferred_first_name: str(body.preferred_first_name) || null,
    personal_email: normalizeEmailForLookup(body.personal_email), // store normalized going forward
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
    // AVAILABILITY-CANON-1B: student-owned availability, sanitized to canonical encodings.
    // (Written ONLY to students; coordinator-owned rotation availability is never touched here.)
    unavailable_weekdays:        sanitizeWeekdays(body.unavailable_weekdays),
    unavailable_weekdays_reason: str(body.unavailable_weekdays_reason),
    personal_blackout_dates:     sanitizeIsoDates(body.personal_blackout_dates),
    weekends_available:          coerceBoolOrNull(body.weekends_available),
    nights_available:            coerceBoolOrNull(body.nights_available),
    preferred_days:              sanitizeWeekdays(body.preferred_days),
    availability_notes:          str(body.availability_notes),
    availability_ack:            true,
    // STUDENT-FORM-INFORMATION-ACKNOWLEDGMENT: store the typed name; server owns version + timestamp.
    student_form_privacy_ack_name:    privacyAckName,
    student_form_privacy_ack_version: STUDENT_FORM_ACK_VERSION,
    student_form_privacy_ack_at:      new Date().toISOString(),
    submitted_via: 'student_form',
    status: 'Form Received',
  }
  // S-03: bind each supplied file reference to this student. The value must equal the canonical
  // path this server issued for them, so a path naming another student or another cohort is
  // refused rather than persisted. Rejected, never rewritten: silently correcting a mismatch would
  // mask a client defect and could claim an object this submitter never uploaded.
  for (const column of ['resume_url', 'headshot_url']) {
    if (!str(body[column])) continue
    const ref = validateStoredFileRefForStudent({
      value: body[column], column, cohortId: student.cohort_id, studentId: student.id,
    })
    if (!ref.ok) {
      console.log('[student-intake-submit] file reference rejected', { request_id: requestId, column, reason: ref.error })
      return res.status(400).json({ error: 'invalid_request', field: column, message: ref.message })
    }
    updates[column] = ref.path
  }

  // ── STUDENT-FORM-CEDARS-STATUS-AUTO-MAP (forward fix) ───────────────────────────
  // Derive the CS-Link "Cedars-Sinai Status" (cs_cedars_status) from the student's affiliation.
  // This is SERVER-DERIVED from the already-validated cs_affiliation - cs_cedars_status is NOT a
  // student-controlled field (it is absent from ALLOWED_BODY_KEYS and is never read from the body).
  // Applied ONLY when the record has no cs_cedars_status yet: never overwrite a staff-set value and
  // never auto-clear one. "No prior affiliation" is intentionally unmapped (no write). The Stage-1
  // side-effects MIRROR StudentSidePanel's manual Step-1 onChange exactly - no new side-effects.
  const CS_AFFILIATION_TO_CEDARS_STATUS = {
    'Current Employee': 'employee',
    'Volunteer':        'employee',
    'Former Employee':  'former',
  }
  const derivedCedarsStatus = CS_AFFILIATION_TO_CEDARS_STATUS[updates.cs_affiliation]
  if (derivedCedarsStatus && !str(student.cs_cedars_status)) {
    updates.cs_cedars_status = derivedCedarsStatus
    if (derivedCedarsStatus === 'employee') {
      // Mirrors StudentSidePanel: employees already have a worker record → Stage 1 not required.
      updates.cs_stage1_action    = 'not_applicable'
      updates.cs_stage1_submitted = true
      updates.cs_stage1_complete  = true
    } else {
      // 'former' → mirrors StudentSidePanel's reset branch (Stage 1 pending, no action chosen yet).
      updates.cs_stage1_action    = ''
      updates.cs_stage1_submitted = false
      updates.cs_stage1_complete  = false
    }
  }

  // Field write + status transition in a single update (no separate status write).
  const { error: updateErr } = await db.from('students').update(updates).eq('id', student.id)
  if (updateErr) {
    console.log('[student-intake-submit] update failed', { request_id: requestId, errorCode: updateErr.code })
    return res.status(500).json({ error: 'internal_error' })
  }

  // form_received event - server-derived context; created_by is a server label.
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
