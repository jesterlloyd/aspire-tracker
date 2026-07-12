// api/unit-form-lookup.js
//
// PHASE0B-WAVE-D: PUBLIC pre-fill lookup for /unit-form.
//
// Replaces the client's direct anon SELECTs on units and unit_cohort_responses
// (the "pre-fill when a unit is selected" step), so the anon SELECT policy on
// unit_cohort_responses can be dropped without breaking the form.
//
// Security model (public, NO staff auth, mirrors the public-intake pattern):
//   - The accepting cohort is resolved SERVER-side (exactly one cohort with
//     accepting_submissions = true); the client cannot point the lookup at an
//     arbitrary cohort.
//   - Returns ONLY the allow-listed fields the form pre-fills, for the one
//     (cohort, unit) row. Never the whole table, never other cohorts.
//   - Rows still in 'pending' state return found: false (matches the previous
//     client behavior, which only pre-filled non-pending rows).

import { createClient } from '@supabase/supabase-js'
import { resolveAcceptingCohort } from './lib/intakeStudentLookup.js'

function getDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role credentials')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// Exact pre-fill field allow-list (what UnitFormPage maps into form state).
const RESPONSE_FIELDS = [
  'response_status',
  'submitted_by_name', 'submitted_by_email', 'submitted_by_role',
  'slots_offered', 'shift_preference', 'preferred_preceptors', 'considerations',
  'reason_for_zero', 'hiring_new_grads_ngrp', 'hiring_new_grads_reason',
  'has_hired_aspire_alumni', 'aspire_alumni_outcome', 'aspire_alumni_notes',
  'would_consider_aspire_alumni',
]

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'internal_error' })
  }

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const unitName = typeof body.unit_name === 'string' ? body.unit_name.trim() : ''
  if (!unitName || unitName.length > 200) {
    return res.status(400).json({ error: 'invalid_request', field: 'unit_name', message: 'A unit name is required.' })
  }

  const db = getDb()

  const cohortResult = await resolveAcceptingCohort(db)
  if (cohortResult.failure) {
    const { status, ...rest } = cohortResult.failure
    return res.status(status).json(rest)
  }

  const { data: unitsRow, error: unitErr } = await db
    .from('units')
    .select('id')
    .eq('cohort_id', cohortResult.cohortId)
    .eq('unit_name', unitName)
    .limit(1)
    .maybeSingle()
  if (unitErr) return res.status(500).json({ error: 'internal_error' })
  if (!unitsRow) return res.status(200).json({ found: false })

  const { data: responseRow, error: respErr } = await db
    .from('unit_cohort_responses')
    .select(RESPONSE_FIELDS.join(', '))
    .eq('cohort_id', cohortResult.cohortId)
    .eq('unit_id', unitsRow.id)
    .maybeSingle()
  if (respErr) return res.status(500).json({ error: 'internal_error' })
  if (!responseRow || responseRow.response_status === 'pending') {
    return res.status(200).json({ found: false })
  }

  return res.status(200).json({ found: true, response: responseRow })
}
