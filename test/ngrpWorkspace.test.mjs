// NGRP-WORKSPACE-1 (correction pass): scope, prior-outcome, authorization,
// database-security, and reliability coverage for the NGRP workspace.
//
// Pure unit tests run the actual server core (lib/server/ngrpApplicants.js)
// against a mocked db that APPLIES the query filters, so cohort scoping and
// the prior-hire exclusion are exercised, not just asserted about. The
// authorization matrix runs the one canonical capability (lib/server/
// access.js via src/lib/ngrp/ngrpAccess.js) - the same object the server
// verifier uses, which is itself proven by static guards. Database security
// is covered by static guards over the (unapplied) migration in the
// repository's established style; the migration's own verification SQL
// checks live privileges with has_table_privilege after apply.
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
} from '../lib/server/ngrpApplicants.js'
import {
  deriveApplicantRows, sortApplicantRows, operationalRank, KPI_DEFS, effectiveEligibility,
} from '../src/lib/ngrp/ngrpStates.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const migration   = read('supabase/migrations/20260903000000_ngrp_foundation.sql')
const endpoint    = read('api/ngrp-workspace.js')
const ngrpAuth    = read('api/lib/ngrpAuth.js')
const serverCore  = read('lib/server/ngrpApplicants.js')
const appJsx      = read('src/App.jsx')
const headerJsx   = read('src/components/Header/Header.jsx')
const cyclePicker = read('src/components/Header/NgrpCyclePicker.jsx')
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

const CYCLE = 'cccccccc-0000-4000-8000-000000000001'
const PRIOR = 'cccccccc-0000-4000-8000-000000000000'
const [A, B, C, D] = ['a', 'b', 'c', 'd'].map(x => `${x}0000000-0000-4000-8000-000000000000`)
const stu = (id, cohort_id, status, extra = {}) => ({
  id, cohort_id, status, first_name: id, last_name: 'x', name: id,
  school: 'S', program_type: 'BSN', aspire_cohort: 'X', headshot_url: '',
  updated_at: '2026-08-01T00:00:00Z', ngrp_cohort_target: '', ngrp_outcome: '',
  school_email: `${id}@x.test`, personal_email: '', ...extra,
})

function scenarioDb() {
  return mockDb({
    ngrp_cycles: { rows: [{ id: CYCLE, name: 'January 2027 NGRP', status: 'Application Open' }] },
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
        stu('s2', B, 'Completed'),          // hired in the PRIOR cycle -> excluded
        stu('s3', C, 'Completed'),          // hired then separated in PRIOR -> still excluded
        stu('s4', B, 'Active Rotation'),    // not completed -> excluded by status
        stu('s5', D, 'Completed'),          // cohort NOT mapped -> excluded by scope
        stu('s6', C, 'Completed'),          // hired in the CURRENT cycle -> stays listed
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
        { student_id: 's2', cycle_id: PRIOR, hired_at: '2026-02-01T00:00:00Z' },                  // durable hire
        { student_id: 's3', cycle_id: PRIOR, hired_at: '2026-02-01T00:00:00Z', separated_at: '2026-06-01T00:00:00Z' },
        { student_id: 's6', cycle_id: CYCLE, hired_at: '2027-02-10T00:00:00Z' },                  // same-cycle hire
      ],
    },
  })
}

// ── Scope ────────────────────────────────────────────────────────────────────

test('scope: one cycle mapped to three cohorts returns completed alumni from all three', async () => {
  const payload = await loadApplicantsPayload(scenarioDb(), CYCLE)
  assert.equal(payload.state, 'ok')
  assert.deepEqual(payload.sourceCohorts.map(c => c.name), ['Summer 2026', 'Fall 2026', 'Winter 2027'])
  const ids = payload.students.map(s => s.id).sort()
  // s1 (Summer), s6 (Winter) remain; s2/s3 excluded by prior hire; s4 not
  // completed; s5's cohort is not mapped.
  assert.deepEqual(ids, ['s1', 's6'])
})

