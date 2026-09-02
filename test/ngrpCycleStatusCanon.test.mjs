// test/ngrpCycleStatusCanon.test.mjs
//
// NGRP-CYCLE-STATUS-CANON: one cohort status vocabulary across both experiences, and
// the residency picker's dates line.
//
// The property worth pinning is that FOUR separate places agree about what a legal
// cycle status is: the client list, the server validator, the picker's colors, and the
// ngrp_cycles CHECK constraint. They previously did not all read the same source, which
// is how a dropdown and a validator could disagree with nothing catching it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { CYCLE_STATUSES, FORM_ACTIVE_STATUSES, CYCLE_CLOSED_STATUSES, orderCyclesForSelector } from '../src/lib/ngrp/ngrpStates.js'
import { CYCLE_STATUSES as SERVER_STATUSES, FORM_ACTIVE_STATUSES as SERVER_FORM_ACTIVE, validateStatusTransition } from '../lib/server/ngrpPlanning.js'
import { COHORT_STATUSES } from '../src/lib/constants.js'
import { cycleDatesLine, fmtDateRange, RESIDENCY_OPEN_STATUSES } from '../src/lib/scopePickerLabels.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
// Line comments FIRST: a path ending in a wildcard inside a // comment otherwise opens
// a false block comment and swallows the rest of the file.
const strip = (src) => src.replace(/^\s*\/\/[^\n]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

const MIGRATION = 'supabase/migrations/20260905000000_ngrp_cycle_status_canon.sql'
const LIST = 'src/components/Header/scope/ResidencyCohortList.jsx'
const MODAL = 'src/components/ngrp/CohortSettingsModal.jsx'

const RETIRED = [
  'Accepting Interest', 'Application Open', 'Application Closed',
  'Interviews', 'Offers', 'Residency Active',
]

// ── One vocabulary ───────────────────────────────────────────────────────────

test('residency and internship cohorts share one status vocabulary', () => {
  assert.deepEqual(CYCLE_STATUSES, ['Planning', 'Active', 'Completed', 'Archived'])
  // The whole point: identical to the ASPIRE cohort list, in the same order.
  assert.deepEqual(CYCLE_STATUSES, COHORT_STATUSES)
})

test('the server validator reads the same list, it does not keep its own', () => {
  assert.equal(SERVER_STATUSES, CYCLE_STATUSES, 'same array identity, not a copy')
  assert.equal(SERVER_FORM_ACTIVE, FORM_ACTIVE_STATUSES)
  // A second declaration is the drift this consolidation removed.
  assert.doesNotMatch(strip(read('lib/server/ngrpPlanning.js')), /export const CYCLE_STATUSES = \[/)
})

test('no retired status survives anywhere in the app', () => {
  for (const f of ['src/lib/ngrp/ngrpStates.js', 'lib/server/ngrpPlanning.js', 'src/lib/scopePickerLabels.js', LIST, MODAL]) {
    const code = strip(read(f))
    for (const gone of RETIRED) {
      assert.ok(!code.includes(`'${gone}'`), `${f} still names the retired status ${gone}`)
    }
  }
})

test('the picker colors exactly the four, and matches the ASPIRE list', () => {
  const list = strip(read(LIST))
  for (const s of CYCLE_STATUSES) assert.match(list, new RegExp(`${s}:\\s*\\{`), `${s} needs a color`)
  // Same four hex pairs InternshipCohortList uses: one dropdown, one language.
  const internship = read('src/components/Header/scope/InternshipCohortList.jsx')
  for (const hex of ['#dbeafe', '#1d4ed8', '#dcfce7', '#166534', '#f3f4f6', '#6b7280', '#9ca3af']) {
    assert.ok(list.includes(hex) && internship.includes(hex), `both lists must use ${hex}`)
  }
})

// ── What the statuses still gate ─────────────────────────────────────────────

test("'Active' is the live status, and the only one", () => {
  assert.deepEqual([...RESIDENCY_OPEN_STATUSES], ['Active'])
  assert.deepEqual(CYCLE_CLOSED_STATUSES, ['Completed', 'Archived'])
})

test('activating a cohort still requires a form-ready configuration', () => {
  const notReady = { ok: false, reasons: ['No application closing date is set.'] }
  assert.equal(validateStatusTransition({ nextStatus: 'Active', readiness: notReady }).ok, false)
  assert.equal(validateStatusTransition({ nextStatus: 'Active', readiness: { ok: true } }).ok, true)
  // Planning and the closed states never required it and still do not.
  for (const s of ['Planning', 'Completed', 'Archived']) {
    assert.equal(validateStatusTransition({ nextStatus: s, readiness: notReady }).ok, true, `${s} must not be gated`)
  }
})

test('selector ordering still puts the default first and the closed ones last', () => {
  const rows = [
    { id: 'done', status: 'Completed', application_open_date: '2025-01-01' },
    { id: 'next', status: 'Planning', application_open_date: '2027-01-01' },
    { id: 'dflt', status: 'Active', is_active: true, application_open_date: '2026-01-01' },
  ]
  assert.deepEqual(orderCyclesForSelector(rows).map(c => c.id), ['dflt', 'next', 'done'])
})

// ── The dates line ───────────────────────────────────────────────────────────

test('the row states the whole shape of the cohort', () => {
  assert.equal(
    cycleDatesLine({
      application_open_date: '2026-11-09',
      interview_window_start: '2026-12-10',
      interview_window_end: '2026-12-11',
      residency_start_date: '2027-01-11',
    }),
    'Opens Nov 9 • Interviews Dec 10-11 • Starts Jan 11',
  )
})

test('every segment is conditional: a missing date reads as absent, not blank', () => {
  assert.equal(cycleDatesLine({ application_open_date: '2026-11-09' }), 'Opens Nov 9')
  assert.equal(cycleDatesLine({ residency_start_date: '2027-01-11' }), 'Starts Jan 11')
  assert.equal(cycleDatesLine({ interview_window_start: '2026-12-10' }), 'Interviews Dec 10')
  // A cohort with no dates at all yields nothing, never a stray separator.
  for (const empty of [{}, null, undefined]) assert.equal(cycleDatesLine(empty), '')
  assert.ok(!cycleDatesLine({ application_open_date: '2026-11-09' }).includes('•'))
})

test('a range writes its month once, and only when both ends share it', () => {
  assert.equal(fmtDateRange('2026-12-10', '2026-12-11'), 'Dec 10-11')
  assert.equal(fmtDateRange('2026-12-30', '2027-01-02'), 'Dec 30 - Jan 2')
  // A one-day window is a date, not a range against itself.
  assert.equal(fmtDateRange('2026-12-10', '2026-12-10'), 'Dec 10')
  assert.equal(fmtDateRange('2026-12-10', null), 'Dec 10')
  assert.equal(fmtDateRange(null, '2026-12-11'), null)
})

test('dates are parsed as calendar dates, never shifted by a timezone', () => {
  // A date-only string through `new Date()` is parsed as UTC midnight and renders as
  // the PREVIOUS day west of Greenwich. Nov 9 must read Nov 9.
  assert.match(cycleDatesLine({ application_open_date: '2026-11-09' }), /Nov 9$/)
  assert.match(cycleDatesLine({ residency_start_date: '2027-01-01' }), /Jan 1$/)
})

// ── The migration ────────────────────────────────────────────────────────────

test('the migration relaxes before it writes', () => {
  const sql = read(MIGRATION)
  const drop = sql.indexOf('DROP CONSTRAINT IF EXISTS ngrp_cycles_status_check')
  const update = sql.indexOf('UPDATE public.ngrp_cycles')
  const add = sql.indexOf('ADD CONSTRAINT ngrp_cycles_status_canon')
  assert.ok(drop > -1 && update > -1 && add > -1)
  // 'Active' is not in the old vocabulary, so an UPDATE before the DROP would violate
  // the very constraint it is trying to escape.
  assert.ok(drop < update, 'the constraint must be dropped before the rows are rewritten')
  assert.ok(update < add, 'and re-added only once every row is canonical')
})

test('the migration maps every retired value and is one transaction', () => {
  const sql = read(MIGRATION)
  for (const gone of RETIRED) assert.ok(sql.includes(`'${gone}'`), `${gone} must be remapped`)
  assert.match(sql, /^BEGIN;$/m)
  assert.match(sql, /^COMMIT;$/m)
  // The rollback is inert: every line of it is commented.
  const rollback = sql.slice(sql.indexOf('-- ── ROLLBACK'))
  for (const line of rollback.split('\n').filter(l => l.trim())) {
    assert.match(line.trim(), /^--/, `live SQL in the rollback block: ${line}`)
  }
})

test('the new CHECK names exactly the canon', () => {
  const sql = read(MIGRATION)
  const check = sql.slice(sql.indexOf('ADD CONSTRAINT ngrp_cycles_status_canon'), sql.indexOf('COMMIT;'))
  for (const s of CYCLE_STATUSES) assert.ok(check.includes(`'${s}'`), `${s} missing from the constraint`)
  for (const gone of RETIRED) assert.ok(!check.includes(`'${gone}'`), `${gone} must not be permitted`)
})

test('the Owner gate records the applied state, with its audit file and evidence', () => {
  const gate = read('docs/security/OWNER_SQL_GATE.md')
  assert.match(gate, /20260905000000_ngrp_cycle_status_canon\.sql/)
  // Applied by the Owner 2026-09-02. Recording the RESULT is part of closing a
  // migration, not a follow-up: a ledger that still says "not applied" is worse than
  // no ledger, because it is confidently wrong.
  assert.match(gate, /\*\*APPLIED, confirmed 2026-09-02\*\*/)
  assert.match(gate, /db\/audit\/ngrp_cycle_status_canon_checks\.sql/)
  // The evidence has to name what each section actually returned, not just claim green.
  assert.match(gate, /PRE 2 returned the expected/)
  assert.match(gate, /POST 2 returned zero rows outside the canon/)
  assert.match(gate, /23514/, 'POST 4 raising is the pass condition and must be recorded as such')
  const audit = read('db/audit/ngrp_cycle_status_canon_checks.sql')
  for (const section of ['PRE 1.', 'PRE 2.', 'POST 1.', 'POST 2.', 'POST 3.', 'POST 4.']) {
    assert.ok(audit.includes(section), `audit missing ${section}`)
  }
})

// ── The deploy window ────────────────────────────────────────────────────────

test('a row on a retired status keeps it visible instead of silently rewriting it', () => {
  // The app ships the four values before the migration is applied. A select whose value
  // matches no option renders the FIRST option, so saving any unrelated field would
  // quietly move the cohort to Planning.
  const modal = read(MODAL)
  assert.match(modal, /!CYCLE_STATUSES\.includes\(basics\.status\) && basics\.status && \(/)
  assert.match(modal, /\(retired status\)/)
})

test('no em dash in anything this change touched', () => {
  const EM = String.fromCharCode(0x2014)
  for (const f of [MIGRATION, LIST, MODAL, 'src/lib/ngrp/ngrpStates.js', 'src/lib/scopePickerLabels.js',
                   'lib/server/ngrpPlanning.js', 'db/audit/ngrp_cycle_status_canon_checks.sql']) {
    assert.ok(!read(f).includes(EM), `${f} contains an em dash`)
  }
})
