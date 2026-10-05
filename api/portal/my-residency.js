// api/portal/my-residency.js
//
// RESIDENCY-TAB-1 (résumé review build, Phase 5): the Student Portal's Residency tab, for ASPIRE
// alumni (Completed students) only. Owner decisions, 2026-10-05: the tab replaces Shift Log for
// alumni and is their residency preparation home: key dates, application documents, the
// Transition Form's status, upcoming events (read by the client from my-calendar-events) and
// the support they have had.
//
// IDENTITY IS THE SESSION. JWT -> profile -> active student grant -> linked students; the
// student is one of THEIR links, never an id the client chose outside them. Only a Completed
// student gets anything; anyone else is told the tab is not theirs (eligible: false).
//
// Actions:
//   status        -> { eligible }                         (the nav asks this)
//   summary       -> the page (no Keith, no staff notes, no uploader names)
//   upload_start  { doc_type, file_name, size }           -> a signed upload path
//   upload_finish { doc_type, path, file_name, doc_date?, date_confirmed? } -> filed, via 'portal'
//   open          { version_id }                          -> a 60 s link, own versions only
// Uploads go through lib/server/studentDocuments.js, the staff path: replacing never deletes, a
// résumé is kept from the record first, a dated document needs the date confirmed.
import process from 'node:process'
import { verifyPortalCaller, hasActiveRoleGrant, getActiveStudentLinks, getServiceDb } from '../lib/portalAuth.js'
import {
  DOCUMENTS_BUCKET, isMissingTable, loadTypes, uploadPath, finishUpload, openVersion,
} from '../../lib/server/studentDocuments.js'
import { cycleForStudent, keyDates, transitionFormStatus, supportReceived, alumnusDocuments, openRequests, resumeFeedback } from '../../lib/server/alumnusResidency.js'
import { extsFor, DOCUMENT_MAX_BYTES } from '../../src/lib/documents/documentChecklist.js'

