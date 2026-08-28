/* global process */
// api/school-form-submit.js
// Handles ASPIRE school coordinator form submissions.
// Replaces the previous direct-Supabase approach in SchoolFormPage.jsx.
//
// Responsibilities:
//   1. Upsert cohort_school_rotations row for (cohort, school) pair.
//   2. Insert each student, linking to the rotation row.
//   3. Log rotation_created event for the first new student added.
//   4. Fire form_received notifications (fire-and-forget).
//
// S-08. The cohort password is verified HERE, on the server, before anything is
// written.
//
// It used to be checked only in the browser: SchoolFormPage called
// verify_school_form_password, flipped its own pageState to 'verified', and then
// submitted without the password at all. This endpoint checked only that the
// cohort was accepting, so the gate protected the SCREEN and nothing else. Anyone
// who skipped the screen and posted straight here was never asked for it.
//
// The check mirrors the authenticated Academic Partner path in
// api/portal/school-placement-requests.js, so the two submission routes ask the
// same question of the same function and cannot drift.
//
// The coordinator has already typed the password to reach the form, so the client
// simply sends what it already holds. Nothing new is asked of a real submitter.
//
// STILL OUTSTANDING: cohorts.school_form_password is plaintext and the RPC compares
// it with TRIM equality. Hashing it is a schema change plus a staff-UI change (both
// cohort modals write the column directly) and is deliberately NOT bundled here.
// See db/audit/school_form_password_hardening.sql for the plan. Moving the check
// server-side is worth shipping on its own: it closes the bypass today, and it is a
// prerequisite for hashing rather than a duplicate of it.

import { createClient } from '@supabase/supabase-js'
import { performSchoolPlacementUpsert, isPlacementProvenanceReady, validatePlacementRequestInput } from './lib/schoolPlacementUpsert.js'
import { sanitizeSubmitMode } from '../src/lib/placementResubmission.js'
import { sendPlacementRequestNotifications } from '../lib/server/notifications/placementRequestNotifications.js'
import { consumePublicRateLimit, SCHOOL_SUBMIT_LIMITS, TOO_MANY_REQUESTS } from './lib/publicRateLimit.js'

function getDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role credentials')
  return createClient(url, key)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const {
    cohortId, cohortName,
    coordinator,
    rotationStartDate, rotationEndDate,
    availability,
    students = [],
  } = req.body || {}

  // Required field validation
  if (!cohortId) return res.status(400).json({ error: 'cohortId is required' })
  if (!coordinator?.school?.trim()) return res.status(400).json({ error: 'School name is required' })
  if (!coordinator?.name?.trim() || !coordinator?.email?.trim())
    return res.status(400).json({ error: 'Coordinator name and email are required' })
  // PLACEMENT-RESUBMIT-1: 'add_students' attaches a roster to the EXISTING
  // rotation row without writing its dates, so it does not carry any.
  const mode = sanitizeSubmitMode(req.body?.mode)
  const addOnly = mode === 'add_students'
  if (!addOnly) {
    if (!rotationStartDate || !rotationEndDate)
      return res.status(400).json({ error: 'Rotation start and end dates are required' })
    if (rotationEndDate <= rotationStartDate)
      return res.status(400).json({ error: 'Rotation end date must be after start date' })
  }
  if (!students.length) return res.status(400).json({ error: 'At least one student is required' })

  // S-06 LENGTH CAPS: coordinator fields, per-student fields, and the size of the roster itself
  // were unbounded. Shared with the Academic Partner portal path so the two cannot drift. The
  // message names the specific field and is safe to show a coordinator verbatim.
  const tooLong = validatePlacementRequestInput({ coordinator, students, availability })
  if (tooLong) return res.status(400).json({ error: tooLong.message, field: tooLong.field })

  const db = getDb()

  // S-11: throttle before any write or any lookup. Fails closed. This also bounds
  // guessing at the cohort password checked below.
  if (!(await consumePublicRateLimit(db, req, SCHOOL_SUBMIT_LIMITS))) {
    return res.status(429).json({ error: 'rate_limited', message: TOO_MANY_REQUESTS })
  }

  // Verify cohort is still accepting submissions
  const { data: cohort } = await db
    .from('cohorts').select('id, name, accepting_submissions')
    .eq('id', cohortId).single()
  if (!cohort?.accepting_submissions)
    return res.status(400).json({ error: 'This cohort is not currently accepting submissions.' })

  // ── S-08: the password gate, server side ───────────────────────────────────
  // Asked only when the cohort actually has a password set, so a cohort without one
  // behaves exactly as it always has. A failure to determine that is refused rather
  // than waved through.
  let requiresPassword
  try {
    const { data, error } = await db.rpc('school_form_requires_password', { p_cohort_id: cohortId })
    if (error) throw error
    requiresPassword = data === true
  } catch {
    return res.status(500).json({ error: 'We could not verify access for this form right now. Please try again shortly.' })
  }

  if (requiresPassword) {
    const entered = typeof req.body?.password === 'string' ? req.body.password.trim() : ''
    // One message for a missing password and a wrong one: which of the two it was
    // is not information a caller needs, and telling them turns this into an oracle
    // for whether a cohort is password-protected.
    const refuse = () => res.status(403).json({ error: 'The cohort password is incorrect. Please check with the ASPIRE team.' })
    if (!entered) return refuse()
    let ok
    try {
      const { data, error } = await db.rpc('verify_school_form_password', {
        p_cohort_id: cohortId, p_entered_password: entered,
      })
      if (error) throw error
      ok = data === true
    } catch {
      return res.status(500).json({ error: 'We could not verify access for this form right now. Please try again shortly.' })
    }
    if (!ok) return refuse()
  }
  // The password has served its only purpose. It is deliberately NOT copied into any
  // write payload, log line, response body, or notification.

  // Canonical write, shared with the authenticated Academic Partner endpoint so the two submission
  // paths can never drift (rotation upsert + duplicate-safe student insert/update + event log). The
  // public path is anonymous, so the latest-submission provenance records source 'school_form' with a
  // null profile id and a server timestamp. It is written only when the schema is ready; before the
  // migration is applied the public submission still succeeds, simply without those columns.
  const provenanceReady = await isPlacementProvenanceReady(db)
  const result = await performSchoolPlacementUpsert(db, {
    cohortId, cohortName, coordinator,
    rotationStartDate, rotationEndDate, availability, students,
    provenance: { source: 'school_form', submittedByProfileId: null, submittedAt: new Date().toISOString() },
    provenanceReady,
    mode,
  })
  if (result.error) return res.status(500).json({ error: result.error })
  const { added, updated, skipped, rotationId } = result

  // Placement-request confirmations for each new student, sent in-process through the shared
  // sender. S-06 ENDPOINT CLOSURE: this used to be a fire-and-forget POST to the PUBLIC
  // api/form-received-notification.js route, which accepted the recipient and every display value
  // from its request body. The route is gone; the sender never throws, so a notification problem
  // still cannot fail a placement request that is already written.
  // AP-SCHOOL-CANONICALIZATION-1: the confirmation goes to the SUBMITTING COORDINATOR with
  // placement-request language (never the student - a placement request is not a student
  // application), carrying the canonical school display name the write persisted.
  await sendPlacementRequestNotifications(added.map(s => ({
    studentId:        s.id,
    cohortId,
    cohortName:       cohort.name || cohortName || '',
    studentName:      s.name,
    studentFirstName: s.name.split(' ')[0],
    studentEmail:     s.email,
    school:           result.schoolName || coordinator.school.trim(),
    programType:      s.programType || '',
    coordinatorName:  coordinator.name.trim(),
    coordinatorEmail: coordinator.email.trim(),
  })))

  return res.status(200).json({
    success: true,
    added:   added.map(s => s.name),
    updated: updated.map(s => s.name),
    skipped,
    rotationId,
  })
}
