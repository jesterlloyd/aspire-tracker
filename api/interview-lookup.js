/* global process */
// api/interview-lookup.js
//
// PUBLIC endpoint behind /interview-schedule: resolves the student who is scheduling by the school
// email they type, then returns the bookable slots.
//
// S-01 HARDENING. This endpoint stays public because there is no authenticated alternative: the
// scheduling link ASPIRE Connect sends is a static, tokenless URL to /interview-schedule
// (src/components/connect/BulkManualComposer.jsx STATIC_LINK_SUBS, and
// 'student_interview_scheduling' is deliberately absent from SECURE_LINK_TYPES in
// api/lib/archiveClassification.js). The student's own school email is the only credential the flow
// has. Retiring the route would mean designing a tokenized scheduling flow, which is a separate
// piece of work. So the exposure is reduced instead:
//
//   1. RESPONSE ALLOW-LIST. The student row was previously fetched with select('*') and returned
//      whole, which handed an anonymous caller date_of_birth, ssn_last4, personal_email,
//      cumulative_gpa, and the interview scores and recommendations. Both queries now name their
//      columns, and every response is built by a projection function, so a column added to the
//      students or interview_slots table later cannot leak by default. `status` is read for the
//      eligibility check and deliberately never returned.
//   2. RATE LIMIT. Two buckets keyed on a peppered hash of the client IP, through the existing
//      consume_evaluation_rate_limit RPC. Fails closed.
//   3. NON-ENUMERATING. "No such student" and "student exists but is not eligible" return the
//      IDENTICAL status and body. Distinguishing them confirmed whether a school email belongs to
//      an ASPIRE student, which is what made bulk enumeration worth doing.
//   4. NARROW CORS. The only caller is the app's own page, so the wildcard is gone.
//   5. GENERIC FAILURES. No raw database or provider error text reaches the caller.
//
// Importing the rate-limit helper makes EVALUATION_RATE_LIMIT_PEPPER a hard requirement for this
// function: the module throws at import when it is unset. That is intentional and fail-closed, and
// the variable is already required by the deployed evaluation and certificate endpoints.

import { createClient } from '@supabase/supabase-js'
import { normalizeEmailForLookup, escapeLikePattern } from '../src/lib/emailUtils.js'
import { extractClientIp, bucketKey } from '../lib/server/evaluation/rate_limit.js'
import { CANONICAL_APP_URL, LEGACY_APP_URL } from '../src/lib/appUrl.js'

export const ELIGIBLE_STATUSES = new Set([
  'Form Received', 'Interview Scheduled', 'Interviewed',
  'Placed', 'Active Rotation', 'Completed',
])

// The page is served from the same origin as this route, so a same-origin fetch needs no CORS
// header at all. The allow-list exists only so a browser on the legacy fallback origin still works;
// it is not a security boundary on its own (curl ignores CORS), which is what the rate limit is for.
const ALLOWED_ORIGINS = new Set([CANONICAL_APP_URL, LEGACY_APP_URL])

// Rate limit, per client IP. Two buckets, because enumeration is a SUSTAINED attack: a single
// per-minute cap leaves a patient caller free to walk a school's whole address space. A student
// scheduling normally needs one or two lookups, so both ceilings sit far above real use.
export const RATE_LIMITS = [
  { prefix: 'interview_lookup_burst',     windowSeconds: 60,   maxPerWindow: 10 },
  { prefix: 'interview_lookup_sustained', windowSeconds: 3600, maxPerWindow: 60 },
]

// ── Response allow-lists ─────────────────────────────────────────────────────────────────────────
// Columns fetched from students. `status` is here because the eligibility gate needs it; it is NOT
// in the projection below, so it never reaches the caller. Everything else is a field the scheduling
// screen actually renders (verified against src/components/InterviewSchedulePage.jsx).
export const STUDENT_COLUMNS = [
  'id',                        // sent back to /api/interview-book to book a slot
  'first_name',                // greeting and confirmation copy
  'last_name',                 // identity line
  'school',                    // identity line
  'program_type',              // identity line
  'school_email',              // confirmation copy (the address the caller already supplied)
  'interview_scheduled_date',  // fallback display on the existing-booking screen
  'interview_scheduled_time',  // fallback display on the existing-booking screen
  'status',                    // SERVER-SIDE ONLY: eligibility gate, never returned
].join(', ')

export const SLOT_COLUMNS = 'id, slot_date, slot_time, duration_minutes, created_at'

// The booking a student already holds. interview_scheduled_* on the student row covers the same
// display, and the interviewer's identity is internal, so neither interviewer_name nor the slot id
// is returned here.
export const EXISTING_BOOKING_COLUMNS = 'slot_date, slot_time'

