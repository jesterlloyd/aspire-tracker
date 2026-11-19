// AP-STUDENT-WITHDRAW-1 (Owner, 2026-11-19): an Academic Partner removes, for good, a student
// it submitted that the ASPIRE team has not reached out to. The rule is
// src/lib/ap/studentWithdraw.js; this module reads the facts it needs and performs the delete.
//
// Safety, in order: the student is in the caller's school scope (scopedStudent), the rule is
// re-run on fresh facts at the moment of the delete, the delete is conditional on the status still
// being Pending Outreach and the submitter still being the caller (a compare-and-set, so a send
// that lands between the check and the delete wins), and a row that other records still point at
// fails on its foreign keys rather than taking them with it. The team is emailed after the delete;
// the email never fails it.
import { scopedStudent } from './schoolStudentRecords.js'
import {
  withdrawBlocker, WITHDRAW_STATUS, NOT_OUTREACH_TYPES,
} from '../../src/lib/ap/studentWithdraw.js'
import { getStudentPreferredFullName } from '../../src/lib/studentNameFormatters.js'

export const WITHDRAW_COLUMNS = [
  'status', 'submitted_via', 'placement_request_last_submitted_by_profile_id',
  'student_form_privacy_ack_at', 'resume_url', 'headshot_url',
]

const ids = (list) => [...new Set((list || []).filter(Boolean))]

/**
 * The facts withdrawBlocker needs, for many students at once. Only students still Pending
 * Outreach are worth asking about; the others are blocked by status already.
 * Returns Map(studentId -> { hasPortalLink, outreachCount, documentCount }) or throws.
 */
export async function withdrawFactsFor(db, studentIds) {
  const want = ids(studentIds)
  const facts = new Map(want.map(id => [id, { hasPortalLink: false, outreachCount: 0, documentCount: 0 }]))
  if (want.length === 0) return facts

  const [links, log, docs] = await Promise.all([
    db.from('user_student_links').select('student_id').in('student_id', want),
    db.from('notification_log').select('student_id, notification_type').in('student_id', want),
    db.from('student_document_versions').select('student_id').in('student_id', want),
  ])
  if (links.error || log.error) throw links.error || log.error
  for (const r of links.data || []) facts.get(r.student_id).hasPortalLink = true
  for (const r of log.data || []) {
    if (!NOT_OUTREACH_TYPES.includes(r.notification_type)) facts.get(r.student_id).outreachCount += 1
  }
  // The documents table arrives with an Owner-gated migration; absent, nothing is on file there.
  if (!docs.error) for (const r of docs.data || []) facts.get(r.student_id).documentCount += 1
  return facts
}

/** Which of these roster students this caller may remove. Never throws: a failure offers none. */
export async function withdrawableIds(db, students, callerId) {
  const candidates = (students || []).filter(s =>
    s.status === WITHDRAW_STATUS && callerId && s.placement_request_last_submitted_by_profile_id === callerId)
  if (candidates.length === 0) return new Set()
  try {
    const facts = await withdrawFactsFor(db, candidates.map(s => s.id))
    return new Set(candidates.filter(s => withdrawBlocker(s, { callerId, ...facts.get(s.id) }) === null).map(s => s.id))
  } catch {
    return new Set()
  }
}

/**
 * AP-STUDENT-WITHDRAW-2 (Owner, 2026-11-19): for an Owner/Admin preview, which students their own
 * submitter could remove, and that submitter's name, so the preview shows where Remove is without
 * being able to use it. Returns Map(studentId -> submitter name). Never throws.
 */
export async function previewWithdrawers(db, students) {
  const out = new Map()
  const candidates = (students || []).filter(s => s.status === WITHDRAW_STATUS && s.placement_request_last_submitted_by_profile_id)
  if (candidates.length === 0) return out
  try {
    const facts = await withdrawFactsFor(db, candidates.map(s => s.id))
    const ok = candidates.filter(s => withdrawBlocker(s, { callerId: s.placement_request_last_submitted_by_profile_id, ...facts.get(s.id) }) === null)
    if (ok.length === 0) return out
    const pids = ids(ok.map(s => s.placement_request_last_submitted_by_profile_id))
    const { data, error } = await db.from('user_profiles').select('id, full_name').in('id', pids)
    if (error) return out
    const nameOf = new Map((data || []).map(p => [p.id, p.full_name || 'the person who submitted them']))
    for (const s of ok) out.set(s.id, nameOf.get(s.placement_request_last_submitted_by_profile_id) || 'the person who submitted them')
  } catch { /* a preview shows nothing rather than failing the roster */ }
  return out
}

/**
 * Delete one student, if the caller may. Returns { ok, name } or { ok:false, status, error }.
 * `notify` sends the team email and is injected so tests never send.
 */
export async function withdrawStudent(db, scopes, { studentId, actor, notify }) {
  const got = await scopedStudent(db, scopes, studentId, ['first_name', 'last_name', 'preferred_first_name', 'school_email', 'program_type', ...WITHDRAW_COLUMNS])
  if (got.error) return { ok: false, status: 500, error: 'internal_error' }
  if (got.notFound) return { ok: false, status: 404, error: 'not_found' }
  const s = got.student

  let facts
  try { facts = (await withdrawFactsFor(db, [s.id])).get(s.id) } catch { return { ok: false, status: 500, error: 'internal_error' } }
  const blocker = withdrawBlocker(s, { callerId: actor?.id, ...facts })
  if (blocker) return { ok: false, status: blocker === 'not_found' ? 404 : 409, error: blocker }

  let cohortName = ''
  if (s.cohort_id) {
    const c = await db.from('cohorts').select('name').eq('id', s.cohort_id).maybeSingle()
    cohortName = c.data?.name || ''
  }

  const del = await db.from('students').delete()
    .eq('id', s.id)
    .eq('status', WITHDRAW_STATUS)
    .eq('placement_request_last_submitted_by_profile_id', actor.id)
    .select('id')
  if (del.error) {
    // 23503: another record still points at this student (an evaluation, a certificate...).
    if (del.error.code === '23503') return { ok: false, status: 409, error: 'blocked' }
    return { ok: false, status: 500, error: 'internal_error' }
  }
  if (!del.data || del.data.length === 0) return { ok: false, status: 409, error: 'reached_out' }

  const name = getStudentPreferredFullName(s) || 'Student'
  if (typeof notify === 'function') {
    try {
      await notify({
        studentName: name,
        studentEmail: s.school_email || '',
        school: s.school || '',
        programType: s.program_type || '',
        cohortName,
        cohortId: s.cohort_id || null,
        removedByName: actor.name || '',
        removedByEmail: actor.email || '',
      })
    } catch { /* the delete stands; the email is best-effort */ }
  }
  return { ok: true, name }
}
