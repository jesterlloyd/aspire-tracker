// lib/server/schoolStudentRecords.js
//
// AP-STUDENT-RECORDS-1 (Owner, 2026-11-08): what an Academic Partner keeps of its own students'
// records. api/portal/school-student-records.js is the only caller; it verifies the caller and
// hands this module the service-role client and the caller's ACTIVE school scopes.
//
// A student is reachable only when its school and cohort match one of the caller's scopes
// (schoolScope.js's exact alias-aware rule). No request parameter widens that: the student id the
// browser names is only ever intersected with it.
import { randomUUID } from 'node:crypto'
import { schoolScopeTerms, matchSchoolCohortScope } from '../../api/lib/schoolScope.js'
import { resolveSchoolAliases } from '../../api/lib/schoolAliases.js'
import {
  PROFILE_COLUMNS, GRADUATION_COLUMN, CORRECTABLE, cleanCorrection, logText, shapeProfile,
} from '../../src/lib/ap/schoolStudentProfile.js'
import {
  loadTypes, ensureDocument, finishUpload, openVersion, uploadPath, isMissingTable, isMissingColumn, DOCUMENTS_BUCKET,
} from './studentDocuments.js'
import { extsFor, DOCUMENT_MAX_BYTES } from '../../src/lib/documents/documentChecklist.js'
import { clearanceRows, cleanItemLabel, rosterClearance } from '../../src/lib/ap/clearanceChecklist.js'

const schoolItemKey = () => `sc_${randomUUID().replace(/-/g, '').slice(0, 16)}`

const CORRECTIONS = 'student_record_corrections'
const TYPES = 'student_document_types'
const norm = (s) => String(s || '').toLowerCase().replace(/[.,&/-]/g, ' ').replace(/\s+/g, ' ').trim()

/** The school_key of the first scope that admits this student, or null. */
export function scopeKeyFor(scopes, student) {
  const n = norm(student?.school)
  const hit = schoolScopeTerms(scopes).find(t => t.terms.has(n) && (t.cohort_id == null || t.cohort_id === student.cohort_id))
  return hit ? hit.school_key : null
}

/** One student, only when the caller's scopes admit it. Returns { student, schoolKey } or { notFound }. */
export async function scopedStudent(db, scopes, studentId, columns) {
  if (!/^[0-9a-f-]{36}$/i.test(String(studentId || ''))) return { notFound: true }
  const cols = [...new Set(['id', 'cohort_id', 'school', 'is_demo', ...columns])].join(', ')
  const r = await db.from('students').select(cols).eq('id', studentId).maybeSingle()
  if (r.error) return { error: r.error }
  if (!r.data || !matchSchoolCohortScope(scopes, r.data.school, r.data.cohort_id)) return { notFound: true }
  return { student: r.data, schoolKey: scopeKeyFor(scopes, r.data) }
}

async function selectWithGraduation(db, scopes, studentId) {
  const withGrad = await scopedStudent(db, scopes, studentId, [...PROFILE_COLUMNS, GRADUATION_COLUMN])
  if (withGrad.error && isMissingColumn(withGrad.error)) {
    const plain = await scopedStudent(db, scopes, studentId, PROFILE_COLUMNS)
    return { ...plain, graduationEnabled: false }
  }
  return { ...withGrad, graduationEnabled: true }
}

async function loadCorrections(db, studentId) {
  const r = await db.from(CORRECTIONS).select('field, old_value, new_value, corrected_by_name, created_at')
    .eq('student_id', studentId).order('created_at', { ascending: true })
  if (r.error) return { rows: [], enabled: !isMissingTable(r.error) }
  return { rows: r.data || [], enabled: true }
}

