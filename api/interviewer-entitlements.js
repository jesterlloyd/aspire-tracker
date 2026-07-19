// api/interviewer-entitlements.js
//
// WAVE F-2 (interviewer file access): server-mediated management of interviewer
// cohort entitlements. Active Owner/Admin ONLY. The browser never touches the
// interviewer_cohort_entitlements table directly (RLS grants it no browser
// privilege); every read and write goes through this endpoint under the verified
// caller identity. Interviewers cannot grant or revoke their own entitlement.
//
// Actions (POST { action, ... }):
//   list    { cohort_id? }                          -> { entitlements: [...] }
//   grant   { interviewer_profile_id, cohort_id }   -> { entitlement, idempotent }
//   revoke  { interviewer_profile_id, cohort_id }   -> { revoked, idempotent }
//   restore { interviewer_profile_id, cohort_id }   -> { entitlement, idempotent }
//
// Authorization actor is ALWAYS the verified caller's user_profiles.id; no
// request-body actor is ever trusted. No interviewer name/email/roster matching.

import { getServiceDb } from './lib/portalAuth.js'
import { verifyStaffCaller } from './lib/messagesAuth.js'

const ENTITLEMENTS = 'interviewer_cohort_entitlements'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = new Set(['list', 'grant', 'revoke', 'restore'])

// The target must be an active interviewer ACCOUNT (identity, never a name).
async function verifyInterviewerTarget(db, profileId) {
  const { data, error } = await db
    .from('user_profiles')
    .select('id, role, is_active')
    .eq('id', profileId)
    .maybeSingle()
  if (error) return { ok: false, status: 500, reason: 'target_lookup_failed' }
  if (!data) return { ok: false, status: 404, reason: 'target_not_found' }
  if (String(data.role || '').toLowerCase() !== 'interviewer') {
    return { ok: false, status: 409, reason: 'target_not_interviewer' }
  }
  if (data.is_active === false) return { ok: false, status: 409, reason: 'target_inactive' }
  return { ok: true }
}

async function cohortExists(db, cohortId) {
  const { data, error } = await db.from('cohorts').select('id').eq('id', cohortId).maybeSingle()
  if (error) return { ok: false, status: 500, reason: 'cohort_lookup_failed' }
  if (!data) return { ok: false, status: 404, reason: 'cohort_not_found' }
  return { ok: true }
}

async function findActive(db, interviewerProfileId, cohortId) {
  const { data, error } = await db
    .from(ENTITLEMENTS)
    .select('id, interviewer_profile_id, cohort_id, granted_by_profile_id, granted_at, revoked_at, revoked_by_profile_id')
    .eq('interviewer_profile_id', interviewerProfileId)
    .eq('cohort_id', cohortId)
    .is('revoked_at', null)
    .maybeSingle()
  if (error) return { error }
  return { row: data || null }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const caller = await verifyStaffCaller(req) // active owner/admin only
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason })
  const actorId = caller.profile.id

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = typeof body.action === 'string' ? body.action : null
  if (!action || !ACTIONS.has(action)) return res.status(400).json({ error: 'invalid_action' })

  const db = getServiceDb()

  // ── list ───────────────────────────────────────────────────────────────────
  if (action === 'list') {
    const cohortId = typeof body.cohort_id === 'string' ? body.cohort_id : null
    if (cohortId && !UUID.test(cohortId)) return res.status(422).json({ error: 'invalid_cohort_id' })
    let q = db
      .from(ENTITLEMENTS)
      .select('id, interviewer_profile_id, cohort_id, granted_by_profile_id, granted_at, revoked_at, revoked_by_profile_id')
      .order('granted_at', { ascending: false })
    if (cohortId) q = q.eq('cohort_id', cohortId)
    const { data, error } = await q
    if (error) return res.status(500).json({ error: 'internal_error' })
    return res.status(200).json({ entitlements: data || [] })
  }

  // grant / revoke / restore all need a valid interviewer + cohort pair.
  const interviewerProfileId = typeof body.interviewer_profile_id === 'string' ? body.interviewer_profile_id : ''
  const cohortId = typeof body.cohort_id === 'string' ? body.cohort_id : ''
  if (!UUID.test(interviewerProfileId)) return res.status(422).json({ error: 'invalid_interviewer_profile_id' })
  if (!UUID.test(cohortId)) return res.status(422).json({ error: 'invalid_cohort_id' })

  // ── revoke ───────────────────────────────────────────────────────────────
  if (action === 'revoke') {
    const found = await findActive(db, interviewerProfileId, cohortId)
    if (found.error) return res.status(500).json({ error: 'internal_error' })
    if (!found.row) return res.status(200).json({ revoked: false, idempotent: true }) // nothing active to revoke
    const { error } = await db
      .from(ENTITLEMENTS)
      .update({ revoked_at: new Date().toISOString(), revoked_by_profile_id: actorId })
      .eq('id', found.row.id)
      .is('revoked_at', null)
    if (error) return res.status(500).json({ error: 'internal_error' })
    return res.status(200).json({ revoked: true, idempotent: false })
  }

  // grant / restore both create an active entitlement if one is not present.
  const targetOk = await verifyInterviewerTarget(db, interviewerProfileId)
  if (!targetOk.ok) return res.status(targetOk.status).json({ error: targetOk.reason })
  const cohortOk = await cohortExists(db, cohortId)
  if (!cohortOk.ok) return res.status(cohortOk.status).json({ error: cohortOk.reason })

  const existing = await findActive(db, interviewerProfileId, cohortId)
  if (existing.error) return res.status(500).json({ error: 'internal_error' })
  if (existing.row) return res.status(200).json({ entitlement: existing.row, idempotent: true })

  const { data: inserted, error: insErr } = await db
    .from(ENTITLEMENTS)
    .insert({ interviewer_profile_id: interviewerProfileId, cohort_id: cohortId, granted_by_profile_id: actorId })
    .select('id, interviewer_profile_id, cohort_id, granted_by_profile_id, granted_at, revoked_at, revoked_by_profile_id')
    .single()
  if (insErr) {
    // A concurrent grant may have won the uq_ice_active race; treat as idempotent.
    const retry = await findActive(db, interviewerProfileId, cohortId)
    if (!retry.error && retry.row) return res.status(200).json({ entitlement: retry.row, idempotent: true })
    return res.status(500).json({ error: 'internal_error' })
  }
  return res.status(200).json({ entitlement: inserted, idempotent: false })
}
