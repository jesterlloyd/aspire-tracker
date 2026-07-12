// api/portal/unit-participation-submit.js
//
// PHASE3-UNIT-PORTAL: authenticated unit participation submission.
//
// The portal counterpart of the public api/unit-form-submit.js, sharing the
// exact write sequence via api/lib/unitResponseUpsert.js. Differences:
//   - Caller identity is the verified JWT plus profile; submitter name and
//     email come from the PROFILE, never the body.
//   - The unit must be inside the caller's ACTIVE unit_leader scope (with any
//     cohort restriction honored against the accepting cohort).
//   - The public /unit-form stays available during the transition; both paths
//     converge on the same server-side write.

import { verifyPortalCaller, getServiceDb, hasActiveRoleGrant, getActiveUnitScopes } from '../lib/portalAuth.js'
import { resolveAcceptingCohort } from '../lib/intakeStudentLookup.js'
import { performUnitResponseUpsert } from '../lib/unitResponseUpsert.js'

const ALLOWED_BODY_KEYS = [
  'unit_name', 'submitter_role',
  'slots_offered', 'shift_preference', 'preferred_preceptors', 'considerations',
  'reason_for_zero', 'hiring_ngrp', 'hiring_ngrp_reason',
  'has_fired_alumni', 'alumni_outcome', 'alumni_notes', 'would_consider_alumni',
]

const str = (v) => (typeof v === 'string' ? v.trim() : '')

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
    return res.status(500).json({ error: 'internal_error' })
  }

  const auth = await verifyPortalCaller(req)
  if (!auth.authenticated) {
    return res.status(auth.status === 403 ? 403 : 401).json({ error: auth.status === 403 ? 'forbidden' : 'unauthorized' })
  }

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const unexpected = Object.keys(body).filter(k => !ALLOWED_BODY_KEYS.includes(k))
  if (unexpected.length > 0) {
    return res.status(400).json({ error: 'invalid_request', field: unexpected[0], message: 'Unexpected field.' })
  }

  const db = getServiceDb()

  // ── Authorization: active unit_leader grant plus unit in scope ─────────────
  const isUnitLeader = await hasActiveRoleGrant(db, auth.profile.id, 'unit_leader')
  if (!isUnitLeader) return res.status(403).json({ error: 'forbidden' })

  const unitName = str(body.unit_name)
  if (!unitName) {
    return res.status(400).json({ error: 'invalid_request', field: 'unit_name', message: 'Unit is required.' })
  }

  const cohortResult = await resolveAcceptingCohort(db)
  if (cohortResult.failure) {
    const { status, ...rest } = cohortResult.failure
    return res.status(status).json(rest)
  }
  const cohortId = cohortResult.cohortId

  const scopes = await getActiveUnitScopes(db, auth.profile.id)
  const scoped = scopes.some(s =>
    s.unit_key === unitName && (s.cohort_id === null || s.cohort_id === cohortId)
  )
  if (!scoped) {
    return res.status(403).json({ error: 'forbidden', message: 'That unit is not in your access scope.' })
  }

  // ── Validation (same rules as the public endpoint) ─────────────────────────
  const submitterRole = str(body.submitter_role)
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

  // Identity from the verified profile, never the body.
  const submitterName  = str(auth.profile.full_name) || 'Unit leader'
  const submitterEmail = str(auth.profile.email)
  if (!submitterEmail) {
    return res.status(500).json({ error: 'internal_error', message: 'Your profile has no email on file. Please contact the ASPIRE team.' })
  }

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
    console.log('[unit-participation-submit] write failed', { code: result.error.code })
    return res.status(result.error.status).json({ error: 'internal_error' })
  }

  console.log('[unit-participation-submit] portal submission accepted', { unitName })
  return res.status(200).json({ success: true, cohort_id: cohortId })
}
