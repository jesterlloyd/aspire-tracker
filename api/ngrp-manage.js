// api/ngrp-manage.js
//
// NGRP-RELEASE-2: the authenticated NGRP MANAGEMENT endpoint - Planning
// configuration plus the staff review/override/confirm actions. The browser
// never touches an ngrp_* table; every action here runs under a verified
// ACTIVE Owner-capability / Admin / Co-Lead caller (the same ngrp_manage
// capability the UI gates on), validates its payload through the pure
// Planning/eligibility cores, and writes through the service role.
//
// Actions (POST { action, ... }):
//   planning                { cycle_id? }             -> setup data for the Planning tab
//   cycle_create            { cycle, source_cohort_ids } -> new residency cohort
//   cycle_update            { cycle_id, cycle }       -> update + guarded status change
//   cycle_set_active        { cycle_id }              -> one-active default switch
//   sources_set             { cycle_id, cohort_ids }  -> replace source mappings
//                             (refused when it would leave an open cycle with zero sources)
//   units_set               { cycle_id, units }       -> replace participating units
//   candidate_review        { candidate_id }          -> latest revision + requirements + link meta
//   eligibility_recalculate { cycle_id? candidate_id? }
//   eligibility_override    { candidate_id, result, reason_category, note }
//   application_confirm     { candidate_id }          -> the ONLY path to Confirmed
//   application_withdraw    { candidate_id }
//   token_revoke            { candidate_id }          -> revoke live link (no resend)
import { getServiceDb } from './lib/portalAuth.js'
import { verifyPortalCaller } from './lib/portalAuth.js'
import { can } from '../lib/server/access.js'
import {
  validateCyclePayload, validateSourceCohortIds, validateCycleUnits,
  openReadiness, validateStatusTransition, FORM_ACTIVE_STATUSES,
} from '../lib/server/ngrpPlanning.js'
import { isMissingNgrpTable } from '../lib/server/ngrpApplicants.js'
import {
  liveAssignmentForCandidate, revokeTokensById, recalculateEligibility,
} from '../lib/server/ngrpTransition.js'
import { recordNgrpAudit } from '../lib/server/ngrpAudit.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = new Set([
  'planning', 'cycle_create', 'cycle_update', 'cycle_set_active', 'sources_set', 'units_set',
  'candidate_review', 'eligibility_recalculate', 'eligibility_override',
  'application_confirm', 'application_withdraw', 'token_revoke',
])
const ELIGIBILITY_VOCAB = ['pending', 'eligible', 'conditionally_eligible', 'not_eligible']
const OVERRIDE_CATEGORIES = ['documentation_verified', 'requirement_waived', 'data_correction', 'other']

async function verifyManageCaller(req) {
  const caller = await verifyPortalCaller(req)
  if (!caller.authenticated) return { ok: false, status: caller.status || 401, reason: caller.reason || 'unauthenticated' }
  if (!can(caller.profile, 'ngrp_manage')) return { ok: false, status: 403, reason: 'ngrp_role_required' }
  return { ok: true, profile: caller.profile }
}

const unprovisioned = res => res.status(200).json({ provisioned: false })
const internal = res => res.status(500).json({ error: 'internal_error' })
const invalid = (res, errors) => res.status(422).json({ error: 'validation_failed', errors })

async function loadCycleBundle(db, cycleId) {
  const cyc = await db.from('ngrp_cycles').select('*').eq('id', cycleId).maybeSingle()
  if (cyc.error) return { error: cyc.error }
  if (!cyc.data) return { notFound: true }
  const [maps, units] = await Promise.all([
    db.from('ngrp_cycle_source_cohorts').select('cohort_id, cohorts ( id, name, start_date )').eq('cycle_id', cycleId),
    db.from('ngrp_cycle_units').select('*').eq('cycle_id', cycleId).order('display_order'),
  ])
  if (maps.error) return { error: maps.error }
  const sourceCohorts = (maps.data || []).map(r => r.cohorts).filter(Boolean)
    .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
  // Units table ships in 20260904000000 - absent means transition features
  // are unprovisioned, but the cycle itself is still manageable.
  let cycleUnits = []
  let unitsProvisioned = true
  if (units.error) {
    if (!isMissingNgrpTable(units.error)) return { error: units.error }
    unitsProvisioned = false
  } else {
    cycleUnits = units.data || []
  }
  const readiness = openReadiness({
    cycle: cyc.data,
    sourceCohortCount: sourceCohorts.length,
    activeUnitCount: cycleUnits.filter(u => u.is_active).length,
  })
  // Canonical unit-name suggestions from the mapped ASPIRE cohorts' existing
  // units rows - reuse of the one unit vocabulary, never a second directory.
  let unitNameSuggestions = []
  if (sourceCohorts.length) {
    const sug = await db.from('units')
      .select('unit_name')
      .in('cohort_id', sourceCohorts.map(c => c.id))
      .order('unit_name')
    if (!sug.error) unitNameSuggestions = [...new Set((sug.data || []).map(u => u.unit_name).filter(Boolean))]
  }
  return { cycle: cyc.data, sourceCohorts, units: cycleUnits, unitsProvisioned, readiness, unitNameSuggestions }
}

