// api/portal/school-student-records.js
//
// AP-STUDENT-RECORDS-1 (Owner, 2026-11-08): an Academic Partner's view of one of its own students,
// and the parts of the record the school keeps.
//
//   GET  ?action=profile&student_id=     the profile (lib: src/lib/ap/schoolStudentProfile.js)
//   GET  ?action=clearance&student_id=   the clearance checklist with what is on file
//   GET  ?action=items                   ASPIRE's base list and the school's own items
//   POST { action: 'summary', student_ids }  the roster's Clearance column (a read; ids in a body)
//   POST { action: 'correct', student_id, field, value, apply_to_cohort }
//   POST { action: 'item_add', school_key, label, qualifier } / { action: 'item_retire', key }
//   POST { action: 'upload_start' | 'upload_finish', student_id, doc_type, ... }
//   POST { action: 'open', version_id }
//
// Authorization is the roster's own (api/lib/schoolScope.js): a verified JWT, an ACTIVE
// academic_partner grant and ACTIVE user_school_scopes. A student id is only ever intersected with
// those scopes. An Owner/Admin preview reads and never writes (403 preview_read_only).
import {
  verifyPortalAcademicPartnerCaller,
} from '../lib/schoolScope.js'
import {
  loadSchoolProfile, correctAnswer, loadClearance, loadClearanceSummaries, loadSchoolItems, addSchoolItem, retireSchoolItem,
  startClearanceUpload, finishClearanceUpload, openClearanceVersion,
} from '../../lib/server/schoolStudentRecords.js'

const WRITES = new Set(['correct', 'item_add', 'item_retire', 'upload_start', 'upload_finish'])

export function createSchoolStudentRecordsHandler({ verifyCaller = verifyPortalAcademicPartnerCaller } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store')
    if (req.method === 'OPTIONS') return res.status(200).end()
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

    const auth = await verifyCaller(req)
    if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })
    const { db, scopes, profile } = auth
    const storage = db.storage
    const body = req.method === 'POST' && req.body && typeof req.body === 'object' ? req.body : {}
    const q = req.query || {}
    const action = String(req.method === 'GET' ? q.action || '' : body.action || '')
    if (WRITES.has(action) && auth.staffPreview) return res.status(403).json({ error: 'preview_read_only' })
    const nowIso = new Date().toISOString()
    const actor = { id: profile.id, name: profile.full_name || null }
    const send = (r) => {
      if (r.ok) { const rest = { ...r }; delete rest.ok; delete rest.status; return res.status(200).json({ ok: true, ...rest }) }
      return res.status(r.status || 500).json({ error: r.error || 'internal_error' })
    }

    try {
      if (req.method === 'GET') {
        if (action === 'profile') {
          const r = await loadSchoolProfile(db, scopes, q.student_id)
          if (r.notFound) return res.status(404).json({ error: 'not_found' })
          if (r.error) return res.status(500).json({ error: 'internal_error' })
          return res.status(200).json({ profile: r.profile, readOnly: Boolean(auth.staffPreview) })
        }
        if (action === 'clearance') {
          const r = await loadClearance(db, scopes, q.student_id)
          if (r.notFound) return res.status(404).json({ error: 'not_found' })
          if (r.notEnabled) return res.status(200).json({ enabled: false, rows: [] })
          if (r.error) return res.status(500).json({ error: 'internal_error' })
          return res.status(200).json({ enabled: true, rows: r.rows, readOnly: Boolean(auth.staffPreview) })
        }
        if (action === 'items') {
          const r = await loadSchoolItems(db, scopes)
          if (r.notEnabled) return res.status(200).json({ enabled: false, base: [], items: [], schools: [] })
          if (r.error) return res.status(500).json({ error: 'internal_error' })
          return res.status(200).json({ enabled: true, ...r, readOnly: Boolean(auth.staffPreview) })
        }
        return res.status(400).json({ error: 'unknown_action' })
      }

      if (action === 'summary') {
        const r = await loadClearanceSummaries(db, scopes, body.student_ids, new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }))
        if (r.notEnabled) return res.status(200).json({ enabled: false, summaries: {} })
        if (r.status) return res.status(r.status).json({ error: r.error })
        if (r.error) return res.status(500).json({ error: 'internal_error' })
        return res.status(200).json({ enabled: true, summaries: r.summaries })
      }
      if (action === 'correct') {
        return send(await correctAnswer(db, scopes, {
          studentId: body.student_id, field: body.field, value: body.value,
          applyToCohort: body.apply_to_cohort === true, actor, nowIso,
        }))
      }
      if (action === 'item_add') return send(await addSchoolItem(db, scopes, { schoolKey: body.school_key, label: body.label, qualifier: body.qualifier, actorId: profile.id }))
      if (action === 'item_retire') return send(await retireSchoolItem(db, scopes, { key: body.key }))
      if (action === 'upload_start') return send(await startClearanceUpload(db, storage, scopes, { studentId: body.student_id, docType: body.doc_type, fileName: body.file_name, size: body.size }))
      if (action === 'upload_finish') {
        const r = await finishClearanceUpload(db, storage, scopes, {
          studentId: body.student_id, docType: body.doc_type, path: body.path, fileName: body.file_name,
          docDate: body.doc_date, dateConfirmed: body.date_confirmed === true, actorId: profile.id, nowIso,
        })
        if (r.ok) return res.status(200).json({ ok: true, version: r.version })
        return send(r)
      }
      if (action === 'open') return send(await openClearanceVersion(db, storage, scopes, { versionId: body.version_id }))
      return res.status(400).json({ error: 'unknown_action' })
    } catch {
      return res.status(500).json({ error: 'internal_error' })
    }
  }
}

export default createSchoolStudentRecordsHandler()
