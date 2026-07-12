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
import { PATIENT_POPULATION_MAP } from '../src/lib/constants.js'
import { resolveAcceptingCohort } from './lib/intakeStudentLookup.js'

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
  const isHosting = slotsNum > 0
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

  // ── 1. Upsert the units row (ensures the matching board has a record) ──────
  let unitId
  const { data: existingUnit, error: findErr } = await db
    .from('units')
    .select('id')
    .eq('cohort_id', cohortId)
    .eq('unit_name', unitName)
    .limit(1)
    .maybeSingle()
  if (findErr) return res.status(500).json({ error: 'internal_error' })

  const unitFields = {
    contact_person:   submitterName,
    contact_email:    submitterEmail,
    is_participating: isHosting,
    total_slots:      isHosting ? slotsNum : 0,
    slots_remaining:  isHosting ? slotsNum : 0,
    shift_preference: str(body.shift_preference),
    preceptors:       str(body.preferred_preceptors),
    considerations:   str(body.considerations),
  }

  if (existingUnit) {
    unitId = existingUnit.id
    const { error: updateErr } = await db.from('units').update(unitFields).eq('id', unitId)
    if (updateErr) {
      console.log('[unit-form-submit] unit update failed', { request_id: requestId, errorCode: updateErr.code })
      return res.status(500).json({ error: 'internal_error' })
    }
  } else {
    const { data: newUnit, error: insertErr } = await db.from('units').insert({
      unit_name:          unitName,
      ...unitFields,
      patient_population: PATIENT_POPULATION_MAP[unitName] || '',
      cohort_id:          cohortId,
    }).select('id').single()
    if (insertErr || !newUnit) {
      console.log('[unit-form-submit] unit insert failed', { request_id: requestId, errorCode: insertErr?.code })
      return res.status(500).json({ error: 'internal_error' })
    }
    unitId = newUnit.id
  }

  // ── 2. Upsert unit_cohort_responses (server-managed counters/timestamps) ───
  const { data: existingRow, error: existingErr } = await db
    .from('unit_cohort_responses')
    .select('submission_count, submitted_at')
    .eq('cohort_id', cohortId)
    .eq('unit_id', unitId)
    .maybeSingle()
  if (existingErr) return res.status(500).json({ error: 'internal_error' })

  const now = new Date().toISOString()
  const upsertData = {
    cohort_id:                    cohortId,
    unit_id:                      unitId,
    unit_name:                    unitName,
    response_status:              isHosting ? 'submitted_hosting' : 'submitted_not_hosting',
    submitted_by_name:            submitterName,
    submitted_by_email:           submitterEmail,
    submitted_by_role:            submitterRole,
    slots_offered:                isHosting ? slotsNum : 0,
    shift_preference:             str(body.shift_preference) || null,
    preferred_preceptors:         str(body.preferred_preceptors) || null,
    considerations:               str(body.considerations) || null,
    reason_for_zero:              !isHosting ? (str(body.reason_for_zero) || null) : null,
    hiring_new_grads_ngrp:        body.hiring_ngrp,
    hiring_new_grads_reason:      body.hiring_ngrp === false ? (str(body.hiring_ngrp_reason) || null) : null,
    has_hired_aspire_alumni:      str(body.has_fired_alumni) || null,
    aspire_alumni_outcome:        str(body.has_fired_alumni) === 'yes' ? (str(body.alumni_outcome) || null) : null,
    aspire_alumni_notes:          str(body.has_fired_alumni) === 'yes' ? (str(body.alumni_notes) || null) : null,
    would_consider_aspire_alumni: str(body.has_fired_alumni) === 'no'  ? (str(body.would_consider_alumni) || null) : null,
    submission_count:             (existingRow?.submission_count || 0) + 1,
    submitted_at:                 existingRow?.submitted_at || now,
    last_updated_at:              now,
  }

  const { error: upsertErr } = await db
    .from('unit_cohort_responses')
    .upsert(upsertData, { onConflict: 'cohort_id,unit_id' })
  if (upsertErr) {
    console.log('[unit-form-submit] response upsert failed', { request_id: requestId, errorCode: upsertErr.code })
    return res.status(500).json({ error: 'internal_error' })
  }

  console.log('[unit-form-submit] submission accepted', { request_id: requestId, cohortId })
  return res.status(200).json({ success: true })
}
