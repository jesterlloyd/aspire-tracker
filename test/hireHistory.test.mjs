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
  // HIRE-HISTORY-2 (Owner, 2026-11-04): GNT is Graduate Nurse Trainee; one licensure date
  // (license issued) and the interim permit, which replaced the NCLEX date.
  assert.deepEqual([...HIRED_AS], ['Clinical Nurse I', 'Graduate Nurse Trainee', 'Other'])
  const ok = validateHireHistory({ hired_as: 'Graduate Nurse Trainee', licensed_at_application: 'no', license_issued_on: '2026-09-01', interim_permit_issued: true })
  assert.deepEqual(ok, { ok: true, fields: { hired_as: 'Graduate Nurse Trainee', hired_as_other: null, licensed_at_application: false, license_issued_on: '2026-09-01', interim_permit_issued: true } })
  assert.equal(validateHireHistory({ hired_as: 'Graduate Nurse Tech' }).ok, false, 'the old spelling is refused')
  assert.equal(validateHireHistory({}).fields.interim_permit_issued, null)
  assert.equal(validateHireHistory({ interim_permit_issued: 'maybe' }).ok, false)
  assert.equal('nclex_passed_on' in validateHireHistory({ nclex_passed_on: '2026-01-01' }).fields, false, 'the NCLEX date is not written')
  assert.equal(validateHireHistory({ hired_as: 'Other' }).ok, false, 'Other without words')
  assert.equal(validateHireHistory({ hired_as: 'Other', hired_as_other: 'Nurse Extern' }).fields.hired_as_other, 'Nurse Extern')
  assert.equal(validateHireHistory({ hired_as: 'Nurse Boss' }).ok, false)
  assert.equal(validateHireHistory({ license_issued_on: 'last May' }).ok, false)
  assert.equal(validateHireHistory({}).fields.licensed_at_application, null, 'unknown stays unknown')
  assert.equal(hiredAsLabel({ hired_as: 'Other', hired_as_other: 'Nurse Extern' }), 'Nurse Extern')
  assert.equal(hiredAsLabel({ hired_as: 'Clinical Nurse I' }), 'CN I')
  assert.equal(hiredAsLabel({ hired_as: 'Graduate Nurse Trainee' }), 'GNT')
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
  const v = validateBackfillHire({ hired_on: '2026-03-02', hired_unit: '6 NE', hired_as: 'Graduate Nurse Trainee', position_title: 'Clinical Nurse I', separated_on: '2026-09-30', separation_reason: 'Moved' })
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
    outcomes: [{ candidate_id: 'c1', student_id: 's1', cycle_id: 'y1', hired_at: '2026-03-02T12:00:00Z', hired_unit: '6 NE', position_title: 'RN Resident', hired_as: 'Graduate Nurse Trainee', licensed_at_application: false, license_issued_on: '2026-04-10', interim_permit_issued: true, backfilled: true }],
    candidates: [{ id: 'c1', cycle_id: 'y1', student_id: 's1' }],
    students: [{ id: 's1', first_name: 'A', last_name: 'B' }],
    cycles: [{ id: 'y1', name: 'Spring 2026' }],
    titles: { c1: [{ title: 'RN Resident', effective_on: '2026-03-02' }, { title: 'Clinical Nurse I', effective_on: '2026-09-01', created_at: '2026-09-01T00:00:00Z' }] },
  })
  const r = rows[0]
  assert.equal(r.current_title, 'Clinical Nurse I')
  assert.deepEqual(r.titles.map(t => t.title), ['Clinical Nurse I', 'RN Resident'])
  assert.equal(r.hired_as_label, 'GNT')
  assert.equal(r.licensed_at_application, false)
  assert.equal(r.license_issued_on, '2026-04-10')
  assert.equal(r.interim_permit_issued, true)
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
  assert.deepEqual(hiredAsFrom('GNT'), { hired_as: 'Graduate Nurse Trainee', hired_as_other: null })
  assert.deepEqual(hiredAsFrom('Graduate Nurse Trainee'), { hired_as: 'Graduate Nurse Trainee', hired_as_other: null })
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
  // HIRE-HISTORY-3 changed this: a row with no hire date is recorded on its cohort's date.
  assert.deepEqual([noDate[0].action, noDate[0].reason], ['record', 'record'])
  assert.equal(suggestCycle('2026 August', [{ id: 'y', name: 'August 2026 Cohort' }]), null, 'word order differs: the person chooses')
  assert.equal(suggestCycle('Winter 2027', [{ id: 'y', name: 'Winter 2027' }]).id, 'y')
})

