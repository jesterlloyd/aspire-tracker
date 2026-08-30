/* global process */
// api/interview-book.js
//
// PUBLIC endpoint behind /interview-schedule: books the slot a student picked.
//
// S-07 HARDENING. This endpoint used to accept studentId, cohortId, and slotId from the request
// body and trust all three. It verified none of the relationships between them, so an anonymous
// caller holding any student id could book slots for that student, exhaust a cohort's availability,
// flip student statuses to Interview Scheduled, and trigger an outbound notification per call. It
// also returned the full slot row and the interviewer's email address to the caller.
//
// Identity is now re-resolved server-side from the submitted school email, exactly the way
// api/interview-lookup.js does it, and the cohort is derived from server state. studentId and
// cohortId are no longer read from the body at all. This flow still authenticates a student by
// school email alone; that is deliberate and documented, and changing it is a product decision.
//
//   1. RE-RESOLVED IDENTITY. The student comes from the email, within the single accepting cohort,
//      and must pass the same eligibility gate the lookup applies.
//   2. ENFORCED RELATIONSHIPS. The slot claim is a single conditional UPDATE that requires the slot
//      to be in the resolved cohort AND still unbooked, so "belongs to this cohort" and "is still
//      available" are checked by the same atomic statement that claims it.
//   3. ONE BOOKING PER STUDENT. A student who already holds a booking is refused. Rescheduling is a
//      staff-mediated process, which the confirmation screen states explicitly, so silently
//      releasing a held slot would contradict the product and hand a caller a slot-churn primitive.
//   4. UNIFORM REFUSAL. Every failed precondition (identity, eligibility, slot, already-booked) returns
//      one identical response, so this endpoint cannot be used to test whether an email belongs to
//      an eligible ASPIRE student.
//   5. TRIMMED RESPONSE via a projection, in the S-01 style. This closes the slot columns that
//      remained exposed here after the lookup was trimmed, and stops returning the interviewer's
//      email address to an anonymous caller.
//   6. RATE LIMIT, two buckets, through the existing consume_evaluation_rate_limit RPC.
//   7. GENERIC ERRORS and CORS narrowed to the app origins, matching the lookup.
//
// The S-06 booking notification path below is unchanged: same trigger, same recipients, same
// content, still derived entirely from server state.

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { normalizeEmailForLookup, escapeLikePattern } from '../src/lib/emailUtils.js'
import { extractClientIp, bucketKey } from '../lib/server/evaluation/rate_limit.js'
import { CANONICAL_APP_URL, LEGACY_APP_URL } from '../src/lib/appUrl.js'
import { resolveAcceptingCohort } from './lib/intakeStudentLookup.js'
// Shared with the lookup so the two halves of the scheduling flow can never disagree about who may
// schedule. A student the lookup admits is exactly a student this endpoint will book.
import { ELIGIBLE_STATUSES } from './interview-lookup.js'
// S-06 ENDPOINT CLOSURE: the booking notice is rendered here and sent from this endpoint. It used
// to be a fire-off HTTP call to the PUBLIC api/notify-interview-booked.js route, which accepted its
// recipients and its whole body from the request, so anyone could send ASPIRE-branded mail to an
// arbitrary address. Recipients and content are now derived from server state only.
import { interviewBookedEmail, shouldSkipDuplicateBookingNotice } from '../lib/server/email/interviewBooked.js'

const BOOKING_NOTICE_FROM     = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>'
const BOOKING_NOTICE_REPLY_TO = 'JesterLloyd.Bautista@cshs.org'
const BOOKING_NOTICE_OWNER    = 'JesterLloyd.Bautista@cshs.org'

const ALLOWED_ORIGINS = new Set([CANONICAL_APP_URL, LEGACY_APP_URL])

// Booking is rarer than lookup: a student books once, plus perhaps a retry after losing a slot
// race. Both ceilings sit well above that and well below anything useful for draining a cohort.
export const RATE_LIMITS = [
  { prefix: 'interview_book_burst',     windowSeconds: 60,   maxPerWindow: 5 },
  { prefix: 'interview_book_sustained', windowSeconds: 3600, maxPerWindow: 20 },
]

// Columns read for the student. Every one is needed server-side: cohort_id and status for the
// gates, school_email to confirm the normalized match, and the name/school/program fields for the
// S-06 notification. NONE of them is returned to the caller, which already holds its own profile
// from the lookup.
export const STUDENT_COLUMNS =
  'id, cohort_id, school_email, status, first_name, last_name, school, program_type'

// Columns read back from the claimed slot. interviewer_name and cohort_id are needed server-side
// (the notification, the event note, and the post-claim verification); the projection below drops
// them, so neither reaches the caller.
export const BOOKED_SLOT_COLUMNS = 'id, cohort_id, slot_date, slot_time, duration_minutes, interviewer_name'

// The only slot fields the confirmation screen renders: the detail rows, the .ics file, and the
// student mailto all read exactly these three (verified against InterviewSchedulePage.jsx).
export function projectBookedSlot(row) {
  return {
    slot_date:        row.slot_date,
    slot_time:        row.slot_time,
    duration_minutes: row.duration_minutes,
  }
}

