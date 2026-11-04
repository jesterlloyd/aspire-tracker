// HIRE-HISTORY-1 (Owner, 2026-11-04): what a hire record says beyond the date and the unit
// (hired as, licensure at application, NCLEX and license dates, a title history), a hire recorded
// after the fact, the past-hires import, and the two reports (by school, by ASPIRE cohort).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  HIRED_AS, validateHireHistory, validateBackfillHire, validateResidentDetails, composeResidents,
  residentReports, hiredAsLabel, SMALL_GROUP,
} from '../src/lib/ngrp/ngrpResidents.js'
import { validateOutcomePayload } from '../lib/server/ngrpPlanning.js'
import { NGRP_AUDIT_EVENTS } from '../lib/server/ngrpAudit.js'
import { EVENT_LABELS, ACTION_GROUPS } from '../src/lib/ngrp/residencyActivityModel.js'
import {
  guessHireMapping, sanitizeHireMapping, hireRowValues, hiredAsFrom, planHires, cohortValues, suggestCycle, IGNORE,
} from '../src/lib/ngrp/hireImportModel.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const MIG = read('supabase/migrations/20261124000000_residency_hire_history.sql')

test('hired as is a closed list; Other needs its words; licensure and dates are checked', () => {
  assert.deepEqual([...HIRED_AS], ['Clinical Nurse I', 'Graduate Nurse Tech', 'Other'])
  const ok = validateHireHistory({ hired_as: 'Graduate Nurse Tech', licensed_at_application: 'no', nclex_passed_on: '2026-09-01', license_issued_on: '' })
  assert.deepEqual(ok, { ok: true, fields: { hired_as: 'Graduate Nurse Tech', hired_as_other: null, licensed_at_application: false, nclex_passed_on: '2026-09-01', license_issued_on: null } })
  assert.equal(validateHireHistory({ hired_as: 'Other' }).ok, false, 'Other without words')
  assert.equal(validateHireHistory({ hired_as: 'Other', hired_as_other: 'Nurse Extern' }).fields.hired_as_other, 'Nurse Extern')
  assert.equal(validateHireHistory({ hired_as: 'Nurse Boss' }).ok, false)
  assert.equal(validateHireHistory({ nclex_passed_on: 'last May' }).ok, false)
  assert.equal(validateHireHistory({}).fields.licensed_at_application, null, 'unknown stays unknown')
  assert.equal(hiredAsLabel({ hired_as: 'Other', hired_as_other: 'Nurse Extern' }), 'Nurse Extern')
  assert.equal(hiredAsLabel({ hired_as: 'Clinical Nurse I' }), 'Clinical Nurse I')
})

test('the outcome validator carries the hire history, and the old shape still validates', () => {
  const base = { offer_extended_at: '2026-10-01T10:00:00Z', offer_accepted_at: '2026-10-02T10:00:00Z', hired_at: '2026-10-03T10:00:00Z', hired_unit: '6 NE' }
  const v = validateOutcomePayload({ ...base, hired_as: 'Clinical Nurse I', licensed_at_application: 'yes' })
  assert.equal(v.ok, true)
  assert.equal(v.outcome.hired_as, 'Clinical Nurse I')
  assert.equal(v.outcome.licensed_at_application, true)
  assert.equal(validateOutcomePayload(base).ok, true)
  assert.equal(validateOutcomePayload({ ...base, hired_as: 'Other' }).ok, false)
})

test('a past hire needs a date and a unit; the separation cannot predate it; the title is dated to the hire', () => {
  assert.equal(validateBackfillHire({ hired_unit: '6 NE' }).ok, false)
  assert.equal(validateBackfillHire({ hired_on: '2026-03-02' }).ok, false)
  const v = validateBackfillHire({ hired_on: '2026-03-02', hired_unit: '6 NE', hired_as: 'Graduate Nurse Tech', position_title: 'Clinical Nurse I', separated_on: '2026-09-30', separation_reason: 'Moved' })
  assert.equal(v.ok, true)
  assert.equal(v.hire.hired_at, '2026-03-02T12:00:00.000Z')
  assert.equal(v.hire.separated_at, '2026-09-30T12:00:00.000Z')
  assert.equal(v.hire.separation_reason, 'Moved')
  assert.equal(v.hire.position_title, 'Clinical Nurse I')
  assert.equal(validateBackfillHire({ hired_on: '2026-03-02', hired_unit: '6 NE', separated_on: '2026-01-01' }).ok, false, 'left before hired')
})

