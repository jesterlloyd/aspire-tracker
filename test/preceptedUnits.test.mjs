// PRECEPTED-UNITS-1 (Owner, 2026-11-02): an alumnus can precept on more than one unit (Emi
// Bayaraa: PACU and 6 NE). The form takes a list, the roster reads every placement on the record,
// and every reader shows all of them.
// CS-EMPLOYMENT-OTHER-1 (Owner, 2026-11-02): "Other" for CS employment carries what they wrote.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  formUnitPicks, formPreceptedUnits, formPreceptedUnitsText, recordPreceptedUnits, preceptedUnitsOfRow,
  assignmentUnits, csEmploymentText, MAX_PRECEPTED_UNITS,
} from '../src/lib/ngrp/preceptedUnits.js'
import { validateSubmission } from '../lib/server/ngrpTransition.js'
import { transitionSummaryRows } from '../src/lib/ngrp/transitionSummary.js'
import { preceptedUnitOf } from '../src/lib/ngrp/interestEligibilityModel.js'
import { rotatedUnits, unitFitFactor } from '../src/lib/ngrp/candidateScoreModel.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')

test('the form reads the list, and a revision from before the list as a list of one', () => {
  assert.deepEqual(formPreceptedUnits({ precepted_units: ['PACU', '6 NE'] }), ['PACU', '6 NE'])
  assert.deepEqual(formPreceptedUnits({ precepted_unit: '6 NE' }), ['6 NE'])
  assert.deepEqual(formPreceptedUnits({ precepted_units: ['6NE', '6 NE', ''] }), ['6NE'], 'one unit, however spelled')
  assert.deepEqual(formPreceptedUnits({ precepted_units: ['PACU', 'Other'], precepted_unit_other: 'Cath Lab' }), ['PACU', 'Cath Lab'])
  assert.deepEqual(formPreceptedUnits({ precepted_units: ['Other'], precepted_unit_other: '' }), [], 'an unnamed Other names no unit')
  assert.equal(formPreceptedUnitsText({ precepted_units: ['PACU', 'Other'] }), 'PACU, Other: not named')
  assert.deepEqual(formUnitPicks({}), [])
})

test('the record lists every placement not removed, primary first', () => {
  const rows = [
    { unit_key: '6 NE', role: 'additional', status: 'ended', start_date: '2026-07-08' },
    { unit_key: 'PACU', role: 'primary', status: 'active', start_date: null },
    { unit_key: '5 North', role: 'additional', status: 'removed', start_date: '2026-06-01' },
  ]
  assert.deepEqual(assignmentUnits(rows), ['PACU', '6 NE'])
  assert.deepEqual(recordPreceptedUnits({ precepted_unit: 'PACU' }), ['PACU'], 'an older payload with one unit')
})

test('a roster row: the record wins, else the form; the column shows every unit', () => {
  const emi = { student: { precepted_unit: 'PACU', precepted_units: ['PACU', '6 NE'] }, form_precepted_units: ['6 NE'] }
  assert.deepEqual(preceptedUnitsOfRow(emi), ['PACU', '6 NE'])
  assert.equal(preceptedUnitOf(emi), 'PACU, 6 NE')
  assert.equal(preceptedUnitOf({ student: {}, form_precepted_units: ['4 North', 'NICU'] }), '4 North, NICU')
  assert.equal(preceptedUnitOf({ student: { precepted_unit: '6 NE' }, form_precepted_unit: '4 North' }), '6 NE')
  assert.equal(preceptedUnitOf({ student: {} }), null)
})

test('unit fit counts any unit they precepted on', () => {
  const rotated = rotatedUnits({ preceptedUnit: ['PACU', '6 NE'], formPreceptedUnit: ['6 NE'], feedbackUnits: [] })
  assert.deepEqual(rotated, ['PACU', '6 NE'])
  assert.equal(unitFitFactor(['6 NE', '6 NW', '6 South'], rotated).points, 20)
  assert.deepEqual(rotatedUnits({ preceptedUnit: '6 NE', formPreceptedUnit: '6NE', feedbackUnits: ['5 North'] }), ['6 NE', '5 North'], 'single values still work')
})

