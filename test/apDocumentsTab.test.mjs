// AP-DOCUMENTS-TAB-1 (Owner, 2026-11-17): Academic Partner Portal > Documents replaced Forms. One
// row per student, one column per document, an Upload button in every empty cell, and words that
// never call a document required. Forms is the tab's second view, and a never-sent draft can be
// deleted. These pin the pure model, the server read's scoping, the routes and the words.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sheetColumns, sheetCell, columnCounts, gapsFor, onSheet, SHEET_GUIDANCE } from '../src/lib/ap/documentSheet.js'
import { loadDocumentSheet } from '../lib/server/schoolStudentRecords.js'
import { SCHOOL_WRITES, schoolFormAction } from '../lib/server/forms/schoolForms.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const S1 = 'a1111111-1111-4111-8111-111111111111'
const S2 = 'a2222222-2222-4222-8222-222222222222'
const TYPES = [
  { key: 'clr_tb', label: 'TB Screening', check_kind: 'expiry_date', school_key: null },
  { key: 'clr_background', label: 'Background Check', check_kind: 'file', school_key: null },
  { key: 'sc_ucla', label: 'Hep B titer', check_kind: 'file', school_key: 'UCLA' },
  { key: 'sc_csun', label: 'CSUN waiver', check_kind: 'file', school_key: 'CSUN' },
]

test('columns are ASPIRE\'s list, then this school\'s own items only', () => {
  const cols = sheetColumns(TYPES, 'UCLA')
  assert.deepEqual(cols.map(c => c.key), ['clr_tb', 'clr_background', 'sc_ucla'])
  assert.equal(cols[0].dateLabel, 'Expiration date')
  assert.equal(cols[2].own, true)
})

test('a cell is on file, expired, or not on file; counts and gaps follow', () => {
  const cols = sheetColumns(TYPES, 'UCLA')
  const cells = {
    [S1]: { clr_tb: { version_id: 'v1', file_name: 'tb.pdf', uploaded_at: '2026-10-01T00:00:00Z', doc_date: '2026-11-01' }, clr_background: { version_id: 'v2', file_name: 'bg.pdf', uploaded_at: '2026-10-02T00:00:00Z' }, sc_ucla: { version_id: 'v3' } },
    [S2]: { clr_tb: { version_id: 'v4', doc_date: '2027-06-01' } },
  }
  assert.equal(sheetCell(cells[S1].clr_tb, cols[0], '2026-11-17').state, 'expired')
  assert.equal(sheetCell(cells[S2].clr_tb, cols[0], '2026-11-17').dateWord, 'Expires')
  assert.equal(sheetCell(undefined, cols[1], '2026-11-17').state, 'none')
  const counts = columnCounts(cols, [S1, S2], cells, '2026-11-17')
  assert.deepEqual(counts.clr_tb, { onFile: 2, expired: 1 })
  assert.deepEqual(counts.clr_background, { onFile: 1, expired: 0 })
  assert.deepEqual(gapsFor(cols, cells[S1], '2026-11-17'), ['TB Screening'], 'an expired file is a gap')
  assert.deepEqual(gapsFor(cols, cells[S2], '2026-11-17'), ['Background Check', 'Hep B titer'])
  assert.equal(onSheet({ status: 'Not Proceeding' }), false)
  assert.equal(onSheet({ status: 'Active Rotation' }), true)
  assert.doesNotMatch(SHEET_GUIDANCE, /must|mandatory|required documents/i)
  assert.match(SHEET_GUIDANCE, /what your school requires/)
})

function fakeDb(tables) {
  return {
    from(table) {
      let rows = [...(tables[table] || [])]
      const q = {
        select() { return q },
        eq(k, v) { rows = rows.filter(r => r[k] === v); return q },
        in(k, vs) { rows = rows.filter(r => vs.includes(r[k])); return q },
        order() { return q },
        then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej) },
      }
      return q
    },
  }
}

