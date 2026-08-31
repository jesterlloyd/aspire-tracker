// NGRP-WORKSPACE-1 (correction passes): scope, cycle chronology + prior-hire
// exclusion, truthful mapping states, authorization, database security,
// Experience/Cohort header presentation, and reliability coverage.
//
// Pure unit tests run the actual server core (lib/server/ngrpApplicants.js)
// against a mocked db that APPLIES the query filters, so cohort scoping and
// the chronology-based prior-hire exclusion are exercised, not just asserted
// about. The authorization matrix runs the one canonical capability
// (lib/server/access.js via src/lib/ngrp/ngrpAccess.js) - the same object
// the server verifier uses, which is itself proven by static guards.
// Database security is covered by static guards over the (unapplied)
// migration; the migration's own verification SQL checks live privileges
// with has_table_privilege after apply.
// Run: node --test test/ngrpWorkspace.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { canAccessNgrp, canManageNgrp, ngrpCycleStorageKey } from '../src/lib/ngrp/ngrpAccess.js'
import { can } from '../lib/server/access.js'
import {
  sanitizeStudent, excludePriorHires, isMissingNgrpTable, loadApplicantsPayload,
  fetchSourceCohortsForCycles, cycleChronoKey, isEarlierCycle,
} from '../lib/server/ngrpApplicants.js'
import {
  deriveApplicantRows, sortApplicantRows, operationalRank, KPI_DEFS, effectiveEligibility,
  orderCyclesForSelector, resolveSelectedCycle,
} from '../src/lib/ngrp/ngrpStates.js'
import { ngrpTabFromPath, resolveNgrpEntryTab } from '../src/lib/ngrp/ngrpTabs.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const migration   = read('supabase/migrations/20260903000000_ngrp_foundation.sql')
const outcomesDeleteRepair = read('supabase/migrations/20260903010000_ngrp_residency_outcomes_revoke_delete.sql')
const endpoint    = read('api/ngrp-workspace.js')
const ngrpAuth    = read('api/lib/ngrpAuth.js')
const serverCore  = read('lib/server/ngrpApplicants.js')
const appJsx      = read('src/App.jsx')
const headerJsx   = read('src/components/Header/Header.jsx')
const expPicker   = read('src/components/Header/ExperiencePicker.jsx')
const resPicker   = read('src/components/Header/ResidencyCohortPicker.jsx')
const workspace   = read('src/components/ngrp/NgrpWorkspace.jsx')
const applicants  = read('src/components/ngrp/ApplicantsTab.jsx')
const dataHooks   = read('src/lib/ngrp/useNgrpData.js')
const ngrpCss     = read('src/components/ngrp/ngrp.css')

// ── Mock db that APPLIES filters ─────────────────────────────────────────────
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

function mockDb(tables) {
  return {
    from(table) {
      const filters = []
      const resolve = () => {
        const t = tables[table]
        if (t && t.error) return { data: null, error: t.error }
        return { data: applyFilters(t?.rows || [], filters), error: null }
      }
      const b = {
        select: () => b,
        order: () => b,
        eq: (col, v) => { filters.push(['eq', col, v]); return b },
        neq: (col, v) => { filters.push(['neq', col, v]); return b },
        in: (col, v) => { filters.push(['in', col, v]); return b },
        is: (col, v) => { filters.push(v === null ? ['is', col, null] : ['eq', col, v]); return b },
        not: (col, op, v) => { filters.push(['not', col, op, v]); return b },
        maybeSingle: async () => {
          const r = resolve()
          return { data: r.error ? null : (r.data[0] ?? null), error: r.error }
        },
        then: (res, rej) => Promise.resolve(resolve()).then(res, rej),
      }
      return b
    },
  }
}

// Three cycles in authoritative chronological order: PRIOR < CYCLE < LATER.
const PRIOR = 'cccccccc-0000-4000-8000-000000000000'
const CYCLE = 'cccccccc-0000-4000-8000-000000000001'
const LATER = 'cccccccc-0000-4000-8000-000000000002'
const CYCLE_ROWS = [
  { id: PRIOR, name: 'August 2026 NGRP',  status: 'Completed',        application_open_date: '2026-03-01', residency_start_date: '2026-08-10', created_at: '2026-01-01T00:00:00Z' },
  { id: CYCLE, name: 'January 2027 NGRP', status: 'Application Open', application_open_date: '2026-09-01', residency_start_date: '2027-01-25', created_at: '2026-06-01T00:00:00Z' },
  { id: LATER, name: 'August 2027 NGRP',  status: 'Planning',         application_open_date: '2027-03-01', residency_start_date: '2027-08-09', created_at: '2026-08-01T00:00:00Z' },
]
const [A, B, C, D] = ['a', 'b', 'c', 'd'].map(x => `${x}0000000-0000-4000-8000-000000000000`)
const stu = (id, cohort_id, status, extra = {}) => ({
  id, cohort_id, status, first_name: id, last_name: 'x', name: id,
  school: 'S', program_type: 'BSN', aspire_cohort: 'X', headshot_url: '',
  updated_at: '2026-08-01T00:00:00Z',
  school_email: `${id}@x.test`, personal_email: '', ...extra,
})

