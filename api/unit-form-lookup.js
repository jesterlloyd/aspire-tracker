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
import { consumePublicRateLimit, UNIT_LOOKUP_LIMITS, TOO_MANY_REQUESTS } from './lib/publicRateLimit.js'
import { normalizeEmailForLookup } from '../src/lib/emailUtils.js'

function getDb() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase service role credentials')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

// S-10. Unit names are guessable, and this endpoint took nothing else. Anyone who
// could name a unit received the previous submitter's name, work email, and role,
// plus every free-text answer they had written: staffing considerations, the reason
// a unit offered zero slots, why it does or does not hire new graduates, named
// preceptor preferences, and notes about named ASPIRE alumni. That is a directory of
// staff and their candid internal commentary, available to anyone who guessed "5 West".
//
// The response is now split in two.
//
// OPEN fields are structured answers with no author and no prose: how many slots, a
// shift preference, and three yes/no style answers. Knowing that a unit offered four
// day slots identifies nobody, and the form needs them to prefill on unit selection.
const OPEN_FIELDS = [
  'response_status',
  'slots_offered', 'shift_preference',
  'hiring_new_grads_ngrp', 'has_hired_aspire_alumni', 'aspire_alumni_outcome',
  'would_consider_aspire_alumni',
]

// GUARDED fields name people or carry their words. They are returned ONLY to a caller
// who already knows the submitter's email address, which means a returning coordinator
// gets their own prior answers back and a stranger with a unit name gets nothing.
const GUARDED_FIELDS = [
  'submitted_by_name', 'submitted_by_email', 'submitted_by_role',
  'preferred_preceptors', 'considerations', 'reason_for_zero',
  'hiring_new_grads_reason', 'aspire_alumni_notes',
]

// submitted_by_email is read for the match itself and is in GUARDED, so it is returned
// only once the caller has proved they already have it.
const RESPONSE_FIELDS = [...OPEN_FIELDS, ...GUARDED_FIELDS]

// Projections. Every field in a response is named here, so a column added to
// unit_cohort_responses later cannot reach a caller by default.
export function projectOpen(row) {
  return {
    response_status:              row.response_status,
    slots_offered:                row.slots_offered,
    shift_preference:             row.shift_preference,
    hiring_new_grads_ngrp:        row.hiring_new_grads_ngrp,
    has_hired_aspire_alumni:      row.has_hired_aspire_alumni,
    aspire_alumni_outcome:        row.aspire_alumni_outcome,
    would_consider_aspire_alumni: row.would_consider_aspire_alumni,
  }
}

export function projectGuarded(row) {
  return {
    submitted_by_name:       row.submitted_by_name,
    submitted_by_email:      row.submitted_by_email,
    submitted_by_role:       row.submitted_by_role,
    preferred_preceptors:    row.preferred_preceptors,
    considerations:          row.considerations,
    reason_for_zero:         row.reason_for_zero,
    hiring_new_grads_reason: row.hiring_new_grads_reason,
    aspire_alumni_notes:     row.aspire_alumni_notes,
  }
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

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const unitName = typeof body.unit_name === 'string' ? body.unit_name.trim() : ''
  if (!unitName || unitName.length > 200) {
    return res.status(400).json({ error: 'invalid_request', field: 'unit_name', message: 'A unit name is required.' })
  }
  // Optional. Present once the coordinator has typed their address; absent on the
  // first lookup when they pick their unit.
  const submitterEmail = typeof body.submitter_email === 'string' ? body.submitter_email.trim() : ''

  const db = getDb()

  if (!(await consumePublicRateLimit(db, req, UNIT_LOOKUP_LIMITS))) {
    return res.status(429).json({ error: 'rate_limited', message: TOO_MANY_REQUESTS })
  }

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

  // The guarded half is released only to a caller who already knows the address it
  // would disclose. Compared with the same forgiving normalization used everywhere
  // else, so a coordinator is never refused their own row over capitalisation.
  const stored = normalizeEmailForLookup(responseRow.submitted_by_email || '')
  const supplied = normalizeEmailForLookup(submitterEmail)
  const matched = !!stored && !!supplied && stored === supplied

  return res.status(200).json({
    found: true,
    // Tells the form whether typing the submitter's email would reveal more, without
    // revealing whose it is. The form uses it to re-look-up on blur.
    identifying_available: !!stored,
    identifying_included: matched,
    response: matched
      ? { ...projectOpen(responseRow), ...projectGuarded(responseRow) }
      : projectOpen(responseRow),
  })
}
