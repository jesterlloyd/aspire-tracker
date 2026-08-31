// NGRP-RELEASE-2 (integrity correction): Planning + Transition Form coverage -
// planning validation, atomic planning replacements, the delivery-safe send
// unit of work, token isolation and the token state machine, transactional
// submission with concurrency + failure injection, server-side submission
// completeness, Pacific end-of-day, migration security (explicit service_role
// revokes included), and regressions.
//
// The mutable mock db APPLIES filters and RECORDS inserts/updates/deletes,
// and its rpc() layer models the migration's transactional functions with
// ALL-OR-NOTHING semantics (a failure inside a handler restores the full
// table snapshot), so atomicity, rollback-on-failure, and serial revision
// numbering are exercised for real. Token minting is injected (a
// deterministic fake), so no pepper env is needed and "raw never persisted"
// is assertable.
// Run: node --test test/ngrpPlanningTransition.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  computeEligibility, extractEligibilityFacts, validateQualificationRules,
  resolveLicensureDeadline, DEFAULT_APPLICATION_CHECKLIST,
} from '../lib/server/ngrpEligibility.js'
import {
  validateCyclePayload, validateCycleUnits, validateSourceCohortIds,
  openReadiness, validateStatusTransition,
} from '../lib/server/ngrpPlanning.js'
import {
  effectiveFormClose, isFormClosed, pacificEndOfDay, isRealDate,
  classifySendRecipients, sendOneTransitionForm,
  resolveTokenAssignment, validateSubmission, submitRevision, ensureCandidate,
  recalculateEligibility,
} from '../lib/server/ngrpTransition.js'
import { sanitizeAuditMetadata, NGRP_AUDIT_EVENTS } from '../lib/server/ngrpAudit.js'
import { loadApplicantsPayload, composeCandidateLifecycle, isMissingNgrpFunction } from '../lib/server/ngrpApplicants.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const migration    = read('supabase/migrations/20260904000000_ngrp_planning_transition.sql')
const manageApi    = read('api/ngrp-manage.js')
const sendApi      = read('api/ngrp-transition-send.js')
const publicApi    = read('api/ngrp-transition.js')
const appJsx       = read('src/App.jsx')
const outreachView = read('src/components/connect/OutreachView.jsx')
const sendPanel    = read('src/components/connect/NgrpTransitionSendPanel.jsx')
const registry     = read('src/lib/connect/templateRegistry.js')
const launchCtx    = read('src/lib/connect/launchContext.js')
const applicantsUi = read('src/components/ngrp/ApplicantsTab.jsx')
const drawerUi     = read('src/components/ngrp/ApplicantDrawer.jsx')
const workspaceUi  = read('src/components/ngrp/NgrpWorkspace.jsx')
const planningUi   = read('src/components/ngrp/PlanningTab.jsx')
const formPage     = read('src/pages/NgrpTransitionFormPage.jsx')

// ── Mutable mock db with transactional rpc handlers ─────────────────────────
let idSeq = 0
const nextId = () => `00000000-0000-4000-8000-9${String(++idSeq).padStart(11, '0')}`
const nowIso = () => new Date().toISOString()

function applyFilters(rows, filters) {
  return filters.reduce((acc, f) => {
    const [op, col, a, b] = f
    if (op === 'eq') return acc.filter(r => r[col] === a)
    if (op === 'neq') return acc.filter(r => r[col] !== a)
    if (op === 'in') return acc.filter(r => (a || []).includes(r[col]))
    if (op === 'is' && a === null) return acc.filter(r => r[col] === null || r[col] === undefined)
    if (op === 'not' && a === 'is' && b === null) return acc.filter(r => r[col] !== null && r[col] !== undefined)
    return acc
  }, rows)
}

// A row insert that honors the real schema's unique constraints and any
// injected per-table insertError - used by direct inserts AND rpc handlers,
// so a failure can be injected at any stage of a transactional function.
function insertRow(tables, table, row) {
  if (!tables[table]) tables[table] = { rows: [] }
  const bucket = tables[table]
  if (bucket.insertError) { const e = new Error(bucket.insertError.message || 'insert failed'); e.code = bucket.insertError.code; throw e }
  const r = { id: nextId(), created_at: nowIso(), ...row }
  const dupe =
    (table === 'ngrp_candidates' && bucket.rows.some(x => x.cycle_id === r.cycle_id && x.student_id === r.student_id)) ||
    (table === 'ngrp_transition_assignments' && bucket.rows.some(x => x.candidate_id === r.candidate_id && !x.revoked_at)) ||
    (table === 'ngrp_transition_revisions' && bucket.rows.some(x => x.assignment_id === r.assignment_id && x.revision_number === r.revision_number)) ||
    (table === 'ngrp_transition_deliveries' && bucket.rows.some(x => x.batch_id === r.batch_id && x.candidate_id === r.candidate_id)) ||
    (table === 'ngrp_transition_tokens' && r.status === 'active' && bucket.rows.some(x => x.assignment_id === r.assignment_id && x.status === 'active'))
  if (dupe) { const e = new Error('duplicate key'); e.code = '23505'; throw e }
  bucket.rows.push(r)
  return r
}

// The migration's transactional functions, modeled with the SAME semantics:
// the CURRENT row state is re-read under the "lock" (never the caller's
// stale copy), the deadline is enforced inside, and every write happens
// through insertRow so injected failures abort the whole call.
const RPC_HANDLERS = {
  ngrp_set_candidate_eligibility_tx(tables, { p_candidate_id, p_result, p_reasons, p_requirements, p_revision_id }) {
    const cand = (tables.ngrp_candidates?.rows || []).find(c => c.id === p_candidate_id)
    if (!cand) throw new Error('NGRP_NOT_FOUND')
    cand.eligibility_calculated = p_result
    cand.eligibility_reasons = p_reasons || []
    if (!tables.ngrp_candidate_requirements) tables.ngrp_candidate_requirements = { rows: [] }
    tables.ngrp_candidate_requirements.rows =
      tables.ngrp_candidate_requirements.rows.filter(r => r.candidate_id !== p_candidate_id)
    for (const r of p_requirements || []) {
      insertRow(tables, 'ngrp_candidate_requirements', {
        candidate_id: p_candidate_id, code: r.code, status: r.status, label: r.label,
        detail: r.detail || null, deadline: r.deadline || null,
        computed_from_revision_id: p_revision_id || null, computed_at: nowIso(),
      })
    }
    return { ok: true }
  },
  ngrp_submit_revision_tx(tables, { p_assignment_id, p_payload, p_interest, p_result, p_reasons, p_requirements }) {
    const a = (tables.ngrp_transition_assignments?.rows || []).find(x => x.id === p_assignment_id)
    if (!a || a.revoked_at || a.status === 'pending') throw new Error('NGRP_GONE')
    const cand = (tables.ngrp_candidates?.rows || []).find(c => c.id === a.candidate_id)
    if (!cand) throw new Error('NGRP_GONE')
    const cyc = (tables.ngrp_cycles?.rows || []).find(c => c.id === cand.cycle_id)
    if (!cyc) throw new Error('NGRP_GONE')
    const close = a.deadline_at || (cyc.application_deadline ? pacificEndOfDay(cyc.application_deadline) : null)
    if (close && nowIso() > close) throw new Error('NGRP_CLOSED')
    const next = (a.revision_count || 0) + 1
    const rev = insertRow(tables, 'ngrp_transition_revisions', {
      assignment_id: p_assignment_id, revision_number: next, payload: p_payload, submitted_at: nowIso(),
    })
    Object.assign(a, next === 1
      ? { status: 'submitted', submitted_at: nowIso(), revision_count: next, last_saved_at: nowIso() }
      : { status: 'revised', revised_at: nowIso(), revision_count: next, last_saved_at: nowIso() })
    if (['interested', 'undecided', 'not_interested'].includes(p_interest)) cand.interest = p_interest
    RPC_HANDLERS.ngrp_set_candidate_eligibility_tx(tables, {
      p_candidate_id: cand.id, p_result, p_reasons, p_requirements, p_revision_id: rev.id,
    })
    if (!tables.ngrp_transition_drafts) tables.ngrp_transition_drafts = { rows: [] }
    tables.ngrp_transition_drafts.rows =
      tables.ngrp_transition_drafts.rows.filter(d => d.assignment_id !== p_assignment_id)
    insertRow(tables, 'ngrp_audit_events', {
      event_type: next === 1 ? 'form_submitted' : 'form_revised',
      cycle_id: cyc.id, candidate_id: cand.id, assignment_id: p_assignment_id,
      student_id: cand.student_id, actor_kind: 'alumnus',
      metadata: { revision_number: next, result: p_result },
    })
    return { revision_number: next, submitted_at: nowIso() }
  },
  ngrp_save_draft_tx(tables, { p_assignment_id, p_payload }) {
    const a = (tables.ngrp_transition_assignments?.rows || []).find(x => x.id === p_assignment_id)
    if (!a || a.revoked_at || a.status === 'pending') throw new Error('NGRP_GONE')
    const cand = (tables.ngrp_candidates?.rows || []).find(c => c.id === a.candidate_id)
    const cyc = cand && (tables.ngrp_cycles?.rows || []).find(c => c.id === cand.cycle_id)
    if (!cyc) throw new Error('NGRP_GONE')
    const close = a.deadline_at || (cyc.application_deadline ? pacificEndOfDay(cyc.application_deadline) : null)
    if (close && nowIso() > close) throw new Error('NGRP_CLOSED')
    if (!tables.ngrp_transition_drafts) tables.ngrp_transition_drafts = { rows: [] }
    const existing = tables.ngrp_transition_drafts.rows.find(d => d.assignment_id === p_assignment_id)
    if (existing) { existing.payload = p_payload; existing.saved_at = nowIso() }
    else insertRow(tables, 'ngrp_transition_drafts', { assignment_id: p_assignment_id, payload: p_payload, saved_at: nowIso() })
    if (a.status === 'sent' || a.status === 'opened') {
      a.status = 'in_progress'
      a.opened_at = a.opened_at || nowIso()
    }
    a.last_saved_at = nowIso()
    return { saved_at: nowIso() }
  },
  ngrp_activate_token_tx(tables, { p_token_id, p_actor }) {
    const toks = tables.ngrp_transition_tokens?.rows || []
    const tok = toks.find(t => t.id === p_token_id)
    if (!tok) throw new Error('NGRP_NOT_FOUND')
    const a = (tables.ngrp_transition_assignments?.rows || []).find(x => x.id === tok.assignment_id)
    if (!a || a.revoked_at) throw new Error('NGRP_GONE')
    if (tok.status !== 'pending') throw new Error('NGRP_TOKEN_STATE')
    for (const t of toks) {
      if (t.assignment_id === a.id && t.id !== p_token_id && ['pending', 'active'].includes(t.status)) {
        t.status = 'revoked'; t.revoked_at = nowIso(); t.revoked_by_profile_id = p_actor
      }
    }
    tok.status = 'active'
    let first = false
    if (a.status === 'pending') { first = true; a.status = 'sent'; a.sent_at = nowIso() }
    const cand = (tables.ngrp_candidates?.rows || []).find(c => c.id === a.candidate_id)
    insertRow(tables, 'ngrp_audit_events', {
      event_type: first ? 'form_sent' : 'token_resent',
      cycle_id: cand?.cycle_id || null, candidate_id: cand?.id || null, assignment_id: a.id,
      student_id: cand?.student_id || null, actor_profile_id: p_actor,
      metadata: { token_hash_prefix: tok.token_hash_prefix },
    })
    return { activated: true, first_send: first }
  },
  ngrp_fail_token_tx(tables, { p_token_id, p_actor, p_reason }) {
    const toks = tables.ngrp_transition_tokens?.rows || []
    const tok = toks.find(t => t.id === p_token_id)
    if (!tok) throw new Error('NGRP_NOT_FOUND')
    const a = (tables.ngrp_transition_assignments?.rows || []).find(x => x.id === tok.assignment_id)
    if (!a) throw new Error('NGRP_GONE')
    if (tok.status === 'pending') { tok.status = 'failed'; tok.failed_reason = p_reason || 'failed' }
    let revoked = false
    const anyActive = toks.some(t => t.assignment_id === a.id && t.status === 'active')
    if (!a.revoked_at && a.status === 'pending' && (a.revision_count || 0) === 0 && !anyActive) {
      a.revoked_at = nowIso(); a.revoked_by_profile_id = p_actor; a.revoked_reason = p_reason || 'delivery_failed'
      revoked = true
    }
    return { failed: true, assignment_revoked: revoked }
  },
  ngrp_cycle_create_tx(tables, { p_cycle, p_source_cohort_ids, p_actor }) {
    const ids = p_source_cohort_ids || []
    const known = new Set((tables.cohorts?.rows || []).map(c => c.id))
    if (ids.some(id => !known.has(id))) throw new Error('NGRP_UNKNOWN_COHORT')
    const cycle = insertRow(tables, 'ngrp_cycles', { ...p_cycle, is_active: false })
    for (const cohort_id of ids) {
      insertRow(tables, 'ngrp_cycle_source_cohorts', { cycle_id: cycle.id, cohort_id, created_by_profile_id: p_actor })
    }
    insertRow(tables, 'ngrp_audit_events', {
      event_type: 'cycle_created', cycle_id: cycle.id, actor_profile_id: p_actor,
      metadata: { cycle_name: cycle.name, status: cycle.status, source_cohort_count: ids.length },
    })
    return cycle
  },
  ngrp_cycle_set_active_tx(tables, { p_cycle_id, p_actor }) {
    const rows = tables.ngrp_cycles?.rows || []
    const target = rows.find(c => c.id === p_cycle_id)
    if (!target) throw new Error('NGRP_NOT_FOUND')
    for (const c of rows) if (c.id !== p_cycle_id) c.is_active = false
    target.is_active = true
    insertRow(tables, 'ngrp_audit_events', {
      event_type: 'cycle_activated', cycle_id: p_cycle_id, actor_profile_id: p_actor,
      metadata: { cycle_name: target.name },
    })
    return { ...target }
  },
  ngrp_sources_set_tx(tables, { p_cycle_id, p_cohort_ids, p_actor }) {
    if (!(tables.ngrp_cycles?.rows || []).some(c => c.id === p_cycle_id)) throw new Error('NGRP_NOT_FOUND')
    const ids = p_cohort_ids || []
    const known = new Set((tables.cohorts?.rows || []).map(c => c.id))
    if (ids.some(id => !known.has(id))) throw new Error('NGRP_UNKNOWN_COHORT')
    if (!tables.ngrp_cycle_source_cohorts) tables.ngrp_cycle_source_cohorts = { rows: [] }
    tables.ngrp_cycle_source_cohorts.rows =
      tables.ngrp_cycle_source_cohorts.rows.filter(m => m.cycle_id !== p_cycle_id)
    for (const cohort_id of ids) {
      insertRow(tables, 'ngrp_cycle_source_cohorts', { cycle_id: p_cycle_id, cohort_id, created_by_profile_id: p_actor })
    }
    insertRow(tables, 'ngrp_audit_events', {
      event_type: 'source_cohorts_changed', cycle_id: p_cycle_id, actor_profile_id: p_actor,
      metadata: { source_cohort_count: ids.length },
    })
    return { count: ids.length }
  },
  ngrp_units_set_tx(tables, { p_cycle_id, p_units, p_actor }) {
    if (!(tables.ngrp_cycles?.rows || []).some(c => c.id === p_cycle_id)) throw new Error('NGRP_NOT_FOUND')
    if (!tables.ngrp_cycle_units) tables.ngrp_cycle_units = { rows: [] }
    tables.ngrp_cycle_units.rows = tables.ngrp_cycle_units.rows.filter(u => u.cycle_id !== p_cycle_id)
    ;(p_units || []).forEach((u, i) => insertRow(tables, 'ngrp_cycle_units', { ...u, display_order: i, cycle_id: p_cycle_id }))
    insertRow(tables, 'ngrp_audit_events', {
      event_type: 'units_changed', cycle_id: p_cycle_id, actor_profile_id: p_actor,
      metadata: { unit_count: (p_units || []).length },
    })
    return { count: (p_units || []).length }
  },
}