function scenarioDb() {
  return mockDb({
    ngrp_cycles: { rows: CYCLE_ROWS },
    ngrp_cycle_source_cohorts: {
      rows: [
        { cycle_id: CYCLE, cohort_id: A, cohorts: { id: A, name: 'Summer 2026', start_date: '2026-05-01' } },
        { cycle_id: CYCLE, cohort_id: B, cohorts: { id: B, name: 'Fall 2026', start_date: '2026-09-01' } },
        { cycle_id: CYCLE, cohort_id: C, cohorts: { id: C, name: 'Winter 2027', start_date: '2027-01-01' } },
      ],
    },
    students: {
      rows: [
        stu('s1', A, 'Completed'),          // prior applicant, never hired -> included
        stu('s2', B, 'Completed'),          // hired in the EARLIER cycle -> excluded
        stu('s3', C, 'Completed'),          // hired then separated in EARLIER -> still excluded
        stu('s4', B, 'Active Rotation'),    // not completed -> excluded by status
        stu('s5', D, 'Completed'),          // cohort NOT mapped -> excluded by scope
        stu('s6', C, 'Completed'),          // hired in the SELECTED cycle -> stays listed
        stu('s7', A, 'Completed'),          // hired in a LATER cycle -> stays in this earlier roster
      ],
    },
    ngrp_candidates: {
      rows: [
        { id: 'k1', cycle_id: CYCLE, student_id: 's1', interest: 'interested', eligibility_calculated: 'eligible', eligibility_effective: null, application_status: 'not_confirmed' },
        { id: 'k0', cycle_id: PRIOR, student_id: 's1', interest: 'interested', eligibility_calculated: 'eligible', eligibility_effective: null, application_status: 'withdrawn' },
      ],
    },
    ngrp_residency_outcomes: {
      rows: [
        { student_id: 's1', cycle_id: PRIOR, hired_at: null },                                   // applied, no hire
        { student_id: 's2', cycle_id: PRIOR, hired_at: '2026-08-15T00:00:00Z' },                  // durable earlier hire
        { student_id: 's3', cycle_id: PRIOR, hired_at: '2026-08-15T00:00:00Z', separated_at: '2026-12-01T00:00:00Z' },
        { student_id: 's6', cycle_id: CYCLE, hired_at: '2027-02-10T00:00:00Z' },                  // same-cycle hire
        { student_id: 's7', cycle_id: LATER, hired_at: '2027-08-20T00:00:00Z' },                  // later-cycle hire
      ],
    },
  })
}

// ── Scope ────────────────────────────────────────────────────────────────────

test('scope: one cycle mapped to three cohorts returns completed alumni from all three', async () => {
  const payload = await loadApplicantsPayload(scenarioDb(), CYCLE)
  assert.equal(payload.state, 'ok')
  assert.deepEqual(payload.sourceCohorts.map(c => c.name), ['Summer 2026', 'Fall 2026', 'Winter 2027'])
  assert.deepEqual(payload.students.map(s => s.id).sort(), ['s1', 's6', 's7'])
})

test('scope: a non-completed ASPIRE status is excluded; an unmapped cohort is excluded', async () => {
  const payload = await loadApplicantsPayload(scenarioDb(), CYCLE)
  assert.ok(!payload.students.some(s => s.id === 's4'), 'Active Rotation student must not appear')
  assert.ok(!payload.students.some(s => s.id === 's5'), 'unmapped-cohort student must not appear')
})

test('scope: no mapped cohorts is its own distinct empty result, not an error', async () => {
  const dbNoMap = mockDb({
    ngrp_cycles: { rows: [CYCLE_ROWS[1]] },
    ngrp_cycle_source_cohorts: { rows: [] },
  })
  const payload = await loadApplicantsPayload(dbNoMap, CYCLE)
  assert.equal(payload.state, 'ok')
  assert.deepEqual(payload.sourceCohorts, [])
  assert.deepEqual(payload.students, [])
})

test('scope: the internal ASPIRE cohort filter narrows by cohort_id from the mapping, not from loaded students', () => {
  assert.match(applicants, /r\.student\.cohort_id !== cohortFilter/)
  assert.match(applicants, /sourceCohorts\.map\(c => <option key=\{c\.id\} value=\{c\.id\}>\{c\.name\}<\/option>\)/)
  assert.doesNotMatch(applicants, /students=\{students\}/)
})

test('scope: the ASPIRE workspace cohort cannot constrain the NGRP roster (no students prop; endpoint-backed)', () => {
  assert.match(applicants, /useNgrpApplicants\(cycle\?\.id\)/)
  assert.match(appJsx, /<NgrpWorkspace\b(?![\s\S]{0,400}students=)/)
  // handleCohortSwitch (ASPIRE) never touches the residency-cohort preference…
  const cohortSwitch = appJsx.slice(appJsx.indexOf('const handleCohortSwitch'), appJsx.indexOf('// Auto-start welcome tour'))
  assert.doesNotMatch(cohortSwitch, /ngrp/i)
  // …and the experience switch never touches the ASPIRE cohort selection.
  const wsSwitch = appJsx.slice(appJsx.indexOf('const switchExperience'), appJsx.indexOf('const ngrpSubTab'))
  assert.doesNotMatch(wsSwitch, /aspire_active_cohort_id/)
})