test('scope: a non-completed ASPIRE status is excluded; an unmapped cohort is excluded', async () => {
  const payload = await loadApplicantsPayload(scenarioDb(), CYCLE)
  assert.ok(!payload.students.some(s => s.id === 's4'), 'Active Rotation student must not appear')
  assert.ok(!payload.students.some(s => s.id === 's5'), 'unmapped-cohort student must not appear')
})

test('scope: no mapped cohorts is its own distinct empty result, not an error', async () => {
  const db = scenarioDb()
  const dbNoMap = mockDb({
    ngrp_cycles: { rows: [{ id: CYCLE, name: 'January 2027 NGRP' }] },
    ngrp_cycle_source_cohorts: { rows: [] },
  })
  const payload = await loadApplicantsPayload(dbNoMap, CYCLE)
  assert.equal(payload.state, 'ok')
  assert.deepEqual(payload.sourceCohorts, [])
  assert.deepEqual(payload.students, [])
  // and the mapped scenario is unaffected
  assert.equal((await loadApplicantsPayload(db, CYCLE)).students.length, 2)
})

test('scope: the internal ASPIRE cohort filter narrows by cohort_id from the mapping, not from loaded students', () => {
  // The component filters rows by student.cohort_id against a mapped cohort id,
  // and builds its option list from payload.sourceCohorts.
  assert.match(applicants, /r\.student\.cohort_id !== cohortFilter/)
  assert.match(applicants, /sourceCohorts\.map\(c => <option key=\{c\.id\} value=\{c\.id\}>\{c\.name\}<\/option>\)/)
  assert.doesNotMatch(applicants, /students=\{students\}/)
})

test('scope: the ASPIRE workspace cohort cannot constrain the NGRP roster (no students prop; endpoint-backed)', () => {
  assert.match(applicants, /useNgrpApplicants\(cycle\?\.id\)/)
  assert.match(appJsx, /<NgrpWorkspace\b(?![\s\S]{0,400}students=)/)
  // handleCohortSwitch (ASPIRE) never touches the NGRP cycle preference…
  const cohortSwitch = appJsx.slice(appJsx.indexOf('const handleCohortSwitch'), appJsx.indexOf('// Auto-start welcome tour'))
  assert.doesNotMatch(cohortSwitch, /ngrp/i)
  // …and the workspace switch never touches the ASPIRE cohort selection.
  const wsSwitch = appJsx.slice(appJsx.indexOf('const switchWorkspace'), appJsx.indexOf('const ngrpSubTab'))
  assert.doesNotMatch(wsSwitch, /aspire_active_cohort_id/)
})

// ── Previous outcomes ────────────────────────────────────────────────────────

test('outcomes: prior applicant without a hire appears in a later cycle', async () => {
  const payload = await loadApplicantsPayload(scenarioDb(), CYCLE)
  assert.ok(payload.students.some(s => s.id === 's1'))
})

test('outcomes: a durable prior-cycle hire is excluded, and separation does not restore prospect status', async () => {
  const payload = await loadApplicantsPayload(scenarioDb(), CYCLE)
  assert.ok(!payload.students.some(s => s.id === 's2'), 'hired via earlier cycle must be excluded')
  assert.ok(!payload.students.some(s => s.id === 's3'), 'separated former NGRP hire stays excluded')
  assert.equal(payload.excludedPriorHires, 2)
})

test('outcomes: a hire recorded in the SELECTED cycle does not exclude from that cycle', async () => {
  const payload = await loadApplicantsPayload(scenarioDb(), CYCLE)
  assert.ok(payload.students.some(s => s.id === 's6'))
})

test('outcomes: candidate state joins only the selected cycle', async () => {
  const payload = await loadApplicantsPayload(scenarioDb(), CYCLE)
  assert.deepEqual(payload.candidates.map(c => c.id), ['k1'])
  const rows = deriveApplicantRows(payload.students, payload.candidates)
  const s1 = rows.find(r => r.id === 's1')
  assert.equal(s1.interest, 'interested')            // from the CURRENT cycle's row
  assert.equal(s1.application_status, 'not_confirmed') // never the prior cycle's 'withdrawn'
})

