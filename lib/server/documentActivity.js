// lib/server/documentActivity.js
//
// RESIDENCY-TAB-1 (résumé review build, Phase 5): what alumni did in the Student Portal's
// Residency tab that the ASPIRE team should act on, for Needs you and the Action Center:
//   uploads      a new résumé an alumnus uploaded that has no Keith review yet ("Score now")
//   completions  an alumnus whose required application documents became complete through a
//                portal upload in the last 14 days
// Read by api/student-documents.js ('activity', Owner/Admin/Co-Lead). A row is navigation:
// it disappears when the résumé is scored, or after its window.
//
// ONE POPULATION (DEMO-DATA-2): this lists people, so a demo session sees demo alumni and a
// real one real alumni. The students are read with is_demo and filtered here, in memory,
// rather than by wrapping the shared service client.
import { loadStudentDocuments } from './studentDocuments.js'
import { checklistSummary } from '../../src/lib/documents/documentChecklist.js'

export const UPLOAD_WINDOW_DAYS = 30
export const COMPLETION_WINDOW_DAYS = 14

export async function documentActivity(db, { demo = false, now = new Date() } = {}) {
  const since = new Date(now.getTime() - UPLOAD_WINDOW_DAYS * 86400000).toISOString()
  const recent = new Date(now.getTime() - COMPLETION_WINDOW_DAYS * 86400000).toISOString()
  const v = await db.from('student_document_versions').select('id, document_id, uploaded_at')
    .eq('uploaded_via', 'portal').gte('uploaded_at', since).order('uploaded_at', { ascending: false })
  if (v.error) return { error: v.error }
  const versions = v.data || []
  if (!versions.length) return { uploads: [], completions: [] }
  const d = await db.from('student_documents').select('id, student_id, doc_type, current_version_id').in('id', [...new Set(versions.map(x => x.document_id))])
  if (d.error) return { error: d.error }
  const docById = new Map((d.data || []).map(x => [x.id, x]))
  const studentIds = [...new Set((d.data || []).map(x => x.student_id))]
  const s = await db.from('students').select('id, first_name, last_name, preferred_first_name, aspire_cohort, is_demo').in('id', studentIds)
  if (s.error) return { error: s.error }
  const people = new Map((s.data || []).filter(x => (x.is_demo === true) === demo).map(x => [x.id, x]))

  // Score now: the CURRENT résumé, uploaded in the portal, with no review of it at all.
  const resumeVersions = versions.filter(x => {
    const doc = docById.get(x.document_id)
    return doc && doc.doc_type === 'resume' && doc.current_version_id === x.id && people.has(doc.student_id)
  })
  let reviewed = new Set()
  if (resumeVersions.length) {
    const r = await db.from('resume_reviews').select('document_version_id').in('document_version_id', resumeVersions.map(x => x.id))
    if (!r.error) reviewed = new Set((r.data || []).map(x => x.document_version_id))
  }
  const uploads = resumeVersions.filter(x => !reviewed.has(x.id)).map((x) => {
    const p = people.get(docById.get(x.document_id).student_id)
    return { student_id: p.id, first_name: p.preferred_first_name || p.first_name || '', last_name: p.last_name || '', cohort: p.aspire_cohort || null, version_id: x.id, uploaded_at: x.uploaded_at }
  })

  // Completed: required documents all on file, and the last portal upload is recent.
  const lastPortal = new Map()
  for (const x of versions) {
    const doc = docById.get(x.document_id)
    if (!doc || !people.has(doc.student_id) || x.uploaded_at < recent) continue
    if (!lastPortal.has(doc.student_id) || x.uploaded_at > lastPortal.get(doc.student_id)) lastPortal.set(doc.student_id, x.uploaded_at)
  }
  const completions = []
  for (const [studentId, at] of lastPortal) {
    const l = await loadStudentDocuments(db, studentId)
    if (l.error || l.notFound) continue
    if (!checklistSummary(l.types, l.documents, { resumeOnRecord: l.resumeOnRecord }).complete) continue
    const p = people.get(studentId)
    completions.push({ student_id: p.id, first_name: p.preferred_first_name || p.first_name || '', last_name: p.last_name || '', cohort: p.aspire_cohort || null, completed_at: at })
  }
  completions.sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)))
  return { uploads, completions }
}