// ── Cycle chronology + previous outcomes ─────────────────────────────────────

test('chronology: cycleChronoKey orders by application open, then residency start, nulls last, deterministic ties', () => {
  const dated  = { id: 'x1', application_open_date: '2026-03-01', residency_start_date: '2026-08-10' }
  const later  = { id: 'x2', application_open_date: '2026-09-01', residency_start_date: '2027-01-25' }
  const noOpen = { id: 'x3', application_open_date: null, residency_start_date: '2026-01-01', created_at: '2025-01-01T00:00:00Z' }
  assert.ok(isEarlierCycle(dated, later))
  assert.ok(!isEarlierCycle(later, dated))
  assert.ok(!isEarlierCycle(dated, dated), 'a cycle is never earlier than itself')
  // Null application_open_date sorts AFTER every dated cycle - an undated
  // cycle can never retroactively exclude anyone from a dated one.
  assert.ok(!isEarlierCycle(noOpen, dated))
  assert.ok(isEarlierCycle(dated, noOpen))
  // Fully-undated cycles fall through to created_at, then id - total order.
  const u1 = { id: 'aa', created_at: '2026-01-01T00:00:00Z' }
  const u2 = { id: 'bb', created_at: '2026-02-01T00:00:00Z' }
  assert.ok(isEarlierCycle(u1, u2))
  assert.equal(cycleChronoKey(u1) < cycleChronoKey({ ...u1, id: 'ab' }), true)
})

test('outcomes: an earlier-cycle hire is excluded from the later selected cycle', async () => {
  const payload = await loadApplicantsPayload(scenarioDb(), CYCLE)
  assert.ok(!payload.students.some(s => s.id === 's2'))
})

test('outcomes: a later-cycle hire does NOT disappear from an earlier historical roster', async () => {
  const payload = await loadApplicantsPayload(scenarioDb(), CYCLE)
  assert.ok(payload.students.some(s => s.id === 's7'), 's7 hired via the LATER cycle must stay in this roster')
  // and looking at the PRIOR cycle's own roster, s2 (hired via PRIOR) stays:
  const dbPrior = scenarioDb()
  const prior = await loadApplicantsPayload(
    mockDb({
      ngrp_cycles: { rows: CYCLE_ROWS },
      ngrp_cycle_source_cohorts: { rows: [{ cycle_id: PRIOR, cohort_id: B, cohorts: { id: B, name: 'Fall 2026', start_date: '2026-09-01' } }] },
      students: { rows: [stu('s2', B, 'Completed')] },
      ngrp_candidates: { rows: [] },
      ngrp_residency_outcomes: { rows: [{ student_id: 's2', cycle_id: PRIOR, hired_at: '2026-08-15T00:00:00Z' }] },
    }), PRIOR)
  assert.ok(prior.students.some(s => s.id === 's2'), 'a same/later-cycle hire never erases the historical roster')
  void dbPrior
})

test('outcomes: a hire recorded in the SELECTED cycle stays visible in that cycle', async () => {
  const payload = await loadApplicantsPayload(scenarioDb(), CYCLE)
  assert.ok(payload.students.some(s => s.id === 's6'))
})

test('outcomes: prior attempt without a hire remains visible', async () => {
  const payload = await loadApplicantsPayload(scenarioDb(), CYCLE)
  assert.ok(payload.students.some(s => s.id === 's1'))
})

test('outcomes: an earlier hire followed by separation remains excluded from later cycles', async () => {
  const payload = await loadApplicantsPayload(scenarioDb(), CYCLE)
  assert.ok(!payload.students.some(s => s.id === 's3'))
  assert.equal(payload.excludedPriorHires, 2)
})

test('outcomes: candidate state joins only the selected cycle', async () => {
  const payload = await loadApplicantsPayload(scenarioDb(), CYCLE)
  assert.deepEqual(payload.candidates.map(c => c.id), ['k1'])
  const rows = deriveApplicantRows(payload.students, payload.candidates)
  const s1 = rows.find(r => r.id === 's1')
  assert.equal(s1.interest, 'interested')
  assert.equal(s1.application_status, 'not_confirmed')
})

test('outcomes: excludePriorHires and sanitizeStudent are pure and least-privilege', () => {
  const kept = excludePriorHires([{ id: 'a' }, { id: 'b' }], new Set(['b']))
  assert.deepEqual(kept.map(s => s.id), ['a'])
  const s = sanitizeStudent(stu('z', A, 'Completed'))
  assert.equal(s.has_email, true)
  assert.ok(!('school_email' in s) && !('personal_email' in s), 'raw emails never leave the server')
  assert.equal(sanitizeStudent(stu('z', A, 'Completed', { school_email: '', personal_email: ' ' })).has_email, false)
})

