// STUDENT-DOCUMENTS-1 (résumé review build, Phase 2): a student's application documents,
// every version kept. Three layers:
//   - the migration on a real Postgres (PGlite): eight types, versions never deleted by the
//     app and append-only except Keith's check, a student's deletion still cascades;
//   - the checklist rules the drawer reads (status, detail, summary);
//   - the engine's order: the résumé on the record is KEPT before anything overwrites it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import {
  statusFor, detailFor, checklistSummary, checklistRows, versionHistory, validatePick, needsDate,
} from '../src/lib/documents/documentChecklist.js'
import {
  finishUpload, keepBeforeRecordReplace, isUploadPathFor, uploadPath, sha256Hex,
} from '../lib/server/studentDocuments.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const migration = readFileSync(join(root, 'supabase/migrations/20261104000000_student_documents.sql'), 'utf8')
const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE IF NOT EXISTS students (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
`
async function fresh() {
  const db = new PGlite()
  await db.exec(PRELUDE)
  await db.exec(migration)
  return db
}
async function version(db, studentId, type = 'transcript', extra = '') {
  const d = await db.query(`INSERT INTO student_documents (student_id, doc_type) VALUES ($1, $2)
    ON CONFLICT (student_id, doc_type) DO UPDATE SET updated_at = now() RETURNING id`, [studentId, type])
  const v = await db.query(`INSERT INTO student_document_versions (document_id, storage_bucket, storage_path, file_name, uploaded_via ${extra ? ', doc_date, confirmed_at' : ''})
    VALUES ($1, 'student-documents', $2, 'file.pdf', 'staff' ${extra ? ", '2026-12-15', now()" : ''}) RETURNING id`, [d.rows[0].id, `${studentId}/${type}/${Math.random()}.pdf`])
  return { documentId: d.rows[0].id, versionId: v.rows[0].id }
}

test('the migration applies twice and seeds the one NGRP list', async () => {
  const db = await fresh()
  await db.exec(migration)
  const t = await db.query(`SELECT key, required, check_kind, max_pages, not_yet_label FROM student_document_types ORDER BY sort_order`)
  assert.deepEqual(t.rows.map(r => r.key), ['resume', 'personal_statement', 'transcript', 'recommendation_1', 'recommendation_2', 'bls', 'acls', 'rn_license'])
  assert.deepEqual(t.rows.filter(r => r.required).map(r => r.key), ['resume', 'personal_statement', 'transcript', 'recommendation_1', 'recommendation_2'])
  assert.equal(t.rows.find(r => r.key === 'personal_statement').max_pages, 2)
  assert.equal(t.rows.find(r => r.key === 'rn_license').not_yet_label, 'After NCLEX')
  const b = await db.query(`SELECT public, file_size_limit FROM storage.buckets WHERE id = 'student-documents'`)
  assert.deepEqual(b.rows[0], { public: false, file_size_limit: 10485760 })
})

test('a version is append-only except Keith\'s check; a dated version must be confirmed', async () => {
  const db = await fresh()
  const s = (await db.query(`INSERT INTO students DEFAULT VALUES RETURNING id`)).rows[0].id
  const { versionId } = await version(db, s)
  await db.query(`UPDATE student_document_versions SET keith_check = '{"pages":2}' WHERE id = $1`, [versionId])
  await assert.rejects(db.query(`UPDATE student_document_versions SET file_name = 'x.pdf' WHERE id = $1`, [versionId]), /append-only/)
  await assert.rejects(db.query(`UPDATE student_document_versions SET doc_date = '2027-01-01' WHERE id = $1`, [versionId]))
  const d = (await db.query(`SELECT id FROM student_documents WHERE student_id = $1`, [s])).rows[0].id
  await assert.rejects(db.query(`INSERT INTO student_document_versions (document_id, storage_bucket, storage_path, file_name, uploaded_via, doc_date)
    VALUES ($1, 'student-documents', 'p/q/r.pdf', 'a.pdf', 'staff', '2026-12-15')`, [d]), /confirmed/)
  await assert.rejects(db.query(`INSERT INTO student_document_versions (document_id, storage_bucket, storage_path, file_name, uploaded_via)
    VALUES ($1, 'record-documents', 'p/q/s.pdf', 'a.pdf', 'staff')`, [d]), 'only the documents bucket')
})

test('the app cannot delete a version, and a student\'s deletion still cascades', async () => {
  const db = await fresh()
  const grants = await db.query(`SELECT privilege_type FROM information_schema.role_table_grants
    WHERE grantee = 'service_role' AND table_name = 'student_document_versions' ORDER BY 1`)
  assert.deepEqual(grants.rows.map(r => r.privilege_type), ['INSERT', 'SELECT', 'UPDATE'])
  const anon = await db.query(`SELECT COUNT(*)::int AS n FROM information_schema.role_table_grants
    WHERE grantee IN ('anon', 'authenticated') AND table_name LIKE 'student_document%'`)
  assert.equal(anon.rows[0].n, 0)
  const s = (await db.query(`INSERT INTO students DEFAULT VALUES RETURNING id`)).rows[0].id
  const { documentId, versionId } = await version(db, s, 'bls', 'dated')
  await db.query(`UPDATE student_documents SET current_version_id = $1 WHERE id = $2`, [versionId, documentId])
  await db.query(`DELETE FROM students WHERE id = $1`, [s])
  const left = await db.query(`SELECT COUNT(*)::int AS n FROM student_document_versions`)
  assert.equal(left.rows[0].n, 0)
})

// ── The checklist rules ───────────────────────────────────────────────────────
const T = {
  resume: { key: 'resume', label: 'Résumé', required: true, check_kind: 'resume', sort_order: 10 },
  ps: { key: 'personal_statement', label: 'Personal Statement', required: true, check_kind: 'pages', max_pages: 2, sort_order: 20 },
  transcript: { key: 'transcript', label: 'Transcript', required: true, check_kind: 'completion_date', sort_order: 30 },
  bls: { key: 'bls', label: 'BLS Card', required: false, check_kind: 'expiry_date', sort_order: 60 },
  rn: { key: 'rn_license', label: 'Proof of Licensure', required: false, check_kind: 'expiry_date', not_yet_label: 'After NCLEX', sort_order: 80 },
}
const doc = (type, v) => ({ doc_type: type, current_version_id: v ? 'v1' : null, versions: v ? [{ id: 'v1', uploaded_at: '2026-10-01T18:00:00Z', ...v }] : [] })

test('status is one word: On file, Missing, None, Not yet', () => {
  assert.equal(statusFor(T.ps, doc('personal_statement', { pages: 1 })).label, 'On file')
  assert.equal(statusFor(T.ps, null).label, 'Missing')
  assert.equal(statusFor(T.bls, null).label, 'None')
  assert.equal(statusFor(T.rn, null).label, 'Not yet')
  assert.equal(statusFor(T.resume, null, { resumeOnRecord: true }).label, 'On file', 'the record\'s résumé counts before any version exists')
})

test('detail says what the check found, and flags without blocking', () => {
  assert.deepEqual(detailFor(T.ps, doc('personal_statement', { pages: 2 })), { text: '2 pages · within limit', warn: false })
  assert.deepEqual(detailFor(T.ps, doc('personal_statement', { pages: 3 })), { text: '3 pages · over the 2-page limit', warn: true })
  assert.deepEqual(detailFor(T.transcript, doc('transcript', { doc_date: '2026-12-15' })), { text: 'Completion Dec 2026', warn: false })
  assert.deepEqual(detailFor(T.bls, doc('bls', { doc_date: '2028-05-31' }), { today: '2026-10-04' }), { text: 'Expires May 2028', warn: false })
  assert.deepEqual(detailFor(T.bls, doc('bls', { doc_date: '2026-09-30' }), { today: '2026-10-04' }), { text: 'Expired Sep 2026', warn: true })
  assert.deepEqual(detailFor(T.rn, null), { text: 'After NCLEX', warn: false })
  assert.equal(needsDate(T.transcript) && needsDate(T.bls) && !needsDate(T.ps), true)
})

test('the summary counts required types only; rows put required first', () => {
  const types = [T.bls, T.rn, T.transcript, T.ps, T.resume]
  const docs = [doc('personal_statement', { pages: 1 }), doc('bls', { doc_date: '2028-01-01' })]
  const s = checklistSummary(types, docs, { resumeOnRecord: true })
  assert.deepEqual([s.onFile, s.required, s.missing, s.complete], [2, 3, ['Transcript'], false])
  assert.deepEqual(checklistRows(types, docs).map(r => r.type.key), ['resume', 'personal_statement', 'transcript', 'bls', 'rn_license'])
  const h = versionHistory({ current_version_id: 'b', versions: [{ id: 'a', uploaded_at: '2026-01-01' }, { id: 'b', uploaded_at: '2026-02-01' }] })
  assert.deepEqual(h.map(v => [v.id, v.isCurrent]), [['b', true], ['a', false]])
  assert.match(validatePick('resume', { name: 'card.png', size: 10 }), /not accepted/)
  assert.equal(validatePick('bls', { name: 'card.png', size: 10 }), null)
  assert.match(validatePick('bls', { name: 'big.pdf', size: 11 * 1024 * 1024 }), /10 MB/)
})

// ── The engine's order ────────────────────────────────────────────────────────
const STUDENT = '11111111-1111-4111-8111-111111111111'
const COHORT = '22222222-2222-4222-8222-222222222222'

function fakes({ recordFile = null, recordExt = 'pdf', docs = [], versions = [] } = {}) {
  const files = new Map() // `${bucket}:${path}` -> Buffer
  const log = []
  if (recordFile) files.set(`student-files:${COHORT}/${STUDENT}/resume.${recordExt}`, Buffer.from(recordFile))
  const tables = {
    student_documents: docs.map(d => ({ ...d })),
    student_document_versions: versions.map(v => ({ ...v })),
    students: [{ id: STUDENT, cohort_id: COHORT, resume_url: recordFile ? `${COHORT}/${STUDENT}/resume.${recordExt}` : null }],
  }
  let seq = 0
  const db = {
    from(table) {
      const filters = []
      let mode = 'select', payload = null, limit = null
      const run = () => {
        const rows = tables[table]
        const match = r => filters.every(f => f(r))
        if (mode === 'select') { const out = rows.filter(match); return { data: limit ? out.slice(0, limit) : out, error: null } }
        if (mode === 'update') { rows.filter(match).forEach(r => Object.assign(r, payload)); log.push(`update:${table}`); return { data: null, error: null } }
        const list = Array.isArray(payload) ? payload : [payload]
        const made = []
        for (const p of list) {
          if (table === 'student_documents' && rows.some(r => r.student_id === p.student_id && r.doc_type === p.doc_type)) continue
          const r = { id: `${table}-${++seq}`, current_version_id: null, ...p }; rows.push(r); made.push(r)
        }
        log.push(`insert:${table}`)
        return { data: made[0] || null, error: null }
      }
      const q = {
        select() { return q }, order() { return q },
        limit(n) { limit = n; return q },
        eq(k, v) { filters.push(r => r[k] === v); return q },
        in(k, vs) { filters.push(r => vs.includes(r[k])); return q },
        insert(p) { mode = 'insert'; payload = p; return q },
        upsert(p) { mode = 'insert'; payload = p; return q },
        update(p) { mode = 'update'; payload = p; return q },
        maybeSingle() { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error }) },
        then(res, rej) { return Promise.resolve(run()).then(res, rej) },
      }
      return q
    },
  }
  const storage = {
    from(bucket) {
      return {
        async download(path) {
          const b = files.get(`${bucket}:${path}`)
          if (!b) return { data: null, error: { statusCode: '404', message: 'Object not found' } }
          return { data: { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }, error: null }
        },
        async upload(path, bytes) { files.set(`${bucket}:${path}`, Buffer.from(bytes)); log.push(`upload:${bucket}`); return { error: null } },
        async list(folder) { return { data: [...files.keys()].filter(k => k.startsWith(`${bucket}:${folder}/`)).map(k => ({ name: k.split('/').pop() })), error: null } },
        async remove(paths) { paths.forEach(p => files.delete(`${bucket}:${p}`)); log.push(`remove:${bucket}`); return { error: null } },
      }
    },
  }
  return { db, storage, files, tables, log }
}
const RESUME = { key: 'resume', label: 'Résumé', required: true, check_kind: 'resume' }
const BLS = { key: 'bls', label: 'BLS Card', required: false, check_kind: 'expiry_date' }

test('replacing the record\'s résumé keeps it as a version BEFORE the record is overwritten', async () => {
  const f = fakes({ recordFile: 'old resume bytes' })
  const path = uploadPath(STUDENT, 'resume', 'docx')
  f.files.set(`student-documents:${path}`, Buffer.from('new resume bytes'))
  const student = f.tables.students[0]
  const r = await finishUpload(f.db, f.storage, { student, type: RESUME, path, fileName: 'Ortiz_Resume.docx', actorId: 'p1', nowIso: '2026-10-04T18:00:00Z' })
  assert.equal(r.ok, true)
  const vs = f.tables.student_document_versions
  assert.deepEqual(vs.map(v => v.uploaded_via), ['record', 'staff'])
  assert.equal(vs[0].sha256, sha256Hex(Buffer.from('old resume bytes')))
  const keptAt = f.log.indexOf('upload:student-documents')
  const mirroredAt = f.log.indexOf('upload:student-files')
  assert.ok(keptAt > -1 && keptAt < mirroredAt, 'the old file is copied before the record path is written')
  assert.equal(student.resume_url, `${COHORT}/${STUDENT}/resume.docx`)
  assert.equal(f.files.has(`student-files:${COHORT}/${STUDENT}/resume.pdf`), false, 'the old extension goes only after the record points at the new file')
  assert.equal(f.tables.student_documents[0].current_version_id, vs[1].id)
})

test('the same bytes are not a new version; a dated document must be confirmed', async () => {
  const f = fakes({ recordFile: 'same bytes' })
  const path = uploadPath(STUDENT, 'resume', 'pdf')
  f.files.set(`student-documents:${path}`, Buffer.from('same bytes'))
  const r = await finishUpload(f.db, f.storage, { student: f.tables.students[0], type: RESUME, path, fileName: 'r.pdf', actorId: 'p1', nowIso: 'now' })
  assert.deepEqual([r.ok, r.status, r.error], [undefined, 409, 'same_file'])
  assert.equal(f.files.has(`student-documents:${path}`), false, 'the duplicate upload is removed')
  const g = fakes()
  const p2 = uploadPath(STUDENT, 'bls', 'png')
  g.files.set(`student-documents:${p2}`, Buffer.from('card'))
  const base = { student: g.tables.students[0], type: BLS, path: p2, fileName: 'bls.png', actorId: 'p1', nowIso: 'now' }
  assert.equal((await finishUpload(g.db, g.storage, { ...base })).error, 'date_required')
  assert.equal((await finishUpload(g.db, g.storage, { ...base, docDate: '2028-05-31' })).error, 'date_unconfirmed')
  const ok = await finishUpload(g.db, g.storage, { ...base, docDate: '2028-05-31', dateConfirmed: true })
  assert.equal(ok.ok, true)
  assert.equal(g.tables.student_document_versions[0].confirmed_by_profile_id, 'p1')
  assert.equal(g.log.includes('upload:student-files'), false, 'only a résumé touches the student record')
})

test('an upload path must be this student\'s and this type\'s', () => {
  const p = uploadPath(STUDENT, 'bls', 'pdf')
  assert.equal(isUploadPathFor(p, STUDENT, 'bls'), true)
  assert.equal(isUploadPathFor(p, STUDENT, 'acls'), false)
  assert.equal(isUploadPathFor(p, '33333333-3333-4333-8333-333333333333', 'bls'), false)
  assert.equal(isUploadPathFor(`../${p}`, STUDENT, 'bls'), false)
})

test('the chart\'s Replace keeps the record file first, once, and then points at the record', async () => {
  const f = fakes({ recordFile: 'chart resume' })
  const student = f.tables.students[0]
  const a = await keepBeforeRecordReplace(f.db, f.storage, { student, actorId: 'p1', nowIso: 'now' })
  assert.deepEqual([a.ok, a.kept], [true, true])
  const b = await keepBeforeRecordReplace(f.db, f.storage, { student, actorId: 'p1', nowIso: 'now' })
  assert.deepEqual([b.ok, b.kept], [true, false], 'the same bytes are kept once')
  assert.equal(f.tables.student_document_versions.length, 1)
  assert.equal(f.tables.student_documents[0].current_version_id, null)
  const missing = fakes()
  missing.tables.students[0].resume_url = `${COHORT}/${STUDENT}/resume.pdf`
  const c = await keepBeforeRecordReplace(missing.db, missing.storage, { student: missing.tables.students[0], actorId: 'p1', nowIso: 'now' })
  assert.deepEqual([c.ok, c.kept], [true, false], 'a record naming a file storage no longer has holds nothing to keep')
})

test('the endpoint: staff readers, Owner/Admin writers, never Talent Acquisition', () => {
  const src = readFileSync(join(root, 'api/student-documents.js'), 'utf8')
  assert.match(src, /const READ_ROLES = new Set\(\['owner', 'admin', 'co-lead'\]\)/)
  assert.match(src, /const WRITE_ROLES = new Set\(\['owner', 'admin'\]\)/)
  assert.doesNotMatch(src, /\.delete\(/, 'nothing here deletes a version row')
  const panel = readFileSync(join(root, 'src/components/StudentSidePanel.jsx'), 'utf8')
  const keep = panel.indexOf('await keepRecordResume(student.id)')
  const upload = panel.indexOf("signAndUploadStaffFile({ studentId: student.id, kind: 'resume', file })")
  assert.ok(keep > -1 && keep < upload, 'the chart keeps the record résumé before it uploads')
  const drawer = readFileSync(join(root, 'src/components/ngrp/ApplicantDrawer.jsx'), 'utf8')
  // APPLICANT-CHART-1 (this commit): the documents are a sheet of the Applicant chart; the
  // Residency Portal's binder has no Documents sheet and the section renders nothing there.
  assert.match(drawer, /APPLICANT_SHEETS\.filter\(x => staffApp \|\| x\.id !== 'documents'\)/, 'the Residency Portal has no Documents sheet')
  assert.match(drawer, /function DocumentsSection\(\{ row, toast, cycle \}\) \{\n  const \{ staffApp \} = useNgrpSurface\(\)\n  if \(!staffApp\) return null/, 'the Residency Portal never shows documents')
})