// insert/update/delete mutate tables[t].rows; every write is journaled.
// rpc() runs a handler against the live tables under an ALL-OR-NOTHING
// contract: any thrown failure restores the pre-call snapshot in full.
function mutableDb(tables, journal = []) {
  const t = name => { if (!tables[name]) tables[name] = { rows: [] }; return tables[name] }
  const db = {
    journal,
    tables,
    rpcErrors: {},
    async rpc(name, args) {
      journal.push({ op: 'rpc', name, args })
      if (db.rpcErrors[name]) return { data: null, error: db.rpcErrors[name] }
      const handler = RPC_HANDLERS[name]
      if (!handler) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } }
      // Snapshot ROWS only (bucket objects may carry injected error
      // functions, which structuredClone cannot copy) - buckets keep their
      // identity so injections survive a rollback.
      const snapshot = {}
      for (const [k, v] of Object.entries(tables)) snapshot[k] = { bucket: v, rows: structuredClone(v.rows) }
      try {
        const data = handler(tables, args)
        return { data, error: null }
      } catch (err) {
        for (const k of Object.keys(tables)) { if (!snapshot[k]) delete tables[k] }
        for (const [k, s] of Object.entries(snapshot)) { tables[k] = s.bucket; s.bucket.rows = s.rows }
        return { data: null, error: { code: err.code, message: err.message } }
      }
    },
    from(table) {
      const filters = []
      let pendingInsert = null
      let pendingUpdate = null
      let pendingDelete = false
      const finish = () => {
        const bucket = t(table)
        if (bucket.error) return { data: null, error: bucket.error }
        if (pendingInsert) {
          if (bucket.insertError) return { data: null, error: bucket.insertError }
          const rows = []
          for (const src of Array.isArray(pendingInsert) ? pendingInsert : [pendingInsert]) {
            try {
              rows.push(insertRow(tables, table, src))
            } catch (err) {
              return { data: null, error: { code: err.code, message: err.message } }
            }
            journal.push({ op: 'insert', table, row: rows[rows.length - 1] })
          }
          return { data: rows, error: null }
        }
        if (pendingUpdate) {
          // updateError may be a predicate on the patch, so a failure can be
          // injected at ONE specific update (e.g. only the final accepted
          // settle) while earlier updates on the same table succeed.
          const updErr = typeof bucket.updateError === 'function' ? bucket.updateError(pendingUpdate) : bucket.updateError
          if (updErr) return { data: null, error: updErr }
          const hit = applyFilters(bucket.rows, filters)
          for (const r of hit) { Object.assign(r, pendingUpdate); journal.push({ op: 'update', table, id: r.id, patch: { ...pendingUpdate } }) }
          return { data: hit, error: null }
        }
        if (pendingDelete) {
          const hit = new Set(applyFilters(bucket.rows, filters).map(r => r.id))
          bucket.rows = bucket.rows.filter(r => !hit.has(r.id))
          journal.push({ op: 'delete', table, count: hit.size })
          return { data: null, error: null }
        }
        return { data: applyFilters(bucket.rows, filters).map(r => ({ ...r })), error: null }
      }
      const b = {
        select: () => b,
        order: () => b,
        insert: rows => { pendingInsert = rows; return b },
        update: patch => { pendingUpdate = patch; return b },
        delete: () => { pendingDelete = true; return b },
        eq: (c, v) => { filters.push(['eq', c, v]); return b },
        neq: (c, v) => { filters.push(['neq', c, v]); return b },
        in: (c, v) => { filters.push(['in', c, v]); return b },
        not: (c, op2, v) => { filters.push(['not', c, op2, v]); return b },
        maybeSingle: async () => { const r = finish(); return { data: r.error ? null : ((r.data || [])[0] ?? null), error: r.error } },
        single: async () => { const r = finish(); return { data: r.error ? null : ((r.data || [])[0] ?? null), error: r.error } },
        then: (res, rej) => Promise.resolve(finish()).then(res, rej),
      }
      b.is = (c, v) => { filters.push(v === null ? ['is', c, null] : ['eq', c, v]); return b }
      return b
    },
  }
  return db
}

// deterministic injected token mint
let mintSeq = 0
const fakeGenerateToken = () => {
  mintSeq += 1
  const raw = `RAWTOKEN_${mintSeq}_${'x'.repeat(30)}`
  return { raw, hash: `hash_${mintSeq}`, hashPrefix: `hp_${mintSeq}` }
}

const CYCLE = {
  id: 'cccccccc-0000-4000-8000-000000000001', name: 'January 2027',
  status: 'Application Open', application_open_date: '2026-09-01',
  application_deadline: '2026-10-15', interview_window_start: '2026-11-02',
  interview_window_end: '2026-11-13', licensure_deadline: null,
  residency_start_date: '2027-01-25', qualification_rules: {}, application_checklist: [],
}
// 2026-10-15 is a PDT date: Pacific end-of-day is 06:59:59.999Z on the 16th.
const CYCLE_CLOSE = '2026-10-16T06:59:59.999Z'
const STUDENT = { id: 'a0000000-0000-4000-8000-00000000s001', status: 'Completed', has_email: true, email: 's1@x.test', first_name: 'Ada', last_name: 'L', name: 'Ada L' }
const okSend = async () => ({ ok: true, providerId: 'prov-1' })
const failSend = async () => ({ ok: false, reason: 'provider_rejected' })
const buildEmail = () => ({ subject: 'Your NGRP Transition Form', html: '<p>hi</p>' })

// Each logical send gets its own batch id by default (the product rule: a
// deliberate re-attempt is a NEW batch); replay tests pass the same batchId
// explicitly.
let batchSeq = 0
function sendCtx(db, overrides = {}) {
  return {
    db, cycle: CYCLE, student: STUDENT, candidate: null, assignment: null,
    actorProfileId: 'prof-1', generateToken: fakeGenerateToken,
    sendEmail: okSend, buildEmail, baseUrl: 'https://app.test',
    batchId: `batch-${++batchSeq}`, ...overrides,
  }
}

// A sendEmail spy that records every provider call (to prove replays never
// mail again, and that one idempotency key never carries two bodies).
function spySend() {
  const calls = []
  const fn = async ({ to, subject, html, idempotencyKey }) => {
    calls.push({ to, subject, html, idempotencyKey })
    return { ok: true, providerId: `prov-${calls.length}` }
  }
  fn.calls = calls
  return fn
}
const buildEmailWithUrl = ({ url }) => ({ subject: 'Your NGRP Transition Form', html: `<a href="${url}">Open</a>` })
const assertOneBodyPerKey = calls => {
  const seen = new Map()
  for (const c of calls) {
    if (seen.has(c.idempotencyKey)) {
      assert.equal(seen.get(c.idempotencyKey), c.html, 'one idempotency key must never carry two different bodies')
    } else seen.set(c.idempotencyKey, c.html)
  }
}

const sendDb = (extra = {}) => mutableDb({ ngrp_cycles: { rows: [structuredClone(CYCLE)] }, ...extra })

