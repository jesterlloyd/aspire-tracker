// lib/server/ngrpTransitionReminders.js
//
// TRANSITION-REMINDER-1 (Owner, 2026-11-01): "resend the transition form email daily until they
// complete it. stop sending the reminder email once the response is in."
//
// Who gets one is decided HERE, once, from live state (reminderTargets is pure):
// - the form was delivered and has no submission yet: sent, opened or in progress, not revoked;
// - the form has not closed (the assignment's own close, else the cohort's application deadline);
// - the assignment still has an ACTIVE link. Staff revoking a link leaves the assignment live, so
//   without this a daily job would quietly undo that revoke the next morning;
// - no link was issued in the last RECENT_HOURS, so the morning after a hand send is not a second
//   email, and a re-run of the job sends nothing;
// - their application is still open (not hired, not proceeding, declined or not selected).
//
// EVERY LINK KEEPS WORKING. A raw token is never stored, so a reminder has to carry a new one, and
// the hand resend's ngrp_activate_token_tx would revoke the earlier links. That is right for a
// deliberate resend and wrong every morning: last week's email would be dead, and so would the page
// of someone typing at 8 AM (their code and session are tied to the link they opened). So a reminder
// ADDS an active link and revokes nothing, which needs 20261117000000 to drop the one-active index.
// Before it, the insert is refused with 23505 and the run stops before anything is mailed. Revoke
// and the hand resend both already act on every active link of an assignment.
import { effectiveFormClose } from './ngrpTransition.js'
import { rosterStatus, NOT_PROCEEDING } from './ngrpPool.js'
import { getStudentBulkEmailRoute } from '../../src/lib/studentBulkEmail.js'
import { ALUMNUS_ROUTE } from '../../src/lib/notifications/studentEmailLifecycle.js'

export const REMINDER_NOTIFICATION_TYPE = 'ngrp_transition_form_reminder'
export const RECENT_HOURS = 20
const WAITING_STATUSES = new Set(['sent', 'opened', 'in_progress'])
const APPLICATION_OVER = new Set(['hired', NOT_PROCEEDING, 'declined_offer', 'not_selected', 'offered'])
const HOUR = 3_600_000

export const REMINDER_STUDENT_FIELDS = 'id, first_name, last_name, preferred_first_name, name, status, school_email, personal_email, rotation:cohort_school_rotation_id ( rotation_end_date ), residency_outcomes:ngrp_residency_outcomes ( hired_at, separated_at, cs_email )'

/** Who gets today's reminder, and why each of the others does not. Pure. */
export function reminderTargets({ cycle, candidates = [], assignments = [], tokens = [], students = [], nowMs = Date.now() }) {
  const assignmentById = new Map(assignments.map(a => [a.id, a]))
  const studentById = new Map(students.map(s => [s.id, s]))
  const tokensByAssignment = new Map()
  for (const t of tokens) {
    if (!tokensByAssignment.has(t.assignment_id)) tokensByAssignment.set(t.assignment_id, [])
    tokensByAssignment.get(t.assignment_id).push(t)
  }
  const targets = [], skipped = {}
  const skip = why => { skipped[why] = (skipped[why] || 0) + 1 }
  for (const candidate of candidates) {
    const assignment = assignmentById.get(candidate.assignment_id)
    if (!assignment || assignment.revoked_at || !WAITING_STATUSES.has(assignment.status) || assignment.revision_count > 0) continue
    const close = effectiveFormClose(cycle, assignment)
    if (!close || nowMs > Date.parse(close)) { skip('closed'); continue }
    if (APPLICATION_OVER.has(rosterStatus(candidate))) { skip('application_over'); continue }
    const links = tokensByAssignment.get(assignment.id) || []
    if (!links.some(t => t.status === 'active')) { skip('link_revoked'); continue }
    if (links.some(t => nowMs - Date.parse(t.created_at) < RECENT_HOURS * HOUR)) { skip('recently_sent'); continue }
    const student = studentById.get(candidate.student_id)
    if (!student || student.status !== 'Completed') { skip('not_completed'); continue }
    const email = getStudentBulkEmailRoute(student, ALUMNUS_ROUTE).email // ALUMNUS-EMAIL-1
    if (!email) { skip('no_email'); continue }
    targets.push({ candidate, assignment, student, email })
  }
  return { targets, skipped }
}

/**
 * Add one active link for this assignment. { raw, token } on success; { notReady: true } while the
 * one-active index is still in place, which is the signal to stop the run before anything is mailed.
 */
export async function addReminderLink(db, assignmentId, generateToken) {
  const { raw, hash, hashPrefix } = generateToken()
  const { data, error } = await db.from('ngrp_transition_tokens')
    .insert({ assignment_id: assignmentId, token_hash: hash, token_hash_prefix: hashPrefix, status: 'active' })
    .select('id, token_hash_prefix').maybeSingle()
  if (error?.code === '23505') return { notReady: true }
  if (error || !data) return { error: error || new Error('token_write_failed') }
  return { raw, token: data }
}

/** The provider refused the email, so nobody holds this link. An unknown outcome keeps it live. */
export async function retireUnsentLink(db, tokenId, reason) {
  return db.from('ngrp_transition_tokens').update({ status: 'failed', failed_reason: reason }).eq('id', tokenId)
}