test('a title change carries the day it took effect, never before the hire', () => {
  const hiredAt = '2026-03-02T12:00:00.000Z'
  assert.equal(validateResidentDetails({ position_title: 'Clinical Nurse II', title_effective_on: '2026-02-01' }, { hiredAt }).ok, false)
  const v = validateResidentDetails({ position_title: 'Clinical Nurse II', title_effective_on: '2026-09-01' }, { hiredAt })
  assert.equal(v.ok, true)
  assert.equal(v.titleEffectiveOn, '2026-09-01')
  assert.equal(validateResidentDetails({ position_title: 'Clinical Nurse II' }, { hiredAt }).titleEffectiveOn, null, 'today, decided by the server')
})

test('composeResidents: the current title is the latest history row, the rest is carried', () => {
  const rows = composeResidents({
    outcomes: [{ candidate_id: 'c1', student_id: 's1', cycle_id: 'y1', hired_at: '2026-03-02T12:00:00Z', hired_unit: '6 NE', position_title: 'RN Resident', hired_as: 'Graduate Nurse Tech', licensed_at_application: false, nclex_passed_on: '2026-04-10', backfilled: true }],
    candidates: [{ id: 'c1', cycle_id: 'y1', student_id: 's1' }],
    students: [{ id: 's1', first_name: 'A', last_name: 'B' }],
    cycles: [{ id: 'y1', name: 'Spring 2026' }],
    titles: { c1: [{ title: 'RN Resident', effective_on: '2026-03-02' }, { title: 'Clinical Nurse I', effective_on: '2026-09-01', created_at: '2026-09-01T00:00:00Z' }] },
  })
  const r = rows[0]
  assert.equal(r.current_title, 'Clinical Nurse I')
  assert.deepEqual(r.titles.map(t => t.title), ['Clinical Nurse I', 'RN Resident'])
  assert.equal(r.hired_as_label, 'Graduate Nurse Tech')
  assert.equal(r.licensed_at_application, false)
  assert.equal(r.nclex_passed_on, '2026-04-10')
  assert.equal(r.backfilled, true)
  assert.equal(r.affiliated, true)
  const plain = composeResidents({ outcomes: [{ candidate_id: 'c2', student_id: 's2', hired_at: '2026-03-02T12:00:00Z', position_title: 'Clinical Nurse I' }], students: [{ id: 's2' }] })[0]
  assert.equal(plain.current_title, 'Clinical Nurse I', 'no history: position_title')
  assert.deepEqual(plain.titles, [])
  assert.equal(plain.licensed_at_application, null)
})

test('the reports: hired and retained per school and per ASPIRE cohort, a student hired twice counts once, small groups are marked', () => {
  const population = [
    { student_id: 's1', school: 'CSUN', cohort_name: 'Spring 2026', applied: true },
    { student_id: 's2', school: 'CSUN', cohort_name: 'Spring 2026', applied: true },
    { student_id: 's3', school: 'CSUN', cohort_name: 'Summer 2026', applied: false },
    { student_id: 's4', school: 'CSUN', cohort_name: 'Summer 2026', applied: false },
    { student_id: 's5', school: 'CSUN', cohort_name: 'Summer 2026', applied: false },
    { student_id: 's6', school: 'WCU', cohort_name: 'Spring 2026', applied: true },
    { student_id: 's7', school: 'WCU', cohort_name: 'Spring 2026', applied: true },
    { student_id: 's8', school: '', cohort_name: '', applied: false },
  ]
  const residents = [
    { student: { id: 's1' }, affiliated: true },
    { student: { id: 's1' }, affiliated: true }, // hired in a second cohort: counts once
    { student: { id: 's6' }, affiliated: false },
    { student: { id: 's7' }, affiliated: true },
    { student: { id: 'elsewhere' }, affiliated: true }, // not in the population: never counted
  ]
  const r = residentReports({ population, residents })
  assert.deepEqual(r.bySchool.map(x => [x.key, x.interns, x.applied, x.hired, x.retained, x.hiredPct, x.retainedPct, x.small]), [
    ['CSUN', 5, 2, 1, 1, 20, 100, false],
    ['WCU', 2, 2, 2, 1, 100, 50, true],
    ['No school on file', 1, 0, 0, 0, 0, null, true],
  ])
  assert.deepEqual(r.byCohort.map(x => [x.key, x.interns, x.hired, x.hiredPct]), [
    ['Spring 2026', 4, 3, 75], ['Summer 2026', 3, 0, 0], ['No cohort on file', 1, 0, 0],
  ])
  assert.deepEqual(r.totals, { interns: 8, hired: 3, retained: 2 })
  assert.equal(SMALL_GROUP, 5)
  assert.deepEqual(residentReports({}).bySchool, [])
})