test('HIRE-HISTORY-2: the migration renames GNT, adds the permit, and the sheet picks units and opens Record hire', () => {
  const mig = read('supabase/migrations/20261125000000_hire_gnt_interim_permit.sql')
  assert.match(mig, /UPDATE public\.ngrp_residency_outcomes SET hired_as = 'Graduate Nurse Trainee' WHERE hired_as = 'Graduate Nurse Tech'/)
  assert.match(mig, /IN \('Clinical Nurse I', 'Graduate Nurse Trainee', 'Other'\)/)
  assert.match(mig, /ADD COLUMN IF NOT EXISTS interim_permit_issued boolean/)
  assert.doesNotMatch(mig, /DROP COLUMN IF EXISTS nclex_passed_on;?\s*$/m)
  const drawer = read('src/components/ngrp/ApplicantDrawer.jsx')
  assert.match(drawer, /function HireUnitPicker/)
  assert.equal((drawer.match(/<HireUnitPicker /g) || []).length, 2, 'both hire forms pick from the catalog')
  assert.doesNotMatch(drawer, /placeholder="Unit name"/)
  assert.match(drawer, /Interim permit issued/)
  assert.doesNotMatch(drawer, /NCLEX passed on/)
  assert.match(drawer, /openBackfill=\{initialSheet === 'hiring'\}/)
  // Record hire chooses the row AND sets ?sheet=hiring; the binder must still read the sheet.
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.doesNotMatch(tab, /initialSheet=\{[^}]*!drawerRowId/)
  const m = guessHireMapping(['Name', 'License Issue Date', 'Interim Permit'])
  assert.deepEqual(m.columns.map(c => c.field), ['full_name', 'license_issued_on', 'interim_permit_issued'])
  assert.deepEqual(hireRowValues(['Lee, Sam', '4/10/2026', 'Yes'], m).values, { first_name: 'Sam', last_name: 'Lee', license_issued_on: '2026-04-10', interim_permit_issued: true })
})

test('HIRE-HISTORY-3: a past hire is recorded by its NGRP cohort, and the title is picked from one list', async () => {
  const { cohortHireDate, canonicalTitle, TITLE_SHORT, POSITION_TITLES } = await import('../src/lib/ngrp/ngrpResidents.js')
  const spring = { id: 's', name: 'Spring 2026', residency_start_date: '2026-03-02', application_open_date: '2025-10-01' }
  assert.equal(cohortHireDate(spring), '2026-03-02')
  assert.equal(cohortHireDate({ application_open_date: '2025-10-01' }), '2025-10-01')
  assert.equal(cohortHireDate({}), null)
  const v = validateBackfillHire({ hired_unit: '6 NE', position_title: 'CN II' }, { cohort: spring })
  assert.equal(v.ok, true)
  assert.equal(v.hire.hired_at, '2026-03-02T12:00:00.000Z')
  assert.equal(v.hire.residency_start_date, '2026-03-02')
  assert.equal(v.hire.position_title, 'Clinical Nurse II')
  const none = validateBackfillHire({ hired_unit: '6 NE' }, { cohort: { name: 'Fall 2019' } })
  assert.equal(none.ok, false)
  assert.match(none.errors[0].message, /Fall 2019 has no residency start date/)
  assert.equal(validateBackfillHire({ hired_on: '2026-04-01', hired_unit: '6 NE' }, { cohort: spring }).hire.hired_at, '2026-04-01T12:00:00.000Z', 'a typed date still wins')
  assert.deepEqual(POSITION_TITLES.map(t => TITLE_SHORT[t]), ['CN I', 'CN II', 'CN III', 'CN IV', 'ANM', 'AD', 'NPD-P', 'CNS'])
  assert.equal(canonicalTitle('npd-p'), 'Nursing Professional Development Practitioner')
  assert.equal(canonicalTitle('RN Resident'), 'RN Resident', 'an older title keeps its words')
  assert.equal(validateResidentDetails({ position_title: 'ANM' }).details.position_title, 'Assistant Nurse Manager')
  const drawer = read('src/components/ngrp/ApplicantDrawer.jsx')
  assert.match(drawer, />NGRP cohort</)
  assert.doesNotMatch(drawer, />Hired on</)
  assert.equal((drawer.match(/<ResidentTitlePicker /g) || []).length, 1)
  assert.match(read('src/components/ngrp/ResidentDetailsSection.jsx'), /<ResidentTitlePicker /)
  assert.match(read('api/ngrp-manage.js'), /validateBackfillHire\(body, \{ cohort: cyc\.data \}\)/)
  assert.match(read('lib/server/hireImport.js'), /\}, \{ cohort: cyc \}\)/)
})