test('outcomes: a missing ngrp_residency_outcomes relation is UNPROVISIONED, never a silently incomplete roster', async () => {
  const db = scenarioDb()
  const missing = { error: { code: 'PGRST205', message: "Could not find the table 'public.ngrp_residency_outcomes' in the schema cache" } }
  const dbMissing = mockDb({
    ngrp_cycles: { rows: CYCLE_ROWS },
    ngrp_cycle_source_cohorts: { rows: [{ cycle_id: CYCLE, cohort_id: A, cohorts: { id: A, name: 'Summer 2026', start_date: '2026-05-01' } }] },
    students: { rows: [stu('s1', A, 'Completed')] },
    ngrp_candidates: { rows: [] },
    ngrp_residency_outcomes: missing,
  })
  const payload = await loadApplicantsPayload(dbMissing, CYCLE)
  assert.equal(payload.state, 'unprovisioned', 'must not return provisioned:true with the exclusion skipped')
  assert.ok(!('students' in payload))
  void db
})

test('outcomes: an ordinary outcomes query failure is an error, not unprovisioned and not an empty roster', async () => {
  const dbErr = mockDb({
    ngrp_cycles: { rows: CYCLE_ROWS },
    ngrp_cycle_source_cohorts: { rows: [{ cycle_id: CYCLE, cohort_id: A, cohorts: { id: A, name: 'Summer 2026', start_date: '2026-05-01' } }] },
    students: { rows: [stu('s1', A, 'Completed')] },
    ngrp_candidates: { rows: [] },
    ngrp_residency_outcomes: { error: { code: '57014', message: 'canceling statement' } },
  })
  const payload = await loadApplicantsPayload(dbErr, CYCLE)
  assert.equal(payload.state, 'error')
})

test('outcomes: a successful EMPTY outcomes query yields a valid roster with zero exclusions', async () => {
  const dbEmpty = mockDb({
    ngrp_cycles: { rows: CYCLE_ROWS },
    ngrp_cycle_source_cohorts: { rows: [{ cycle_id: CYCLE, cohort_id: A, cohorts: { id: A, name: 'Summer 2026', start_date: '2026-05-01' } }] },
    students: { rows: [stu('s1', A, 'Completed')] },
    ngrp_candidates: { rows: [] },
    ngrp_residency_outcomes: { rows: [] },
  })
  const payload = await loadApplicantsPayload(dbEmpty, CYCLE)
  assert.equal(payload.state, 'ok')
  assert.deepEqual(payload.students.map(s => s.id), ['s1'])
  assert.equal(payload.excludedPriorHires, 0)
})

test('outcomes: legacy student NGRP fields are not selected and never reach the browser payload', async () => {
  // The select list itself carries no legacy field…
  const fieldsLiteral = [...serverCore
    .slice(serverCore.indexOf('const STUDENT_FETCH_FIELDS'), serverCore.indexOf('const CANDIDATE_FIELDS'))
    .matchAll(/'([^']*)'/g)].map(m => m[1]).join('')
  assert.doesNotMatch(fieldsLiteral, /ngrp_cohort_target|ngrp_outcome/)
  assert.match(fieldsLiteral, /school_email, personal_email/)
  // …and a payload row carries neither field even if the db row did.
  const payload = await loadApplicantsPayload(scenarioDb(), CYCLE)
  for (const row of payload.students) {
    assert.ok(!('ngrp_cohort_target' in row) || row.ngrp_cohort_target === undefined)
    assert.ok(!('school_email' in row))
  }
})

// ── Truthful source-cohort mapping states (cycles action) ────────────────────

test('mappings: a missing mapping table reports unprovisioned, never an empty mapping', async () => {
  const db = mockDb({ ngrp_cycle_source_cohorts: { error: { code: 'PGRST205', message: "Could not find the table 'public.ngrp_cycle_source_cohorts'" } } })
  const r = await fetchSourceCohortsForCycles(db, [CYCLE])
  assert.equal(r.provisioned, false)
  assert.ok(!('byCycle' in r))
})