// A COMPLETE valid submission payload (server-side completeness now requires
// every engine fact, so tests build on this and knock pieces out).
const COMPLETE_FORM = {
  identity: { preferred_email: 'ada@x.test', preferred_phone: '', cs_employment_status: 'per_diem' },
  education: { school: 'CSUN', program: 'ABSN', degree_type: 'BSN', completion_date: '2026-08-01', gpa: 3.5, us_accredited: true },
  aspire: { aspire_cohort: 'Summer 2026', precepted_unit: '6 South', rotation_hours: 180, prior_ngrp_applied: false },
  licensure: {
    ca_rn_status: 'active', license_number: 'RN-12345', paid_rn_months: 2,
    bls_status: 'active', bls_issuer: 'AHA', bls_expiration: '2027-06-01', acls_required: false,
  },
  residency_interest: { interest: 'interested', unit_preferences: ['5 SCCT', 'NICU', '6 South'] },
  attestation: { accurate: true, consent_followup: true },
}
const UNITS3 = ['5 SCCT', 'NICU', '6 South']
const form = (over = {}) => {
  const out = structuredClone(COMPLETE_FORM)
  for (const [section, patch] of Object.entries(over)) out[section] = { ...out[section], ...patch }
  return out
}
const vs = (payload, opts = {}) => validateSubmission(payload, { activeUnitNames: UNITS3, requireComplete: true, ...opts })

// ── Planning validation ──────────────────────────────────────────────────────

test('planning: cycle payload validation enforces name, vocabulary, and date order', () => {
  assert.equal(validateCyclePayload({ name: 'January 2027' }).ok, true)
  assert.equal(validateCyclePayload({ name: '' }).ok, false)
  assert.equal(validateCyclePayload({ name: 'X', status: 'Open Sesame' }).ok, false)
  const badDates = validateCyclePayload({ name: 'X', application_open_date: '2026-09-01', application_deadline: '2026-08-01' })
  assert.equal(badDates.ok, false)
  assert.ok(badDates.errors.some(e => e.field === 'application_deadline'))
  const badWin = validateCyclePayload({ name: 'X', interview_window_start: '2026-11-10', interview_window_end: '2026-11-01' })
  assert.ok(badWin.errors.some(e => e.field === 'interview_window_end'))
  // rules/checklist/benchmarks normalize to canonical shapes
  const ok = validateCyclePayload({ name: 'X', qualification_rules: { gpa_min: 99 }, application_checklist: 'nope', retention_benchmarks: { traditional_pct: 250 } })
  assert.equal(ok.cycle.qualification_rules.gpa_min, 3.0)
  assert.equal(ok.cycle.application_checklist.length, DEFAULT_APPLICATION_CHECKLIST.length)
  assert.equal(ok.cycle.retention_benchmarks.traditional_pct, null)
})

test('planning: unit validation rejects duplicates and invalid capacity; source ids dedupe and validate', () => {
  assert.equal(validateCycleUnits([{ unit_name: '5 SCCT' }, { unit_name: '5 scct' }]).ok, false)
  assert.equal(validateCycleUnits([{ unit_name: '5 SCCT', capacity: -1 }]).ok, false)
  const ok = validateCycleUnits([{ unit_name: '5 SCCT', capacity: '4' }, { unit_name: 'NICU', is_active: false }])
  assert.equal(ok.ok, true)
  assert.equal(ok.units[0].capacity, 4)
  assert.equal(ok.units[1].is_active, false)
  const ids = validateSourceCohortIds(['a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'])
  assert.equal(ids.ok, true)
  assert.equal(ids.ids.length, 1, 'mapping is a set - duplicates dedupe')
  assert.equal(validateSourceCohortIds(['nope']).ok, false)
})

test('planning: readiness names every blocking reason and gates form-active statuses', () => {
  const notReady = openReadiness({ cycle: { name: 'X' }, sourceCohortCount: 0, activeUnitCount: 0 })
  assert.equal(notReady.ok, false)
  assert.equal(notReady.reasons.length, 3, 'deadline + sources + units all reported')
  const gate = validateStatusTransition({ nextStatus: 'Application Open', readiness: notReady })
  assert.equal(gate.ok, false)
  const ready = openReadiness({ cycle: { application_deadline: '2026-10-15' }, sourceCohortCount: 2, activeUnitCount: 3 })
  assert.equal(ready.ok, true)
  assert.equal(validateStatusTransition({ nextStatus: 'Application Open', readiness: ready }).ok, true)
  assert.equal(validateStatusTransition({ nextStatus: 'Planning', readiness: notReady }).ok, true, 'non-form statuses are never blocked')
})

