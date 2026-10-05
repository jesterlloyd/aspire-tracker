// lib/server/supportHandoff.js
//
// SUPPORT-OUTREACH-1 (résumé review build, Phase 4): a message opened from Residency >
// Documents carries a SUPPORT HANDOFF to api/connect-send-direct-email.js. Two kinds:
//   resume_review     the review's draft, the résumé attached; a SUCCESSFUL send logs
//                     Résumé Review as support on the send date (Pacific) and marks the
//                     review Sent. Copying the draft never logs anything.
//   document_request  asks the alumnus for one application document. Never logs support.
//
// NOTHING IN THE HANDOFF IS TRUSTED. It is a claim, verified against the database BEFORE any
// mail client exists (the placement handoff's pattern): the review is this recipient's, the
// cycle is one this student is on the roster of, every attachment is a version of this
// student's own document. A claim that does not survive fails the send: no email, no log.
// Its presence makes the send stricter, never looser; a plain message is unchanged.
import { Buffer } from 'node:buffer'
import { loadApplicantsPayload } from './ngrpApplicants.js'
import { enrollStudents, insertSupportEntries } from './ngrpSupportLog.js'
import { isUuid } from './studentFiles.js'
import { recordKeithOutcome } from './keith/runKeithSkill.js'
import { ALLOWED_TYPES, matchesMagic, safeFilename, formatBytes, MAX_TOTAL_BYTES, MAX_FILE_BYTES } from '../../api/lib/outreachAttachments.js'

export const HANDOFF_TEMPLATE_KEYS = Object.freeze({ resume_review: 'support_resume_review', document_request: 'support_document_request' })
const MAX_DOCS = 3

const fail = (status, code, error) => ({ ok: false, status, code, error })

// Pacific calendar date of an instant: the day Résumé Review is logged for.
export function pacificDay(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

/**
 * Verify a handoff claim. Returns { ok: true, handoff } or { ok: false, status, code, error }.
 * `handoff` is built from rows read here, never from the request.
 */
export async function verifySupportHandoff({ db, ref, recipientType, recipientId, loadPayload = loadApplicantsPayload }) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return fail(400, 'bad_ref', 'That support handoff is not valid.')
  if (recipientType !== 'student') return fail(400, 'not_student', 'A support message goes to one alumnus.')
  const kind = ref.kind === 'resume_review' || ref.kind === 'document_request' ? ref.kind : null
  if (!kind) return fail(400, 'bad_kind', 'That support handoff is not valid.')
  if (!isUuid(ref.cycle_id)) return fail(400, 'bad_cycle', 'That support handoff names no residency cohort.')

  const payload = await loadPayload(db, ref.cycle_id)
  if (payload.state !== 'ok') return fail(409, 'cycle_unavailable', 'That residency cohort could not be read. Nothing was sent.')
  if (!(payload.students || []).some(s => s.id === recipientId)) return fail(409, 'not_on_roster', 'This alumnus is not on that residency cohort\'s roster. Nothing was sent.')

  const handoff = { kind, cycleId: ref.cycle_id, templateKey: HANDOFF_TEMPLATE_KEYS[kind], meta: { support_kind: kind, support_cycle_id: ref.cycle_id } }
  if (kind === 'resume_review') {
    if (!isUuid(ref.resume_review_id)) return fail(400, 'bad_review', 'That review could not be found.')
    const r = await db.from('resume_reviews').select('id, student_id, status, document_version_id, provenance_id').eq('id', ref.resume_review_id).maybeSingle()
    if (r.error) return fail(500, 'review_read_failed', 'The review could not be read. Nothing was sent.')
    if (!r.data || r.data.student_id !== recipientId) return fail(409, 'review_mismatch', 'That review is not this alumnus\'s. Nothing was sent.')
    if (!['scored', 'sent'].includes(r.data.status)) return fail(409, 'review_not_scored', 'That review has not been scored. Nothing was sent.')
    handoff.reviewId = r.data.id
    handoff.provenanceId = r.data.provenance_id || null
    handoff.meta.resume_review_id = r.data.id
  } else {
    const t = typeof ref.doc_type === 'string' ? ref.doc_type : ''
    const ty = await db.from('student_document_types').select('key, label').eq('key', t).maybeSingle()
    if (ty.error || !ty.data) return fail(409, 'bad_doc_type', 'That document type could not be found. Nothing was sent.')
    handoff.meta.document_type = ty.data.key
  }
  return { ok: true, handoff }
}

/**
 * The student's own document versions as attachments. Verified like a Catalog file: the type
 * from the name, the bytes' signature, the format check, and the limits (counted together
 * with any Catalog files, `alreadyBytes`).
 */
