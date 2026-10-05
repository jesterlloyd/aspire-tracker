// api/student-documents.js
//
// STUDENT-DOCUMENTS-1 (résumé review build, Phase 2): a student's application documents
// and their versions. Staff only, and the same people as the résumé today:
//   read   Owner, Admin, Co-Lead (api/student-file-access.js's unrestricted readers)
//   write  Owner, Admin            (api/student-file-sign.js's uploaders)
// Talent Acquisition, interviewers, viewers and portal users get nothing here.
//
// Actions:
//   list         { student_id }                                   -> types, documents, versions
//   upload_start { student_id, doc_type, file_name, content_type, size } -> { path, token }
//   upload_finish{ student_id, doc_type, path, file_name, doc_date?, date_confirmed? }
//   open         { version_id }                                   -> a 60 s link
//   keep_record_resume { student_id } -> the chart's Replace calls this BEFORE it uploads, so
//                  the file on the record becomes a version instead of being overwritten.
//   RESUME-REVIEW-1 (Phase 3): review_start { student_id, version_id? } scores a résumé version
//                  with Keith (Owner, Admin; no version_id = the current résumé, adopting the
//                  record's file as a version first); review_get { review_id } (read roles);
//                  review_draft { review_id, style } and review_save { review_id, ... } (writers).
//
// Nothing here deletes a version (the table has no DELETE grant). Before migration
// 20261104000000 every action answers { provisioned: false }, and the chart's Replace
// goes ahead exactly as it did before.
import supabaseAdmin from '../lib/server/evaluation/supabase_admin.js'
import { verifyPortalCaller } from './lib/portalAuth.js'
import { normalizeStaffRole } from '../src/lib/permissions.js'
import { isUuid } from '../lib/server/studentFiles.js'
import {
  DOCUMENTS_BUCKET, isMissingTable, loadTypes, loadStudentDocuments, uploadPath,
  finishUpload, openVersion, keepBeforeRecordReplace, adoptRecordResume,
} from '../lib/server/studentDocuments.js'
import { listReviews, getReview, scoreResumeVersion, reviseDraft, saveDraft, scoringAvailability } from '../lib/server/resumeReview.js'
import { extsFor, DOCUMENT_MAX_BYTES } from '../src/lib/documents/documentChecklist.js'

const READ_ROLES = new Set(['owner', 'admin', 'co-lead'])
const WRITE_ROLES = new Set(['owner', 'admin'])
const WRITES = new Set(['upload_start', 'upload_finish', 'keep_record_resume', 'review_start', 'review_draft', 'review_save'])
const ACTIONS = new Set(['list', 'open', 'review_get', ...WRITES])

const unprovisioned = res => res.status(200).json({ provisioned: false })
const internal = res => res.status(500).json({ error: 'internal_error' })