const ACTIONS = new Set(['status', 'summary', 'upload_start', 'upload_finish', 'open'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const internal = res => res.status(500).json({ error: 'internal_error' })

// The alumnus among the caller's links: a Completed student. With several, the most recent.
async function resolveAlumnus(db, links) {
  const { data, error } = await db.from('students')
    .select('id, cohort_id, status, resume_url, first_name, preferred_first_name, updated_at')
    .in('id', links)
  if (error) return { error }
  const done = (data || []).filter(s => s.status === 'Completed')
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
  return { student: done[0] || null }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) return internal(res)

  const auth = await verifyPortalCaller(req)
  if (!auth.authenticated) return res.status(auth.status).json({ error: auth.reason })
  const db = getServiceDb()
  const profileId = auth.profile.id
  if (!(await hasActiveRoleGrant(db, profileId, 'student'))) return res.status(403).json({ error: 'forbidden' })
  const links = await getActiveStudentLinks(db, profileId)
  if (links.length === 0) return res.status(403).json({ error: 'forbidden' })

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {}
  const action = typeof body.action === 'string' && ACTIONS.has(body.action) ? body.action : null
  if (!action) return res.status(400).json({ error: 'invalid_request' })

  try {
    const a = await resolveAlumnus(db, links)
    if (a.error) return internal(res)
    const student = a.student
    if (action === 'status') return res.status(200).json({ ok: true, eligible: Boolean(student) })
    if (!student) return res.status(403).json({ error: 'not_alumnus' })
    const nowIso = new Date().toISOString()

    if (action === 'summary') {
      const [c, docs, support] = await Promise.all([cycleForStudent(db, student), alumnusDocuments(db, student.id), supportReceived(db, student.id)])
      if (c.error || support.error) return internal(res)
      const documentsProvisioned = !(docs.error && isMissingTable(docs.error))
      if (docs.error && documentsProvisioned) return internal(res)
      const form = await transitionFormStatus(db, { cycleId: c.cycle?.id || null, studentId: student.id })
      if (form.error) return internal(res)
      // RESUME-FEEDBACK-1: before 20261105000000 there are no reviews; nothing to show.
      const fb = await resumeFeedback(db, student.id)
      const feedback = fb.error ? null : fb.feedback
      let requests = []
      if (documentsProvisioned) {
        const r = await openRequests(db, { studentId: student.id, documents: docs.documents, types: docs.types })
        if (!r.error) requests = r.requests
      }
      return res.status(200).json({
        ok: true,
        firstName: student.preferred_first_name || student.first_name || '',
        cycle: c.cycle ? { name: c.cycle.name, status: c.cycle.status } : null,
        dates: keyDates(c.cycle),
        form,
        support: support.entries,
        documentsProvisioned,
        documents: documentsProvisioned ? { types: docs.types, documents: docs.documents, resumeOnRecord: docs.resumeOnRecord } : null,
        requests,
        feedback,
      })
    }

    if (action === 'open') {
      if (!UUID_RE.test(String(body.version_id || ''))) return res.status(400).json({ error: 'invalid_request' })
      const o = await openVersion(db, db.storage, { versionId: body.version_id })
      if (o.error) return isMissingTable(o.error) ? res.status(409).json({ error: 'unprovisioned' }) : internal(res)
      // Their own versions only; anything else reads as not found.
      if (o.notFound || o.studentId !== student.id) return res.status(404).json({ error: 'not_found' })
      return res.status(200).json({ ok: true, url: o.url })
    }

    const t = await loadTypes(db)
    if (t.error) return isMissingTable(t.error) ? res.status(409).json({ error: 'unprovisioned' }) : internal(res)
    const type = t.types.find(x => x.key === body.doc_type)
    if (!type) return res.status(400).json({ error: 'invalid_doc_type' })

    if (action === 'upload_start') {
      const ext = String(body.file_name || '').split('.').pop().toLowerCase()
      if (!extsFor(type.key).includes(ext)) return res.status(422).json({ error: 'invalid_type' })
      const size = Number(body.size)
      if (!Number.isFinite(size) || size <= 0) return res.status(422).json({ error: 'invalid_size' })
      if (size > DOCUMENT_MAX_BYTES) return res.status(413).json({ error: 'too_large' })
      if (type.key === 'resume' && !UUID_RE.test(String(student.cohort_id || ''))) return res.status(409).json({ error: 'no_cohort' })
      const path = uploadPath(student.id, type.key, ext)
      const signed = await db.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path)
      if (signed.error || !signed.data?.token) return res.status(502).json({ error: 'upload_unavailable' })
      return res.status(200).json({ ok: true, path, token: signed.data.token })
    }

    // upload_finish
    const f = await finishUpload(db, db.storage, {
      student, type, path: body.path, fileName: body.file_name,
      docDate: body.doc_date, dateConfirmed: body.date_confirmed === true,
      actorId: profileId, via: 'portal', nowIso,
    })
    if (!f.ok) return res.status(f.status || 500).json({ error: f.error })
    // An audit line, as every portal save writes one: what and when, never the file.
    try {
      await db.from('activity_logs').insert({
        user_id: profileId, user_name: auth.profile.full_name || 'Student', user_role: 'student',
        action_type: 'student_document_self_upload', entity_type: 'student', entity_id: String(student.id),
        cohort_id: student.cohort_id || null,
        description: `Student uploaded ${type.label} from the Student Portal (Residency).`,
        metadata: { source: 'portal_residency', doc_type: type.key, version_id: f.version?.id || null },
      })
    } catch {
      console.warn('[portal/my-residency] audit insert failed')
    }
    return res.status(200).json({ ok: true, version: { id: f.version.id, file_name: f.version.file_name, uploaded_at: f.version.uploaded_at, doc_date: f.version.doc_date || null } })
  } catch {
    return internal(res)
  }
}
