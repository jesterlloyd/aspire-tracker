// lib/server/studentDocuments.js
//
// STUDENT-DOCUMENTS-1 (résumé review build, Phase 2): a student's application documents,
// with every version kept. api/student-documents.js is the only caller; it decides who
// may read and write and hands this module a service-role client.
//
// THE ORDER IS THE SAFETY. Nothing here deletes a version. When a résumé is replaced:
//   1. the file on the student record is KEPT first (copied into student-documents as a
//      version, unless a version already holds those exact bytes);
//   2. the new file is mirrored to the canonical student-files path, the one Interviews,
//      Keith, the Unit Leader portal and the chart read;
//   3. the version row is written and the document points at it;
//   4. students.resume_url is updated, and only then are the record's other-extension
//      siblings removed (resume.pdf when resume.docx replaced it).
// A failure after step 1 can leave the record unchanged or the history one row short of
// the newest upload, but never loses a file anyone uploaded before.
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import {
  STUDENT_FILES_BUCKET, DOCUMENTS_BUCKET, isUuid, canonicalPath, parseStoredFileRef, refBelongsToStudent,
} from './studentFiles.js'
import { extsFor, DOCUMENT_MAX_BYTES, needsDate } from '../../src/lib/documents/documentChecklist.js'

export { DOCUMENTS_BUCKET }
const TYPES = 'student_document_types'
const DOCS = 'student_documents'
const VERSIONS = 'student_document_versions'
const VERSION_FIELDS = 'id, document_id, file_name, content_type, size_bytes, sha256, pages, uploaded_via, uploaded_by_profile_id, uploaded_at, doc_date, confirmed_by_profile_id, confirmed_at'
const DAY = /^\d{4}-\d{2}-\d{2}$/

const MIME_BY_EXT = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

export const isMissingTable = error => error?.code === '42P01' || error?.code === 'PGRST205'
  || /does not exist|schema cache/i.test(String(error?.message || ''))

export const isObjectMissing = error => String(error?.statusCode || error?.status || '') === '404'
  || /not.?found|does not exist/i.test(String(error?.message || error?.error || ''))

export const sha256Hex = bytes => createHash('sha256').update(bytes).digest('hex')
const extOf = name => String(name || '').split('.').pop().toLowerCase()

export async function countPdfPages(bytes) {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    return pdf.getPageCount()
  } catch {
    return null
  }
}

// Where an upload for this student and type must land: <student>/<type>/<uuid>.<ext>.
// The client never chooses the folder; finish accepts only a path of exactly this shape.
export function uploadPath(studentId, docType, ext) {
  return `${studentId}/${docType}/${randomUUID()}.${ext}`
}
export function isUploadPathFor(path, studentId, docType) {
  const m = /^([0-9a-f-]{36})\/([a-z0-9_]{2,40})\/([0-9a-f-]{36})\.([a-z0-9]+)$/i.exec(String(path || ''))
  return Boolean(m) && m[1] === studentId && m[2] === docType && isUuid(m[3])
}

