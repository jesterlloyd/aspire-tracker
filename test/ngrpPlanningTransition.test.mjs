// NGRP-RELEASE-2: Planning + Transition Form coverage - planning validation,
// the secure send unit of work, token isolation, lifecycle/revision rules,
// the eligibility engine's boundaries, migration security, and regressions.
//
// The mutable mock db APPLIES filters and RECORDS inserts/updates/deletes,
// so idempotency, token rotation, and the failed-delivery rollback are
// exercised for real. Token minting is injected (a deterministic fake), so
// no pepper env is needed and "raw never persisted" is assertable.
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
  effectiveFormClose, isFormClosed, classifySendRecipients, sendOneTransitionForm,
  resolveTokenAssignment, validateSubmission, submitRevision, ensureCandidate,
} from '../lib/server/ngrpTransition.js'
import { sanitizeAuditMetadata, NGRP_AUDIT_EVENTS } from '../lib/server/ngrpAudit.js'
import { loadApplicantsPayload } from '../lib/server/ngrpApplicants.js'

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

// ── Mutable mock db ──────────────────────────────────────────────────────────
let idSeq = 0
const nextId = () => `00000000-0000-4000-8000-9${String(++idSeq).padStart(11, '0')}`

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

// insert/update/delete mutate tables[t].rows; every write is journaled.
function mutableDb(tables, journal = []) {
  const t = name => { if (!tables[name]) tables[name] = { rows: [] }; return tables[name] }
  return {
    journal,
    tables,
    from(table) {
      const filters = []
      let pendingInsert = null
      let pendingUpdate = null
      let pendingDelete = false
      const finish = () => {
        const bucket = t(table)
        if (bucket.error) return { data: null, error: bucket.error }
        if (pendingInsert) {
          const rows = (Array.isArray(pendingInsert) ? pendingInsert : [pendingInsert]).map(r => ({ id: nextId(), created_at: '2026-09-01T00:00:00Z', ...r }))
          for (const r of rows) {
            // honor the unique constraints the real schema enforces
            if (table === 'ngrp_candidates' && bucket.rows.some(x => x.cycle_id === r.cycle_id && x.student_id === r.student_id)) {
              return { data: null, error: { code: '23505', message: 'duplicate' } }
            }
            if (table === 'ngrp_transition_assignments' && bucket.rows.some(x => x.candidate_id === r.candidate_id && !x.revoked_at)) {
              return { data: null, error: { code: '23505', message: 'one live assignment' } }
            }
            if (table === 'ngrp_transition_revisions' && bucket.rows.some(x => x.assignment_id === r.assignment_id && x.revision_number === r.revision_number)) {
              return { data: null, error: { code: '23505', message: 'revision numbered' } }
            }
            bucket.rows.push(r)
            journal.push({ op: 'insert', table, row: r })
          }
          return { data: rows, error: null }
        }
        if (pendingUpdate) {
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
        is: (c, v) => { filters.push(['is', v, undefined, undefined]) && undefined; filters[filters.length - 1] = ['is', c === undefined ? null : v, undefined]; filters[filters.length - 1] = ['is2']; return b },
        not: (c, op2, v) => { filters.push(['not', c, op2, v]); return b },
        maybeSingle: async () => { const r = finish(); return { data: r.error ? null : ((r.data || [])[0] ?? null), error: r.error } },
        single: async () => { const r = finish(); return { data: r.error ? null : ((r.data || [])[0] ?? null), error: r.error } },
        then: (res, rej) => Promise.resolve(finish()).then(res, rej),
      }
      // fix the botched is() above with a clean implementation
      b.is = (c, v) => { filters.push(v === null ? ['is', c, null] : ['eq', c, v]); return b }
      return b
    },
  }
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
const STUDENT = { id: 'a0000000-0000-4000-8000-00000000s001', status: 'Completed', has_email: true, email: 's1@x.test', first_name: 'Ada', last_name: 'L', name: 'Ada L' }
const okSend = async () => ({ ok: true, providerId: 'prov-1' })
const failSend = async () => ({ ok: false, reason: 'provider_rejected' })
const buildEmail = () => ({ subject: 'Your NGRP Transition Form', html: '<p>hi</p>' })

function sendCtx(db, overrides = {}) {
  return {
    db, cycle: CYCLE, student: STUDENT, candidate: null, assignment: null,
    actorProfileId: 'prof-1', generateToken: fakeGenerateToken,
    sendEmail: okSend, buildEmail, baseUrl: 'https://app.test', ...overrides,
  }
}

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

test('planning: endpoint order and guards (first cohort, active constraint, scope guard, status action)', () => {
  // planning action works with NO cycle (first-time setup data).
  assert.match(manageApi, /if \(!cycleId\) return res\.status\(200\)\.json\(\{ provisioned: true, cycle: null, aspireCohorts/)
  // active-switch clears everywhere else FIRST and translates 23505.
  assert.ok(manageApi.indexOf("update({ is_active: false }).neq('id', cycleId)") < manageApi.indexOf("update({ is_active: true }).eq('id', cycleId)"))
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

// ── Send unit of work ────────────────────────────────────────────────────────

test('send: one candidate + one live assignment per alumnus/cycle; repeat send is a token-rotating resend', async () => {
  const db = mutableDb({})
  const first = await sendOneTransitionForm(sendCtx(db))
  assert.equal(first.outcome, 'sent')
  assert.equal(db.tables.ngrp_candidates.rows.length, 1)
  assert.equal(db.tables.ngrp_transition_assignments.rows.length, 1)
  assert.equal(db.tables.ngrp_transition_tokens.rows.length, 1)

  const second = await sendOneTransitionForm(sendCtx(db))
  assert.equal(second.outcome, 'resent')
  assert.equal(db.tables.ngrp_candidates.rows.length, 1, 'no duplicate candidate attempt')
  assert.equal(db.tables.ngrp_transition_assignments.rows.length, 1, 'no duplicate assignment')
  assert.equal(db.tables.ngrp_transition_tokens.rows.length, 2)
  const [oldTok, newTok] = db.tables.ngrp_transition_tokens.rows
  assert.ok(oldTok.revoked_at, 'resend revoked the prior token')
  assert.ok(!newTok.revoked_at)
})

test('send: raw tokens are never persisted, returned, or derivable from what is stored', async () => {
  const db = mutableDb({})
  const out = await sendOneTransitionForm(sendCtx(db))
  const stored = JSON.stringify(db.tables)
  assert.doesNotMatch(stored, /RAWTOKEN_/, 'no table row carries a raw token')
  assert.doesNotMatch(JSON.stringify(out), /RAWTOKEN_/, 'the outcome never carries a raw token')
  assert.equal(out.tokenHashPrefix?.startsWith('hp_'), true, 'only the hash prefix surfaces')
  // and the endpoint layer never echoes tokens either
  assert.doesNotMatch(sendApi, /rawToken|\.raw\b/)
  assert.match(sendApi, /token_hash_prefix: outcome\.tokenHashPrefix/)
})

test('send: a failed delivery never becomes Sent - token and fresh assignment are revoked', async () => {
  const db = mutableDb({})
  const out = await sendOneTransitionForm(sendCtx(db, { sendEmail: failSend }))
  assert.equal(out.outcome, 'failed')
  assert.ok(db.tables.ngrp_transition_tokens.rows.every(t => t.revoked_at), 'token revoked')
  assert.ok(db.tables.ngrp_transition_assignments.rows.every(a => a.revoked_at), 'assignment revoked')
  // a later real send starts clean:
  const retry = await sendOneTransitionForm(sendCtx(db))
  assert.equal(retry.outcome, 'sent')
  assert.equal(db.tables.ngrp_transition_assignments.rows.filter(a => !a.revoked_at).length, 1)
})

test('send: classification skips missing-email / non-completed / already-sent (without resend)', () => {
  const students = [
    { id: 's1', status: 'Completed', has_email: true },
    { id: 's2', status: 'Completed', has_email: false },
    { id: 's3', status: 'Active Rotation', has_email: true },
    { id: 's4', status: 'Completed', has_email: true },
  ]
  const candidatesByStudent = new Map([['s4', { id: 'c4' }]])
  const liveAssignmentsByCandidate = new Map([['c4', { id: 'a4' }]])
  const noResend = classifySendRecipients({ students, candidatesByStudent, liveAssignmentsByCandidate, resend: false })
  assert.deepEqual(noResend.send.map(x => x.student.id), ['s1'])
  assert.deepEqual(noResend.skipped.map(x => [x.student.id, x.reason]), [['s2', 'missing_email'], ['s3', 'not_completed'], ['s4', 'already_sent']])
  const withResend = classifySendRecipients({ students, candidatesByStudent, liveAssignmentsByCandidate, resend: true })
  assert.deepEqual(withResend.reissue.map(x => x.student.id), ['s4'])
})

test('send: endpoint gates - no request-body recipients, typed confirmation, cap, readiness, batch idempotency', () => {
  assert.match(sendApi, /'email' in body \|\| 'to' in body \|\| 'cc' in body \|\| 'bcc' in body/)
  assert.match(sendApi, /body\.confirmation !== CONFIRMATION/)
  assert.match(sendApi, /too_many_recipients/)
  assert.match(sendApi, /cycle_not_ready/)
  assert.match(sendApi, /already_sent_in_batch/)
  assert.ok(sendApi.indexOf('verifyPortalCaller(req)') < sendApi.indexOf('getServiceDb()'))
  assert.match(sendApi, /can\(caller\.profile, 'ngrp_manage'\)/)
  // recipients resolve from the db (mapped cohorts + Completed), never the request
  assert.match(sendApi, /\.in\('cohort_id', cohortIds\)/)
  // send copy discipline: the user-facing phrase "Invited to Apply" never
  // appears (the comment explaining the rule may mention it in lowercase)
  assert.doesNotMatch(sendApi, /Invited to Apply/)
  assert.match(sendApi, /not an application to the/)
})

// ── Public form: token isolation + lifecycle ─────────────────────────────────

function publicDb() {
  return mutableDb({
    ngrp_cycles: { rows: [CYCLE] },
    ngrp_candidates: { rows: [
      { id: 'cand-1', cycle_id: CYCLE.id, student_id: 'stu-1' },
      { id: 'cand-2', cycle_id: CYCLE.id, student_id: 'stu-2' },
    ] },
    ngrp_transition_assignments: { rows: [
      { id: 'asg-1', candidate_id: 'cand-1', status: 'sent', sent_at: '2026-09-02T00:00:00Z', revision_count: 0, revoked_at: null, deadline_at: null },
      { id: 'asg-2', candidate_id: 'cand-2', status: 'sent', sent_at: '2026-09-02T00:00:00Z', revision_count: 0, revoked_at: null, deadline_at: null },
    ] },
    ngrp_transition_tokens: { rows: [
      { id: 'tok-1', assignment_id: 'asg-1', token_hash: 'hash-one', token_hash_prefix: 'hashone', revoked_at: null },
      { id: 'tok-2', assignment_id: 'asg-2', token_hash: 'hash-two', token_hash_prefix: 'hashtwo', revoked_at: null },
      { id: 'tok-3', assignment_id: 'asg-1', token_hash: 'hash-revoked', token_hash_prefix: 'hashrev', revoked_at: '2026-09-03T00:00:00Z' },
    ] },
    ngrp_transition_drafts: { rows: [] },
    ngrp_transition_revisions: { rows: [] },
    ngrp_candidate_requirements: { rows: [] },
  })
}

test('public: a token resolves exactly ITS assignment; revoked and unknown are one indistinguishable state', async () => {
  const db = publicDb()
  const one = await resolveTokenAssignment(db, 'hash-one', '2026-09-10T00:00:00Z')
  assert.equal(one.state, 'ok')
  assert.equal(one.candidate.id, 'cand-1', 'never another alumnus')
  const two = await resolveTokenAssignment(db, 'hash-two', '2026-09-10T00:00:00Z')
  assert.equal(two.candidate.id, 'cand-2')
  assert.equal((await resolveTokenAssignment(db, 'hash-revoked', '2026-09-10T00:00:00Z')).state, 'unknown')
  assert.equal((await resolveTokenAssignment(db, 'hash-never-existed', '2026-09-10T00:00:00Z')).state, 'unknown')
})

test('public: the effective close is enforced server-side (assignment deadline, else cycle deadline EOD)', () => {
  assert.equal(effectiveFormClose(CYCLE, { deadline_at: null }), '2026-10-15T23:59:59.999Z')
  assert.equal(effectiveFormClose(CYCLE, { deadline_at: '2026-10-01T12:00:00Z' }), '2026-10-01T12:00:00Z')
  assert.equal(effectiveFormClose({ application_deadline: null }, {}), null)
  assert.equal(isFormClosed(CYCLE, {}, '2026-10-15T23:00:00.000Z'), false)
  assert.equal(isFormClosed(CYCLE, {}, '2026-10-16T00:00:00.000Z'), true)
  // and the endpoint refuses mutations after close, before any write
  assert.match(publicApi, /if \(resolved\.closed\) return res\.status\(410\)\.json\(\{ error: WINDOW_CLOSED \}\)/)
  // sending without a deadline is refused upstream (readiness), with Planning named
  assert.match(sendPanel, /Fix this in Residency → Planning/)
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

test('public: submit creates immutable numbered revisions; the latest wins; drafts clear; interest lands on the candidate', async () => {
  const db = publicDb()
  const candidate = db.tables.ngrp_candidates.rows[0]
  const assignment = db.tables.ngrp_transition_assignments.rows[0]
  const payload1 = validateSubmission({
    residency_interest: { interest: 'interested', unit_preferences: ['5 SCCT', 'NICU', '6 South'] },
    attestation: { accurate: true, consent_followup: true },
  }, { activeUnitNames: ['5 SCCT', 'NICU', '6 South'], requireComplete: true })
  assert.equal(payload1.ok, true)

  const first = await submitRevision(db, { cycle: CYCLE, candidate, assignment, payload: payload1.payload, nowIso: '2026-09-10T00:00:00Z' })
  assert.equal(first.ok, true)
  assert.equal(first.revisionNumber, 1)
  const asg = db.tables.ngrp_transition_assignments.rows[0]
  assert.equal(asg.status, 'submitted')

  const second = await submitRevision(db, { cycle: CYCLE, candidate, assignment: asg, payload: payload1.payload, nowIso: '2026-09-11T00:00:00Z' })
  assert.equal(second.revisionNumber, 2)
  assert.equal(db.tables.ngrp_transition_assignments.rows[0].status, 'revised')
  assert.equal(db.tables.ngrp_transition_revisions.rows.length, 2, 'both submitted revisions retained')
  assert.equal(db.tables.ngrp_candidates.rows[0].interest, 'interested')
  // duplicate revision number is impossible (unique constraint honored by mock)
  const dupe = await db.from('ngrp_transition_revisions').insert({ assignment_id: asg.id, revision_number: 2, payload: {} }).maybeSingle()
  assert.equal(dupe.error?.code, '23505')
})

test('public: ranked preferences require exactly three DISTINCT active units, only when interested', () => {
  const units = ['5 SCCT', 'NICU', '6 South']
  const base = { attestation: { accurate: true, consent_followup: true } }
  const twoPrefs = validateSubmission({ ...base, residency_interest: { interest: 'interested', unit_preferences: ['5 SCCT', 'NICU'] } }, { activeUnitNames: units, requireComplete: true })
  assert.equal(twoPrefs.ok, false)
  const dupePrefs = validateSubmission({ ...base, residency_interest: { interest: 'interested', unit_preferences: ['5 SCCT', '5 SCCT', 'NICU'] } }, { activeUnitNames: units, requireComplete: true })
  assert.equal(dupePrefs.ok, false)
  const offList = validateSubmission({ ...base, residency_interest: { interest: 'interested', unit_preferences: ['5 SCCT', 'NICU', 'Mars Base'] } }, { activeUnitNames: units, requireComplete: true })
  assert.equal(offList.ok, false)
  const notInterested = validateSubmission({ ...base, residency_interest: { interest: 'not_interested', unit_preferences: ['5 SCCT', 'NICU', '6 South'] } }, { activeUnitNames: units, requireComplete: true })
  assert.equal(notInterested.ok, true)
  assert.deepEqual(notInterested.payload.residency_interest.unit_preferences, [], 'a non-interested submission never carries rankings')
  const noAttest = validateSubmission({ residency_interest: { interest: 'undecided' }, attestation: { accurate: true } }, { activeUnitNames: units, requireComplete: true })
  assert.equal(noAttest.ok, false)
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
  // recalculation never touches the effective override either
  const core = read('lib/server/ngrpTransition.js')
  const recalcBlock = core.slice(core.indexOf('export async function recalculateEligibility'))
  assert.doesNotMatch(recalcBlock, /eligibility_effective/)
})

// ── Migration security ───────────────────────────────────────────────────────

test('db: seven server-only tables - RLS, revokes, minimal grants, immutable revisions/audit', () => {
  for (const t of ['ngrp_cycle_units', 'ngrp_transition_assignments', 'ngrp_transition_tokens', 'ngrp_transition_drafts', 'ngrp_transition_revisions', 'ngrp_candidate_requirements', 'ngrp_audit_events']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`))
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`))
    assert.match(migration, new RegExp(`REVOKE ALL ON public\\.${t}\\s+FROM PUBLIC, anon, authenticated`))
  }
  assert.doesNotMatch(migration, /CREATE POLICY/)
  assert.doesNotMatch(migration, /GRANT[^;]*TO authenticated/)
  assert.match(migration, /GRANT SELECT, INSERT\s+ON public\.ngrp_transition_revisions\s+TO service_role/)
  assert.match(migration, /GRANT SELECT, INSERT\s+ON public\.ngrp_audit_events\s+TO service_role/)
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE\s+ON public\.ngrp_transition_assignments\s+TO service_role/)
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE\s+ON public\.ngrp_transition_tokens\s+TO service_role/)
  assert.match(migration, /has_table_privilege\('anon'/)
  assert.match(migration, /has_table_privilege\('service_role'/)
})

test('db: constraints make bad states unrepresentable - one live assignment/token, numbered revisions, coherence', () => {
  assert.match(migration, /ngrp_assignments_one_live[\s\S]*?\(candidate_id\)[\s\S]*?WHERE revoked_at IS NULL/)
  assert.match(migration, /ngrp_tokens_one_active[\s\S]*?\(assignment_id\)[\s\S]*?WHERE revoked_at IS NULL/)
  assert.match(migration, /CONSTRAINT ngrp_revisions_numbered UNIQUE \(assignment_id, revision_number\)/)
  assert.match(migration, /CONSTRAINT ngrp_cycle_units_unique UNIQUE \(cycle_id, unit_name\)/)
  assert.match(migration, /CONSTRAINT ngrp_assignment_state_times/)
  assert.match(migration, /token_hash\s+text NOT NULL UNIQUE/)
  assert.match(migration, /candidate_id\s+uuid NOT NULL REFERENCES public\.ngrp_candidates\(id\) ON DELETE RESTRICT/)
  // nothing seeded; legacy untouched; audit has no FKs by design
  assert.doesNotMatch(migration, /INSERT INTO/)
  // legacy ngrp_outcomes may be MENTIONED (as untouched) but never touched:
  assert.doesNotMatch(migration, /(INSERT INTO|UPDATE|ALTER TABLE|DROP TABLE)\s+(public\.)?ngrp_outcomes\b/)
  assert.match(migration, /Deliberately NO\s*\n?--\s*foreign keys|NO foreign keys/i)
  // rollback never destroys submitted/audit data silently
  assert.match(migration, /EXPORT ngrp_transition_revisions/)
})

test('db: audit metadata is allowlisted and safe; event types mirror the table CHECK', () => {
  const meta = sanitizeAuditMetadata({ batch_id: 'b', token_hash_prefix: 'pfx', survey_url: 'https://evil', raw: 'RAWTOKEN', result: 'eligible' })
  assert.deepEqual(Object.keys(meta).sort(), ['batch_id', 'result', 'token_hash_prefix'])
  for (const ev of NGRP_AUDIT_EVENTS) assert.match(migration, new RegExp(`'${ev}'`))
})

// ── Regression guards ────────────────────────────────────────────────────────

test('regression: confirmation stays an explicit staff act; preferences never become an assignment', () => {
  // Only the application_confirm action writes 'confirmed'; the public
  // endpoint and the transition core never do.
  assert.match(manageApi, /application_status: 'confirmed'/)
  assert.doesNotMatch(publicApi, /'confirmed'/)
  assert.doesNotMatch(read('lib/server/ngrpTransition.js'), /application_status: 'confirmed'/)
  // Nothing in this release writes assigned_unit anywhere.
  for (const src of [manageApi, publicApi, sendApi, read('lib/server/ngrpTransition.js')]) {
    assert.doesNotMatch(src, /assigned_unit:/)
  }
  // Drawer language: confirm is explicit; drawer never auto-confirms.
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
  // sending is labeled "Transition Form Sent", never "Invited to Apply"
  assert.doesNotMatch(sendPanel, /[Ii]nvited to [Aa]pply/)
  assert.match(sendPanel, /not an invitation to apply/)
})

test('regression: Planning is reachable with zero cohorts; other tabs explain instead of pretending', () => {
  assert.match(workspaceUi, /cyclesCount === 0 && subTab !== 'planning'/)
  assert.match(planningUi, /Set up your first residency cohort/)
  assert.match(planningUi, /Create residency cohort/)
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