async function candidateWithCycle(db, candidateId) {
  const cand = await db.from('ngrp_candidates').select('*').eq('id', candidateId).maybeSingle()
  if (cand.error) return { error: cand.error }
  if (!cand.data) return { notFound: true }
  const cyc = await db.from('ngrp_cycles').select('*').eq('id', cand.data.cycle_id).maybeSingle()
  if (cyc.error || !cyc.data) return { error: cyc.error || new Error('cycle_missing') }
  return { candidate: cand.data, cycle: cyc.data }
}

// Recalculate every candidate in a cycle (bounded: one residency cohort).
async function recalculateCycle(db, cycle, nowIso) {
  const cands = await db.from('ngrp_candidates').select('*').eq('cycle_id', cycle.id)
  if (cands.error) return { ok: false }
  for (const candidate of cands.data || []) {
    await recalculateEligibility(db, { cycle, candidate, nowIso })
  }
  return { ok: true, count: (cands.data || []).length }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const caller = await verifyManageCaller(req)
  if (!caller.ok) return res.status(caller.status).json({ error: caller.reason })
  const actorId = caller.profile.id

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = typeof body.action === 'string' ? body.action : null
  if (!action || !ACTIONS.has(action)) return res.status(400).json({ error: 'invalid_action' })

  const db = getServiceDb()
  const nowIso = new Date().toISOString()

  try {
    // ── planning ────────────────────────────────────────────────────────────
    if (action === 'planning') {
      const cohorts = await db.from('cohorts')
        .select('id, name, status, start_date, created_at')
        .order('created_at', { ascending: false })
      if (cohorts.error) return internal(res)
      const cycleId = typeof body.cycle_id === 'string' && UUID.test(body.cycle_id) ? body.cycle_id : null
      if (!cycleId) return res.status(200).json({ provisioned: true, cycle: null, aspireCohorts: cohorts.data || [] })
      const bundle = await loadCycleBundle(db, cycleId)
      if (bundle.error) {
        return isMissingNgrpTable(bundle.error) ? unprovisioned(res) : internal(res)
      }
      if (bundle.notFound) return res.status(404).json({ error: 'cycle_not_found' })
      return res.status(200).json({
        provisioned: true,
        aspireCohorts: cohorts.data || [],
        cycle: bundle.cycle,
        sourceCohorts: bundle.sourceCohorts,
        units: bundle.units,
        unitsProvisioned: bundle.unitsProvisioned,
        readiness: bundle.readiness,
        unitNameSuggestions: bundle.unitNameSuggestions,
      })
    }

    // ── cycle_create ────────────────────────────────────────────────────────
    if (action === 'cycle_create') {
      const validated = validateCyclePayload(body.cycle)
      if (!validated.ok) return invalid(res, validated.errors)
      const sources = validateSourceCohortIds(body.source_cohort_ids ?? [])
      if (!sources.ok) return invalid(res, sources.errors)
      // A brand-new cycle starts in Planning unless the payload passes the
      // open-readiness guard - and at create time there are no units yet, so
      // a form-active initial status is refused with the honest reasons.
      const transition = validateStatusTransition({
        nextStatus: validated.cycle.status,
        readiness: openReadiness({
          cycle: validated.cycle,
          sourceCohortCount: sources.ids.length,
          activeUnitCount: 0,
        }),
      })
      if (!transition.ok) return invalid(res, transition.errors)

      const inserted = await db.from('ngrp_cycles').insert(validated.cycle).select('*').maybeSingle()
      if (!inserted.data) {
        if (inserted.error && isMissingNgrpTable(inserted.error)) return unprovisioned(res)
        if (inserted.error?.code === '23505') return invalid(res, [{ field: 'name', message: 'A residency cohort with this name already exists.' }])
        return internal(res)
      }
      if (sources.ids.length) {
        const { error } = await db.from('ngrp_cycle_source_cohorts')
          .insert(sources.ids.map(cohort_id => ({ cycle_id: inserted.data.id, cohort_id, created_by_profile_id: actorId })))
        if (error && error.code !== '23505') return internal(res)
      }
      await recordNgrpAudit(db, { eventType: 'cycle_created', cycleId: inserted.data.id, actorProfileId: actorId, metadata: { cycle_name: inserted.data.name, status: inserted.data.status, source_cohort_count: sources.ids.length } })
      if (sources.ids.length) {
        await recordNgrpAudit(db, { eventType: 'source_cohorts_changed', cycleId: inserted.data.id, actorProfileId: actorId, metadata: { source_cohort_count: sources.ids.length } })
      }
      return res.status(200).json({ ok: true, cycle: inserted.data })
    }

    // ── cycle-scoped actions ────────────────────────────────────────────────
    if (['cycle_update', 'cycle_set_active', 'sources_set', 'units_set'].includes(action)) {
      const cycleId = typeof body.cycle_id === 'string' ? body.cycle_id : null
      if (!cycleId || !UUID.test(cycleId)) return res.status(422).json({ error: 'invalid_cycle_id' })
      const bundle = await loadCycleBundle(db, cycleId)
      if (bundle.error) return isMissingNgrpTable(bundle.error) ? unprovisioned(res) : internal(res)
      if (bundle.notFound) return res.status(404).json({ error: 'cycle_not_found' })
      const current = bundle.cycle

      if (action === 'cycle_update') {
        const validated = validateCyclePayload({ ...current, ...body.cycle })
        if (!validated.ok) return invalid(res, validated.errors)
        const transition = validateStatusTransition({
          nextStatus: validated.cycle.status,
          readiness: openReadiness({
            cycle: validated.cycle,
            sourceCohortCount: bundle.sourceCohorts.length,
            activeUnitCount: bundle.units.filter(u => u.is_active).length,
          }),
        })
        if (!transition.ok) return invalid(res, transition.errors)

        const upd = await db.from('ngrp_cycles').update(validated.cycle).eq('id', cycleId).select('*').maybeSingle()
        if (!upd.data) {
          if (upd.error?.code === '23505') return invalid(res, [{ field: 'name', message: 'A residency cohort with this name already exists.' }])
          return internal(res)
        }
        const changed = Object.keys(validated.cycle).filter(k =>
          JSON.stringify(validated.cycle[k] ?? null) !== JSON.stringify(current[k] ?? null))
        await recordNgrpAudit(db, { eventType: 'cycle_updated', cycleId, actorProfileId: actorId, metadata: { cycle_name: upd.data.name, status: upd.data.status, fields_changed: changed } })
        // Config that feeds the engine changed → recalculate the cycle.
        const engineFields = ['qualification_rules', 'application_open_date', 'application_deadline', 'interview_window_start', 'licensure_deadline']
        if (changed.some(f => engineFields.includes(f))) {
          const recalc = await recalculateCycle(db, upd.data, nowIso)
          await recordNgrpAudit(db, { eventType: 'eligibility_calculated', cycleId, actorProfileId: actorId, metadata: { recipient_count: recalc.count || 0 } })
        }
        return res.status(200).json({ ok: true, cycle: upd.data })
      }

      if (action === 'cycle_set_active') {
        // Same discipline as the cohort accepting flag: clear everywhere else
        // FIRST, abort if that fails, then set (partial unique index backs it).
        const clear = await db.from('ngrp_cycles').update({ is_active: false }).neq('id', cycleId)
        if (clear.error) return internal(res)
        const set = await db.from('ngrp_cycles').update({ is_active: true }).eq('id', cycleId).select('*').maybeSingle()
        if (!set.data) {
          if (set.error?.code === '23505') return res.status(409).json({ error: 'another_cycle_active' })
          return internal(res)
        }
        await recordNgrpAudit(db, { eventType: 'cycle_activated', cycleId, actorProfileId: actorId, metadata: { cycle_name: set.data.name } })
        return res.status(200).json({ ok: true, cycle: set.data })
      }

      if (action === 'sources_set') {
        const sources = validateSourceCohortIds(body.cohort_ids)
        if (!sources.ok) return invalid(res, sources.errors)
        if (sources.ids.length === 0 && FORM_ACTIVE_STATUSES.includes(current.status)) {
          return invalid(res, [{ field: 'cohort_ids', message: 'An open residency cohort must keep at least one source ASPIRE cohort. Close it first if the mapping really should be emptied.' }])
        }
        if (sources.ids.length) {
          const found = await db.from('cohorts').select('id').in('id', sources.ids)
          if (found.error) return internal(res)
          if ((found.data || []).length !== sources.ids.length) {
            return invalid(res, [{ field: 'cohort_ids', message: 'One of the cohorts does not exist.' }])
          }
        }
        const del = await db.from('ngrp_cycle_source_cohorts').delete().eq('cycle_id', cycleId)
        if (del.error) return internal(res)
        if (sources.ids.length) {
          const ins = await db.from('ngrp_cycle_source_cohorts')
            .insert(sources.ids.map(cohort_id => ({ cycle_id: cycleId, cohort_id, created_by_profile_id: actorId })))
          if (ins.error && ins.error.code !== '23505') return internal(res)
        }
        await recordNgrpAudit(db, { eventType: 'source_cohorts_changed', cycleId, actorProfileId: actorId, metadata: { source_cohort_count: sources.ids.length } })
        return res.status(200).json({ ok: true })
      }

      if (action === 'units_set') {
        const validated = validateCycleUnits(body.units)
        if (!validated.ok) return invalid(res, validated.errors)
        if (validated.units.filter(u => u.is_active).length === 0 && FORM_ACTIVE_STATUSES.includes(current.status)) {
          return invalid(res, [{ field: 'units', message: 'An open residency cohort must keep at least one active participating unit.' }])
        }
        const del = await db.from('ngrp_cycle_units').delete().eq('cycle_id', cycleId)
        if (del.error) return isMissingNgrpTable(del.error) ? unprovisioned(res) : internal(res)
        if (validated.units.length) {
          const ins = await db.from('ngrp_cycle_units')
            .insert(validated.units.map((u, i) => ({ ...u, display_order: i, cycle_id: cycleId })))
          if (ins.error) return internal(res)
        }
        await recordNgrpAudit(db, { eventType: 'units_changed', cycleId, actorProfileId: actorId, metadata: { unit_count: validated.units.length } })
        return res.status(200).json({ ok: true })
      }
    }

    // ── candidate-scoped actions ────────────────────────────────────────────
    const candidateId = typeof body.candidate_id === 'string' ? body.candidate_id : null
    if (action === 'eligibility_recalculate' && !candidateId) {
      const cycleId = typeof body.cycle_id === 'string' && UUID.test(body.cycle_id) ? body.cycle_id : null
      if (!cycleId) return res.status(422).json({ error: 'invalid_cycle_id' })
      const cyc = await db.from('ngrp_cycles').select('*').eq('id', cycleId).maybeSingle()
      if (cyc.error) return isMissingNgrpTable(cyc.error) ? unprovisioned(res) : internal(res)
      if (!cyc.data) return res.status(404).json({ error: 'cycle_not_found' })
      const recalc = await recalculateCycle(db, cyc.data, nowIso)
      if (!recalc.ok) return internal(res)
      await recordNgrpAudit(db, { eventType: 'eligibility_calculated', cycleId, actorProfileId: actorId, metadata: { recipient_count: recalc.count } })
      return res.status(200).json({ ok: true, recalculated: recalc.count })
    }

    if (!candidateId || !UUID.test(candidateId)) return res.status(422).json({ error: 'invalid_candidate_id' })
    const ctx = await candidateWithCycle(db, candidateId)
    if (ctx.error) return isMissingNgrpTable(ctx.error) ? unprovisioned(res) : internal(res)
    if (ctx.notFound) return res.status(404).json({ error: 'candidate_not_found' })
    const { candidate, cycle } = ctx

    if (action === 'candidate_review') {
      const live = await liveAssignmentForCandidate(db, candidateId)
      if (live.error) return isMissingNgrpTable(live.error) ? unprovisioned(res) : internal(res)
      let latestRevision = null
      let tokens = []
      if (live.assignment) {
        if (live.assignment.revision_count > 0) {
          const rev = await db.from('ngrp_transition_revisions')
            .select('id, revision_number, submitted_at, payload')
            .eq('assignment_id', live.assignment.id)
            .eq('revision_number', live.assignment.revision_count)
            .maybeSingle()
          if (rev.error) return internal(res)
          latestRevision = rev.data
        }
        const toks = await db.from('ngrp_transition_tokens')
          .select('id, token_hash_prefix, created_at, revoked_at, first_used_at')
          .eq('assignment_id', live.assignment.id)
          .order('created_at', { ascending: false })
        if (toks.error) return internal(res)
        tokens = toks.data || []
      }
      const reqs = await db.from('ngrp_candidate_requirements')
        .select('code, status, label, detail, deadline, computed_at')
        .eq('candidate_id', candidateId)
      if (reqs.error && !isMissingNgrpTable(reqs.error)) return internal(res)
      return res.status(200).json({
        provisioned: true,
        candidate,
        assignment: live.assignment,
        latestRevision,
        requirements: reqs.data || [],
        // Link metadata ONLY - hash prefixes, never anything usable as a link.
        tokens,
      })
    }

    if (action === 'eligibility_recalculate') {
      const recalc = await recalculateEligibility(db, { cycle, candidate, nowIso })
      if (!recalc.ok) return internal(res)
      await recordNgrpAudit(db, { eventType: 'eligibility_calculated', cycleId: cycle.id, candidateId, studentId: candidate.student_id, actorProfileId: actorId, metadata: { result: recalc.result, recipient_count: 1 } })
      return res.status(200).json({ ok: true, result: recalc.result })
    }

    if (action === 'eligibility_override') {
      const result = body.result
      const category = body.reason_category
      const note = typeof body.note === 'string' ? body.note.trim() : ''
      if (!ELIGIBILITY_VOCAB.includes(result)) return invalid(res, [{ field: 'result', message: 'Choose a replacement result.' }])
      if (!OVERRIDE_CATEGORIES.includes(category)) return invalid(res, [{ field: 'reason_category', message: 'Choose a reason category.' }])
      if (!note) return invalid(res, [{ field: 'note', message: 'A narrative note is required.' }])
      const upd = await db.from('ngrp_candidates').update({
        eligibility_effective: result,
        eligibility_override_reason: `[${category}] ${note}`.slice(0, 2000),
        eligibility_overridden_by_profile_id: actorId,
        eligibility_overridden_by_name: caller.profile.full_name || null,
        eligibility_overridden_at: nowIso,
      }).eq('id', candidateId).select('eligibility_calculated').maybeSingle()
      if (!upd.data) return internal(res)
      await recordNgrpAudit(db, { eventType: 'eligibility_overridden', cycleId: cycle.id, candidateId, studentId: candidate.student_id, actorProfileId: actorId, metadata: { result, previous_result: upd.data.eligibility_calculated, reason_category: category } })
      return res.status(200).json({ ok: true })
    }

    if (action === 'application_confirm') {
      if (candidate.application_status === 'confirmed') return res.status(200).json({ ok: true, idempotent: true })
      const upd = await db.from('ngrp_candidates').update({
        application_status: 'confirmed', application_confirmed_at: nowIso, application_withdrawn_at: null,
      }).eq('id', candidateId)
      if (upd.error) return internal(res)
      await recordNgrpAudit(db, { eventType: 'application_confirmed', cycleId: cycle.id, candidateId, studentId: candidate.student_id, actorProfileId: actorId })
      return res.status(200).json({ ok: true })
    }

    if (action === 'application_withdraw') {
      if (candidate.application_status === 'withdrawn') return res.status(200).json({ ok: true, idempotent: true })
      const upd = await db.from('ngrp_candidates').update({
        application_status: 'withdrawn', application_withdrawn_at: nowIso,
      }).eq('id', candidateId)
      if (upd.error) return internal(res)
      await recordNgrpAudit(db, { eventType: 'application_withdrawn', cycleId: cycle.id, candidateId, studentId: candidate.student_id, actorProfileId: actorId })
      return res.status(200).json({ ok: true })
    }

    if (action === 'token_revoke') {
      const live = await liveAssignmentForCandidate(db, candidateId)
      if (live.error) return isMissingNgrpTable(live.error) ? unprovisioned(res) : internal(res)
      if (!live.assignment) return res.status(409).json({ error: 'no_live_assignment' })
      const toks = await db.from('ngrp_transition_tokens')
        .select('id, token_hash_prefix').eq('assignment_id', live.assignment.id).is('revoked_at', null)
      if (toks.error) return internal(res)
      const ids = (toks.data || []).map(t => t.id)
      const revoked = await revokeTokensById(db, ids, actorId)
      if (!revoked.ok) return internal(res)
      for (const t of toks.data || []) {
        await recordNgrpAudit(db, { eventType: 'token_revoked', cycleId: cycle.id, candidateId, studentId: candidate.student_id, assignmentId: live.assignment.id, actorProfileId: actorId, metadata: { token_hash_prefix: t.token_hash_prefix } })
      }
      return res.status(200).json({ ok: true, revoked: ids.length })
    }

    return res.status(400).json({ error: 'invalid_action' })
  } catch (err) {
    console.error('[ngrp-manage] unhandled:', err?.message)
    return internal(res)
  }
}