// ONE refusal for every failed precondition: unknown email, ineligible status, unknown slot, slot
// in another cohort, slot already taken, and student already booked. Identical status and body in
// all six cases, so a caller cannot learn which one it hit and therefore cannot use this endpoint
// as an existence oracle the way the pre-S-01 lookup could be used. Returning the student to the
// scheduling page is genuinely the right next step in every one of those cases: the lookup will
// then show them their real state.
export const BOOKING_REFUSED = {
  status: 409,
  body: {
    error:
      'We could not complete that booking. The time may have just been taken, or your record may '
      + 'not be ready for scheduling. Please return to the scheduling page and start again, and '
      + 'contact the ASPIRE team if the problem continues.',
  },
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
  // studentId and cohortId are deliberately NOT read. Identity comes from the email and the cohort
  // from server state; a body-supplied id is not authority for anything here.
  const { email, slotId } = req.body || {}

  if (!email?.trim() || !slotId) {
    return res.status(400).json({ error: 'Email and slot are required.' })
  }

  try {
    // 0. Rate limit BEFORE any lookup or write, so a refused caller learns nothing and cannot
    //    claim a slot. Fails closed: an RPC error is treated exactly like an exceeded limit.
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

    // 1. Cohort from server state. Scheduling being open is a precondition of booking, so a closed
    //    cohort refuses here exactly as it does in the lookup, and by the same fail-closed resolver:
    //    `.limit(1).maybeSingle()` used to pick an arbitrary row when more than one cohort was
    //    accepting, which would have written a real booking into the wrong cohort. Booking is the
    //    half of this pair that MUTATES, so guessing here was the more expensive of the two.
    //    See api/interview-lookup.js step 1 and migration 20260902000000.
    const cohortResult = await resolveAcceptingCohort(db)
    if (cohortResult.failure) {
      console.warn('[interview-book] no single accepting cohort:', cohortResult.failure.error)
      return res.status(400).json({ error: 'Scheduling is not currently open. Please contact the ASPIRE team.' })
    }
    const cohort = { id: cohortResult.cohortId }

    // 2. Student re-resolved from the email, scoped to that cohort. Same matching rule as the
    //    lookup: escaped ilike, then a normalized-equality confirm in JS.
    const cleanEmail = normalizeEmailForLookup(email)
    const { data: candidates } = await db.from('students')
      .select(STUDENT_COLUMNS).eq('cohort_id', cohort.id).ilike('school_email', escapeLikePattern(cleanEmail)).limit(5)
    const student = (candidates || []).find(s => normalizeEmailForLookup(s.school_email) === cleanEmail) || null

    if (!student || !ELIGIBLE_STATUSES.has(student.status)) {
      return res.status(BOOKING_REFUSED.status).json(BOOKING_REFUSED.body)
    }

    // 3. One booking per student. Refuse rather than replace: the confirmation screen tells a
    //    student to email the ASPIRE team to reschedule, so releasing a held slot here would
    //    contradict that and would let a caller churn other students' bookings.
    const { data: priorBooking } = await db.from('interview_slots')
      .select('id').eq('booked_by_student_id', student.id).eq('is_booked', true).limit(1).maybeSingle()
    if (priorBooking) {
      return res.status(BOOKING_REFUSED.status).json(BOOKING_REFUSED.body)
    }

    const now = new Date().toISOString()

    // 4. Claim the slot. ONE conditional UPDATE carries every remaining precondition: the slot
    //    exists, belongs to THIS cohort, and is still unbooked. Claiming it is atomic at the row
    //    level in Postgres, so two callers racing for the same slot cannot both win.
    const { data: slot, error: slotError } = await db.from('interview_slots')
      .update({ is_booked: true, booked_by_student_id: student.id, booked_at: now, status: 'booked' })
      .eq('id', slotId)
      .eq('cohort_id', cohort.id)
      .eq('is_booked', false)
      .select(BOOKED_SLOT_COLUMNS)
      .single()

    if (slotError || !slot) {
      return res.status(BOOKING_REFUSED.status).json(BOOKING_REFUSED.body)
    }

    // 5. Re-verify the one-booking invariant AFTER the claim. Step 3 cannot see a booking made by a
    //    concurrent request, so two simultaneous calls for the same student could each claim a
    //    different slot. If that happened, release the slot this request just took and refuse.
    //    Both racers may release, leaving the student unbooked and free to retry, which is safe;
    //    what cannot happen is one student silently holding two slots. Making the winner
    //    deterministic instead of retry-safe needs a partial unique index on interview_slots
    //    (booked_by_student_id) WHERE is_booked, which is SQL and is reported as a follow-up.
    const { data: otherBookings } = await db.from('interview_slots')
      .select('id').eq('booked_by_student_id', student.id).eq('is_booked', true).neq('id', slot.id).limit(1)
    if (otherBookings && otherBookings.length > 0) {
      await db.from('interview_slots')
        .update({ is_booked: false, booked_by_student_id: null, booked_at: null, status: 'available' })
        .eq('id', slot.id)
        .eq('booked_by_student_id', student.id)   // only ever release the row we claimed
      console.warn('[interview-book] concurrent double booking detected, released slot', slot.id)
      return res.status(BOOKING_REFUSED.status).json(BOOKING_REFUSED.body)
    }

    // 6. Create or update interview_session
    const { data: existingSession, error: lookupError } = await db.from('interview_sessions')
      .select('id').eq('student_id', student.id).eq('cohort_id', cohort.id).limit(1).maybeSingle()

    if (lookupError) {
      console.error('[interview-book] session lookup failed:', lookupError.message)
    }

    if (existingSession) {
      const { error: updateError } = await db.from('interview_sessions')
        .update({ self_scheduled: true, slot_id: slot.id })
        .eq('id', existingSession.id)
      if (updateError) console.error('[interview-book] session update failed (non-fatal):', updateError.message)
    } else {
      const { error: insertError } = await db.from('interview_sessions').insert({
        student_id: student.id, cohort_id: cohort.id,
        self_scheduled: true, slot_id: slot.id, session_number: 1,
      })
      if (insertError) console.error('[interview-book] session insert failed (non-fatal):', insertError.message)
    }

    // 7. Update student record
    const { error: studentError } = await db.from('students').update({
      interview_scheduled_date:   slot.slot_date,
      interview_scheduled_time:   slot.slot_time,
      interview_duration_minutes: slot.duration_minutes,
      status:                     'Interview Scheduled',
      scheduling_viewed_at:       now,
    }).eq('id', student.id)

    if (studentError) console.error('[interview-book] student update error:', studentError.message)

    // 8. Log to program_events - non-fatal; schema uses notes text, no event_data column
    const bookingNote = `Interview self-scheduled for ${slot.slot_date} at ${slot.slot_time} with ${slot.interviewer_name || 'TBD'} (${slot.duration_minutes} min). Slot: ${slot.id}.`
    const { error: eventError } = await db.from('program_events').insert({
      student_id: student.id,
      cohort_id:  cohort.id,
      event_type: 'interview_booked',
      event_date: slot.slot_date,
      event_time: slot.slot_time,
      notes:      bookingNote,
      created_by: 'self_schedule',
    })
    if (eventError) console.warn('[interview-book] program_events log failed (non-blocking):', eventError.message)

    // 9. Fetch interviewer email
    let interviewerEmail = null
    if (slot.interviewer_name?.trim()) {
      const { data: iv } = await db.from('user_profiles')
        .select('email').ilike('full_name', slot.interviewer_name.trim())
        .eq('can_conduct_interviews', true).limit(1).maybeSingle()
      interviewerEmail = iv?.email?.trim() || null
    }

    // 10. Booking notice - single send path, in-process. Recipients are the ASPIRE owner address and
    // the interviewer email resolved in step 9, never a value from the request. Non-fatal: the
    // booking is already committed and an email problem must never fail it.
    try {
      const studentName = `${student.first_name} ${student.last_name}`
      const dedupeKey = slot.id || `${student.school_email || 'unknown'}-${slot.slot_date}-${slot.slot_time}`
      if (shouldSkipDuplicateBookingNotice(dedupeKey)) {
        console.log('[interview-book] duplicate booking notice within 60s window, skipping:', dedupeKey)
      } else if (!process.env.RESEND_API_KEY) {
        console.error('[interview-book] RESEND_API_KEY not set, booking notice not sent')
      } else {
        const recipients = [...new Set([BOOKING_NOTICE_OWNER, interviewerEmail].filter(Boolean))]
        const { subject, html } = interviewBookedEmail({
          studentName,
          studentSchool:   student.school,
          studentProgram:  student.program_type,
          studentEmail:    student.school_email,
          interviewDate:   slot.slot_date,
          interviewTime:   slot.slot_time,
          duration:        slot.duration_minutes,
          interviewerName: slot.interviewer_name,
        })
        const { data, error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
          from:     BOOKING_NOTICE_FROM,
          reply_to: BOOKING_NOTICE_REPLY_TO,
          to:       recipients,
          subject,
          html,
        })
        if (error) console.error('[interview-book] booking notice send error:', JSON.stringify(error))
        else console.log('[interview-book] booking notice sent:', data?.id)
      }
    } catch (notifyErr) {
      console.error('[interview-book] booking notice failed (non-fatal):', notifyErr.message)
    }

    // The caller already holds its own student profile from the lookup, so the response carries
    // only the booked time. interviewerEmail and ownerEmail used to be returned here and were a
    // staff address disclosure to an anonymous caller; neither is rendered by the page.
    return res.status(200).json({ success: true, slot: projectBookedSlot(slot) })

  } catch (err) {
    // Server-side only: the caller gets a fixed string, never provider or database text.
    console.error('[interview-book] unhandled error:', err?.message || err)
    return res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
}
