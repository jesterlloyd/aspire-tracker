// lib/server/alumnusResidency.js
//
// RESIDENCY-TAB-1 (résumé review build, Phase 5): what the Student Portal's Residency tab shows
// an ASPIRE alumnus about their own residency preparation. api/portal/my-residency.js is the
// only caller; it has already resolved the student from the session (never from the request)
// and checked that they are Completed.
//
// WHAT AN ALUMNUS NEVER SEES (Owner, spec section 6): Keith scores, categories, readiness,
// reports, drafts, staff notes, who uploaded or confirmed a version, or anyone else's records.
// Every shape below is built field by field, so a column added to a table later cannot leak.
import { loadStudentDocuments } from './studentDocuments.js'

export const ALUMNUS_ACTIVITIES = Object.freeze(['resume_review', 'town_hall', 'interview_bootcamp', 'placement_advising'])
const REQUEST_WINDOW_DAYS = 90

// The residency cohort this alumnus belongs to: a cycle whose source cohorts include theirs.
// The active one wins; else the latest by residency start, then by creation.
export async function cycleForStudent(db, student) {
  if (!student?.cohort_id) return { cycle: null }
  const map = await db.from('ngrp_cycle_source_cohorts').select('cycle_id').eq('cohort_id', student.cohort_id)
  if (map.error) return { error: map.error }
  const ids = [...new Set((map.data || []).map(r => r.cycle_id))]
  if (!ids.length) return { cycle: null }
  const c = await db.from('ngrp_cycles')
    .select('id, name, status, is_active, application_open_date, application_deadline, interview_window_start, interview_window_end, licensure_deadline, residency_start_date, created_at')
    .in('id', ids)
  if (c.error) return { error: c.error }
  const rows = [...(c.data || [])].sort((a, b) => (Number(b.is_active) - Number(a.is_active))
    || String(b.residency_start_date || '').localeCompare(String(a.residency_start_date || ''))
    || String(b.created_at || '').localeCompare(String(a.created_at || '')))
  return { cycle: rows[0] || null }
}

// The cohort's dates, as a list the page reads top to bottom. Missing dates are left out.
export function keyDates(cycle) {
  if (!cycle) return []
  const out = [
    ['application_open', 'Application opens', cycle.application_open_date],
    ['application_deadline', 'Application deadline', cycle.application_deadline],
    ['interview_window', 'Interviews', cycle.interview_window_start, cycle.interview_window_end],
    ['licensure_deadline', 'Licensure deadline', cycle.licensure_deadline],
    ['residency_start', 'Residency starts', cycle.residency_start_date],
  ]
  return out.filter(([, , d]) => d).map(([key, label, date, end]) => ({ key, label, date, end: end || null }))
}

// The Transition Form, as status words only. Never the link: it is a personal secure link
// that lives in their email. A 'pending' assignment was never accepted by the provider, so
// it reads Not sent, exactly as the staff roster reads it.
export async function transitionFormStatus(db, { cycleId, studentId }) {
  if (!cycleId) return { status: 'not_sent' }
  const cand = await db.from('ngrp_candidates').select('id').eq('cycle_id', cycleId).eq('student_id', studentId).maybeSingle()
  if (cand.error) return { error: cand.error }
  if (!cand.data) return { status: 'not_sent' }
  const a = await db.from('ngrp_transition_assignments')
    .select('status, sent_at, opened_at, submitted_at, revised_at, deadline_at, revoked_at')
    .eq('candidate_id', cand.data.id).is('revoked_at', null).maybeSingle()
  if (a.error) return { error: a.error }
  const r = a.data
  if (!r || r.status === 'pending') return { status: 'not_sent' }
  return {
    status: r.status === 'revised' ? 'submitted' : r.status,
    sent_at: r.sent_at || null, submitted_at: r.revised_at || r.submitted_at || null, deadline_at: r.deadline_at || null,
  }
}

// The support the ASPIRE team logged for them: activity and date only. No note, no source.
export async function supportReceived(db, studentId) {
  const e = await db.from('ngrp_support_entries').select('activity, occurred_on')
    .eq('student_id', studentId).is('voided_at', null).in('activity', ALUMNUS_ACTIVITIES)
    .order('occurred_on', { ascending: false })
  if (e.error) return { error: e.error }
  return { entries: (e.data || []).map(x => ({ activity: x.activity, occurred_on: x.occurred_on })) }
}

// Their documents: the checklist types and, per document, the versions with upload dates
// and the date they confirmed. Never who uploaded or confirmed, never a path, never Keith.
export async function alumnusDocuments(db, studentId) {
  const l = await loadStudentDocuments(db, studentId)
  if (l.error || l.notFound) return l
  return {
    types: l.types.map(t => ({ key: t.key, label: t.label, qualifier: t.qualifier, required: t.required, check_kind: t.check_kind, max_pages: t.max_pages, not_yet_label: t.not_yet_label, sort_order: t.sort_order })),
    documents: l.documents.map(d => ({
      doc_type: d.doc_type, current_version_id: d.current_version_id,
      versions: (d.versions || []).map(v => ({ id: v.id, file_name: v.file_name, uploaded_at: v.uploaded_at, doc_date: v.doc_date || null, pages: v.pages ?? null })),
    })),
    resumeOnRecord: l.resumeOnRecord,
  }
}

// Requests the ASPIRE team sent from Documents (an Outreach message tagged document_request)
// in the last 90 days that nothing has answered: no version of that type uploaded since.
export async function openRequests(db, { studentId, documents, types, now = new Date() }) {
  const since = new Date(now.getTime() - REQUEST_WINDOW_DAYS * 86400000).toISOString()
  const r = await db.from('notification_log').select('sent_at, metadata')
    .eq('student_id', studentId).eq('notification_type', 'direct_message_sent').gte('sent_at', since)
    .order('sent_at', { ascending: false })
  if (r.error) return { error: r.error }
  const label = new Map(types.map(t => [t.key, t.label]))
  const latestUpload = new Map(documents.map(d => [d.doc_type, (d.versions || []).reduce((m, v) => (v.uploaded_at > m ? v.uploaded_at : m), '')]))
  const seen = new Set()
  const out = []
  for (const row of r.data || []) {
    const m = row.metadata || {}
    if (m.support_kind !== 'document_request' || !m.document_type || seen.has(m.document_type)) continue
    seen.add(m.document_type)
    if ((latestUpload.get(m.document_type) || '') > row.sent_at) continue
    if (!label.has(m.document_type)) continue
    out.push({ doc_type: m.document_type, label: label.get(m.document_type), sent_at: row.sent_at })
  }
  return { requests: out }
}
