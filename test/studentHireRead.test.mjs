// STUDENT-HIRE-READ-1 (Owner, 2026-11-05): Student Profiles > Placement shows the residency hire
// read-only, from the record the Residency binder's Hiring sheet keeps.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadStudentHires } from '../lib/server/ngrpStudentHire.js'
import { hireLines } from '../src/lib/ngrp/studentHireModel.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

function fakeDb(tables) {
  return {
    from(name) {
      const rows = tables[name] || []
      let filtered = [...rows]
      const q = {
        select() { return q },
        eq(col, v) { filtered = filtered.filter(r => r[col] === v); return q },
        not(col) { filtered = filtered.filter(r => r[col] != null); return q },
        in(col, vs) { filtered = filtered.filter(r => vs.includes(r[col])); return q },
        then(res) { return Promise.resolve({ data: filtered, error: null }).then(res) },
      }
      return q
    },
  }
}

test('a student\'s hires read most recent first, with the current title and no contact details', async () => {
  const db = fakeDb({
    ngrp_residency_outcomes: [
      { candidate_id: 'c1', cycle_id: 'y1', student_id: 's1', hired_at: '2026-08-14T12:00:00Z', hired_unit: '7 South', residency_start_date: '2026-08-14', separated_at: null, position_title: 'Clinical Nurse I', hired_as: 'Clinical Nurse I', phone: '555', cs_email: 'x@cshs.org' },
      { candidate_id: 'c2', cycle_id: 'y2', student_id: 's2', hired_at: '2026-02-02T12:00:00Z', hired_unit: '6 NE' },
      { candidate_id: 'c3', cycle_id: 'y1', student_id: 's1', hired_at: null },
    ],
    ngrp_resident_titles: [{ candidate_id: 'c1', title: 'Clinical Nurse II', effective_on: '2026-10-01', created_at: '2026-10-01' }],
    ngrp_cycles: [{ id: 'y1', name: 'Summer 2026' }, { id: 'y2', name: 'Winter 2026' }],
  })
  const r = await loadStudentHires(db, 's1')
  assert.equal(r.state, 'ok')
  assert.equal(r.hires.length, 1)
  const h = r.hires[0]
  assert.equal(h.cohort_name, 'Summer 2026')
  assert.equal(h.unit, '7 South')
  assert.equal(h.hired_as_label, 'CN I')
  assert.equal(h.current_title, 'Clinical Nurse II')
  assert.equal(h.affiliated, true)
  for (const k of ['phone', 'cs_email', 'personal_email', 'preceptor', 'separation_reason', 'student']) assert.ok(!(k in h), `${k} must not leave`)
})

test('no hire reads as an empty list', async () => {
  const r = await loadStudentHires(fakeDb({ ngrp_residency_outcomes: [] }), 's9')
  assert.deepEqual(r, { state: 'ok', provisioned: true, hires: [] })
})

test('the lines name the cohort, unit, position, title, date and whether they are still here', () => {
  const lines = Object.fromEntries(hireLines({ cohort_name: 'Summer 2026', unit: '7 South', hired_as_label: 'CN I', current_title: 'Clinical Nurse I', hired_at: '2026-08-14T12:00:00Z', affiliated: true }))
  assert.equal(lines['Hired on'], 'Aug 14, 2026')
  assert.equal(lines['Still at Cedars-Sinai'], 'Yes')
  const gone = Object.fromEntries(hireLines({ affiliated: false, separated_at: '2026-10-01T12:00:00Z' }))
  assert.equal(gone['Still at Cedars-Sinai'], 'No, separated Oct 1, 2026')
  assert.equal(gone['Hired into unit'], 'Not recorded')
})

test('the endpoint serves it to the ASPIRE team only, and the chart reads it, never writes it', () => {
  const ep = read('api/ngrp-workspace.js')
  assert.match(ep, /'student_hire'\]\)/)
  assert.match(ep, /action === 'student_hire'[\s\S]{0,200}caller\.audience !== 'staff'[\s\S]{0,40}403/)
  const comp = read('src/components/student/ResidencyHireOnRecord.jsx')
  assert.match(comp, /student\?\.status === 'Completed'/)
  assert.match(comp, /residentRecordPath\('\/ngrp', h\.candidate_id\)/)
  assert.doesNotMatch(comp, /postNgrpManage|<input|<select/)
  assert.match(read('src/components/StudentSidePanel.jsx'), /<ResidencyHireOnRecord student=\{data\} \/>/)
})