test('COHORT-ORDER-1: cohorts read in calendar order, and the seven past residency cohorts are seeded', async () => {
  const { cohortTimelineKey, sortByCohortTimeline } = await import('../src/lib/cohortTimeline.js')
  const names = ['Fall 2026', 'Winter 2027', 'Spring 2026', 'Summer 2026', 'Demo Cohort', 'Spring 2027']
  const asItems = names.map(name => ({ name }))
  assert.deepEqual(sortByCohortTimeline(asItems).map(c => c.name),
    ['Spring 2026', 'Summer 2026', 'Fall 2026', 'Winter 2027', 'Spring 2027', 'Demo Cohort'])
  assert.deepEqual(sortByCohortTimeline(asItems, { newestFirst: true }).map(c => c.name),
    ['Spring 2027', 'Winter 2027', 'Fall 2026', 'Summer 2026', 'Spring 2026', 'Demo Cohort'])
  assert.equal(cohortTimelineKey('Demo Residency Cohort'), null)
  const mig = read('supabase/migrations/20261127100000_past_residency_cohorts.sql')
  for (const [name, day] of [['Winter 2025', '2025-02-03'], ['Spring 2025', '2025-05-12'], ['Summer 2025', '2025-08-11'],
    ['Fall 2025', '2025-10-20'], ['Winter 2026', '2026-02-02'], ['Spring 2026', '2026-05-18'], ['Summer 2026', '2026-08-14']]) {
    assert.match(mig, new RegExp(`\\('${name}', +'Completed', false, false, DATE '${day}'`))
  }
  assert.match(mig, /ON CONFLICT \(name\) DO NOTHING/)
  assert.doesNotMatch(mig, /'Winter 2027'/)
  assert.match(read('src/components/ngrp/ApplicantDrawer.jsx'), /sortByCohortTimeline\([\s\S]*newestFirst: true/)
})

test('the past residency cohorts are corrected: four cohorts, the Owner\'s dates, Summer 2026 hires follow', () => {
  const mig = read('supabase/migrations/20261127200000_past_residency_cohorts_fix.sql')
  assert.match(mig, /DELETE FROM public\.ngrp_cycles\s+WHERE name IN \('Winter 2025', 'Spring 2025', 'Summer 2025'\) AND notes LIKE 'Added by HIRE-HISTORY-3%'/)
  assert.match(mig, /RAISE EXCEPTION 'PRECHECK FAILED/)
  for (const [name, day] of [['Winter 2026', '2026-02-03'], ['Spring 2026', '2026-05-12'], ['Summer 2026', '2026-08-11']]) {
    assert.match(mig, new RegExp(`residency_start_date = DATE '${day}', updated_at = now\\(\\)\\s+WHERE name = '${name}'`))
  }
  assert.doesNotMatch(mig, /'Fall 2025'/, 'Fall 2025 was right and is untouched')
  assert.match(mig, /SET hired_at = TIMESTAMPTZ '2026-08-11 12:00:00\+00'/)
  assert.match(mig, /o\.backfilled = true AND o\.hired_at = TIMESTAMPTZ '2026-08-14 12:00:00\+00'/)
})

test('COHORT-ORDER-2: the eight residency cohorts are restored with the Owner\'s first dates', () => {
  const mig = read('supabase/migrations/20261127300000_past_residency_cohorts_restore.sql')
  for (const [name, day] of [['Winter 2025', '2025-02-03'], ['Spring 2025', '2025-05-12'], ['Summer 2025', '2025-08-11']]) {
    assert.match(mig, new RegExp(`\\('${name}', 'Completed', false, false, DATE '${day}'`))
  }
  assert.match(mig, /ON CONFLICT \(name\) DO NOTHING/)
  for (const [name, day] of [['Winter 2026', '2026-02-02'], ['Spring 2026', '2026-05-18'], ['Summer 2026', '2026-08-14']]) {
    assert.match(mig, new RegExp(`residency_start_date = DATE '${day}', updated_at = now\\(\\)\\s+WHERE name = '${name}'`))
  }
  assert.doesNotMatch(mig, /'Fall 2025'|'Winter 2027'/, 'Fall 2025 and Winter 2027 are untouched')
  assert.match(mig, /SET hired_at = TIMESTAMPTZ '2026-08-14 12:00:00\+00'/)
  assert.match(mig, /o\.backfilled = true AND o\.hired_at = TIMESTAMPTZ '2026-08-11 12:00:00\+00'/)
})
