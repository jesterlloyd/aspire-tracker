// lib/server/resumeStatus.js
//
// RESUME-WORKSPACE-1: each alumnus's résumé status for Residency > Support > By Alumnus
// (rules: src/lib/documents/resumeStatusModel.js). Three reads by student id, all inside the
// roster the caller already scoped (demo or real). Before the documents or review tables
// exist, those reads are simply empty. Any other read failure returns null, and the column
// shows a dash rather than a status it cannot stand behind.
import { resumeStatusMap } from '../../src/lib/documents/resumeStatusModel.js'

const missing = e => e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || ''))

export async function loadResumeStatuses(db, studentIds = [], now = Date.now()) {
  if (!studentIds.length) return {}
  const [st, docs, rv] = await Promise.all([
    db.from('students').select('id, resume_url').in('id', studentIds),
    db.from('student_documents').select('student_id, current_version_id').eq('doc_type', 'resume').in('student_id', studentIds),
    db.from('resume_reviews').select('id, student_id, document_version_id, status, score, readiness, requested_at, scored_at, sent_at, provenance_id').in('student_id', studentIds),
  ])
  if (st.error) return null
  if (docs.error && !missing(docs.error)) return null
  if (rv.error && !missing(rv.error)) return null
  const currentVersionByStudent = {}
  for (const d of docs.data || []) if (d.current_version_id) currentVersionByStudent[d.student_id] = d.current_version_id
  return resumeStatusMap({
    studentIds,
    onRecordIds: (st.data || []).filter(s => s.resume_url).map(s => s.id),
    currentVersionByStudent,
    reviews: rv.data || [],
  }, now)
}