test('the sheet answers only students and items the caller\'s scopes admit', async () => {
  const db = fakeDb({
    student_document_types: TYPES.map((t, i) => ({ ...t, active: true, checklist: 'clearance', sort_order: i, required: t.school_key == null })),
    students: [{ id: S1, school: 'UCLA', cohort_id: 'k1' }, { id: S2, school: 'CSUN', cohort_id: 'k1' }],
    student_documents: [
      { student_id: S1, doc_type: 'clr_tb', current_version_id: 'v1' },
      { student_id: S2, doc_type: 'clr_tb', current_version_id: 'v2' },
    ],
    student_document_versions: [{ id: 'v1', file_name: 'tb.pdf', uploaded_at: '2026-10-01', doc_date: '2027-01-01' }, { id: 'v2', file_name: 'x.pdf' }],
  })
  const r = await loadDocumentSheet(db, [{ school_key: 'UCLA', cohort_id: null }], [S1, S2, 'nope'])
  assert.deepEqual(Object.keys(r.students), [S1])
  assert.deepEqual(Object.keys(r.cells), [S1])
  assert.equal(r.cells[S1].clr_tb.file_name, 'tb.pdf')
  assert.ok(!r.types.some(t => t.key === 'sc_csun'), 'another school\'s item is not listed')
  assert.ok(!JSON.stringify(r).includes('storage_path'))
  const many = Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
  assert.equal((await loadDocumentSheet(db, [], many)).error, 'too_many')
})

test('Documents replaced Forms in the nav; the forms routes live under it', () => {
  const nav = read('src/portal/ap/AcademicPartnerChrome.jsx')
  assert.match(nav, /key: 'documents',\s*label: NAV_LABELS\.documents/)
  assert.doesNotMatch(nav, /key: 'forms'/)
  const docs = read('src/portal/ap/SchoolDocuments.jsx')
  assert.match(docs, /\{ value: 'students', label: 'Student Documents' \}/)
  assert.match(docs, /\{ value: 'forms', label: 'Forms' \}/)
  assert.match(docs, /uploadClearanceFile\(/, 'a sheet upload is the record\'s own upload')
  assert.doesNotMatch(docs, /\bRequired\b|\bMissing\b/)
  const tours = read('src/lib/onboardingTours.js')
  assert.match(tours, /portal-nav-documents/)
})

test('the student record no longer says required or missing', () => {
  const drawer = read('src/portal/ap/SchoolStudentDrawer.jsx')
  assert.doesNotMatch(drawer, /'Missing'|required on file/)
  assert.match(drawer, /not every\s+student needs every document/)
})

test('a school deletes only a draft that was never published or sent; it is archived, not removed', async () => {
  assert.ok(SCHOOL_WRITES.has('discard'))
  const F = 'f1111111-1111-4111-8111-111111111111'
  const updates = []
  const mk = (form, sentCount) => ({
    from(table) {
      const q = {
        _t: table, select() { return q }, in() { return q }, limit() { return q }, order() { return q },
        eq() { return q }, neq() { return q },
        maybeSingle() { return Promise.resolve({ data: table === 'catalog_forms' ? form : null, error: null }) },
        update(v) { updates.push({ table, v }); return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) } },
        then(res, rej) {
          if (table === 'form_assignments') return Promise.resolve({ count: sentCount, error: null }).then(res, rej)
          return Promise.resolve({ data: [{ id: F, owner_school_key: 'UCLA' }], error: null }).then(res, rej)
        },
      }
      return q
    },
  })
  const scopes = [{ school_key: 'UCLA', cohort_id: null }]
  const out = await schoolFormAction(mk({ id: F, status: 'draft', current_version: 0 }, 0), { action: 'discard', id: F }, { scopes, act: () => {} })
  assert.equal(out.discarded, F)
  assert.deepEqual(updates[0].v.status, 'archived')
  await assert.rejects(schoolFormAction(mk({ id: F, status: 'published', current_version: 1 }, 0), { action: 'discard', id: F }, { scopes, act: () => {} }), /never published/)
  await assert.rejects(schoolFormAction(mk({ id: F, status: 'draft', current_version: 0 }, 2), { action: 'discard', id: F }, { scopes, act: () => {} }), /was sent/)
  await assert.rejects(schoolFormAction(mk({ id: F, status: 'draft', current_version: 0 }, 0), { action: 'discard', id: F }, { scopes, staffPreview: true, act: () => {} }), /read-only/)
})