test('mappings: an ordinary query failure surfaces as an error, never as "no source cohorts"', async () => {
  const db = mockDb({ ngrp_cycle_source_cohorts: { error: { code: '57014', message: 'canceling statement' } } })
  const r = await fetchSourceCohortsForCycles(db, [CYCLE])
  assert.ok(r.error, 'error must propagate')
  assert.ok(!('byCycle' in r))
  // and the endpoint maps that to a 500, before any empty-list defaulting
  assert.match(endpoint, /if \(mapped\.error\) return res\.status\(500\)/)
  assert.match(endpoint, /if \(mapped\.provisioned === false\) return res\.status\(200\)\.json\(\{ provisioned: false/)
  assert.ok(endpoint.indexOf('mapped.error') < endpoint.indexOf('mapped.byCycle.get'))
})

test('mappings: a successful query with zero rows is a valid empty mapping for every listed cycle', async () => {
  const db = mockDb({ ngrp_cycle_source_cohorts: { rows: [] } })
  const r = await fetchSourceCohortsForCycles(db, [PRIOR, CYCLE])
  assert.equal(r.provisioned, true)
  assert.deepEqual(r.byCycle.get(PRIOR), [])
  assert.deepEqual(r.byCycle.get(CYCLE), [])
  // batched: the endpoint issues ONE mapping read for all cycles
  assert.match(endpoint, /fetchSourceCohortsForCycles\(db, result\.cycles\.map\(c => c\.id\)\)/)
  assert.doesNotMatch(endpoint, /for \(const cycle of result\.cycles\)/)
})

// ── Selector ordering (plan §3.2) ────────────────────────────────────────────

test('ordering: active first, then planned/open chronologically, then completed/archived; ties by open then start date', () => {
  const cycles = [
    { id: 'z-arch', name: 'Old',    status: 'Archived',         application_open_date: '2025-03-01' },
    { id: 'later',  name: 'Later',  status: 'Planning',         application_open_date: '2027-03-01', residency_start_date: '2027-08-09' },
    { id: 'act',    name: 'Active', status: 'Application Open', application_open_date: '2026-09-01', is_active: true },
    { id: 'done',   name: 'Done',   status: 'Completed',        application_open_date: '2026-03-01' },
    { id: 'tie-b',  name: 'TieB',   status: 'Planning',         application_open_date: '2027-03-01', residency_start_date: '2027-09-01' },
    { id: 'early',  name: 'Early',  status: 'Accepting Interest', application_open_date: '2026-11-01' },
  ]
  const ordered = orderCyclesForSelector(cycles).map(c => c.id)
  // Closed cycles come after every active/planned one, chronological within
  // their own group as well.
  assert.deepEqual(ordered, ['act', 'early', 'later', 'tie-b', 'z-arch', 'done'])
})

test('ordering: a valid saved selection is preserved; otherwise active, then first ordered', () => {
  const cycles = [
    { id: 'c1', status: 'Completed', application_open_date: '2026-03-01' },
    { id: 'c2', status: 'Application Open', application_open_date: '2026-09-01', is_active: true },
    { id: 'c3', status: 'Planning', application_open_date: '2027-03-01' },
  ]
  assert.equal(resolveSelectedCycle(cycles, 'c3')?.id, 'c3', 'saved selection preserved')
  assert.equal(resolveSelectedCycle(cycles, 'missing')?.id, 'c2', 'falls back to the active cycle')
  assert.equal(resolveSelectedCycle(cycles.filter(c => !c.is_active), null)?.id, 'c3', 'else the first ordered (open before completed)')
  assert.equal(resolveSelectedCycle([], 'x'), null)
  // App.jsx actually uses these helpers for the header picker.
  assert.match(appJsx, /orderCyclesForSelector\(ngrpCyclesQuery\.cycles\)/)
  assert.match(appJsx, /resolveSelectedCycle\(ngrpCyclesQuery\.cycles, ngrpCyclePref\)/)
})

// ── Authorization (the one capability definition) ────────────────────────────

const profiles = {
  owner:        { is_owner: true, role: 'owner', is_active: true },
  ownerOddRole: { is_owner: true, role: 'something_else', is_active: true },
  stringOwner:  { is_owner: false, role: 'owner', is_active: true },
  admin:        { role: 'admin', is_active: true },
  coLeadHyphen: { role: 'co-lead', is_active: true },
  coLeadUnder:  { role: 'co_lead', is_active: true },
  interviewer:  { role: 'interviewer', is_active: true },
  viewer:       { role: 'viewer', is_active: true },
  portal:       { role: 'portal', is_active: true },
  student:      { role: 'student', is_active: true },
  inactiveOwner:{ is_owner: true, role: 'owner', is_active: false },
  inactiveAdmin:{ role: 'admin', is_active: false },
  inactiveCoLead:{ role: 'co_lead', is_active: false },
}

test('authorization: active Owner capability, Admin, and both Co-Lead spellings can access and manage', () => {
  for (const p of [profiles.owner, profiles.ownerOddRole, profiles.admin, profiles.coLeadHyphen, profiles.coLeadUnder]) {
    assert.equal(canAccessNgrp(p), true)
    assert.equal(canManageNgrp(p), true)
  }
})

test('authorization: interviewer, viewer, portal roles, string-owner-without-capability, and anon fail closed', () => {
  for (const p of [profiles.interviewer, profiles.viewer, profiles.portal, profiles.student, profiles.stringOwner, null, undefined]) {
    assert.equal(canAccessNgrp(p), false)
    assert.equal(canManageNgrp(p), false)
  }
})

test('authorization: inactive Owner/Admin/Co-Lead fail closed', () => {
  for (const p of [profiles.inactiveOwner, profiles.inactiveAdmin, profiles.inactiveCoLead]) {
    assert.equal(canAccessNgrp(p), false)
    assert.equal(canManageNgrp(p), false)
  }
})

test('authorization: server endpoint uses the SAME capability, before any query, and the UI gates every surface', () => {
  assert.match(ngrpAuth, /can\(caller\.profile, 'ngrp_access'\)/)
  assert.ok(endpoint.indexOf('verifyNgrpCaller(req)') < endpoint.indexOf('getServiceDb()'))
  assert.match(appJsx, /const ngrpAllowed = canAccessNgrp\(currentUserProfile\)/)
  // Experience picker (and with it the Residency option) exists only for
  // authorized profiles; nav and workspace render gate the same way; direct
  // /ngrp/* navigation redirects.
  assert.match(appJsx, /experience=\{ngrpAllowed \?/)
  assert.match(appJsx, /\{ngrpAllowed && activeTab === 'ngrp' && \(\s*<NgrpNav/)
  assert.match(appJsx, /\{ngrpAllowed && activeTab === 'ngrp' && \(\s*<NgrpWorkspace/)
  assert.match(appJsx, /!canAccessNgrp\(currentUserProfile\)\) \{\s*navigate\('\/aggregate', \{ replace: true \}\)/)
  assert.equal(can({ role: 'interviewer', is_active: true }, 'ngrp_access'), false)
  assert.equal(can({ role: 'admin' }, 'ngrp_access'), true)
})

// ── Database security (static over the unapplied migration) ──────────────────

test('db: four server-only tables - RLS on, no policies, client roles revoked, service_role explicit', () => {
  for (const t of ['ngrp_cycles', 'ngrp_cycle_source_cohorts', 'ngrp_candidates', 'ngrp_residency_outcomes']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`))
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`))
    assert.match(migration, new RegExp(`REVOKE ALL ON public\\.${t}\\s+FROM PUBLIC, anon, authenticated`))
    assert.match(migration, new RegExp(`GRANT [^;]*ON public\\.${t}\\s+TO service_role`))
  }
  assert.doesNotMatch(migration, /CREATE POLICY/)
  assert.doesNotMatch(migration, /GRANT[^;]*TO authenticated/)
  assert.match(migration, /has_table_privilege\('anon'/)
  assert.match(migration, /has_table_privilege\('authenticated'/)
  assert.match(migration, /has_table_privilege\('service_role'/)
})

test('db: durable employment history cannot be silently erased; no seeded rows; hardened constraints', () => {
  assert.match(migration, /student_id\s+uuid NOT NULL REFERENCES public\.students\(id\)\s+ON DELETE RESTRICT/)
  assert.match(migration, /cycle_id\s+uuid NOT NULL REFERENCES public\.ngrp_cycles\(id\) ON DELETE RESTRICT/)
  assert.match(migration, /REFERENCES public\.ngrp_candidates \(id, student_id, cycle_id\) ON DELETE RESTRICT/)
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE\s+ON public\.ngrp_residency_outcomes\s+TO service_role/)
  assert.match(outcomesDeleteRepair, /REVOKE DELETE ON TABLE public\.ngrp_residency_outcomes FROM service_role/)
  assert.doesNotMatch(migration, /INSERT INTO/)
  assert.doesNotMatch(migration, /January 2027|February 2027/)
  assert.match(migration, /application_deadline >= application_open_date/)
  assert.match(migration, /interview_window_end >= interview_window_start/)
  assert.match(migration, /jsonb_typeof\(qualification_rules\) = 'object'/)
  assert.match(migration, /jsonb_typeof\(application_checklist\) = 'array'/)
  assert.match(migration, /btrim\(eligibility_override_reason\) <> ''/)
  assert.match(migration, /eligibility_overridden_by_profile_id IS NOT NULL/)
  assert.match(migration, /application_status = 'confirmed'\s+AND application_confirmed_at IS NOT NULL AND application_withdrawn_at IS NULL/)
  assert.match(migration, /CONSTRAINT ngrp_cycle_source_cohorts_unique UNIQUE \(cycle_id, cohort_id\)/)
  const candidatesBlock = migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS public.ngrp_candidates'), migration.indexOf('ngrp_candidates_cycle_idx'))
  assert.doesNotMatch(candidatesBlock, /cohort_id/)
})

test('db: no browser data path exists in the client code (endpoint-only reads)', () => {
  assert.doesNotMatch(dataHooks, /supabase\s*\.\s*from\(/)
  assert.match(dataHooks, /authedPost\('\/api\/ngrp-workspace'/)
  assert.match(dataHooks, /authedPost\('\/api\/ngrp-manage'/)
  assert.doesNotMatch(serverCore, /select\('\*'\)[\s\S]{0,80}from\('students'\)|from\('students'\)[\s\S]{0,120}select\('\*'\)/)
})

// ── Experience / Cohort header presentation ──────────────────────────────────

test('header: Experience dropdown offers Internship and Residency; adjacency and shared pill treatment', () => {
  assert.match(expPicker, /id: 'internship', label: 'Internship'/)
  assert.match(expPicker, /id: 'residency',\s+label: 'Residency'/)
  assert.match(expPicker, />Experience</)
  // Adjacent controls in the right-side cluster, before search - and NOT in
  // the brand zone (the old segmented switcher there is gone).
  const iExp = headerJsx.indexOf('<ExperiencePicker')
  const iCoh = headerJsx.indexOf('<CohortPicker')
  const iRes = headerJsx.indexOf('<ResidencyCohortPicker')
  const iSearch = headerJsx.indexOf('<UniversalSearch')
  const iSpacer = headerJsx.indexOf('chart-header-spacer')
  assert.ok(iSpacer < iExp && iExp < iRes && iRes < iCoh && iCoh < iSearch, 'spacer < experience < cohort pickers < search')
  assert.doesNotMatch(headerJsx, /WorkspaceSwitcher/)
  // Both pickers share the dark translucent pill style.
  for (const src of [expPicker, resPicker]) assert.match(src, /rgba\(255,255,255,0\.07\)/)
})

test('header: unauthorized users have no Experience picker (and therefore no Residency option)', () => {
  assert.match(appJsx, /experience=\{ngrpAllowed \? \{ active: activeTab === 'ngrp' \? 'residency' : 'internship'/)
  assert.match(headerJsx, /\{experience && <ExperiencePicker/)
})

test('header: Residency swaps the adjacent picker to residency cohorts presented as COHORT; Internship keeps CohortPicker', () => {
  assert.match(headerJsx, /inResidency && residencyCohort\s*\?\s*<ResidencyCohortPicker/)
  assert.match(headerJsx, /:\s*<CohortPicker/)
  // Eyebrow says Cohort, primary label is the cohort (cycle) name.
  assert.match(resPicker, />Cohort</)
  assert.match(resPicker, /activeCycle\?\.name/)
  // Presentation language: no user-facing "NGRP Residency Cycle" and no
  // "Awaiting provisioning" anywhere in the header components.
  for (const src of [headerJsx, expPicker, resPicker]) {
    assert.doesNotMatch(src, /NGRP Residency Cycle/)
    assert.doesNotMatch(src, /Awaiting provisioning/)
  }
})

test('header: unconfigured, unavailable, and loading picker states are truthful and distinct', () => {
  assert.match(resPicker, /'No cohorts configured'/)
  assert.match(resPicker, /'Cohorts unavailable'/)
  assert.match(resPicker, /'Loading cohorts…'/)
  // A failure is never presented as a valid empty cohort list: the
  // unavailable branch is separate from the zero-cycles branch.
  assert.match(resPicker, /unavailable = status === 'unprovisioned' \|\| status === 'error' \|\| status === 'stale'/)
  assert.doesNotMatch(resPicker, /January 2027/)
})

test('header: each experience restores its own last operational tab; residency cohort pref is per user', () => {
  const wsSwitch = appJsx.slice(appJsx.indexOf('const switchExperience'), appJsx.indexOf('const ngrpSubTab'))
  assert.match(wsSwitch, /lastNgrpTabKey\(user\.id\)/)
  assert.match(wsSwitch, /lastTabKey\(user\.id\)/)
  assert.match(wsSwitch, /resolveNgrpEntryTab\(savedNgrp\)/)
  assert.equal(ngrpCycleStorageKey('user-a'), 'aspire:ngrpCycle:user-a')
  assert.notEqual(ngrpCycleStorageKey('user-a'), ngrpCycleStorageKey('user-b'))
  assert.equal(ngrpCycleStorageKey(null), null)
  assert.match(appJsx, /ngrpCycleStorageKey\(user\?\.id\)/)
})

test('tabs: any VALID location-derived NGRP subtab is persisted; unknown routes never overwrite', () => {
  // The pure model the App effect and entry restore are built on. Simulated
  // per-user store:
  const store = {}
  const visit = (pathname) => {
    const tab = ngrpTabFromPath(pathname)
    if (tab) store['aspire:lastNgrpTab:u1'] = tab   // exactly the effect's guard
  }
  // Direct visit to /ngrp/support → switch to Internship → back to Residency
  // lands on /ngrp/support.
  visit('/ngrp/support')
  assert.equal(resolveNgrpEntryTab(store['aspire:lastNgrpTab:u1']), 'support')
  // Browser navigation (Back/Forward or link) to another valid tab updates
  // the saved tab.
  visit('/ngrp/planning')
  assert.equal(resolveNgrpEntryTab(store['aspire:lastNgrpTab:u1']), 'planning')
  // An unknown /ngrp/* route yields null and does NOT overwrite the saved
  // value - and it is never itself restorable.
  assert.equal(ngrpTabFromPath('/ngrp/bogus'), null)
  visit('/ngrp/bogus')
  assert.equal(resolveNgrpEntryTab(store['aspire:lastNgrpTab:u1']), 'planning')
  assert.equal(resolveNgrpEntryTab('bogus'), 'applicants')
  assert.equal(resolveNgrpEntryTab(null), 'applicants')
  // App.jsx wires exactly this model: an effect persists the location-derived
  // tab (covering nav clicks, direct URLs, Back/Forward, and programmatic
  // navigation) with the null guard, and the nav handler only navigates.
  assert.match(appJsx, /const tab = ngrpTabFromPath\(location\.pathname\)\s*if \(!tab\) return\s*try \{ localStorage\.setItem\(lastNgrpTabKey\(user\.id\), tab\)/)
  assert.match(appJsx, /const switchNgrpTab = id => navigate\(`\/ngrp\/\$\{id\}`\)/)
  assert.match(appJsx, /const ngrpSubTab = ngrpTabFromPath\(location\.pathname\) \|\| 'applicants'/)
})

test('pickers: Escape closes and refocuses the trigger; options are native buttons with Enter/Space for free', () => {
  for (const src of [expPicker, resPicker]) {
    assert.match(src, /e\.key === 'Escape' && open/)
    assert.match(src, /const closeAndRefocus = \(\) => \{ setOpen\(false\); triggerRef\.current\?\.focus\(\) \}/)
    assert.match(src, /ref=\{triggerRef\}/)
    // Choices are real <button type="button"> options; selection closes and
    // refocuses the trigger; no synthetic Enter/Space handler remains.
    assert.match(src, /<button\s+key=\{[cx]\.id\}\s+type="button"\s+role="option"/)
    assert.match(src, /closeAndRefocus\(\) \}/)
    assert.doesNotMatch(src, /e\.key === 'Enter' \|\| e\.key === ' '/)
  }
})

// ── Bundle and reliability ───────────────────────────────────────────────────

test('bundle: NgrpWorkspace is statically imported (the lazy chunk regressed the entry to ~3 MB)', () => {
  assert.match(appJsx, /import NgrpWorkspace from '\.\/components\/ngrp\/NgrpWorkspace'/)
  assert.doesNotMatch(appJsx, /lazy\(\(\) => import\('\.\/components\/ngrp/)
})

test('states: cycle errors, no-cohorts, no-mappings, unprovisioned, and unauthorized are all distinct', () => {
  assert.match(workspace, /NGRP cycles could not be loaded/)
  assert.match(workspace, /No residency cohorts configured/)
  assert.match(workspace, /NGRP persistence is not provisioned yet/)
  assert.match(workspace, /NGRP access required/)
  assert.match(applicants, /No source ASPIRE cohorts mapped to this residency cohort/)
  assert.match(applicants, /No completed alumni yet/)
  assert.match(applicants, /Live refresh failed/)
  assert.doesNotMatch(dataHooks, /provisioned \?\? true|provisioned: true/)
  assert.match(dataHooks, /if \(query\.isLoading\) return 'loading'/)
})

test('states: unprovisioned db errors map only from the missing-table signature', () => {
  assert.equal(isMissingNgrpTable({ code: 'PGRST205' }), true)
  assert.equal(isMissingNgrpTable({ code: '42P01' }), true)
  assert.equal(isMissingNgrpTable({ code: '500', message: 'connection reset' }), false)
  assert.equal(isMissingNgrpTable(null), false)
})

test('reliability: no toast in the data layer; KPI filters keep the roster visible; sticky header; no duplicate selector', () => {
  assert.doesNotMatch(dataHooks, /useToast|toast\?\.|toast\(/)
  assert.match(applicants, /setParam\('kpi', kpiFilter === k\.key \? 'all' : k\.key, 'all'\)/)
  assert.match(applicants, /No alumni match the current filters/)
  assert.match(ngrpCss, /\.ngrp-table thead th \{\s*position: sticky/)
  // The workspace body renders cohort metadata only - no second selector
  // (onSelectCycle passes through to Planning purely as a post-create
  // selection callback, never as a rendered picker).
  assert.doesNotMatch(workspace, /<select|<ResidencyCohortPicker/)
})

test('roster semantics: neutral defaults, operational sort, and KPI predicates hold', () => {
  const rows = deriveApplicantRows([sanitizeStudent(stu('n1', A, 'Completed'))], [])
  assert.equal(rows[0].form_status, 'not_sent')
  assert.equal(rows[0].interest, 'no_response')
  assert.equal(rows[0].application_status, 'not_confirmed')
  assert.equal(effectiveEligibility(rows[0]), 'pending')
  assert.equal(operationalRank(rows[0]), 6)
  const confirmed = { ...rows[0], application_status: 'confirmed' }
  const withdrawn = { ...rows[0], application_status: 'withdrawn' }
  assert.equal(operationalRank(confirmed), 1)
  assert.equal(operationalRank(withdrawn), 7)
  const sorted = sortApplicantRows([withdrawn, rows[0], confirmed], 'priority')
  assert.deepEqual(sorted.map(r => r.application_status), ['confirmed', 'not_confirmed', 'withdrawn'])
  assert.equal(KPI_DEFS.find(k => k.key === 'confirmed').match(confirmed), true)
  assert.equal(KPI_DEFS.find(k => k.key === 'not_sent').match(withdrawn), false, 'withdrawn alumni are not outreach targets')
})