test('planning: endpoint order and guards (first cohort, scope guard, status action)', () => {
  // planning action works with NO cycle (first-time setup data).
  assert.match(manageApi, /if \(!cycleId\) return res\.status\(200\)\.json\(\{ provisioned: true, cycle: null, aspireCohorts/)
  assert.match(manageApi, /another_cycle_active/)
  // an open cycle cannot be left with zero sources or zero active units.
  assert.match(manageApi, /must keep at least one source ASPIRE cohort/)
  assert.match(manageApi, /must keep at least one active participating unit/)
  // engine-feeding config changes trigger a cycle recalculation.
  assert.match(manageApi, /engineFields = \['qualification_rules', 'application_open_date', 'application_deadline', 'interview_window_start', 'licensure_deadline'\]/)
  // Planning UI: no auto-open, explicit confirm for form-active statuses.
  assert.match(planningUi, /Status is an explicit staff action/)
  assert.match(planningUi, /Opening a residency cohort makes Transition Form sends possible/)
})

test('planning ATOMICITY: replacement operations run through transactional rpc functions, never delete-then-insert requests', () => {
  assert.match(manageApi, /rpc\('ngrp_cycle_create_tx'/)
  assert.match(manageApi, /rpc\('ngrp_cycle_set_active_tx'/)
  assert.match(manageApi, /rpc\('ngrp_sources_set_tx'/)
  assert.match(manageApi, /rpc\('ngrp_units_set_tx'/)
  // No separate delete+insert (or clear+set) requests remain in the endpoint.
  assert.doesNotMatch(manageApi, /ngrp_cycle_source_cohorts'\)[\s\S]{0,80}\.delete\(/)
  assert.doesNotMatch(manageApi, /ngrp_cycle_units'\)[\s\S]{0,80}\.delete\(/)
  assert.doesNotMatch(manageApi, /update\(\{ is_active: false \}\)/)
  // The SQL functions lock the cycle row and validate ids before writing.
  for (const fn of ['ngrp_cycle_set_active_tx', 'ngrp_sources_set_tx', 'ngrp_units_set_tx', 'ngrp_submit_revision_tx', 'ngrp_save_draft_tx', 'ngrp_activate_token_tx', 'ngrp_fail_token_tx']) {
    const body = migration.slice(migration.indexOf(`FUNCTION public.${fn}`))
    assert.match(body.slice(0, 2500), /FOR UPDATE/, `${fn} locks its row`)
  }
  const createBody = migration.slice(migration.indexOf('FUNCTION public.ngrp_cycle_create_tx'))
  assert.ok(createBody.indexOf('NGRP_UNKNOWN_COHORT') < createBody.indexOf('INSERT INTO public.ngrp_cycles'),
    'cohort ids are validated BEFORE the cycle row exists')
  // Audit events are written inside the same transactions.
  for (const [fn, ev] of [['ngrp_cycle_create_tx', 'cycle_created'], ['ngrp_cycle_set_active_tx', 'cycle_activated'], ['ngrp_sources_set_tx', 'source_cohorts_changed'], ['ngrp_units_set_tx', 'units_changed']]) {
    const body = migration.slice(migration.indexOf(`FUNCTION public.${fn}`), migration.indexOf(`FUNCTION public.${fn}`) + 3200)
    assert.match(body, new RegExp(`'${ev}'`), `${fn} audits in-transaction`)
  }
})

test('planning ATOMICITY: failures roll back in full - original mappings, units, and active flag survive', async () => {
  const A = 'a0000000-0000-4000-8000-00000000c00a'
  const base = () => mutableDb({
    cohorts: { rows: [{ id: A, name: 'Summer 2026' }] },
    ngrp_cycles: { rows: [{ ...structuredClone(CYCLE), is_active: true }, { id: 'cy-2', name: 'August 2027', is_active: false }] },
    ngrp_cycle_source_cohorts: { rows: [{ id: 'm1', cycle_id: CYCLE.id, cohort_id: A }] },
    ngrp_cycle_units: { rows: [{ id: 'u1', cycle_id: CYCLE.id, unit_name: '5 SCCT', is_active: true }] },
  })

  // Unknown cohort id: no cycle row is created at all (validated first).
  const db1 = base()
  const bad = await db1.rpc('ngrp_cycle_create_tx', { p_cycle: { name: 'X', status: 'Planning' }, p_source_cohort_ids: ['a0000000-0000-4000-8000-00000000dead'], p_actor: 'p1' })
  assert.match(bad.error.message, /NGRP_UNKNOWN_COHORT/)
  assert.equal(db1.tables.ngrp_cycles.rows.length, 2, 'no orphan cycle')

  // Mid-replace insert failure: the ORIGINAL mapping survives untouched.
  const db2 = base()
  db2.tables.ngrp_cycle_source_cohorts.insertError = { message: 'boom' }
  const srcFail = await db2.rpc('ngrp_sources_set_tx', { p_cycle_id: CYCLE.id, p_cohort_ids: [A], p_actor: 'p1' })
  assert.ok(srcFail.error)
  assert.deepEqual(db2.tables.ngrp_cycle_source_cohorts.rows.map(m => m.id), ['m1'], 'original mapping restored')

  // Mid-replace unit failure: the ORIGINAL unit list survives untouched.
  const db3 = base()
  db3.tables.ngrp_cycle_units.insertError = { message: 'boom' }
  const unitFail = await db3.rpc('ngrp_units_set_tx', { p_cycle_id: CYCLE.id, p_units: [{ unit_name: 'NICU' }], p_actor: 'p1' })
  assert.ok(unitFail.error)
  assert.deepEqual(db3.tables.ngrp_cycle_units.rows.map(u => u.unit_name), ['5 SCCT'], 'original units restored')

  // Active-switch failure (audit write dies): the PREVIOUS active flag survives.
  const db4 = base()
  db4.tables.ngrp_audit_events = { rows: [], insertError: { message: 'boom' } }
  const actFail = await db4.rpc('ngrp_cycle_set_active_tx', { p_cycle_id: 'cy-2', p_actor: 'p1' })
  assert.ok(actFail.error)
  assert.equal(db4.tables.ngrp_cycles.rows.find(c => c.id === CYCLE.id).is_active, true, 'previous active cycle still active')
  assert.equal(db4.tables.ngrp_cycles.rows.find(c => c.id === 'cy-2').is_active, false)

  // Success path: switch + audit land together.
  const db5 = base()
  const actOk = await db5.rpc('ngrp_cycle_set_active_tx', { p_cycle_id: 'cy-2', p_actor: 'p1' })
  assert.equal(actOk.error, null)
  assert.equal(db5.tables.ngrp_cycles.rows.filter(c => c.is_active).length, 1)
  assert.equal(db5.tables.ngrp_audit_events.rows.at(-1).event_type, 'cycle_activated')
})

test('planning: source-mapping changes drive the Applicants scope (same resolver)', async () => {
  const students = [
    { id: 's1', cohort_id: 'A', status: 'Completed', school_email: 'a@x', personal_email: '' },
    { id: 's2', cohort_id: 'B', status: 'Completed', school_email: 'b@x', personal_email: '' },
  ]
  const base = {
    ngrp_cycles: { rows: [CYCLE] },
    students: { rows: students },
    ngrp_candidates: { rows: [] },
    ngrp_residency_outcomes: { rows: [] },
    ngrp_transition_assignments: { rows: [] },
    ngrp_transition_revisions: { rows: [] },
  }
  const mapA = mutableDb({ ...structuredClone(base), ngrp_cycle_source_cohorts: { rows: [{ cycle_id: CYCLE.id, cohort_id: 'A', cohorts: { id: 'A', name: 'Summer 2026', start_date: '2026-05-01' } }] } })
  const mapAB = mutableDb({ ...structuredClone(base), ngrp_cycle_source_cohorts: { rows: [
    { cycle_id: CYCLE.id, cohort_id: 'A', cohorts: { id: 'A', name: 'Summer 2026', start_date: '2026-05-01' } },
    { cycle_id: CYCLE.id, cohort_id: 'B', cohorts: { id: 'B', name: 'Fall 2026', start_date: '2026-09-01' } },
  ] } })
  assert.deepEqual((await loadApplicantsPayload(mapA, CYCLE.id)).students.map(s => s.id), ['s1'])
  assert.deepEqual((await loadApplicantsPayload(mapAB, CYCLE.id)).students.map(s => s.id).sort(), ['s1', 's2'])
})

test('planning: recalculation is honest - partial failure is reported and never audited as success', async () => {
  // cycle_update audits eligibility_calculated ONLY when recalc.ok, and the
  // response carries the recalc report either way.
  const updBlock = manageApi.slice(manageApi.indexOf("action === 'cycle_update'"), manageApi.indexOf("action === 'cycle_set_active'"))
  assert.match(updBlock, /if \(recalc\.ok\) \{/)
  assert.match(updBlock, /recalc: recalcReport/)
  const recalcBlock = manageApi.slice(manageApi.indexOf("action === 'eligibility_recalculate' && !candidateId"), manageApi.indexOf('if (!candidateId ||'))
  assert.match(recalcBlock, /recalculation_failed/)
  assert.ok(recalcBlock.indexOf('recalculation_failed') < recalcBlock.indexOf("recordNgrpAudit"), 'failure returns before the success audit')
  // recalculateCycle checks every candidate result.
  assert.match(manageApi, /if \(!r\.ok\) failed \+= 1/)
  // And the Planning UI surfaces the partial-failure report.
  assert.match(planningUi, /res\.recalc && !res\.recalc\.ok/)
  // recalculateEligibility itself goes through the atomic eligibility rpc.
  const db = mutableDb({
    ngrp_cycles: { rows: [CYCLE] },
    ngrp_candidates: { rows: [{ id: 'cand-1', cycle_id: CYCLE.id, student_id: 's1' }] },
    ngrp_transition_assignments: { rows: [] },
    ngrp_candidate_requirements: { rows: [] },
  })
  const ok = await recalculateEligibility(db, { cycle: CYCLE, candidate: { id: 'cand-1' } })
  assert.equal(ok.ok, true)
  db.rpcErrors.ngrp_set_candidate_eligibility_tx = { message: 'boom' }
  const bad = await recalculateEligibility(db, { cycle: CYCLE, candidate: { id: 'cand-1' } })
  assert.equal(bad.ok, false, 'a failed eligibility write is reported, never swallowed')
})

// ── Pacific end-of-day (the ONE close rule) ──────────────────────────────────

test('close: Pacific end-of-day is DST-aware - PST and PDT dates both close at 11:59:59.999 PM in Los Angeles', () => {
  assert.equal(pacificEndOfDay('2027-01-15'), '2027-01-16T07:59:59.999Z', 'PST: UTC-8')
  assert.equal(pacificEndOfDay('2027-04-15'), '2027-04-16T06:59:59.999Z', 'PDT: UTC-7')
  assert.equal(pacificEndOfDay('2026-10-15'), CYCLE_CLOSE)
  assert.equal(pacificEndOfDay('2026-99-99'), null, 'impossible dates never produce a close')
  assert.equal(effectiveFormClose(CYCLE, { deadline_at: null }), CYCLE_CLOSE)
  assert.equal(effectiveFormClose(CYCLE, { deadline_at: '2026-10-01T12:00:00Z' }), '2026-10-01T12:00:00Z')
  assert.equal(effectiveFormClose({ application_deadline: null }, {}), null)
  // 11 PM Pacific on the deadline date is still open; past midnight is closed.
  assert.equal(isFormClosed(CYCLE, {}, '2026-10-16T06:00:00.000Z'), false)
  assert.equal(isFormClosed(CYCLE, {}, '2026-10-16T07:00:00.000Z'), true)
  // The database enforces the SAME rule (ngrp_pacific_deadline, used by both
  // transactional functions), and every display surface formats in LA time.
  assert.match(migration, /AT TIME ZONE 'America\/Los_Angeles'/)
  const submitFn = migration.slice(migration.indexOf('FUNCTION public.ngrp_submit_revision_tx'))
  assert.match(submitFn.slice(0, 3000), /ngrp_pacific_deadline\(cyc\.application_deadline\)/)
  const saveFn = migration.slice(migration.indexOf('FUNCTION public.ngrp_save_draft_tx'))
  assert.match(saveFn.slice(0, 3000), /ngrp_pacific_deadline\(cyc\.application_deadline\)/)
  assert.match(sendApi, /timeZone: 'America\/Los_Angeles'/)
  assert.match(formPage, /timeZone: 'America\/Los_Angeles'/)
})

// ── Send unit of work (delivery-safe token lifecycle) ────────────────────────

test('send: first send is pending until provider acceptance, then exactly one active token and a sent assignment', async () => {
  const db = sendDb()
  const first = await sendOneTransitionForm(sendCtx(db))
  assert.equal(first.outcome, 'sent')
  assert.equal(db.tables.ngrp_candidates.rows.length, 1)
  assert.equal(db.tables.ngrp_transition_assignments.rows.length, 1)
  assert.equal(db.tables.ngrp_transition_assignments.rows[0].status, 'sent')
  assert.ok(db.tables.ngrp_transition_assignments.rows[0].sent_at, 'sent_at set only at activation')
  assert.equal(db.tables.ngrp_transition_tokens.rows.length, 1)
  assert.equal(db.tables.ngrp_transition_tokens.rows[0].status, 'active')
  assert.equal(db.tables.ngrp_audit_events.rows.at(-1).event_type, 'form_sent', 'audited inside the activation transaction')

  // the durable delivery row is bound to the exact token and fully settled
  const delivery = db.tables.ngrp_transition_deliveries.rows[0]
  assert.equal(delivery.status, 'accepted')
  assert.equal(delivery.token_id, db.tables.ngrp_transition_tokens.rows[0].id, 'bound to the emailed token')
  assert.ok(delivery.provider_accepted_at, 'provider acceptance recorded separately')
  assert.ok(delivery.accepted_at)

  const second = await sendOneTransitionForm(sendCtx(db))
  assert.equal(second.outcome, 'resent')
  assert.equal(db.tables.ngrp_candidates.rows.length, 1, 'no duplicate candidate attempt')
  assert.equal(db.tables.ngrp_transition_assignments.rows.length, 1, 'no duplicate assignment')
  assert.equal(db.tables.ngrp_transition_tokens.rows.length, 2)
  const [oldTok, newTok] = db.tables.ngrp_transition_tokens.rows
  assert.equal(oldTok.status, 'revoked')
  assert.ok(oldTok.revoked_at, 'resend revoked the prior token - but only at activation')
  assert.equal(newTok.status, 'active')
})

test('send: a failed RESEND keeps the old link working - the pending replacement fails, nothing else moves', async () => {
  const db = sendDb()
  await sendOneTransitionForm(sendCtx(db))
  const out = await sendOneTransitionForm(sendCtx(db, { sendEmail: failSend }))
  assert.equal(out.outcome, 'failed')
  const [oldTok, newTok] = db.tables.ngrp_transition_tokens.rows
  assert.equal(oldTok.status, 'active', 'the alumnus still has a working link')
  assert.equal(newTok.status, 'failed')
  assert.equal(db.tables.ngrp_transition_assignments.rows[0].status, 'sent', 'assignment untouched')
  // and the public endpoint still resolves the OLD token, never the failed one
  assert.equal((await resolveTokenAssignment(db, oldTok.token_hash, '2026-09-10T00:00:00Z')).state, 'ok')
  assert.equal((await resolveTokenAssignment(db, newTok.token_hash, '2026-09-10T00:00:00Z')).state, 'unknown')
})

test('send: a failed FIRST delivery never becomes Sent - pending token fails, pending assignment is revoked', async () => {
  const db = sendDb()
  const out = await sendOneTransitionForm(sendCtx(db, { sendEmail: failSend }))
  assert.equal(out.outcome, 'failed')
  assert.equal(db.tables.ngrp_transition_tokens.rows[0].status, 'failed')
  assert.ok(db.tables.ngrp_transition_assignments.rows.every(a => a.revoked_at), 'never-delivered assignment revoked')
  // nothing anywhere reads as Sent: the lifecycle join skips pending/revoked
  const composed = await composeCandidateLifecycle(db, db.tables.ngrp_candidates.rows.map(r => ({ ...r })))
  assert.equal(composed.candidates[0].form_status, undefined, 'roster keeps its not_sent default')
  // a later real send starts clean:
  const retry = await sendOneTransitionForm(sendCtx(db))
  assert.equal(retry.outcome, 'sent')
  assert.equal(db.tables.ngrp_transition_assignments.rows.filter(a => !a.revoked_at).length, 1)
})

test('send: token insert failure leaves the previous link untouched; a leftover pending assignment is retried, not "already sent"', async () => {
  // token insert failure on a resend
  const db = sendDb()
  await sendOneTransitionForm(sendCtx(db))
  db.tables.ngrp_transition_tokens.insertError = { message: 'insert failed' }
  const insFail = await sendOneTransitionForm(sendCtx(db))
  assert.equal(insFail.outcome, 'failed')
  assert.equal(insFail.reason, 'token_write_failed')
  assert.equal(db.tables.ngrp_transition_tokens.rows[0].status, 'active', 'old link untouched')
  assert.equal(db.tables.ngrp_transition_deliveries.rows.at(-1).status, 'failed', 'attempt recorded as failed - never re-armable')
  delete db.tables.ngrp_transition_tokens.insertError

  // a leftover pending FIRST-send assignment is retried, not "already sent"
  const db2 = sendDb({
    ngrp_candidates: { rows: [{ id: 'cand-p', cycle_id: CYCLE.id, student_id: STUDENT.id }] },
    ngrp_transition_assignments: { rows: [{ id: 'asg-p', candidate_id: 'cand-p', status: 'pending', sent_at: null, revision_count: 0, revoked_at: null }] },
  })
  const classified = classifySendRecipients({
    students: [STUDENT],
    candidatesByStudent: new Map([[STUDENT.id, { id: 'cand-p' }]]),
    liveAssignmentsByCandidate: new Map([['cand-p', { id: 'asg-p', status: 'pending' }]]),
    resend: false,
  })
  assert.equal(classified.send.length, 1, 'pending is not already_sent')
  const retried = await sendOneTransitionForm(sendCtx(db2, { candidate: { id: 'cand-p' }, assignment: db2.tables.ngrp_transition_assignments.rows[0] }))
  assert.equal(retried.outcome, 'sent', 'a reused pending assignment still counts as the FIRST send')
  assert.equal(db2.tables.ngrp_transition_assignments.rows.length, 1)
})

test('send REPLAY: provider accepts token A, activation fails - the same batch retries activation of token A with NO second email', async () => {
  const db = sendDb()
  const send = spySend()
  db.rpcErrors.ngrp_activate_token_tx = { message: 'boom' }
  const first = await sendOneTransitionForm(sendCtx(db, { sendEmail: send, buildEmail: buildEmailWithUrl, batchId: 'batch-replay-1' }))
  assert.equal(first.outcome, 'failed')
  assert.equal(first.reason, 'activation_failed')
  assert.equal(first.providerAccepted, true)
  assert.equal(first.recoverable, true)
  assert.equal(send.calls.length, 1)

  const tokenA = db.tables.ngrp_transition_tokens.rows[0]
  assert.equal(tokenA.status, 'pending', 'the emailed token is kept RECOVERABLE - never failed')
  const row = db.tables.ngrp_transition_deliveries.rows[0]
  assert.equal(row.token_id, tokenA.id, 'delivery bound to the exact emailed token before the provider call')
  assert.ok(row.provider_accepted_at, 'provider acceptance recorded separately from activation')
  assert.equal(row.status, 'attempting')

  // the raw token the alumnus actually RECEIVED (from the emailed URL)
  const emailedRaw = /#t=([^"]+)"/.exec(send.calls[0].html)[1]
  const mintN = /^RAWTOKEN_(\d+)_/.exec(emailedRaw)[1]

  delete db.rpcErrors.ngrp_activate_token_tx
  const retry = await sendOneTransitionForm(sendCtx(db, { sendEmail: send, buildEmail: buildEmailWithUrl, batchId: 'batch-replay-1' }))
  assert.equal(retry.outcome, 'sent')
  assert.equal(retry.activatedOnReplay, true)
  assert.equal(send.calls.length, 1, 'Resend called exactly ONCE across attempt + replay')
  assert.equal(db.tables.ngrp_transition_tokens.rows.length, 1, 'no token B was ever minted')
  assert.equal(tokenA.status, 'active', 'the retry activated token A itself')
  assert.equal(tokenA.token_hash, `hash_${mintN}`, 'the hash of the token from the ORIGINAL email is the active one')
  assert.equal((await resolveTokenAssignment(db, tokenA.token_hash, '2026-09-10T00:00:00Z')).state, 'ok', 'the emailed link works')
  assert.equal(db.tables.ngrp_transition_deliveries.rows[0].status, 'accepted')
  assertOneBodyPerKey(send.calls)
})

test('send REPLAY: activation-failure replay on a RESEND keeps the old link live until token A activates, then swaps', async () => {
  const db = sendDb()
  const send = spySend()
  await sendOneTransitionForm(sendCtx(db, { sendEmail: send, buildEmail: buildEmailWithUrl }))
  const originalTok = db.tables.ngrp_transition_tokens.rows[0]

  db.rpcErrors.ngrp_activate_token_tx = { message: 'boom' }
  const resendFail = await sendOneTransitionForm(sendCtx(db, { sendEmail: send, buildEmail: buildEmailWithUrl, batchId: 'batch-replay-2' }))
  assert.equal(resendFail.reason, 'activation_failed')
  assert.equal(originalTok.status, 'active', 'the old link still works while the replacement waits')
  assert.equal(db.tables.ngrp_transition_tokens.rows.at(-1).status, 'pending', 'replacement recoverable, not failed')

  delete db.rpcErrors.ngrp_activate_token_tx
  const replay = await sendOneTransitionForm(sendCtx(db, { sendEmail: send, buildEmail: buildEmailWithUrl, batchId: 'batch-replay-2' }))
  assert.equal(replay.outcome, 'resent')
  assert.equal(send.calls.length, 2, 'attempt + resend attempt - the replay itself never mailed')
  assert.equal(originalTok.status, 'revoked', 'old token swapped out only once its replacement truly activated')
  assert.equal(db.tables.ngrp_transition_tokens.rows.at(-1).status, 'active')
  assertOneBodyPerKey(send.calls)
})

test('send REPLAY: activation succeeded but the ledger settle failed - replay repairs the ledger with no provider call and no new token', async () => {
  const db = sendDb()
  const send = spySend()
  db.tables.ngrp_transition_deliveries = {
    rows: [],
    updateError: patch => (patch.status === 'accepted' ? { message: 'ledger down' } : null),
  }
  const out = await sendOneTransitionForm(sendCtx(db, { sendEmail: send, buildEmail: buildEmailWithUrl, batchId: 'batch-replay-3' }))
  assert.equal(out.outcome, 'sent', 'the email went out and the token activated - truthfully Sent')
  assert.ok(out.warnings.some(w => w.warning === 'delivery_ledger_update_failed'))
  const token = db.tables.ngrp_transition_tokens.rows[0]
  assert.equal(token.status, 'active')
  assert.equal(db.tables.ngrp_transition_deliveries.rows[0].status, 'attempting', 'ledger lagging behind reality')

  delete db.tables.ngrp_transition_deliveries.updateError
  const replay = await sendOneTransitionForm(sendCtx(db, { sendEmail: send, buildEmail: buildEmailWithUrl, batchId: 'batch-replay-3' }))
  assert.equal(replay.outcome, 'repaired')
  assert.equal(send.calls.length, 1, 'the repair made no provider call')
  assert.equal(db.tables.ngrp_transition_tokens.rows.length, 1, 'no replacement token was created')
  assert.equal(token.status, 'active', 'the original token stays active')
  assert.equal(db.tables.ngrp_transition_deliveries.rows[0].status, 'accepted', 'ledger repaired')
})

test('send REPLAY: attempting/failed/accepted rows can never be re-armed and mailed again under the same batch', async () => {
  const mkDb = deliveryRow => sendDb({
    ngrp_candidates: { rows: [{ id: 'cand-1', cycle_id: CYCLE.id, student_id: STUDENT.id }] },
    ngrp_transition_deliveries: { rows: [deliveryRow] },
  })
  const base = { batch_id: 'batch-locked', cycle_id: CYCLE.id, candidate_id: 'cand-1', student_id: STUDENT.id, token_id: null, provider_accepted_at: null }

  // indeterminate attempting (no recorded acceptance)
  const send1 = spySend()
  const db1 = mkDb({ id: 'd-att', ...base, status: 'attempting' })
  const att = await sendOneTransitionForm(sendCtx(db1, { sendEmail: send1, candidate: { id: 'cand-1' }, batchId: 'batch-locked' }))
  assert.equal(att.outcome, 'failed')
  assert.equal(att.reason, 'recovery_required_new_batch')

  // failed
  const db2 = mkDb({ id: 'd-fail', ...base, status: 'failed', failed_reason: 'provider_rejected' })
  const failedRow = await sendOneTransitionForm(sendCtx(db2, { sendEmail: send1, candidate: { id: 'cand-1' }, batchId: 'batch-locked' }))
  assert.equal(failedRow.reason, 'recovery_required_new_batch')

  // accepted
  const db3 = mkDb({ id: 'd-acc', ...base, status: 'accepted', provider_accepted_at: '2026-09-02T00:00:00Z', accepted_at: '2026-09-02T00:00:01Z' })
  const acc = await sendOneTransitionForm(sendCtx(db3, { sendEmail: send1, candidate: { id: 'cand-1' }, batchId: 'batch-locked' }))
  assert.equal(acc.outcome, 'skipped')
  assert.equal(acc.reason, 'already_sent_in_batch')

  assert.equal(send1.calls.length, 0, 'no replay path ever called the provider')
  for (const d of [db1, db2, db3]) {
    assert.equal((d.tables.ngrp_transition_tokens?.rows || []).length, 0, 'no replay path ever minted a token')
    assert.equal(d.tables.ngrp_transition_deliveries.rows[0].status !== 'attempting' || d.tables.ngrp_transition_deliveries.rows[0].id === 'd-att', true)
  }

  // a DELIBERATE new batch performs a real new send: new token, new key
  const fresh = await sendOneTransitionForm(sendCtx(db1, { sendEmail: send1, buildEmail: buildEmailWithUrl, candidate: { id: 'cand-1' }, batchId: 'batch-new' }))
  assert.equal(fresh.outcome, 'sent')
  assert.equal(send1.calls.length, 1)
  assert.match(send1.calls[0].idempotencyKey, /batch-new/)
  assert.equal(db1.tables.ngrp_transition_tokens.rows.length, 1, 'the new batch minted its own token')
  assert.equal(db1.tables.ngrp_transition_deliveries.rows.length, 2, 'a second, separate delivery row')
})

test('send REPLAY: two batches never share an idempotency key, and each key maps to exactly one token body', async () => {
  const db = sendDb()
  const send = spySend()
  await sendOneTransitionForm(sendCtx(db, { sendEmail: send, buildEmail: buildEmailWithUrl, batchId: 'batch-k1' }))
  await sendOneTransitionForm(sendCtx(db, { sendEmail: send, buildEmail: buildEmailWithUrl, batchId: 'batch-k2' }))
  assert.equal(send.calls.length, 2)
  assert.notEqual(send.calls[0].idempotencyKey, send.calls[1].idempotencyKey)
  assert.notEqual(send.calls[0].html, send.calls[1].html, 'different tokens ride different keys')
  assertOneBodyPerKey(send.calls)
  // the replay path is structurally incapable of mailing or minting:
  const coreSrc = read('lib/server/ngrpTransition.js')
  const resumeFn = coreSrc.slice(coreSrc.indexOf('async function resumeDeliveryAttempt'))
  assert.doesNotMatch(resumeFn.slice(0, resumeFn.indexOf('// ── Public form resolution')), /sendEmail|generateToken/)
})

test('send: raw tokens are never persisted, returned, or derivable from what is stored', async () => {
  const db = sendDb()
  const out = await sendOneTransitionForm(sendCtx(db))
  const stored = JSON.stringify(db.tables)
  assert.doesNotMatch(stored, /RAWTOKEN_/, 'no table row carries a raw token')
  assert.doesNotMatch(JSON.stringify(out), /RAWTOKEN_/, 'the outcome never carries a raw token')
  assert.equal(out.tokenHashPrefix?.startsWith('hp_'), true, 'only the hash prefix surfaces')
  // and the endpoint layer never echoes tokens either
  assert.doesNotMatch(sendApi, /rawToken|\.raw\b/)
  assert.match(sendApi, /token_hash_prefix: outcome\.tokenHashPrefix/)
})

test('send: classification skips missing-email / non-completed / already-sent (without resend)', () => {
  const students = [
    { id: 's1', status: 'Completed', has_email: true },
    { id: 's2', status: 'Completed', has_email: false },
    { id: 's3', status: 'Active Rotation', has_email: true },
    { id: 's4', status: 'Completed', has_email: true },
  ]
  const candidatesByStudent = new Map([['s4', { id: 'c4' }]])
  const liveAssignmentsByCandidate = new Map([['c4', { id: 'a4', status: 'sent' }]])
  const noResend = classifySendRecipients({ students, candidatesByStudent, liveAssignmentsByCandidate, resend: false })
  assert.deepEqual(noResend.send.map(x => x.student.id), ['s1'])
  assert.deepEqual(noResend.skipped.map(x => [x.student.id, x.reason]), [['s2', 'missing_email'], ['s3', 'not_completed'], ['s4', 'already_sent']])
  const withResend = classifySendRecipients({ students, candidatesByStudent, liveAssignmentsByCandidate, resend: true })
  assert.deepEqual(withResend.reissue.map(x => x.student.id), ['s4'])
})

test('send: endpoint gates - no request-body recipients, typed confirmation, cap, readiness, durable idempotency', () => {
  assert.match(sendApi, /'email' in body \|\| 'to' in body \|\| 'cc' in body \|\| 'bcc' in body/)
  assert.match(sendApi, /body\.confirmation !== CONFIRMATION/)
  assert.match(sendApi, /too_many_recipients/)
  assert.match(sendApi, /cycle_not_ready/)
  assert.match(sendApi, /already_sent_in_batch/)
  assert.ok(sendApi.indexOf('verifyPortalCaller(req)') < sendApi.indexOf('getServiceDb()'))
  assert.match(sendApi, /can\(caller\.profile, 'ngrp_manage'\)/)
  // recipients resolve from the db (mapped cohorts + Completed), never the request
  assert.match(sendApi, /\.in\('cohort_id', cohortIds\)/)
  // send copy discipline: the user-facing phrase "Invited to Apply" never appears
  assert.doesNotMatch(sendApi, /Invited to Apply/)
  assert.match(sendApi, /not an application to the/)
})

test('send: idempotency is DURABLE - fail-closed probe, claim + bind before mail, accepted rows skip, one key per token', () => {
  const coreSrc = read('lib/server/ngrpTransition.js')
  // The probe reads ngrp_transition_deliveries and FAILS CLOSED on error.
  assert.match(sendApi, /from\('ngrp_transition_deliveries'\)/)
  assert.match(sendApi, /idempotency_probe_failed/)
  assert.ok(sendApi.indexOf('idempotency_probe_failed') < sendApi.indexOf('sendOneTransitionForm({'),
    'a failed probe returns before any send')
  // notification_log is a display ledger, never the idempotency source.
  assert.doesNotMatch(sendApi, /from\('notification_log'\)\s*\n?\s*\.select/)
  // The durable claim happens BEFORE the token exists, and the row is BOUND
  // to the exact prepared token BEFORE the provider is called.
  const claimIdx = coreSrc.indexOf("status: 'attempting'")
  const mintIdx = coreSrc.indexOf('generateToken()')
  const bindIdx = coreSrc.indexOf('token_id: tokenId')
  const mailIdx = coreSrc.indexOf('await sendEmail({')
  assert.ok(claimIdx > -1 && claimIdx < mintIdx, 'claim before mint')
  assert.ok(mintIdx < bindIdx && bindIdx < mailIdx, 'mint, then bind, then mail')
  // Accepted rows are skipped; ledger failures are typed; acceptance is
  // recorded separately from activation.
  assert.match(coreSrc, /already_sent_in_batch/)
  assert.match(coreSrc, /ledger_unavailable/)
  assert.match(coreSrc, /provider_accepted_at/)
  assert.match(coreSrc, /delivery_ledger_update_failed/)
  // Provider idempotency key rides every send, unconditionally.
  assert.match(coreSrc, /idempotencyKey: `ngrp-transition\//)
  // Only an EXPLICIT rejection fails the token; activation failure never does.
  assert.match(coreSrc, /sent\.reason === 'provider_rejected'/)
  const actFailBlock = coreSrc.slice(coreSrc.indexOf("rpc('ngrp_activate_token_tx'"), coreSrc.indexOf('async function resumeDeliveryAttempt'))
  assert.doesNotMatch(actFailBlock, /ngrp_fail_token_tx/, 'no fail_token call after provider acceptance')
  // A notification_log failure after acceptance is a WARNING, not a failure -
  // the email went out and the recipient stays truthfully Sent.
  assert.match(sendApi, /sent_history_ledger_failed/)
  assert.match(sendApi, /logIns\.error/)
  assert.ok(sendApi.indexOf('results.warnings.push({ student_id: student.id, warning: \'sent_history_ledger_failed\' })')
    < sendApi.indexOf('results.sent.push({ student_id: student.id, resent'), 'the ledger warning never blocks the truthful Sent result')
  // Replays that settle earlier work are reported, never silently re-logged.
  assert.match(sendApi, /sent_history_may_be_incomplete/)
  // The panel reports the warning honestly.
  assert.match(sendPanel, /delivered but a bookkeeping ledger write failed/)
})

// ── Public form: token isolation + lifecycle ─────────────────────────────────

function publicDb() {
  return mutableDb({
    ngrp_cycles: { rows: [structuredClone(CYCLE)] },
    ngrp_candidates: { rows: [
      { id: 'cand-1', cycle_id: CYCLE.id, student_id: 'stu-1' },
      { id: 'cand-2', cycle_id: CYCLE.id, student_id: 'stu-2' },
    ] },
    ngrp_transition_assignments: { rows: [
      { id: 'asg-1', candidate_id: 'cand-1', status: 'sent', sent_at: '2026-09-02T00:00:00Z', revision_count: 0, revoked_at: null, deadline_at: null },
      { id: 'asg-2', candidate_id: 'cand-2', status: 'sent', sent_at: '2026-09-02T00:00:00Z', revision_count: 0, revoked_at: null, deadline_at: null },
    ] },
    ngrp_transition_tokens: { rows: [
      { id: 'tok-1', assignment_id: 'asg-1', token_hash: 'hash-one', token_hash_prefix: 'hashone', status: 'active', revoked_at: null },
      { id: 'tok-2', assignment_id: 'asg-2', token_hash: 'hash-two', token_hash_prefix: 'hashtwo', status: 'active', revoked_at: null },
      { id: 'tok-3', assignment_id: 'asg-1', token_hash: 'hash-revoked', token_hash_prefix: 'hashrev', status: 'revoked', revoked_at: '2026-09-03T00:00:00Z' },
      { id: 'tok-4', assignment_id: 'asg-2', token_hash: 'hash-pending', token_hash_prefix: 'hashpen', status: 'pending', revoked_at: null },
      { id: 'tok-5', assignment_id: 'asg-2', token_hash: 'hash-failed', token_hash_prefix: 'hashfail', status: 'failed', revoked_at: null },
    ] },
    ngrp_transition_drafts: { rows: [] },
    ngrp_transition_revisions: { rows: [] },
    ngrp_candidate_requirements: { rows: [] },
  })
}

test('public: a token resolves exactly ITS assignment; pending/failed/revoked/unknown are one indistinguishable state', async () => {
  const db = publicDb()
  const one = await resolveTokenAssignment(db, 'hash-one', '2026-09-10T00:00:00Z')
  assert.equal(one.state, 'ok')
  assert.equal(one.candidate.id, 'cand-1', 'never another alumnus')
  const two = await resolveTokenAssignment(db, 'hash-two', '2026-09-10T00:00:00Z')
  assert.equal(two.candidate.id, 'cand-2')
  for (const h of ['hash-revoked', 'hash-pending', 'hash-failed', 'hash-never-existed']) {
    assert.equal((await resolveTokenAssignment(db, h, '2026-09-10T00:00:00Z')).state, 'unknown', h)
  }
})

test('public: endpoint order - token shape gate before db, rate limit fail-closed, no staff auth on this surface', () => {
  assert.ok(publicApi.indexOf('isWellFormedRawToken(token)') < publicApi.indexOf('consume_evaluation_rate_limit'))
  assert.ok(publicApi.indexOf('consume_evaluation_rate_limit') < publicApi.indexOf('hashToken(token)'))
  assert.match(publicApi, /rlError \|\| allowed !== true/)
  assert.doesNotMatch(publicApi, /verifyPortalCaller|verifyNgrpCaller|ngrp_access/)
  // draft saves never touch the revisions table
  const saveBlock = publicApi.slice(publicApi.indexOf("action === 'save_draft'"), publicApi.indexOf("action === 'submit'"))
  assert.doesNotMatch(saveBlock, /ngrp_transition_revisions/)
})

test('public: closed-link bookkeeping - closure is checked BEFORE first-use/Opened writes, and update results are checked', () => {
  const loadBlock = publicApi.slice(publicApi.indexOf("action === 'load'"), publicApi.indexOf('// Prefill identity'))
  assert.match(loadBlock, /if \(!resolved\.closed\) \{/)
  assert.ok(loadBlock.indexOf('if (!resolved.closed)') < loadBlock.indexOf('.update({ first_used_at'),
    'an expired link may render the safe page but never records an open')
  assert.match(loadBlock, /used\.error/)
  assert.match(loadBlock, /opened\.error/)
  // mutations are refused pre-transaction too, with the same generic errors
  assert.match(publicApi, /if \(resolved\.closed\) return res\.status\(410\)\.json\(\{ error: WINDOW_CLOSED \}\)/)
})

test('public: submit is ONE transaction - locked serial numbering, immutable revisions, drafts clear, interest lands', async () => {
  const db = publicDb()
  const candidate = db.tables.ngrp_candidates.rows[0]
  const assignment = db.tables.ngrp_transition_assignments.rows[0]
  db.tables.ngrp_transition_drafts.rows.push({ id: 'd1', assignment_id: 'asg-1', payload: {} })
  const payload1 = vs(form())
  assert.equal(payload1.ok, true)

  const first = await submitRevision(db, { cycle: CYCLE, candidate, assignment, payload: payload1.payload })
  assert.equal(first.ok, true)
  assert.equal(first.revisionNumber, 1)
  const asg = db.tables.ngrp_transition_assignments.rows[0]
  assert.equal(asg.status, 'submitted')
  assert.equal(db.tables.ngrp_transition_drafts.rows.length, 0, 'draft cleared in the same transaction')
  assert.equal(db.tables.ngrp_candidates.rows[0].interest, 'interested')
  assert.equal(db.tables.ngrp_audit_events.rows.at(-1).event_type, 'form_submitted')
  assert.ok(db.tables.ngrp_candidate_requirements.rows.length > 0, 'requirement rows written atomically with the result')

  // CONCURRENCY: a second submit carrying the STALE assignment row still gets
  // revision 2 - the locked re-read serializes the number.
  const second = await submitRevision(db, { cycle: CYCLE, candidate, assignment: { ...assignment, revision_count: 0 }, payload: payload1.payload })
  assert.equal(second.revisionNumber, 2)
  assert.equal(db.tables.ngrp_transition_assignments.rows[0].status, 'revised')
  assert.equal(db.tables.ngrp_transition_revisions.rows.length, 2, 'both submitted revisions retained')
  // duplicate revision number is impossible (unique constraint honored by mock)
  const dupe = await db.from('ngrp_transition_revisions').insert({ assignment_id: asg.id, revision_number: 2, payload: {} }).maybeSingle()
  assert.equal(dupe.error?.code, '23505')
})

test('public: submit rolls back IN FULL on a failure at any stage', async () => {
  const payload = vs(form()).payload
  const stages = [
    ['ngrp_transition_revisions', 'revision insert'],
    ['ngrp_candidate_requirements', 'requirement replacement'],
    ['ngrp_audit_events', 'audit insert'],
  ]
  for (const [table, label] of stages) {
    const db = publicDb()
    db.tables.ngrp_transition_drafts.rows.push({ id: 'd1', assignment_id: 'asg-1', payload: {} })
    if (!db.tables[table]) db.tables[table] = { rows: [] }
    db.tables[table].insertError = { message: `boom at ${label}` }
    const out = await submitRevision(db, {
      cycle: CYCLE,
      candidate: db.tables.ngrp_candidates.rows[0],
      assignment: db.tables.ngrp_transition_assignments.rows[0],
      payload,
    })
    assert.equal(out.ok, false, label)
    assert.equal(db.tables.ngrp_transition_revisions.rows.length, 0, `${label}: no revision row survives`)
    assert.equal(db.tables.ngrp_transition_assignments.rows[0].status, 'sent', `${label}: lifecycle untouched`)
    assert.equal(db.tables.ngrp_transition_drafts.rows.length, 1, `${label}: draft retained`)
    assert.equal(db.tables.ngrp_candidates.rows[0].interest, undefined, `${label}: interest untouched`)
  }
  // total rpc failure (function unavailable) reports failure too
  const db = publicDb()
  db.rpcErrors.ngrp_submit_revision_tx = { message: 'boom' }
  const out = await submitRevision(db, {
    cycle: CYCLE, candidate: db.tables.ngrp_candidates.rows[0],
    assignment: db.tables.ngrp_transition_assignments.rows[0], payload,
  })
  assert.equal(out.ok, false)
})

test('public: the deadline is enforced INSIDE the submit/save transactions - and after close, nothing commits', async () => {
  const db = publicDb()
  // a cycle whose Pacific close is already past
  db.tables.ngrp_cycles.rows[0].application_deadline = '2020-01-01'
  const out = await submitRevision(db, {
    cycle: db.tables.ngrp_cycles.rows[0],
    candidate: db.tables.ngrp_candidates.rows[0],
    assignment: db.tables.ngrp_transition_assignments.rows[0],
    payload: vs(form()).payload,
  })
  assert.equal(out.ok, false)
  assert.equal(out.reason, 'closed')
  assert.equal(db.tables.ngrp_transition_revisions.rows.length, 0, 'nothing committed after closure')
  // the SQL bodies raise NGRP_CLOSED and the endpoint maps it to 410
  assert.match(migration, /RAISE EXCEPTION 'NGRP_CLOSED'/)
  assert.match(publicApi, /NGRP_CLOSED.*\n.*WINDOW_CLOSED|includes\('NGRP_CLOSED'\)/)
})

test('public: autosave is atomic - draft + lifecycle move together and saved:true requires the transaction', async () => {
  // endpoint: save_draft goes through the rpc and checks its error FIRST
  const saveBlock = publicApi.slice(publicApi.indexOf("action === 'save_draft'"), publicApi.indexOf("action === 'submit'"))
  assert.match(saveBlock, /rpc\('ngrp_save_draft_tx'/)
  assert.ok(saveBlock.indexOf('saved.error') < saveBlock.indexOf('saved: true'),
    'saved:true is unreachable after a failed transaction')
  assert.doesNotMatch(saveBlock, /from\('ngrp_transition_drafts'\)/, 'no separate draft write remains')
  // handler behavior: draft upsert + in_progress land together...
  const db = publicDb()
  const ok = await db.rpc('ngrp_save_draft_tx', { p_assignment_id: 'asg-1', p_payload: { x: 1 } })
  assert.equal(ok.error, null)
  assert.equal(db.tables.ngrp_transition_drafts.rows.length, 1)
  assert.equal(db.tables.ngrp_transition_assignments.rows[0].status, 'in_progress')
  // ...and a failure moves NEITHER
  const db2 = publicDb()
  db2.tables.ngrp_transition_drafts.insertError = { message: 'boom' }
  const bad = await db2.rpc('ngrp_save_draft_tx', { p_assignment_id: 'asg-1', p_payload: { x: 1 } })
  assert.ok(bad.error)
  assert.equal(db2.tables.ngrp_transition_drafts.rows.length, 0)
  assert.equal(db2.tables.ngrp_transition_assignments.rows[0].status, 'sent', 'lifecycle untouched on failure')
})

// ── Server-side submission completeness ──────────────────────────────────────

test('complete: a submission must carry every fact the active rules calculate with', () => {
  assert.equal(vs(form()).ok, true, 'the complete form passes')
  const cases = [
    [form({ education: { gpa: '' } }), 'education.gpa'],
    [form({ education: { gpa: 4.5 } }), 'education.gpa'],
    [form({ education: { completion_date: '' } }), 'education.completion_date'],
    [form({ education: { completion_date: '2026-99-99' } }), 'education.completion_date'],
    [form({ identity: { preferred_email: 'not-an-email' } }), 'identity.preferred_email'],
    [form({ licensure: { ca_rn_status: null } }), 'licensure.ca_rn_status'],
    [form({ licensure: { license_number: '' } }), 'licensure.license_number'],
    [form({ licensure: { paid_rn_months: '' } }), 'licensure.paid_rn_months'],
    [form({ licensure: { paid_rn_months: -1 } }), 'licensure.paid_rn_months'],
    [form({ licensure: { bls_status: null } }), 'licensure.bls_status'],
    [form({ licensure: { bls_issuer: '' } }), 'licensure.bls_issuer'],
    [form({ licensure: { bls_expiration: '' } }), 'licensure.bls_expiration'],
    [form({ licensure: { acls_required: true, acls_status: null } }), 'licensure.acls_status'],
  ]
  for (const [payload, field] of cases) {
    const out = vs(payload)
    assert.equal(out.ok, false, field)
    assert.ok(out.errors.some(e => e.field === field), `field-specific error for ${field}`)
  }
  // conditional requirements follow the rules, not a blanket list:
  const pendingNoNclex = vs(form({ licensure: { ca_rn_status: 'pending', license_number: '' } }))
  assert.ok(pendingNoNclex.errors.some(e => e.field === 'licensure.nclex_scheduled_date'), 'NCLEX date required while pending with the exception on')
  const exceptionOff = vs(form({ licensure: { ca_rn_status: 'pending', license_number: '' } }), { rules: { nclex_exception_enabled: false } })
  assert.ok(!(exceptionOff.errors || []).some(e => e.field === 'licensure.nclex_scheduled_date'), 'no NCLEX date demanded when the exception is off')
  const accreditationOn = vs(form({ education: { us_accredited: null } }), { rules: { require_accreditation: true } })
  assert.ok(accreditationOn.errors.some(e => e.field === 'education.us_accredited'))
  assert.equal(vs(form({ education: { us_accredited: null } })).ok, true, 'accreditation not demanded when the rule is off')
  // readiness checkboxes are a snapshot - never required true
  assert.equal(vs(form({ readiness: {} })).ok, true)
  // real-date discipline is general
  assert.equal(isRealDate('2026-02-29'), false, '2026 is not a leap year')
  assert.equal(isRealDate('2028-02-29'), true)
  // a submitted complete form can never be eligibility-Pending
  const facts = extractEligibilityFacts(vs(form()).payload)
  assert.notEqual(computeEligibility({ cycle: CYCLE, rules: {}, facts }).result, 'pending')
})

test('complete: ranked preferences require exactly three DISTINCT active units, only when interested', () => {
  const twoPrefs = vs(form({ residency_interest: { unit_preferences: ['5 SCCT', 'NICU'] } }))
  assert.equal(twoPrefs.ok, false)
  const dupePrefs = vs(form({ residency_interest: { unit_preferences: ['5 SCCT', '5 SCCT', 'NICU'] } }))
  assert.equal(dupePrefs.ok, false)
  const offList = vs(form({ residency_interest: { unit_preferences: ['5 SCCT', 'NICU', 'Mars Base'] } }))
  assert.equal(offList.ok, false)
  const notInterested = vs(form({ residency_interest: { interest: 'not_interested', unit_preferences: ['5 SCCT', 'NICU', '6 South'] } }))
  assert.equal(notInterested.ok, true)
  assert.deepEqual(notInterested.payload.residency_interest.unit_preferences, [], 'a non-interested submission never carries rankings')
  const noAttest = vs(form({ attestation: { consent_followup: false } }))
  assert.equal(noAttest.ok, false)
  // and the public page maps field errors to inputs with an accessible summary
  assert.match(formPage, /FIELD_TO_INPUT_ID/)
  assert.match(formPage, /errorSummaryRef\.current\?\.focus\(\)/)
  assert.match(formPage, /role="alert"/)
})

// ── Eligibility engine boundaries ────────────────────────────────────────────

const FULL_PASS_FACTS = {
  ca_rn_status: 'active', paid_rn_months: 3, gpa: 3.5,
  completion_date: '2026-08-01', bls_status: 'active', bls_expiration: '2027-06-01',
  acls_required: false, us_accredited: true,
}
const evalWith = over => computeEligibility({ cycle: CYCLE, rules: {}, facts: { ...FULL_PASS_FACTS, ...over } })

test('eligibility: full pass is eligible; GPA boundary 2.99 fails, 3.00 passes', () => {
  assert.equal(evalWith({}).result, 'eligible')
  assert.equal(evalWith({ gpa: 2.99 }).result, 'not_eligible')
  assert.equal(evalWith({ gpa: 3.0 }).result, 'eligible')
})

test('eligibility: paid RN experience - 8 months passes, 9 months does not', () => {
  assert.equal(evalWith({ paid_rn_months: 8 }).result, 'eligible')
  assert.equal(evalWith({ paid_rn_months: 9 }).result, 'not_eligible')
})

test('eligibility: completion window - exactly 12 months passes, beyond fails (as-of = application deadline)', () => {
  assert.equal(evalWith({ completion_date: '2025-10-15' }).result, 'eligible', 'exactly 12 months before 2026-10-15')
  assert.equal(evalWith({ completion_date: '2025-10-14' }).result, 'not_eligible')
})

test('eligibility: NCLEX conditional obeys the default deadline (21 days before the interview window)', () => {
  // default: 2026-11-02 minus 21 days = 2026-10-12
  assert.equal(resolveLicensureDeadline(CYCLE, validateQualificationRules({})), '2026-10-12')
  const onTime = evalWith({ ca_rn_status: 'pending', nclex_scheduled_date: '2026-10-12' })
  assert.equal(onTime.result, 'conditionally_eligible')
  assert.equal(onTime.reasons.find(r => r.code === 'license').deadline, '2026-10-12')
  assert.equal(evalWith({ ca_rn_status: 'pending', nclex_scheduled_date: '2026-10-13' }).result, 'not_eligible')
  // conditional only when every OTHER hard rule passes
  assert.equal(evalWith({ ca_rn_status: 'pending', nclex_scheduled_date: '2026-10-01', gpa: 2.5 }).result, 'not_eligible')
  // explicit cycle licensure_deadline overrides the default
  assert.equal(resolveLicensureDeadline({ ...CYCLE, licensure_deadline: '2026-10-01' }, validateQualificationRules({})), '2026-10-01')
})

test('eligibility: missing facts or missing configuration stays pending, never a silent pass/fail', () => {
  assert.equal(evalWith({ gpa: undefined }).result, 'pending')
  assert.equal(evalWith({ ca_rn_status: undefined }).result, 'pending')
  const noDates = computeEligibility({ cycle: { name: 'X' }, rules: {}, facts: FULL_PASS_FACTS })
  assert.equal(noDates.result, 'pending', 'no application date configured → pending')
  // every reason row is explainable - code + label + detail, never a score
  const r = evalWith({})
  assert.ok(r.reasons.every(x => x.code && x.label && x.status))
  assert.ok(!('score' in r))
  // and support participation is not an input anywhere - no fact, no field
  const engineSrc = read('lib/server/ngrpEligibility.js')
  assert.doesNotMatch(engineSrc, /f\.support|facts\.support|support_participation/)
  assert.ok(!Object.keys(extractEligibilityFacts({})).some(k => /support/i.test(k)))
})

test('eligibility: facts extraction tolerates missing sections and string numbers', () => {
  const facts = extractEligibilityFacts({ education: { gpa: '3.25' }, licensure: { paid_rn_months: '4' } })
  assert.equal(facts.gpa, 3.25)
  assert.equal(facts.paid_rn_months, 4)
  assert.equal(facts.ca_rn_status, undefined)
})

test('eligibility: override endpoint preserves the calculated result and records actor + reason + timestamp', () => {
  const overrideBlock = manageApi.slice(manageApi.indexOf("action === 'eligibility_override'"), manageApi.indexOf("action === 'application_confirm'"))
  assert.match(overrideBlock, /eligibility_effective: result/)
  assert.doesNotMatch(overrideBlock, /eligibility_calculated:/)
  assert.match(overrideBlock, /eligibility_overridden_by_profile_id: actorId/)
  assert.match(overrideBlock, /eligibility_overridden_at: nowIso/)
  assert.match(overrideBlock, /note\b.*required|A narrative note is required/)
  // recalculation never touches the effective override - in JS or in SQL
  const core = read('lib/server/ngrpTransition.js')
  const recalcBlock = core.slice(core.indexOf('export async function recalculateEligibility'))
  assert.doesNotMatch(recalcBlock, /eligibility_effective/)
  const eligFn = migration.slice(migration.indexOf('FUNCTION public.ngrp_set_candidate_eligibility_tx'), migration.indexOf('FUNCTION public.ngrp_submit_revision_tx'))
  assert.doesNotMatch(eligFn, /eligibility_effective/)
})

// ── Migration security ───────────────────────────────────────────────────────

const R2_TABLES = [
  'ngrp_cycle_units', 'ngrp_transition_assignments', 'ngrp_transition_tokens',
  'ngrp_transition_drafts', 'ngrp_transition_revisions', 'ngrp_candidate_requirements',
  'ngrp_transition_deliveries', 'ngrp_audit_events',
]
const R2_FUNCTIONS = [
  'ngrp_pacific_deadline', 'ngrp_cycle_create_tx', 'ngrp_cycle_set_active_tx',
  'ngrp_sources_set_tx', 'ngrp_units_set_tx', 'ngrp_set_candidate_eligibility_tx',
  'ngrp_submit_revision_tx', 'ngrp_save_draft_tx', 'ngrp_activate_token_tx', 'ngrp_fail_token_tx',
]

test('db: eight server-only tables - RLS, client revokes, EXPLICIT service_role revokes before minimal grants', () => {
  for (const t of R2_TABLES) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`))
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`))
    assert.match(migration, new RegExp(`REVOKE ALL ON public\\.${t}\\s+FROM PUBLIC, anon, authenticated`))
    // The outcomes lesson: service_role is revoked EXPLICITLY, before its grant.
    const revokeIdx = migration.search(new RegExp(`REVOKE ALL ON public\\.${t}\\s+FROM service_role`))
    const grantIdx = migration.search(new RegExp(`GRANT [A-Z, ]+ ON public\\.${t}\\s+TO service_role`))
    assert.ok(revokeIdx > -1, `${t}: explicit service_role revoke`)
    assert.ok(grantIdx > -1, `${t}: explicit service_role grant`)
    assert.ok(revokeIdx < grantIdx, `${t}: revoke comes before grant`)
  }
  assert.doesNotMatch(migration, /CREATE POLICY/)
  assert.doesNotMatch(migration, /GRANT[^;]*TO authenticated/)
  assert.match(migration, /GRANT SELECT, INSERT\s+ON public\.ngrp_transition_revisions\s+TO service_role/)
  assert.match(migration, /GRANT SELECT, INSERT\s+ON public\.ngrp_audit_events\s+TO service_role/)
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE\s+ON public\.ngrp_transition_assignments\s+TO service_role/)
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE\s+ON public\.ngrp_transition_tokens\s+TO service_role/)
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE\s+ON public\.ngrp_transition_deliveries\s+TO service_role/)
  assert.match(migration, /has_table_privilege\('anon'/)
  assert.match(migration, /has_table_privilege\('service_role'/)
})

test('db: function security - EXECUTE revoked from every client role, granted to service_role only, and verified', () => {
  for (const fn of R2_FUNCTIONS) {
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\)\\s+FROM PUBLIC, anon, authenticated`), fn)
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\)\\s+TO service_role`), fn)
  }
  assert.match(migration, /has_function_privilege\('anon'/)
  assert.match(migration, /has_function_privilege\('service_role'/)
})

test('db: V1 verification examines EXACTLY the release-2 tables - never a LIKE pattern that legacy policies would falsify', () => {
  // code-shaped pattern only: the explanatory comment may NAME the banned
  // pattern, but no actual query may use it
  assert.doesNotMatch(migration, /tablename LIKE 'ngrp_%'/)
  const v1 = migration.slice(migration.indexOf('V1. Structure'))
  assert.match(v1, /pg_policies/)
  for (const t of R2_TABLES) {
    assert.ok(v1.slice(v1.indexOf('pg_policies'), v1.indexOf('trigger_count')).includes(`'${t}'`), `policy check names ${t}`)
  }
})

test('db: constraints make bad states unrepresentable - one live assignment, ONE ACTIVE token, numbered revisions, coherence', () => {
  assert.match(migration, /ngrp_assignments_one_live[\s\S]*?\(candidate_id\)[\s\S]*?WHERE revoked_at IS NULL/)
  assert.match(migration, /ngrp_tokens_one_active[\s\S]*?\(assignment_id\)[\s\S]*?WHERE status = 'active'/)
  assert.match(migration, /CONSTRAINT ngrp_revisions_numbered UNIQUE \(assignment_id, revision_number\)/)
  assert.match(migration, /CONSTRAINT ngrp_cycle_units_unique UNIQUE \(cycle_id, unit_name\)/)
  assert.match(migration, /CONSTRAINT ngrp_deliveries_batch_candidate UNIQUE \(batch_id, candidate_id\)/)
  // delivery rows bind to their exact token and record provider acceptance
  // separately from completed activation
  assert.match(migration, /token_id\s+uuid REFERENCES public\.ngrp_transition_tokens\(id\)/)
  assert.match(migration, /provider_accepted_at timestamptz/)
  assert.match(migration, /CONSTRAINT ngrp_deliveries_accept_after_provider\s*\n\s*CHECK \(status <> 'accepted' OR provider_accepted_at IS NOT NULL\)/)
  assert.match(migration, /CONSTRAINT ngrp_assignment_state_times/)
  assert.match(migration, /\(status = 'pending'\s+AND sent_at IS NULL\)/)
  assert.match(migration, /CONSTRAINT ngrp_token_status_coherence/)
  assert.match(migration, /token_hash\s+text NOT NULL UNIQUE/)
  assert.match(migration, /candidate_id\s+uuid NOT NULL REFERENCES public\.ngrp_candidates\(id\) ON DELETE RESTRICT/)
  // token state machine vocabulary
  assert.match(migration, /status IN \('pending','active','revoked','failed'\)/)
  // nothing seeded; legacy untouched; audit has no FKs by design
  assert.doesNotMatch(migration, /INSERT INTO public\.ngrp_cycles VALUES|INSERT INTO public\.students/)
  assert.doesNotMatch(migration, /(UPDATE|ALTER TABLE|DROP TABLE)\s+(public\.)?ngrp_outcomes\b/)
  assert.match(migration, /Deliberately NO\s*\n?--?\s*foreign keys|NO foreign keys/i)
  // rollback never destroys submitted/audit data silently, and drops the functions
  assert.match(migration, /EXPORT ngrp_transition_revisions/)
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.ngrp_submit_revision_tx/)
})

test('db: audit metadata is allowlisted and safe; event types mirror the table CHECK', () => {
  const meta = sanitizeAuditMetadata({ batch_id: 'b', token_hash_prefix: 'pfx', survey_url: 'https://evil', raw: 'RAWTOKEN', result: 'eligible' })
  assert.deepEqual(Object.keys(meta).sort(), ['batch_id', 'result', 'token_hash_prefix'])
  for (const ev of NGRP_AUDIT_EVENTS) assert.match(migration, new RegExp(`'${ev}'`))
})

// ── Regression guards ────────────────────────────────────────────────────────

test('regression: confirmation stays an explicit staff act; preferences never become an assignment', () => {
  assert.match(manageApi, /application_status: 'confirmed'/)
  assert.doesNotMatch(publicApi, /'confirmed'/)
  assert.doesNotMatch(read('lib/server/ngrpTransition.js'), /application_status: 'confirmed'/)
  for (const src of [manageApi, publicApi, sendApi, read('lib/server/ngrpTransition.js'), migration]) {
    assert.doesNotMatch(src, /assigned_unit:/)
  }
  assert.match(drawerUi, /never confirms anything automatically/)
})

test('regression: launch handoff carries cycle + filters and the dedicated panel replaces the composer', () => {
  assert.match(launchCtx, /NGRP_TRANSITION_FORM: 'ngrp_transition_form'/)
  assert.match(applicantsUi, /kind: LAUNCH_KINDS\.NGRP_TRANSITION_FORM/)
  assert.match(applicantsUi, /returnPath: `\/ngrp\/applicants\$\{window\.location\.search \|\| ''\}`/)
  assert.match(registry, /key: 'ngrp_transition_form_invitation'/)
  assert.match(registry, /templateKind: 'ngrp_secure'/)
  assert.match(outreachView, /bulkMsgType !== 'ngrp_transition_form_invitation' && \(\s*<BulkManualComposer/)
  assert.match(outreachView, /bulkMsgType === 'ngrp_transition_form_invitation' && \(\s*<NgrpTransitionSendPanel/)
  assert.doesNotMatch(sendPanel, /[Ii]nvited to [Aa]pply/)
  assert.match(sendPanel, /not an invitation to apply/)
})

test('regression: Planning is reachable with zero cohorts; unprovisioned covers missing functions too', () => {
  assert.match(workspaceUi, /cyclesCount === 0 && subTab !== 'planning'/)
  assert.match(planningUi, /Set up your first residency cohort/)
  assert.match(planningUi, /Create residency cohort/)
  // before 20260904000000 is applied, a missing FUNCTION answers as
  // unprovisioned - honestly - instead of a 500
  assert.ok(isMissingNgrpFunction({ code: 'PGRST202', message: 'Could not find the function' }))
  assert.ok(isMissingNgrpFunction({ code: '42883', message: 'function does not exist' }))
  assert.ok(!isMissingNgrpFunction({ code: '23505', message: 'duplicate' }))
  assert.match(manageApi, /isMissingNgrpSchema/)
})

test('regression: the public form page follows the secure-page conventions', () => {
  assert.match(appJsx, /<Route path="\/ngrp\/transition\/\*"/)
  assert.match(formPage, /TOKEN_PATTERN = \/\^#t=\(\[A-Za-z0-9_-\]\{43\}\)\$\//)
  assert.match(formPage, /window\.history\.replaceState\(null, '', window\.location\.pathname\)/)
  assert.match(formPage, /name = 'referrer'; m\.content = 'no-referrer'/)
  assert.match(formPage, /preventImplicitSubmit/)
  assert.match(formPage, /not an application to the residency program/)
  // no toast machinery on the public page, quiet saved-line only
  assert.doesNotMatch(formPage, /useToast|toast\(/)
  assert.match(formPage, /Draft saved/)
})

test('regression: candidate creation race falls back to a re-read, not a duplicate', async () => {
  const db = mutableDb({ ngrp_candidates: { rows: [{ id: 'cand-x', cycle_id: CYCLE.id, student_id: STUDENT.id }] } })
  const ensured = await ensureCandidate(db, { cycleId: CYCLE.id, studentId: STUDENT.id })
  assert.equal(ensured.candidate.id, 'cand-x')
  assert.equal(ensured.created, false)
  assert.equal(db.tables.ngrp_candidates.rows.length, 1)
})
