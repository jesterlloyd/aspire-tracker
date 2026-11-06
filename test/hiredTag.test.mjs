// HIRED-TAG-1 (Owner, 2026-11-05): a hired alumnus keeps the Completed ASPIRE status and wears a
// Hired tag beside it, read from the residency hire record. What these tests hold:
//   - the tag's words (Hired · unit · CN I; Separated · unit) and no tag without a hire;
//   - the batch reader keeps each student's latest hire and degrades before the table exists;
//   - the status is never rewritten: no screen writes 'Hired' into students.status.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hireTag } from '../src/lib/ngrp/studentHireModel.js'
import { loadHireTags } from '../lib/server/ngrpStudentHire.js'

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')

test('the tag reads Hired with unit and role, or Separated', () => {
  const t = hireTag({ hired_at: '2026-08-14', unit: '6 NE', hired_as_label: 'CN I', cohort_name: 'Summer 2026', affiliated: true })
  assert.equal(t.label, 'Hired · 6 NE · CN I')
  assert.equal(t.short, 'Hired')
  assert.match(t.title, /Summer 2026/)
  const s = hireTag({ hired_at: '2026-08-14', unit: '6 NE', hired_as_label: 'CN I', affiliated: false })
  assert.equal(s.label, 'Separated · 6 NE')
  assert.equal(hireTag({ hired_at: '2026-08-14', affiliated: true }).label, 'Hired')
  assert.equal(hireTag(null), null)
  assert.equal(hireTag({}), null)
})

function fakeDb(tables, { missing = false } = {}) {
  return {
    from(name) {
      const q = { rows: tables[name] || [], filters: [] }
      const chain = {
        select() { return chain },
        in(col, vals) { q.rows = q.rows.filter(r => vals.includes(r[col])); return chain },
        not(col) { q.rows = q.rows.filter(r => r[col] != null); return chain },
        then(res, rej) {
          if (missing && name === 'ngrp_residency_outcomes') return Promise.resolve({ data: null, error: { code: '42P01', message: 'relation "ngrp_residency_outcomes" does not exist' } }).then(res, rej)
          return Promise.resolve({ data: q.rows, error: null }).then(res, rej)
        },
      }
      return chain
    },
  }
}

test('the batch reader keeps each student\'s latest hire', async () => {
  const db = fakeDb({
    ngrp_residency_outcomes: [
      { student_id: 'a', cycle_id: 'c1', hired_at: '2025-10-20', hired_unit: '5 N', separated_at: null, hired_as: 'Graduate Nurse Trainee' },
      { student_id: 'a', cycle_id: 'c2', hired_at: '2026-08-14', hired_unit: '6 NE', separated_at: null, hired_as: 'Clinical Nurse I' },
      { student_id: 'b', cycle_id: 'c1', hired_at: '2025-10-20', hired_unit: 'PACU', separated_at: '2026-03-01', hired_as: 'Clinical Nurse I' },
      { student_id: 'x', cycle_id: 'c1', hired_at: null, hired_unit: '4 W' },
    ],
    ngrp_cycles: [{ id: 'c1', name: 'Fall 2025' }, { id: 'c2', name: 'Summer 2026' }],
  })
  const r = await loadHireTags(db, ['a', 'b', 'x'])
  assert.equal(r.state, 'ok')
  assert.deepEqual(Object.keys(r.tags).sort(), ['a', 'b'])
  assert.equal(r.tags.a.unit, '6 NE')
  assert.equal(r.tags.a.hired_as_label, 'CN I')
  assert.equal(r.tags.a.cohort_name, 'Summer 2026')
  assert.equal(r.tags.b.affiliated, false)
})

test('before the hire table exists, no tags and no error', async () => {
  const r = await loadHireTags(fakeDb({}, { missing: true }), ['a'])
  assert.deepEqual(r, { state: 'ok', provisioned: false, tags: {} })
})

test('the list and the plate show the tag; nothing writes Hired as a status', () => {
  const list = read('src/components/StudentListPanel.jsx')
  const plate = read('src/components/StudentSidePanel.jsx')
  assert.match(list, /fetchHireTags\(completedIds\)/)
  assert.match(list, /data-testid="list-hire-tag"/)
  assert.match(plate, /data-testid="plate-hire-tag"/)
  assert.match(read('api/ngrp-workspace.js'), /action === 'hire_tags'[\s\S]{0,120}caller\.audience !== 'staff'/)
  for (const src of [list, plate]) assert.doesNotMatch(src, /status:\s*'Hired'/)
})