function validDay(v) {
  if (typeof v !== 'string' || !DAY.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export async function loadTypes(db) {
  const { data, error } = await db.from(TYPES).select('key, label, qualifier, required, check_kind, max_pages, not_yet_label, sort_order').eq('active', true).order('sort_order')
  if (error) return { error }
  return { types: data || [] }
}

// Everything the Documents drawer shows for one student. Never a storage path.
export async function loadStudentDocuments(db, studentId) {
  const t = await loadTypes(db)
  if (t.error) return { error: t.error }
  const d = await db.from(DOCS).select('id, doc_type, current_version_id, updated_at').eq('student_id', studentId)
  if (d.error) return { error: d.error }
  const docs = d.data || []
  let versions = []
  if (docs.length) {
    const v = await db.from(VERSIONS).select(VERSION_FIELDS).in('document_id', docs.map(x => x.id)).order('uploaded_at', { ascending: false })
    if (v.error) return { error: v.error }
    versions = v.data || []
  }
  const s = await db.from('students').select('id, resume_url').eq('id', studentId).maybeSingle()
  if (s.error) return { error: s.error }
  if (!s.data) return { notFound: true }
  return {
    types: t.types,
    documents: docs.map(doc => ({ ...doc, versions: versions.filter(v => v.document_id === doc.id) })),
    resumeOnRecord: Boolean(s.data.resume_url),
  }
}

export async function ensureDocument(db, studentId, docType) {
  const read = () => db.from(DOCS).select('id, doc_type, current_version_id').eq('student_id', studentId).eq('doc_type', docType).maybeSingle()
  const first = await read()
  if (first.error) return { error: first.error }
  if (first.data) return { document: first.data }
  const ins = await db.from(DOCS).upsert({ student_id: studentId, doc_type: docType }, { onConflict: 'student_id,doc_type', ignoreDuplicates: true })
  if (ins.error) return { error: ins.error }
  const again = await read()
  if (again.error || !again.data) return { error: again.error || new Error('document_upsert_failed') }
  return { document: again.data }
}

async function download(storage, bucket, path) {
  const { data, error } = await storage.from(bucket).download(path)
  if (error || !data) return { error: error || new Error('download_failed') }
  return { bytes: Buffer.from(await data.arrayBuffer()) }
}

// Step 1: keep the résumé that is on the student record as a version, unless a version of
// this document already holds the same bytes. Returns { kept, sha } (sha of the record file).
export async function keepRecordResume(db, storage, { student, document, actorId, nowIso }) {
  const ref = parseStoredFileRef(student.resume_url)
  if (!ref || ref.kind === 'unknown' || !ref.path || !refBelongsToStudent(ref.path, student.id)) return { kept: false, sha: null }
  const got = await download(storage, STUDENT_FILES_BUCKET, ref.path)
  // A record that names a file storage no longer has holds nothing to keep. Any other
  // failure stops the replace: overwriting a file we could not copy would lose it.
  if (got.error) return isObjectMissing(got.error) ? { kept: false, sha: null } : { error: got.error }
  const sha = sha256Hex(got.bytes)
  const same = await db.from(VERSIONS).select('id').eq('document_id', document.id).eq('sha256', sha).limit(1)
  if (same.error) return { error: same.error }
  if ((same.data || []).length) return { kept: false, sha, versionId: same.data[0].id }
  const ext = extOf(ref.path)
  const path = uploadPath(student.id, 'resume', ext)
  const up = await storage.from(DOCUMENTS_BUCKET).upload(path, got.bytes, { contentType: MIME_BY_EXT[ext] || 'application/octet-stream', upsert: false })
  if (up.error) return { error: up.error }
  const row = {
    document_id: document.id, storage_bucket: DOCUMENTS_BUCKET, storage_path: path,
    file_name: `resume.${ext}`, content_type: MIME_BY_EXT[ext] || null, size_bytes: got.bytes.length, sha256: sha,
    pages: ext === 'pdf' ? await countPdfPages(got.bytes) : null,
    uploaded_via: 'record', uploaded_by_profile_id: actorId, uploaded_at: nowIso,
  }
  const ins = await db.from(VERSIONS).insert(row).select('id').maybeSingle()
  if (ins.error) return { error: ins.error }
  return { kept: true, sha, versionId: ins.data.id }
}

// The student chart's Replace: keep what is on the record, then let the chart write the
// new file to the canonical path as it always has. The document stops pointing at a
// version, because its current file is now the record's again.
export async function keepBeforeRecordReplace(db, storage, { student, actorId, nowIso }) {
  const e = await ensureDocument(db, student.id, 'resume')
  if (e.error) return { error: e.error }
  const k = await keepRecordResume(db, storage, { student, document: e.document, actorId, nowIso })
  if (k.error) return { error: k.error }
  if (e.document.current_version_id) {
    const u = await db.from(DOCS).update({ current_version_id: null, updated_at: nowIso }).eq('id', e.document.id)
    if (u.error) return { error: u.error }
  }
  return { ok: true, kept: k.kept }
}

// RESUME-REVIEW-1: "Score now" on a résumé that is only on the student record. The record's
// file becomes a version (or the version already holding those bytes is found) and the
// document points at it, so a score always belongs to one exact file.
export async function adoptRecordResume(db, storage, { student, actorId, nowIso }) {
  const e = await ensureDocument(db, student.id, 'resume')
  if (e.error) return { error: e.error }
  if (e.document.current_version_id) return { versionId: e.document.current_version_id }
  const k = await keepRecordResume(db, storage, { student, document: e.document, actorId, nowIso })
  if (k.error) return { error: k.error }
  if (!k.versionId) return { notFound: true }
  const u = await db.from(DOCS).update({ current_version_id: k.versionId, updated_at: nowIso }).eq('id', e.document.id)
  if (u.error) return { error: u.error }
  return { versionId: k.versionId }
}

// Mirror a résumé to the canonical student-files path and point the record at it.
async function mirrorResumeToRecord(db, storage, { student, bytes, ext }) {
  const cp = canonicalPath(student.cohort_id, student.id, 'resume', ext)
  if (!cp.ok) return { error: new Error(cp.error) }
  const up = await storage.from(STUDENT_FILES_BUCKET).upload(cp.path, bytes, { contentType: MIME_BY_EXT[ext], upsert: true })
  if (up.error) return { error: up.error }
  return { path: cp.path }
}

async function pointRecordAt(db, storage, { student, path, ext }) {
  const u = await db.from('students').update({ resume_url: path }).eq('id', student.id)
  if (u.error) return { error: u.error }
  // Only now, with the record on the new file, do the other extensions go. Each was kept
  // as a version in step 1 if it was the record's file.
  const folder = `${student.cohort_id}/${student.id}`
  const listed = await storage.from(STUDENT_FILES_BUCKET).list(folder, { limit: 100 })
  if (!listed.error) {
    const stale = (listed.data || []).map(o => o.name).filter(n => n && n.startsWith('resume.') && n !== `resume.${ext}`)
    if (stale.length) await storage.from(STUDENT_FILES_BUCKET).remove(stale.map(n => `${folder}/${n}`))
  }
  return { ok: true }
}

// Finish an upload the browser made to a signed path. Returns { ok, version } or { status, error }.
export async function finishUpload(db, storage, { student, type, path, fileName, docDate, dateConfirmed, actorId, via = 'staff', nowIso }) {
  if (!isUploadPathFor(path, student.id, type.key)) return { status: 422, error: 'invalid_path' }
  const ext = extOf(path)
  if (!extsFor(type.key).includes(ext)) return { status: 422, error: 'invalid_type' }
  let doc_date = null
  if (needsDate(type)) {
    if (!validDay(docDate)) return { status: 422, error: 'date_required' }
    if (dateConfirmed !== true) return { status: 422, error: 'date_unconfirmed' }
    doc_date = docDate
  }
  const got = await download(storage, DOCUMENTS_BUCKET, path)
  if (got.error) return { status: 404, error: 'upload_not_found' }
  if (got.bytes.length > DOCUMENT_MAX_BYTES) {
    await storage.from(DOCUMENTS_BUCKET).remove([path])
    return { status: 413, error: 'too_large' }
  }
  const sha = sha256Hex(got.bytes)
  const e = await ensureDocument(db, student.id, type.key)
  if (e.error) return { status: 500, error: 'internal_error', cause: e.error }
  const document = e.document

  // The same bytes as the current file is not a new version. The record's file counts as
  // current for a résumé that no version holds yet.
  let currentSha = null
  if (document.current_version_id) {
    const c = await db.from(VERSIONS).select('sha256').eq('id', document.current_version_id).maybeSingle()
    if (c.error) return { status: 500, error: 'internal_error', cause: c.error }
    currentSha = c.data?.sha256 || null
  }
  if (type.key === 'resume' && !document.current_version_id && student.resume_url) {
    const k = await keepRecordResume(db, storage, { student, document, actorId, nowIso })
    if (k.error) return { status: 502, error: 'keep_failed', cause: k.error }
    currentSha = k.sha
  }
  if (currentSha && currentSha === sha) {
    await storage.from(DOCUMENTS_BUCKET).remove([path])
    return { status: 409, error: 'same_file' }
  }

  let recordPath = null
  if (type.key === 'resume') {
    const m = await mirrorResumeToRecord(db, storage, { student, bytes: got.bytes, ext })
    if (m.error) return { status: 502, error: 'record_update_failed', cause: m.error }
    recordPath = m.path
  }

  const confirmed = doc_date ? { confirmed_by_profile_id: actorId, confirmed_at: nowIso } : {}
  const ins = await db.from(VERSIONS).insert({
    document_id: document.id, storage_bucket: DOCUMENTS_BUCKET, storage_path: path,
    file_name: String(fileName || `document.${ext}`).slice(0, 200), content_type: MIME_BY_EXT[ext] || null,
    size_bytes: got.bytes.length, sha256: sha, pages: ext === 'pdf' ? await countPdfPages(got.bytes) : null,
    uploaded_via: via, uploaded_by_profile_id: actorId, uploaded_at: nowIso, doc_date, ...confirmed,
  }).select(VERSION_FIELDS).maybeSingle()
  if (ins.error) return { status: 500, error: 'internal_error', cause: ins.error }
  const point = await db.from(DOCS).update({ current_version_id: ins.data.id, updated_at: nowIso }).eq('id', document.id)
  if (point.error) return { status: 500, error: 'internal_error', cause: point.error }

  if (recordPath) {
    const p = await pointRecordAt(db, storage, { student, path: recordPath, ext })
    if (p.error) return { ok: true, version: ins.data, warning: 'record_not_updated' }
  }
  return { ok: true, version: ins.data }
}

// A short-lived link to one version, for a student this caller may read.
export async function openVersion(db, storage, { versionId, ttl = 60 }) {
  const v = await db.from(VERSIONS).select('id, storage_bucket, storage_path, file_name, document_id').eq('id', versionId).maybeSingle()
  if (v.error) return { error: v.error }
  if (!v.data) return { notFound: true }
  const d = await db.from(DOCS).select('student_id').eq('id', v.data.document_id).maybeSingle()
  if (d.error) return { error: d.error }
  const signed = await storage.from(v.data.storage_bucket).createSignedUrl(v.data.storage_path, ttl, { download: false })
  if (signed.error || !signed.data?.signedUrl) return { error: signed.error || new Error('sign_failed') }
  return { url: signed.data.signedUrl, studentId: d.data?.student_id || null, fileName: v.data.file_name }
}