/** The profile a school sees. */
export async function loadSchoolProfile(db, scopes, studentId) {
  const got = await selectWithGraduation(db, scopes, studentId)
  if (got.error) return { error: got.error }
  if (got.notFound) return { notFound: true }
  const s = got.student
  const [cohort, unit, log] = await Promise.all([
    s.cohort_id ? db.from('cohorts').select('id, name').eq('id', s.cohort_id).maybeSingle() : { data: null },
    s.matched_unit_id ? db.from('units').select('unit_name').eq('id', s.matched_unit_id).maybeSingle() : { data: null },
    loadCorrections(db, s.id),
  ])
  const cohortRow = cohort.data || null
  const cohortSize = s.cohort_id ? await cohortStudents(db, scopes, s).then(x => x.length).catch(() => null) : null
  return {
    profile: {
      ...shapeProfile(s, { cohort: cohortRow, unitName: unit.data?.unit_name || null, graduationEnabled: got.graduationEnabled && log.enabled, corrections: log.rows }),
      cohortSize,
      correctionsEnabled: log.enabled,
    },
  }
}

// Every student of the target's cohort that the caller's SAME school scope admits.
async function cohortStudents(db, scopes, target, extra = []) {
  const key = scopeKeyFor(scopes, target)
  const terms = new Set([...resolveSchoolAliases(key), norm(key)])
  const cols = [...new Set(['id', 'school', 'cohort_id', 'is_demo', ...extra])].join(', ')
  const r = await db.from('students').select(cols).eq('cohort_id', target.cohort_id)
  if (r.error) throw r.error
  return (r.data || []).filter(x => terms.has(norm(x.school)) && matchSchoolCohortScope(scopes, x.school, x.cohort_id))
}

/**
 * A school corrects one answer. `applyToCohort` (expected graduation only) writes the same date to
 * every student of that cohort at the same school. Each change is its own log row.
 */
export async function correctAnswer(db, scopes, { studentId, field, value, applyToCohort = false, actor, nowIso }) {
  const clean = cleanCorrection(field, value)
  if (clean.error) return { status: 422, error: clean.error }
  const extra = field === GRADUATION_COLUMN ? [GRADUATION_COLUMN] : [field]
  const got = await scopedStudent(db, scopes, studentId, extra)
  if (got.error) return isMissingColumn(got.error) ? { status: 409, error: 'not_enabled' } : { status: 500, error: 'internal_error' }
  if (got.notFound) return { status: 404, error: 'not_found' }
  const probe = await db.from(CORRECTIONS).select('id').limit(1)
  if (probe.error) return isMissingTable(probe.error) ? { status: 409, error: 'not_enabled' } : { status: 500, error: 'internal_error' }

  const cohortWide = applyToCohort === true && CORRECTABLE[field].cohortWide && Boolean(got.student.cohort_id)
  let targets = [got.student]
  if (cohortWide) {
    try { targets = await cohortStudents(db, scopes, got.student, [field]) } catch { return { status: 500, error: 'internal_error' } }
  }
  const newText = logText(clean.value)
  const changed = targets.filter(t => logText(t[field]) !== newText)
  if (!changed.length) return { ok: true, changed: 0 }

  const ids = changed.map(t => t.id)
  const upd = await db.from('students').update({ [field]: clean.value }).in('id', ids)
  if (upd.error) return { status: 500, error: 'internal_error' }
  const batch = cohortWide ? randomUUID() : null
  const log = await db.from(CORRECTIONS).insert(changed.map(t => ({
    student_id: t.id, field, old_value: logText(t[field]) || null, new_value: newText || null,
    scope: cohortWide ? 'cohort' : 'one', batch_id: batch, school_key: got.schoolKey,
    corrected_by_profile_id: actor.id, corrected_by_name: actor.name || null,
    is_demo: t.is_demo === true, created_at: nowIso,
  })))
  if (log.error) return { ok: true, changed: ids.length, warning: 'log_failed' }
  return { ok: true, changed: ids.length }
}

// ---- Clearance checklist ------------------------------------------------------------

function schoolKeysOf(scopes) {
  return [...new Set((scopes || []).map(s => s.school_key).filter(Boolean))]
}