const form = (over = {}) => ({
  identity: { preferred_email: 'a@b.co', cs_employment_status: 'not_employed', ...over.identity },
  aspire: { precepted_unit: '6 South', ...over.aspire },
})
const vs = p => validateSubmission(p, { requireComplete: false })
const vsFull = p => validateSubmission(p, { requireComplete: true })

test('the server keeps a list of catalog units, capped, with precepted_unit as its first', () => {
  const a = vs(form({ aspire: { precepted_units: ['PACU', '6 NE', 'Made-up Unit', 'PACU'] } })).payload.aspire
  assert.deepEqual(a.precepted_units, ['PACU', '6 NE'])
  assert.equal(a.precepted_unit, 'PACU')
  assert.deepEqual(vs(form()).payload.aspire.precepted_units, ['6 South'], 'a draft with one unit')
  const many = ['PACU', '6 NE', '6 NW', '6 South', '5 North', 'NICU']
  assert.equal(vs(form({ aspire: { precepted_units: many } })).payload.aspire.precepted_units.length, MAX_PRECEPTED_UNITS)
  assert.equal(vs(form({ aspire: { precepted_units: ['PACU'], precepted_unit_other: 'ignored' } })).payload.aspire.precepted_unit_other, '')
  const other = vs(form({ aspire: { precepted_units: ['PACU', 'Other'], precepted_unit_other: 'Cath Lab' } })).payload.aspire
  assert.equal(other.precepted_unit_other, 'Cath Lab')
  assert.ok(vsFull(form({ aspire: { precepted_units: ['PACU', 'Other'] } })).errors.some(e => e.field === 'aspire.precepted_unit_other'))
})

test('CS employment Other carries its text, and a complete form needs it', () => {
  const kept = vs(form({ identity: { cs_employment_status: 'other', cs_employment_other: ' Patient care tech ' } })).payload.identity
  assert.equal(kept.cs_employment_other, 'Patient care tech')
  assert.equal(vs(form({ identity: { cs_employment_status: 'per_diem', cs_employment_other: 'x' } })).payload.identity.cs_employment_other, '')
  assert.ok(vsFull(form({ identity: { cs_employment_status: 'other' } })).errors.some(e => e.field === 'identity.cs_employment_other'))
  assert.equal(csEmploymentText({ cs_employment_status: 'other', cs_employment_other: 'Volunteer' }), 'Other: Volunteer')
  assert.equal(csEmploymentText({ cs_employment_status: 'other' }), 'Other')
  assert.equal(csEmploymentText({ cs_employment_status: 'per_diem' }), 'Per diem')
})

test('the staff summary lists every unit and the Other text', () => {
  const rows = new Map(transitionSummaryRows({
    identity: { cs_employment_status: 'other', cs_employment_other: 'Volunteer' },
    aspire: { precepted_units: ['PACU', '6 NE'] },
  }))
  assert.equal(rows.get('Precepted units'), 'PACU, 6 NE')
  assert.equal(rows.get('CS employment'), 'Other: Volunteer')
})

test('every reader reads the lists', () => {
  assert.match(read('lib/server/ngrpResidencyExport.js'), /formPreceptedUnits\(form\.aspire\)\.join/)
  assert.match(read('lib/server/ngrpResidencyExport.js'), /csEmploymentText\(form\.identity\)/)
  assert.match(read('lib/server/ngrpApplicants.js'), /form_precepted_units: formPreceptedUnits/)
  assert.match(read('lib/server/ngrpApplicants.js'), /placementUnitsByStudent\(db/)
  assert.match(read('lib/server/keith/residencyChat.js'), /rotatedUnits: preceptedUnitsOfRow/)
  assert.match(read('api/portal/my-residency.js'), /placementUnitsByStudent\(db, \[student\.id\]\)/)
  const page = read('src/pages/NgrpTransitionFormPage.jsx')
  assert.match(page, /\+ Add another unit/)
  assert.match(page, /id="cso"/)
})