test('the migration: six nullable columns, an append-only titles table, the audit CHECK with both new types', () => {
  for (const c of ['hired_as', 'hired_as_other', 'licensed_at_application', 'nclex_passed_on', 'license_issued_on', 'backfilled']) {
    assert.match(MIG, new RegExp(`ADD COLUMN IF NOT EXISTS ${c} `))
  }
  assert.match(MIG, /CREATE TABLE IF NOT EXISTS public\.ngrp_resident_titles/)
  assert.match(MIG, /GRANT SELECT, INSERT ON TABLE public\.ngrp_resident_titles TO service_role/)
  assert.doesNotMatch(MIG, /GRANT [^\n]*UPDATE[^\n]*ngrp_resident_titles/)
  assert.match(MIG, /aspire_demo_inherit\('ngrp_candidates', 'candidate_id'\)/)
  assert.ok(NGRP_AUDIT_EVENTS.includes('hire_backfilled') && NGRP_AUDIT_EVENTS.includes('title_changed'))
  assert.ok(EVENT_LABELS.hire_backfilled && EVENT_LABELS.title_changed)
  const hiring = ACTION_GROUPS.find(g => g.key === 'hiring')
  assert.ok(hiring.types.includes('hire_backfilled') && hiring.types.includes('title_changed'))
})

test('the endpoint: hire_backfill is in the allowlist and Owner/Admin only; resident details are staff only; TA keeps outcome_set', () => {
  const api = read('api/ngrp-manage.js')
  const allowlist = api.slice(api.indexOf('const ACTIONS = new Set('), api.indexOf('const ELIGIBILITY_VOCAB'))
  assert.ok(allowlist.includes("'hire_backfill'"))
  assert.match(api, /action === 'hire_backfill'[\s\S]{0,400}owner_or_admin_only/)
  assert.match(api, /action === 'resident_details_set'[\s\S]{0,400}if \(isTalentAcquisition\) return res\.status\(403\)/)
  const outcome = api.slice(api.indexOf("action === 'outcome_set'"), api.indexOf("action === 'assign_unit'"))
  assert.doesNotMatch(outcome, /isTalentAcquisition/, 'Talent Acquisition records offers and hires')
  assert.match(outcome, /HIRE_HISTORY_KEYS/, 'saves without the new columns before the migration')
  assert.match(outcome, /licensedAtApplicationFor/)
})

// ── Record past hires ────────────────────────────────────────────────────────

const HEADERS = ['Id', 'ASPIRE Cohort', "Student's Full Legal Name (Last Name, First Name)", 'Personal Email', 'School', 'Applied for Cohort', 'Hired', 'As', 'Unit', 'Notes']

test('the header guess reads the intake export: name, email, Applied for Cohort, Hired, As, Unit; never ASPIRE Cohort', () => {
  const m = guessHireMapping(HEADERS)
  const by = Object.fromEntries(m.columns.filter(c => c.field !== IGNORE).map(c => [c.field, HEADERS[c.index]]))
  assert.deepEqual(by, {
    full_name: "Student's Full Legal Name (Last Name, First Name)", personal_email: 'Personal Email',
    residency_cohort: 'Applied for Cohort', hired: 'Hired', hired_as: 'As', hired_unit: 'Unit',
  })
  assert.equal(m.nameFormat, 'last_first')
  const s = sanitizeHireMapping({ columns: [{ index: 1, field: 'residency_cohort' }, { index: 5, field: 'residency_cohort' }, { index: 9, field: 'bogus' }] }, HEADERS)
  assert.deepEqual(s.columns.filter(c => c.field !== IGNORE), [{ index: 1, field: 'residency_cohort' }], 'one column per field, unknown fields dropped')
})