/** Clearance rows for one student over the given types: base items, plus a school item it has a file for. */
export async function loadClearanceFor(db, studentId, types, { keepAllSchoolItems = false } = {}) {
  const docs = await db.from('student_documents').select('id, doc_type, current_version_id').eq('student_id', studentId)
  if (docs.error) return { error: docs.error }
  const mine = (docs.data || []).filter(d => types.some(x => x.key === d.doc_type))
  const shown = keepAllSchoolItems ? types : types.filter(x => x.school_key == null || mine.some(d => d.doc_type === x.key))
  let versions = []
  if (mine.length) {
    const v = await db.from('student_document_versions')
      .select('id, document_id, file_name, uploaded_via, uploaded_at, doc_date')
      .in('document_id', mine.map(d => d.id)).order('uploaded_at', { ascending: false })
    if (v.error) return { error: v.error }
    versions = v.data || []
  }
  return { rows: clearanceRows(shown, mine, versions) }
}

/** The clearance checklist for one student: rows with their current file, and what is missing. */
export async function loadClearance(db, scopes, studentId) {
  const got = await scopedStudent(db, scopes, studentId, [])
  if (got.error) return { error: got.error }
  if (got.notFound) return { notFound: true }
  const t = await loadTypes(db, { checklist: 'clearance', schoolKeys: [got.schoolKey] })
  if (t.error) return isMissingTable(t.error) ? { notEnabled: true } : { error: t.error }
  if (t.notEnabled) return { notEnabled: true }
  const l = await loadClearanceFor(db, studentId, t.types, { keepAllSchoolItems: true })
  if (l.error) return { error: l.error }
  return { rows: l.rows, schoolKey: got.schoolKey }
}

/**
 * AP-CLEARANCE-2: the Clearance column for the roster. Every id is intersected with the caller's
 * scopes; an id the caller may not see is simply absent from the answer. At most 500 ids.
 */
export async function loadClearanceSummaries(db, scopes, studentIds, today) {
  const ids = [...new Set((Array.isArray(studentIds) ? studentIds : []).map(String))].filter(id => /^[0-9a-f-]{36}$/i.test(id))
  if (ids.length > 500) return { status: 422, error: 'too_many' }
  if (!ids.length) return { summaries: {} }
  const t = await loadTypes(db, { checklist: 'clearance', schoolKeys: schoolKeysOf(scopes) })
  if (t.error) return isMissingTable(t.error) ? { notEnabled: true } : { error: t.error }
  if (t.notEnabled) return { notEnabled: true }
  const st = await db.from('students').select('id, school, cohort_id').in('id', ids)
  if (st.error) return { error: st.error }
  const mine = (st.data || []).filter(x => matchSchoolCohortScope(scopes, x.school, x.cohort_id)).map(x => x.id)
  if (!mine.length) return { summaries: {} }
  const keys = t.types.filter(x => x.required === true && x.school_key == null).map(x => x.key)
  let docs = []
  if (keys.length) {
    const d = await db.from('student_documents').select('student_id, doc_type, current_version_id').in('student_id', mine).in('doc_type', keys)
    if (d.error) return { error: d.error }
    docs = d.data || []
  }
  const current = docs.map(d => d.current_version_id).filter(Boolean)
  let versions = []
  if (current.length) {
    const v = await db.from('student_document_versions').select('id, doc_date').in('id', current)
    if (v.error) return { error: v.error }
    versions = v.data || []
  }
  return { summaries: rosterClearance(mine, t.types, docs, versions, today) }
}

/** A school's own optional items, for the checklist settings. */
export async function loadSchoolItems(db, scopes) {
  const keys = schoolKeysOf(scopes)
  const t = await loadTypes(db, { checklist: 'clearance', schoolKeys: keys })
  if (t.error) return isMissingTable(t.error) ? { notEnabled: true } : { error: t.error }
  if (t.notEnabled) return { notEnabled: true }
  return {
    base: t.types.filter(x => x.school_key == null).map(x => ({ key: x.key, label: x.label, qualifier: x.qualifier })),
    items: t.types.filter(x => x.school_key != null).map(x => ({ key: x.key, label: x.label, qualifier: x.qualifier, school_key: x.school_key })),
    schools: keys,
  }
}

