// AP-CLEARANCE-2 (Owner, 2026-11-08): a school sees who is missing what without opening every
// record, and keeps its own optional checklist items. These pin the roster summary (only ASPIRE's
// required base items count, expired is named, an id outside the caller's scopes is never
// answered), the screens that read it, and the checklist drawer's add and remove.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rosterClearance, clearanceCell, clearanceRank } from '../src/lib/ap/clearanceChecklist.js'
import { loadClearanceSummaries } from '../lib/server/schoolStudentRecords.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const TYPES = [
  { key: 'clr_tb', label: 'TB Screening', required: true, check_kind: 'expiry_date', school_key: null, checklist: 'clearance', active: true, sort_order: 1 },
  { key: 'clr_bls', label: 'BLS Card', required: true, check_kind: 'expiry_date', school_key: null, checklist: 'clearance', active: true, sort_order: 2 },
  { key: 'clr_background', label: 'Background Check', required: true, check_kind: 'file', school_key: null, checklist: 'clearance', active: true, sort_order: 3 },
  { key: 'sc_own', label: 'Hep B titer', required: false, check_kind: 'file', school_key: 'UCLA', checklist: 'clearance', active: true, sort_order: 500 },
]
const S1 = 'a1111111-1111-4111-8111-111111111111'
const S2 = 'a2222222-2222-4222-8222-222222222222'
const S3 = 'a3333333-3333-4333-8333-333333333333'

test('only ASPIRE\'s required items count; an expired file is on file and named', () => {
  const docs = [
    { student_id: S1, doc_type: 'clr_tb', current_version_id: 'v1' },
    { student_id: S1, doc_type: 'clr_bls', current_version_id: 'v2' },
    { student_id: S1, doc_type: 'clr_background', current_version_id: 'v3' },
    { student_id: S2, doc_type: 'clr_tb', current_version_id: 'v4' },
    { student_id: S2, doc_type: 'sc_own', current_version_id: 'v5' },
  ]
  const versions = [
    { id: 'v1', doc_date: '2027-01-01' }, { id: 'v2', doc_date: '2026-10-01' }, { id: 'v3', doc_date: null },
    { id: 'v4', doc_date: '2027-05-01' }, { id: 'v5', doc_date: null },
  ]
  const out = rosterClearance([S1, S2, S3], TYPES, docs, versions, '2026-11-08')
  assert.deepEqual(out[S1], { required: 3, onFile: 3, missing: [], expired: ['BLS Card'] })
  assert.deepEqual(out[S2], { required: 3, onFile: 1, missing: ['BLS Card', 'Background Check'], expired: [] })
  assert.deepEqual(out[S3], { required: 3, onFile: 0, missing: ['TB Screening', 'BLS Card', 'Background Check'], expired: [] })

  assert.deepEqual(clearanceCell(out[S1]), { text: '3 of 3', note: '1 expired', tone: 'warn', label: '3 of 3 required clearance documents on file. Expired: BLS Card.' })
  assert.equal(clearanceCell(out[S2]).note, '2 missing')
  assert.equal(clearanceCell(out[S3]).tone, 'bad')
  assert.equal(clearanceCell({ required: 3, onFile: 3, missing: [], expired: [] }).note, 'Complete')
  assert.equal(clearanceCell({ required: 3, onFile: 3, missing: [], expired: [] }).tone, 'ok')
  assert.equal(clearanceCell(null), null)
  assert.ok(clearanceRank(out[S3]) < clearanceRank(out[S2]) && clearanceRank(out[S2]) < clearanceRank(out[S1]))
})

function fakeDb(tables) {
  const calls = []
  return {
    calls,
    from(table) {
      let rows = [...(tables[table] || [])]
      const q = {
        select() { return q },
        eq(k, v) { rows = rows.filter(r => r[k] === v); return q },
        in(k, vs) { calls.push({ table, k, vs }); rows = rows.filter(r => vs.includes(r[k])); return q },
        order() { return q },
        then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej) },
      }
      return q
    },
  }
}

test('the summary answers only students the caller\'s scopes admit', async () => {
  const db = fakeDb({
    student_document_types: TYPES,
    students: [
      { id: S1, school: 'UCLA', cohort_id: 'k1' },
      { id: S2, school: 'CSUN', cohort_id: 'k1' },
    ],
    student_documents: [
      { student_id: S1, doc_type: 'clr_tb', current_version_id: 'v1' },
      { student_id: S2, doc_type: 'clr_tb', current_version_id: 'v2' },
    ],
    student_document_versions: [{ id: 'v1', doc_date: '2027-01-01' }, { id: 'v2', doc_date: '2027-01-01' }],
  })
  const r = await loadClearanceSummaries(db, [{ school_key: 'UCLA', cohort_id: null }], [S1, S2, 'not-an-id'], '2026-11-08')
  assert.deepEqual(Object.keys(r.summaries), [S1])
  assert.equal(r.summaries[S1].onFile, 1)
  const docRead = db.calls.find(c => c.table === 'student_documents' && c.k === 'student_id')
  assert.deepEqual(docRead.vs, [S1], 'another school\'s student is never read')
  const many = Array.from({ length: 501 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
  assert.equal((await loadClearanceSummaries(db, [], many, '2026-11-08')).error, 'too_many')
})

test('the endpoint serves the summary as a read a preview may make; the screens read it', () => {
  const api = read('api/portal/school-student-records.js')
  assert.match(api, /const WRITES = new Set\(\['correct', 'item_add', 'item_retire', 'upload_start', 'upload_finish'\]\)/, 'summary is not a write')
  assert.match(api, /if \(action === 'summary'\)/)
  const portal = read('src/portal/AcademicPartnerPortal.jsx')
  assert.match(portal, /getClearanceSummaries\(rosterKey\.split\(','\)\)/)
  assert.match(portal, /\{clearanceOn && <SortHeader sortKey="clearance"[^>]*>Clearance<\/SortHeader>\}/)
  assert.match(portal, /onClose=\{\(\) => \{ setOpenStudent\(null\); setClearanceTick\(t => t \+ 1\) \}\}/, 'an upload in the record refreshes the column')
  assert.match(portal, />Clearance Checklist<\/button>/)
  const drawer = read('src/portal/ap/SchoolChecklistDrawer.jsx')
  assert.match(drawer, /action: 'item_add', school_key: school, label, qualifier/)
  assert.match(drawer, /action: 'item_retire', key: item\.key/)
  assert.match(drawer, /confirmDialog\(`Remove \$\{item\.label\}/)
  assert.match(drawer, /state\.readOnly\s*\n?\s*\? <span className="apr-pill apr-pill-mute">Optional<\/span>/, 'a preview removes nothing')
})