async function loadStudent(db, id) {
  const { data, error } = await db.from('students').select('id, cohort_id, resume_url, first_name, preferred_first_name, aspire_cohort').eq('id', id).maybeSingle()
  if (error) return { error }
  return { student: data || null }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = typeof body.action === 'string' && ACTIONS.has(body.action) ? body.action : null
  if (!action) return res.status(400).json({ error: 'invalid_action' })

  // verifyPortalCaller rejects inactive accounts; the role decides the rest.
  const caller = await verifyPortalCaller(req)
  if (!caller.authenticated) return res.status(caller.status || 401).json({ error: caller.reason || 'unauthenticated' })
  if (caller.profile?.is_active === false) return res.status(403).json({ error: 'inactive_staff' })
  const role = normalizeStaffRole(String(caller.profile.role || '').toLowerCase())
  if (!READ_ROLES.has(role)) return res.status(403).json({ error: 'forbidden' })
  if (WRITES.has(action) && !WRITE_ROLES.has(role)) return res.status(403).json({ error: 'forbidden' })

  const db = supabaseAdmin
  const storage = supabaseAdmin.storage
  const actorId = caller.profile.id
  const nowIso = new Date().toISOString()

  try {
    if (action === 'open') {
      if (!isUuid(body.version_id)) return res.status(422).json({ error: 'invalid_version_id' })
      const o = await openVersion(db, storage, { versionId: body.version_id })
      if (o.error) return isMissingTable(o.error) ? unprovisioned(res) : internal(res)
      if (o.notFound) return res.status(404).json({ error: 'not_found' })
      return res.status(200).json({ ok: true, url: o.url, file_name: o.fileName })
    }

    // RESUME-REVIEW-1: one review, with the text Keith read (for the preview), and the draft.
    if (action === 'review_get' || action === 'review_draft' || action === 'review_save') {
      if (!isUuid(body.review_id)) return res.status(422).json({ error: 'invalid_review_id' })
      const g = await getReview(db, body.review_id)
      if (g.error) return isMissingTable(g.error) ? unprovisioned(res) : internal(res)
      if (!g.review) return res.status(404).json({ error: 'not_found' })
      if (action === 'review_get') return res.status(200).json({ ok: true, review: g.review })
      if (action === 'review_save') {
        const sv = await saveDraft(db, { review: g.review, subject: body.subject, body: body.body, includeScore: body.include_score, includeBullets: body.include_bullets, actor: caller.profile })
        return sv.ok ? res.status(200).json({ ok: true }) : res.status(sv.status).json({ error: sv.error })
      }
      const rv = await reviseDraft(db, { review: g.review, style: body.style, actor: caller.profile })
      return rv.ok ? res.status(200).json({ ok: true, draft: rv.draft }) : res.status(rv.status).json({ error: rv.error })
    }

    if (!isUuid(body.student_id)) return res.status(422).json({ error: 'invalid_student_id' })
    const s = await loadStudent(db, body.student_id)
    if (s.error) return internal(res)
    if (!s.student) return res.status(404).json({ error: 'not_found' })
    const student = s.student

    if (action === 'list') {
      const l = await loadStudentDocuments(db, student.id)
      if (l.error) return isMissingTable(l.error) ? unprovisioned(res) : internal(res)
      // Reviews arrive with 20261105000000; before it the drawer shows no scores.
      const r = await listReviews(db, student.id)
      const reviewsProvisioned = !r.error
      if (r.error && !isMissingTable(r.error)) return internal(res)
      const scoring = WRITE_ROLES.has(role) && reviewsProvisioned ? await scoringAvailability(db, caller.profile) : { available: false }
      // The draft is signed by the person reading it: their Connect signature name and
      // credentials, else their account name.
      const me = await db.from('user_profiles').select('full_name, connect_signature').eq('id', caller.profile.id).maybeSingle()
      const cs = me.data?.connect_signature && typeof me.data.connect_signature === 'object' ? me.data.connect_signature : {}
      const sender = { name: String(cs.display_name || me.data?.full_name || '').trim(), credentials: String(cs.credentials || '').trim() }
      return res.status(200).json({
        provisioned: true, canWrite: WRITE_ROLES.has(role),
        types: l.types, documents: l.documents, resumeOnRecord: l.resumeOnRecord,
        reviews: r.reviews || [], reviewsProvisioned, canScore: scoring.available === true, scoringBlocked: scoring.reason || null, sender,
      })
    }

    if (action === 'keep_record_resume') {
      const k = await keepBeforeRecordReplace(db, storage, { student, actorId, nowIso })
      if (k.error) return isMissingTable(k.error) ? unprovisioned(res) : res.status(502).json({ error: 'keep_failed' })
      return res.status(200).json({ ok: true, provisioned: true, kept: k.kept })
    }

    if (action === 'review_start') {
      let versionId = isUuid(body.version_id) ? body.version_id : null
      if (!versionId) {
        const a = await adoptRecordResume(db, storage, { student, actorId, nowIso })
        if (a.error) return isMissingTable(a.error) ? unprovisioned(res) : res.status(502).json({ error: 'keep_failed' })
        if (a.notFound) return res.status(404).json({ error: 'no_resume' })
        versionId = a.versionId
      }
      const sc = await scoreResumeVersion(db, storage, { student, versionId, actor: caller.profile, nowIso })
      if (!sc.ok) {
        if (sc.cause && isMissingTable(sc.cause)) return unprovisioned(res)
        return res.status(sc.status || 500).json({ error: sc.error, review: sc.review || null })
      }
      return res.status(200).json({ ok: true, review: sc.review })
    }

    const t = await loadTypes(db)
    if (t.error) return isMissingTable(t.error) ? unprovisioned(res) : internal(res)
    const type = t.types.find(x => x.key === body.doc_type)
    if (!type) return res.status(422).json({ error: 'invalid_doc_type' })

    if (action === 'upload_start') {
      const ext = String(body.file_name || '').split('.').pop().toLowerCase()
      if (!extsFor(type.key).includes(ext)) return res.status(422).json({ error: 'invalid_type' })
      const size = Number(body.size)
      if (!Number.isFinite(size) || size <= 0) return res.status(422).json({ error: 'invalid_size' })
      if (size > DOCUMENT_MAX_BYTES) return res.status(413).json({ error: 'too_large' })
      if (type.key === 'resume' && !isUuid(student.cohort_id)) return res.status(409).json({ error: 'no_cohort' })
      const path = uploadPath(student.id, type.key, ext)
      const signed = await storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path)
      if (signed.error || !signed.data?.token) return res.status(502).json({ error: 'upload_unavailable' })
      return res.status(200).json({ ok: true, provisioned: true, path, token: signed.data.token })
    }

    // upload_finish
    const f = await finishUpload(db, storage, {
      student, type, path: body.path, fileName: body.file_name,
      docDate: body.doc_date, dateConfirmed: body.date_confirmed === true, actorId, nowIso,
    })
    if (!f.ok) {
      if (f.cause && isMissingTable(f.cause)) return unprovisioned(res)
      return res.status(f.status || 500).json({ error: f.error })
    }
    return res.status(200).json({ ok: true, version: f.version, warning: f.warning || null })
  } catch {
    return internal(res)
  }
}