export async function addSchoolItem(db, scopes, { schoolKey, label, qualifier, actorId }) {
  if (!schoolKeysOf(scopes).includes(schoolKey)) return { status: 403, error: 'forbidden' }
  const clean = cleanItemLabel(label, qualifier)
  if (clean.error) return { status: 422, error: clean.error }
  const ins = await db.from(TYPES).insert({
    key: schoolItemKey(), label: clean.label, qualifier: clean.qualifier, required: false,
    check_kind: 'file', sort_order: 500, checklist: 'clearance', school_key: schoolKey, created_by_profile_id: actorId,
  }).select('key, label, qualifier, school_key').maybeSingle()
  if (ins.error) return isMissingColumn(ins.error) ? { status: 409, error: 'not_enabled' } : { status: 500, error: 'internal_error' }
  return { ok: true, item: ins.data }
}

/** Retiring an item hides it from the checklist; any file already filed stays on the record. */
export async function retireSchoolItem(db, scopes, { key }) {
  const r = await db.from(TYPES).select('key, school_key').eq('key', String(key || '')).maybeSingle()
  if (r.error) return { status: 500, error: 'internal_error' }
  if (!r.data || !r.data.school_key || !schoolKeysOf(scopes).includes(r.data.school_key)) return { status: 404, error: 'not_found' }
  const u = await db.from(TYPES).update({ active: false, updated_at: new Date().toISOString() }).eq('key', r.data.key)
  if (u.error) return { status: 500, error: 'internal_error' }
  return { ok: true }
}

async function clearanceType(db, scopes, studentId, docType) {
  const got = await scopedStudent(db, scopes, studentId, ['resume_url'])
  if (got.error) return { status: 500, error: 'internal_error' }
  if (got.notFound) return { status: 404, error: 'not_found' }
  const t = await loadTypes(db, { checklist: 'clearance', schoolKeys: [got.schoolKey] })
  if (t.error || t.notEnabled) return { status: 409, error: 'not_enabled' }
  const type = t.types.find(x => x.key === docType)
  if (!type) return { status: 422, error: 'invalid_doc_type' }
  return { student: got.student, type }
}

export async function startClearanceUpload(db, storage, scopes, { studentId, docType, fileName, size }) {
  const c = await clearanceType(db, scopes, studentId, docType)
  if (c.error) return c
  const ext = String(fileName || '').split('.').pop().toLowerCase()
  if (!extsFor(docType).includes(ext)) return { status: 422, error: 'invalid_type' }
  const n = Number(size)
  if (!Number.isFinite(n) || n <= 0) return { status: 422, error: 'invalid_size' }
  if (n > DOCUMENT_MAX_BYTES) return { status: 413, error: 'too_large' }
  const path = uploadPath(c.student.id, docType, ext)
  const signed = await storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path)
  if (signed.error || !signed.data?.token) return { status: 502, error: 'upload_unavailable' }
  return { ok: true, path, token: signed.data.token }
}

export async function finishClearanceUpload(db, storage, scopes, { studentId, docType, path, fileName, docDate, dateConfirmed, actorId, nowIso }) {
  const c = await clearanceType(db, scopes, studentId, docType)
  if (c.error) return c
  return finishUpload(db, storage, {
    student: { ...c.student, resume_url: null }, type: c.type, path, fileName, docDate, dateConfirmed,
    actorId, via: 'school', nowIso,
  })
}

/** A short-lived link to a clearance file of a student this caller may read. */
export async function openClearanceVersion(db, storage, scopes, { versionId }) {
  const v = await db.from('student_document_versions').select('id, document_id').eq('id', String(versionId || '')).maybeSingle()
  if (v.error || !v.data) return { status: 404, error: 'not_found' }
  const d = await db.from('student_documents').select('student_id, doc_type').eq('id', v.data.document_id).maybeSingle()
  if (d.error || !d.data) return { status: 404, error: 'not_found' }
  const c = await clearanceType(db, scopes, d.data.student_id, d.data.doc_type)
  if (c.error) return { status: 404, error: 'not_found' }
  const o = await openVersion(db, storage, { versionId: v.data.id })
  if (o.error || o.notFound) return { status: 404, error: 'not_found' }
  return { ok: true, url: o.url, fileName: o.fileName }
}

export { ensureDocument }