export async function resolveDocumentAttachments({ db, storage, versionIds, studentId, alreadyBytes = 0 }) {
  const ids = Array.isArray(versionIds) ? [...new Set(versionIds)] : []
  if (!ids.length) return { ok: true, attachments: [], summary: [] }
  if (ids.length > MAX_DOCS || !ids.every(isUuid)) return fail(400, 'bad_documents', 'Those documents could not be attached.')
  const v = await db.from('student_document_versions').select('id, document_id, storage_bucket, storage_path, file_name').in('id', ids)
  if (v.error) return fail(500, 'documents_read_failed', 'The documents could not be read. Nothing was sent.')
  const rows = ids.map(id => (v.data || []).find(r => r.id === id))
  if (rows.some(r => !r)) return fail(409, 'document_missing', 'A document could not be found. Nothing was sent.')
  const d = await db.from('student_documents').select('id, student_id').in('id', [...new Set(rows.map(r => r.document_id))])
  if (d.error) return fail(500, 'documents_read_failed', 'The documents could not be read. Nothing was sent.')
  if (rows.some(r => (d.data || []).find(x => x.id === r.document_id)?.student_id !== studentId)) {
    return fail(409, 'document_mismatch', 'A document is not this alumnus\'s. Nothing was sent.')
  }
  const attachments = []
  const summary = []
  let total = alreadyBytes
  for (const r of rows) {
    const name = safeFilename(r.file_name) || 'document'
    const ext = name.split('.').pop().toLowerCase()
    const spec = ALLOWED_TYPES[ext]
    if (!spec) return fail(422, 'document_type', `${name} cannot be attached (only PDF, Word .docx and images). Nothing was sent.`)
    const dl = await storage.from(r.storage_bucket).download(r.storage_path)
    if (dl.error || !dl.data) return fail(502, 'document_unavailable', `${name} could not be read. Nothing was sent.`)
    const bytes = Buffer.from(await dl.data.arrayBuffer())
    if (bytes.length > MAX_FILE_BYTES) return fail(413, 'document_large', `${name} is over ${formatBytes(MAX_FILE_BYTES)}.`)
    // The Catalog's own checks: the signature, then the format (a string names the problem).
    const problem = !matchesMagic(bytes, ext) ? 'it does not look like that kind of file' : (spec.verify ? spec.verify(bytes, ext) : null)
    if (problem) return fail(422, 'document_invalid', `${name} could not be attached: ${problem}. Nothing was sent.`)
    total += bytes.length
    if (total > MAX_TOTAL_BYTES) return fail(413, 'attachments_large', `Attachments total more than ${formatBytes(MAX_TOTAL_BYTES)}.`)
    attachments.push({ filename: name, content: bytes.toString('base64'), contentType: spec.mime })
    summary.push({ version_id: r.id, filename: name, content_type: spec.mime, size_bytes: bytes.length, size_label: formatBytes(bytes.length), source: 'student_document' })
  }
  return { ok: true, attachments, summary }
}

/**
 * After a SUCCESSFUL, LOGGED send: log Résumé Review for the send date and mark the review
 * Sent. Idempotent by the live unique index (one Résumé Review per alumnus per day): a repeat
 * is reported as already logged, never an error. Returns { occurredOn, alreadyRecorded } or
 * { error } (the send itself already happened; the caller reports this, never fails the send).
 */
export async function recordSupportSend({ db, handoff, studentId, notificationLogId, actorId, sentAt }) {
  if (handoff.kind !== 'resume_review') return { skipped: true }
  const occurredOn = pacificDay(sentAt)
  const e = await enrollStudents(db, { cycleId: handoff.cycleId, studentIds: [studentId] })
  if (e.error) return { error: e.error }
  const cand = e.byStudent.get(studentId)
  const ins = await insertSupportEntries(db, [{
    cycle_id: handoff.cycleId, candidate_id: cand.id, student_id: studentId, activity: 'resume_review',
    occurred_on: occurredOn, note: null, recorded_by_profile_id: actorId,
    source: 'outreach', source_ref: notificationLogId ? String(notificationLogId) : null,
  }])
  let alreadyRecorded = false
  if (ins.error) {
    if (ins.error.code !== '23505') return { error: ins.error, occurredOn }
    alreadyRecorded = true
  }
  const upd = await db.from('resume_reviews').update({ status: 'sent', sent_at: sentAt, outreach_message_id: notificationLogId ? String(notificationLogId) : null }).eq('id', handoff.reviewId)
  if (upd.error) return { error: upd.error, occurredOn, alreadyRecorded }
  // Keith's review went out: the check on the Keith mark (an edited one keeps its pencil).
  if (handoff.provenanceId) await recordKeithOutcome(db, handoff.provenanceId, 'accept', null, { id: actorId })
  return { occurredOn, alreadyRecorded }
}