// Projections. Every response field is named here, so adding a column to a table or widening a
// select cannot introduce a new field into the payload by accident.
export function projectStudent(row) {
  return {
    id:                       row.id,
    first_name:               row.first_name,
    last_name:                row.last_name,
    school:                   row.school,
    program_type:             row.program_type,
    school_email:             row.school_email,
    interview_scheduled_date: row.interview_scheduled_date,
    interview_scheduled_time: row.interview_scheduled_time,
  }
}

export function projectSlot(row) {
  return {
    id:               row.id,
    slot_date:        row.slot_date,
    slot_time:        row.slot_time,
    duration_minutes: row.duration_minutes,
    created_at:       row.created_at,   // stable tie-break when several slots share a time
  }
}

export function projectBooking(row) {
  return { slot_date: row.slot_date, slot_time: row.slot_time }
}

// ONE message for "we cannot start scheduling for this email", covering both a school email that
// matches no student and a student who has not reached an eligible status. The two cases are
// indistinguishable to the caller by status code and by body, so this endpoint cannot be used to
// test whether an address belongs to an ASPIRE student. It still tells a real student what to do.
export const NOT_ELIGIBLE = {
  status: 404,
  body: {
    error:
      'We could not start scheduling for that school email. If you have not completed the ASPIRE '
      + 'Student Profile yet, please complete it first and then return to this page. If you have '
      + 'already completed it, contact the ASPIRE team and we will help.',
  },
}

function fmtLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

export default async function handler(req, res) {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Server configuration error' })

  const db = createClient(supabaseUrl, serviceKey)
  const { email } = req.body || {}

  if (!email?.trim()) return res.status(400).json({ error: 'Email is required' })

  try {
    // 0. Rate limit BEFORE any lookup, so a refused caller learns nothing at all. Fails closed:
    //    an RPC error is treated exactly like an exceeded limit.
    const ip = extractClientIp(req)
    for (const { prefix, windowSeconds, maxPerWindow } of RATE_LIMITS) {
      const { data: allowed, error: rlError } = await db.rpc('consume_evaluation_rate_limit', {
        p_bucket_key:     bucketKey(prefix, ip),
        p_window_seconds: windowSeconds,
        p_max_per_window: maxPerWindow,
      })
      if (rlError || allowed !== true) {
        return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' })
      }
    }

    // 1. Active cohort
    const { data: cohort } = await db.from('cohorts')
      .select('id, name').eq('accepting_submissions', true).limit(1).maybeSingle()
    if (!cohort) return res.status(400).json({ error: 'Scheduling is not currently open. Please contact the ASPIRE team.' })

    // 2. Student by school_email - forgiving match (case/whitespace/zero-width),
    //    escaped ilike (no % / _ wildcard broadening), JS normalized-equality confirm.
    const cleanEmail = normalizeEmailForLookup(email)
    const { data: candidates } = await db.from('students')
      .select(STUDENT_COLUMNS).eq('cohort_id', cohort.id).ilike('school_email', escapeLikePattern(cleanEmail)).limit(5)
    const student = (candidates || []).find(s => normalizeEmailForLookup(s.school_email) === cleanEmail) || null

    // 3. Not found and not eligible answer identically (see NOT_ELIGIBLE).
    if (!student || !ELIGIBLE_STATUSES.has(student.status)) {
      return res.status(NOT_ELIGIBLE.status).json(NOT_ELIGIBLE.body)
    }

    const safeStudent = projectStudent(student)

    // 4. Existing booking check
    const { data: existingSlot } = await db.from('interview_slots')
      .select(EXISTING_BOOKING_COLUMNS)
      .eq('booked_by_student_id', student.id)
      .eq('is_booked', true)
      .maybeSingle()

    if (existingSlot) {
      return res.status(200).json({
        hasExistingBooking: true,
        student: safeStudent,
        booking: projectBooking(existingSlot),
      })
    }

    // 5. Available slots
    const now = fmtLocalDate(new Date())
    const { data: slots } = await db.from('interview_slots')
      .select(SLOT_COLUMNS)
      .eq('cohort_id', cohort.id)
      .eq('is_booked', false)
      .gte('slot_date', now)
      .order('slot_date')
      .order('slot_time')

    if (!slots || slots.length === 0) {
      return res.status(200).json({ noSlots: true, student: safeStudent })
    }

    return res.status(200).json({
      student: safeStudent,
      cohortId: cohort.id,
      slots: slots.map(projectSlot),
    })

  } catch (err) {
    // Server-side only: the caller gets a fixed string, never provider or database text.
    console.error('[interview-lookup] unhandled error:', err?.message || err)
    return res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
}
