// RESIDENTS-1 (Owner, 2026-09-14): Residency > Residents, the hired new grads and the
// retention tracker, in the staff app and the Residency Portal alike.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  POSITION_TITLES, validateResidentDetails, composeResidents, retentionSummary,
  preceptorFromReflection, phoneFromForm, separationTimestamp,
} from '../src/lib/ngrp/ngrpResidents.js'
import { ngrpSubTabs } from '../src/lib/ngrp/ngrpTabs.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const workspace = read('src/components/ngrp/NgrpWorkspace.jsx')
const portal = read('src/portal/residency/ResidencyPortal.jsx')
const tab = read('src/components/ngrp/ResidentsTab.jsx')
const support = read('api/ngrp-support.js')
const manage = read('api/ngrp-manage.js')
const loader = read('lib/server/ngrpResidents.js')
const migration = read('supabase/migrations/20260919000000_ngrp_resident_details.sql')
const gate = read('docs/security/OWNER_SQL_GATE.md')

test('Residency reads Placement Board | Residents | Activity', () => {
  assert.deepEqual(ngrpSubTabs('residency').map(s => [s.id, s.label]), [
    ['board', 'Placement Board'], ['residents', 'Residents'], ['activity', 'Activity'],
  ])
})

test('one component serves both surfaces: the portal mounts the same workspace', () => {
  assert.match(workspace, /import ResidentsTab from '\.\/ResidentsTab'/)
  assert.match(workspace, /tab === 'residency' && subTab === 'residents' && \(\s*<ResidentsTab cycle=\{cycle\} canManage=\{canManage\} toast=\{toast\} \/>/)
  assert.match(portal, /import NgrpWorkspace from '\.\.\/\.\.\/components\/ngrp\/NgrpWorkspace'/)
})

test('the title list and the edit validator', () => {
  assert.deepEqual(POSITION_TITLES, ['RN Resident', 'Clinical Nurse I', 'Clinical Nurse II', 'Clinical Nurse III'])
  const ok = validateResidentDetails({
    position_title: ' Clinical Nurse I ', preceptor_name: 'Ana Lim, RN', phone: '(310) 555-0100',
    separated_on: '2027-06-30', separation_reason: 'Relocated',
  }, { hiredAt: '2027-01-10T17:00:00Z' })
  assert.deepEqual(ok, { ok: true, details: {
    position_title: 'Clinical Nurse I', preceptor_name: 'Ana Lim, RN', phone: '(310) 555-0100',
    separated_at: separationTimestamp('2027-06-30'), separation_reason: 'Relocated',
  } })
  // Blank clears every field; still affiliated.
  assert.deepEqual(validateResidentDetails({}).details, {
    position_title: null, preceptor_name: null, phone: null, separated_at: null, separation_reason: null,
  })
  const bad = validateResidentDetails({ phone: 'call me', separated_on: '2026-12-01', separation_reason: '' }, { hiredAt: '2027-01-10T17:00:00Z' })
  assert.equal(bad.ok, false)
  assert.deepEqual(bad.errors.map(e => e.field).sort(), ['phone', 'separated_on'])
  assert.deepEqual(validateResidentDetails({ separation_reason: 'Left' }).errors.map(e => e.field), ['separated_on'])
})

test('preceptor and phone fall back to what the resident answered, typed values win', () => {
  assert.equal(preceptorFromReflection({ about: { preceptor_names: '  Marcus Reed, RN ' } }), 'Marcus Reed, RN')
  assert.equal(phoneFromForm({ identity: { preferred_phone: '818-555-0199' } }), '818-555-0199')
  assert.equal(preceptorFromReflection(null), null)

  const rows = composeResidents({
    outcomes: [
      { candidate_id: 'c1', cycle_id: 'w27', student_id: 's1', hired_at: '2027-01-10T17:00:00Z', hired_unit: '5 South', shift: 'Night', cs_email: 'ann.b@cshs.org' },
      { candidate_id: 'c2', cycle_id: 's27', student_id: 's2', hired_at: '2027-06-01T17:00:00Z', hired_unit: 'PACU', preceptor_name: 'Typed Name', phone: '310-555-0000', separated_at: '2027-09-01T12:00:00.000Z', separation_reason: 'Relocated' },
      { candidate_id: 'c3', cycle_id: 'w27', student_id: 's3', hired_at: null },
    ],
    candidates: [{ id: 'c1', cycle_id: 'w27', student_id: 's1', assigned_unit: '5 South' }],
    students: [
      { id: 's1', first_name: 'Ann', last_name: 'Zeller', personal_email: 'ann@gmail.com' },
      { id: 's2', first_name: 'Bo', last_name: 'Abbott' },
    ],
    cycles: [{ id: 'w27', name: 'Winter 2027' }, { id: 's27', name: 'Summer 2027' }],
    formPhones: { c1: '818-555-0199', c2: '999-555-0000' },
    reflectionPreceptors: { c1: 'Marcus Reed, RN', c2: 'Ignored' },
  })
  // Not hired: not a resident. Sorted by last name.
  assert.deepEqual(rows.map(r => r.candidate_id), ['c2', 'c1'])
  const [bo, ann] = rows
  assert.deepEqual(ann.preceptor, { value: 'Marcus Reed, RN', source: 'reflection' })
  assert.deepEqual(ann.phone, { value: '818-555-0199', source: 'form' })
  assert.deepEqual([ann.cohort_name, ann.unit, ann.shift, ann.cs_email, ann.personal_email, ann.affiliated], ['Winter 2027', '5 South', 'Night', 'ann.b@cshs.org', 'ann@gmail.com', true])
  assert.deepEqual(bo.preceptor, { value: 'Typed Name', source: 'record' })
  assert.deepEqual(bo.phone, { value: '310-555-0000', source: 'record' })
  assert.deepEqual([bo.affiliated, bo.separation_reason], [false, 'Relocated'])

  assert.deepEqual(retentionSummary(rows), { hired: 2, affiliated: 1, separated: 1, rate: 50 })
  assert.deepEqual(retentionSummary([]), { hired: 0, affiliated: 0, separated: 0, rate: null })
})

test('per cohort by default, Aggregate on demand', () => {
  assert.match(tab, /useState\(RESIDENTS_SCOPES\.COHORT\)/)
  assert.match(tab, /\{ key: RESIDENTS_SCOPES\.AGGREGATE, label: 'Aggregate' \}/)
  assert.match(tab, /\{aggregate && <th className="aspire-th">Cohort<\/th>\}/)
  for (const h of ['Resident', 'Unit', 'Shift', 'Hire Date', 'Position/Title', 'Preceptor', 'Email/Phone', 'Affiliation']) {
    assert.ok(tab.includes(`<th className="aspire-th">${h}</th>`), `column ${h}`)
  }
  // Edit follows the workspace's manage capability.
  assert.match(tab, /\{canManage && <th className="aspire-th aspire-th-right">/)
})

test('the read action is reachable by both audiences and narrowed for Talent Acquisition', () => {
  assert.match(support, /const ACTIONS = new Set\(\['summary', 'residents', /)
  assert.doesNotMatch(support.slice(support.indexOf('const WRITES'), support.indexOf('const TEAM_ONLY')), /residents/)
  assert.match(support, /loadResidents\(db, \{ cycleId: aggregate \? null : cycleId, talentAcquisition: isTA \}\)/)
  assert.match(loader, /if \(talentAcquisition\) \{\s*\n\s*const submitted = new Set\(liveAssignments\.filter\(a => hasSubmittedForm\(a\.status\)\)/)
  // Answers leave the server reduced to one value each; the school email is never read.
  assert.doesNotMatch(loader, /school_email/)
  assert.match(loader, /phoneFromForm\(rev\.payload\)/)
  assert.match(loader, /preceptorFromReflection\(s\.payload\)/)
})

test('the write action is in the allowlist AND has a block, and only touches a recorded hire', () => {
  const allowlist = manage.slice(manage.indexOf('const ACTIONS = new Set('), manage.indexOf('const ELIGIBILITY_VOCAB'))
  assert.match(allowlist, /'resident_details_set'/)
  const block = manage.slice(manage.indexOf("if (action === 'resident_details_set')"), manage.indexOf("if (action === 'eligibility_recalculate') {"))
  assert.ok(block.length > 0)
  assert.match(block, /Record the hire on the Placement Board before adding resident details\./)
  assert.match(block, /validateResidentDetails\(body, \{ hiredAt: existing\.data\.hired_at \}\)/)
  assert.match(block, /\.update\(\{ \.\.\.v\.details, recorded_by_profile_id: actorId, updated_at: nowIso \}\)/)
  // The Talent Acquisition submitted-form gate runs before every candidate action.
  assert.ok(manage.indexOf('if (isTalentAcquisition) {\n      const submittedCheck') < manage.indexOf("if (action === 'resident_details_set')"))
})

test('the migration is additive, Owner-gated and in the ledger', () => {
  for (const col of ['position_title', 'preceptor_name', 'phone']) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${col} text`))
  }
  assert.match(migration, /APPLY MANUALLY \(Owner\/Jester\)\. Claude Code has applied NOTHING\./)
  assert.doesNotMatch(migration, /^\s*(DROP|DELETE|UPDATE)\b/m)
  // Applied by the Owner 2026-09-14, every check as expected.
  assert.match(gate, /\| 20260919000000_ngrp_resident_details\.sql \| RESIDENTS-1, .*\*\*APPLIED 2026-09-14 by the Owner\.\*\*/)
})