test('outcomes: excludePriorHires and sanitizeStudent are pure and least-privilege', () => {
  const kept = excludePriorHires([{ id: 'a' }, { id: 'b' }], new Set(['b']))
  assert.deepEqual(kept.map(s => s.id), ['a'])
  const s = sanitizeStudent(stu('z', A, 'Completed'))
  assert.equal(s.has_email, true)
  assert.ok(!('school_email' in s) && !('personal_email' in s), 'raw emails never leave the server')
  assert.equal(sanitizeStudent(stu('z', A, 'Completed', { school_email: '', personal_email: ' ' })).has_email, false)
})

// ── Authorization (the one capability definition) ────────────────────────────

const profiles = {
  owner:        { is_owner: true, role: 'owner', is_active: true },
  ownerOddRole: { is_owner: true, role: 'something_else', is_active: true },
  stringOwner:  { is_owner: false, role: 'owner', is_active: true },  // capability rule: role string alone is not Owner
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
  // Server: verifyNgrpCaller -> can(profile, 'ngrp_access'); the endpoint
  // verifies before creating the service client or reading anything.
  assert.match(ngrpAuth, /can\(caller\.profile, 'ngrp_access'\)/)
  assert.ok(endpoint.indexOf('verifyNgrpCaller(req)') < endpoint.indexOf('getServiceDb()'))
  // Client: same capability key through canAccessNgrp; switcher, nav, and
  // workspace body all gate on it; direct /ngrp/* navigation redirects.
  assert.match(appJsx, /const ngrpAllowed = canAccessNgrp\(currentUserProfile\)/)
  assert.match(appJsx, /workspace=\{ngrpAllowed \?/)
  assert.match(appJsx, /\{ngrpAllowed && activeTab === 'ngrp' && \(\s*<NgrpNav/)
  assert.match(appJsx, /ngrpAllowed && activeTab === 'ngrp' && \(\s*<Suspense/)
  assert.match(appJsx, /!canAccessNgrp\(currentUserProfile\)\) \{\s*navigate\('\/aggregate', \{ replace: true \}\)/)
  // NGRP is not gated on the broad canEdit anywhere.
  assert.doesNotMatch(appJsx, /Ngrp\w*\s+canEdit|canEdit=\{canEdit\}[^>]*Ngrp/)
  // The capability table itself: ngrp keys exist and exclude interviewer/viewer.
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
  // Verification checks ACTUAL privileges, not policy counts alone.
  assert.match(migration, /has_table_privilege\('anon'/)
  assert.match(migration, /has_table_privilege\('authenticated'/)
  assert.match(migration, /has_table_privilege\('service_role'/)
})

test('db: durable employment history cannot be silently erased; no seeded rows; hardened constraints', () => {
  // Outcomes: RESTRICT on student/cycle/candidate; no service-role DELETE.
  assert.match(migration, /student_id\s+uuid NOT NULL REFERENCES public\.students\(id\)\s+ON DELETE RESTRICT/)
  assert.match(migration, /cycle_id\s+uuid NOT NULL REFERENCES public\.ngrp_cycles\(id\) ON DELETE RESTRICT/)
  assert.match(migration, /REFERENCES public\.ngrp_candidates \(id, student_id, cycle_id\) ON DELETE RESTRICT/)
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE\s+ON public\.ngrp_residency_outcomes\s+TO service_role/)
  // No demonstration data of any kind.
  assert.doesNotMatch(migration, /INSERT INTO/)
  assert.doesNotMatch(migration, /February 2027/)
  // Cycle date sanity + jsonb shapes + nonblank override reason + stable actor.
  assert.match(migration, /application_deadline >= application_open_date/)
  assert.match(migration, /interview_window_end >= interview_window_start/)
  assert.match(migration, /jsonb_typeof\(qualification_rules\) = 'object'/)
  assert.match(migration, /jsonb_typeof\(application_checklist\) = 'array'/)
  assert.match(migration, /btrim\(eligibility_override_reason\) <> ''/)
  assert.match(migration, /eligibility_overridden_by_profile_id IS NOT NULL/)
  // Application state/timestamp coherence + unique mapping + no denormalized
  // cohort on candidates.
  assert.match(migration, /application_status = 'confirmed'\s+AND application_confirmed_at IS NOT NULL AND application_withdrawn_at IS NULL/)
  assert.match(migration, /CONSTRAINT ngrp_cycle_source_cohorts_unique UNIQUE \(cycle_id, cohort_id\)/)
  const candidatesBlock = migration.slice(migration.indexOf('CREATE TABLE IF NOT EXISTS public.ngrp_candidates'), migration.indexOf('ngrp_candidates_cycle_idx'))
  assert.doesNotMatch(candidatesBlock, /cohort_id/)
})

test('db: no browser data path exists in the client code (endpoint-only reads)', () => {
  assert.doesNotMatch(dataHooks, /supabase\s*\.\s*from\(/)
  assert.match(dataHooks, /fetch\('\/api\/ngrp-workspace'/)
  assert.doesNotMatch(serverCore, /select\('\*'\)[\s\S]{0,80}from\('students'\)|from\('students'\)[\s\S]{0,120}select\('\*'\)/)
})

// ── Reliability and workspace states ─────────────────────────────────────────

test('states: cycle errors, no-cycles, no-mappings, unprovisioned, and unauthorized are all distinct', () => {
  assert.match(workspace, /NGRP cycles could not be loaded/)
  assert.match(workspace, /No residency cycles configured/)
  assert.match(workspace, /NGRP persistence is not provisioned yet/)
  assert.match(workspace, /NGRP access required/)
  assert.match(applicants, /No source ASPIRE cohorts mapped to this cycle/)
  assert.match(applicants, /No completed alumni yet/)
  assert.match(applicants, /Live refresh failed/)
  // and the hook never reports provisioned optimistically: loading resolves
  // first, and no default coerces provisioned to true.
  assert.doesNotMatch(dataHooks, /provisioned \?\? true|provisioned: true/)
  assert.match(dataHooks, /if \(query\.isLoading\) return 'loading'/)
})

test('states: unprovisioned db errors map only from the missing-table signature', () => {
  assert.equal(isMissingNgrpTable({ code: 'PGRST205' }), true)
  assert.equal(isMissingNgrpTable({ code: '42P01' }), true)
  assert.equal(isMissingNgrpTable({ code: '500', message: 'connection reset' }), false)
  assert.equal(isMissingNgrpTable(null), false)
})

test('reliability: per-user cycle persistence cannot leak between accounts; no toast in the data layer', () => {
  assert.equal(ngrpCycleStorageKey('user-a'), 'aspire:ngrpCycle:user-a')
  assert.notEqual(ngrpCycleStorageKey('user-a'), ngrpCycleStorageKey('user-b'))
  assert.equal(ngrpCycleStorageKey(null), null)
  assert.match(appJsx, /ngrpCycleStorageKey\(user\?\.id\)/)
  // The data layer imports no toast machinery and calls none.
  assert.doesNotMatch(dataHooks, /useToast|toast\?\.|toast\(/)
})

test('reliability: KPI filters keep the roster visible; sticky header; header picker swap', () => {
  // A KPI click only writes the URL param; the table (with its own filtered
  // empty row) stays mounted.
  assert.match(applicants, /setParam\('kpi', kpiFilter === k\.key \? 'all' : k\.key, 'all'\)/)
  assert.match(applicants, /No alumni match the current filters/)
  assert.match(ngrpCss, /\.ngrp-table thead th \{\s*position: sticky/)
  // Header: NGRP swaps in the cycle picker; ASPIRE keeps CohortPicker; the
  // picker names the entity precisely and never calls it a cohort.
  assert.match(headerJsx, /inNgrp && ngrpCycle\s*\?\s*<NgrpCyclePicker/)
  assert.match(headerJsx, /:\s*<CohortPicker/)
  assert.match(cyclePicker, />NGRP Residency Cycle</)
  assert.match(cyclePicker, /Select NGRP Residency Cycle/)
  // No user-facing label in the picker calls the selection a cohort (the
  // eyebrow chip in CohortPicker is ">Cohort<"; nothing like it here).
  assert.doesNotMatch(cyclePicker, />Cohort</)
  // The duplicate below-nav selector is gone: the workspace renders metadata
  // only - no <select>, no picker component rendered, no selection handler.
  assert.doesNotMatch(workspace, /<select|<NgrpCyclePicker|onSelectCycle|selectCycle\(/)
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