test('hired as reads the team\'s shorthand; a row reads hired from a word or a date', () => {
  assert.deepEqual(hiredAsFrom('GNT'), { hired_as: 'Graduate Nurse Tech', hired_as_other: null })
  assert.deepEqual(hiredAsFrom('CN I'), { hired_as: 'Clinical Nurse I', hired_as_other: null })
  assert.deepEqual(hiredAsFrom('Nurse Extern'), { hired_as: 'Other', hired_as_other: 'Nurse Extern' })
  const m = guessHireMapping(['Name', 'Hired', 'Unit', 'Applied for Cohort'])
  assert.deepEqual(hireRowValues(['Lee, Sam', 'Yes', '6 NE (Heart Transplant)', '2026 August'], m).values,
    { first_name: 'Sam', last_name: 'Lee', hired: true, hired_unit: '6 NE', residency_cohort: '2026 August' })
  assert.deepEqual(hireRowValues(['Lee, Sam', '3/2/2026', 'PACU', 'x'], m).values,
    { first_name: 'Sam', last_name: 'Lee', hired: true, hired_on: '2026-03-02', hired_unit: 'PACU', residency_cohort: 'x' })
  assert.equal(hireRowValues(['Lee, Sam', 'No', '', ''], m).values.hired, false)
})

test('the plan: one Completed match per row, a date needed, already-recorded skipped by the chosen cohort', () => {
  const m = guessHireMapping(['Name', 'Email', 'Hired', 'Hire date', 'Applied for Cohort'])
  const pool = [
    { id: 'a', first_name: 'Sam', last_name: 'Lee', personal_email: 'sam@x.com', status: 'Completed', cohort_name: 'Spring 2026' },
    { id: 'b', first_name: 'Ana', last_name: 'Cruz', status: 'Active Rotation', cohort_name: 'Fall 2026' },
    { id: 'c', first_name: 'Jo', last_name: 'Kim', status: 'Completed', cohort_name: 'Spring 2026' },
    { id: 'd', first_name: 'Jo', last_name: 'Kim', status: 'Completed', cohort_name: 'Summer 2026' },
  ]
  const rows = [
    ['Lee, Sam', 'sam@x.com', 'Yes', '3/2/2026', '2026 August'],
    ['Cruz, Ana', '', 'Yes', '3/2/2026', '2026 August'],
    ['Kim, Jo', '', 'Yes', '3/2/2026', '2026 August'],
    ['Nobody, New', '', 'Yes', '3/2/2026', '2026 August'],
    ['Lee, Sam', '', 'Yes', '', '2026 August'],
    ['Lee, Sam', 'sam@x.com', 'No', '', '2026 August'],
    ['Lee, Sam', 'sam@x.com', 'Yes', '', ''],
  ]
  const plan = planHires(rows, m, pool)
  assert.deepEqual(plan.map(p => [p.action, p.reason]), [
    ['record', 'record'], ['skip', 'not_completed'], ['skip', 'ambiguous'], ['skip', 'no_match'],
    ['skip', 'repeat_in_file'], ['skip', 'not_hired'], ['skip', 'repeat_in_file'],
  ])
  assert.equal(plan[0].match.id, 'a')
  assert.deepEqual(cohortValues(plan), [{ value: '2026 August', count: 1 }])
  // The same file against a record that already holds the hire, keyed by the chosen cohort.
  const again = planHires(rows.slice(0, 1), m, pool, { onRecord: ['a|august2026'], cohortKeyOf: () => 'august2026' })
  assert.deepEqual([again[0].action, again[0].reason], ['skip', 'already'])
  const noDate = planHires([['Lee, Sam', 'sam@x.com', 'Yes', '', '2026 August']], m, pool)
  assert.deepEqual([noDate[0].action, noDate[0].reason], ['ask', 'no_date'])
  assert.equal(suggestCycle('2026 August', [{ id: 'y', name: 'August 2026 Cohort' }]), null, 'word order differs: the person chooses')
  assert.equal(suggestCycle('Winter 2027', [{ id: 'y', name: 'Winter 2027' }]).id, 'y')
})
