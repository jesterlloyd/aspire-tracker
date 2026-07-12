// api/unit-form-submit.js
//
// PHASE0B-WAVE-D: dedicated PUBLIC submission endpoint for /unit-form.
//
// Replaces the client's direct anon writes (units insert/update and the
// unit_cohort_responses upsert), so the anon INSERT and UPDATE policies on
// unit_cohort_responses and the anon write policies on units can be dropped
// without breaking the unit participation form.
//
// Security model (public, NO staff auth, mirrors student-intake-submit):
//   - The target cohort is resolved SERVER-side: exactly one cohort with
//     accepting_submissions = true. 0 -> 403 not_accepting, more than 1 ->
//     409 ambiguous_cohort. The client can no longer submit into an arbitrary
//     cohort (the previous client-side upsert accepted any cohort_id).
//   - Exact top-level request schema; unexpected fields are rejected.
//   - submission_count, submitted_at, and last_updated_at are SERVER-managed.
//   - Field mapping and conditional-null behavior mirror the previous client
//     logic exactly (single writer preserved: this endpoint replaces the
//     client, the notification stays on api/unit-form-notification.js).

import { createClient } from '@supabase/supabase-js'
import { resolveAcceptingCohort } from './lib/intakeStudentLookup.js'
// PHASE3-UNIT-PORTAL: the write sequence is shared with the authenticated
// portal endpoint (api/portal/unit-participation-submit.js).
import { performUnitResponseUpsert } from './lib/unitResponseUpsert.js'

function getDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role credentials')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

const ALLOWED_BODY_KEYS = [
  'unit_name', 'submitter_name', 'submitter_email', 'submitter_role',
  'slots_offered', 'shift_preference', 'preferred_preceptors', 'considerations',
  'reason_for_zero', 'hiring_ngrp', 'hiring_ngrp_reason',
  'has_fired_alumni', 'alumni_outcome', 'alumni_notes', 'would_consider_alumni',
]

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

  const unexpected = findUnexpectedKeys(body, ALLOWED_BODY_KEYS)
  if (unexpected.length > 0) {
    return res.status(400).json({ error: 'invalid_request', field: unexpected[0], message: 'Unexpected field.' })
  }

  // ── Validation (mirrors the client's own pre-submit checks) ────────────────
  const unitName       = str(body.unit_name)
  const submitterName  = str(body.submitter_name)
  const submitterEmail = str(body.submitter_email)
  const submitterRole  = str(body.submitter_role)
  if (!unitName || unitName.length > 200) {
    return res.status(400).json({ error: 'invalid_request', field: 'unit_name', message: 'Please select your unit or department.' })
  }
  if (!submitterName || submitterName.length > 200) {
    return res.status(400).json({ error: 'invalid_request', field: 'submitter_name', message: 'Please enter your name.' })
  }
  if (!submitterEmail || !submitterEmail.includes('@') || !submitterEmail.includes('.') || submitterEmail.length > 254) {
    return res.status(400).json({ error: 'invalid_request', field: 'submitter_email', message: 'Please enter a valid email address.' })
  }
  if (!submitterRole || submitterRole.length > 100) {
    return res.status(400).json({ error: 'invalid_request', field: 'submitter_role', message: 'Please select your role.' })
  }
  const slotsNum = Number.parseInt(body.slots_offered, 10)
  if (!Number.isFinite(slotsNum) || slotsNum < 0 || slotsNum > 99) {
    return res.status(400).json({ error: 'invalid_request', field: 'slots_offered', message: 'Please enter the number of slots (enter 0 if not hosting).' })
  }
  if (body.hiring_ngrp !== true && body.hiring_ngrp !== false) {
    return res.status(400).json({ error: 'invalid_request', field: 'hiring_ngrp', message: 'Please answer the NGRP hiring question.' })
  }

  const db = getDb()

  // ── Cohort resolved server-side: exactly one accepting cohort ──────────────
  const cohortResult = await resolveAcceptingCohort(db)
  if (cohortResult.failure) {
    const { status, ...rest } = cohortResult.failure
    return res.status(status).json(rest)
  }
  const cohortId = cohortResult.cohortId

  // ── Shared write sequence (units upsert + response upsert) ─────────────────
  const result = await performUnitResponseUpsert(db, cohortId, {
    unitName,
    submitterName,
    submitterEmail,
    submitterRole,
    slotsNum,
    shiftPreference:      body.shift_preference,
    preferredPreceptors:  body.preferred_preceptors,
    considerations:       body.considerations,
    reasonForZero:        body.reason_for_zero,
    hiringNgrp:           body.hiring_ngrp,
    hiringNgrpReason:     body.hiring_ngrp_reason,
    hasFiredAlumni:       body.has_fired_alumni,
    alumniOutcome:        body.alumni_outcome,
    alumniNotes:          body.alumni_notes,
    wouldConsiderAlumni:  body.would_consider_alumni,
  })
  if (result.error) {
    console.log('[unit-form-submit] write failed', { request_id: requestId, code: result.error.code })
    return res.status(result.error.status).json({ error: 'internal_error' })
  }

  console.log('[unit-form-submit] submission accepted', { request_id: requestId, cohortId })
  return res.status(200).json({ success: true })
}
