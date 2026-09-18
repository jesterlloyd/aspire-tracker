// STUDENT-CHART-1: the follow-up flag, and the one place that knows what it means.
//
// THE RULE (Owner, 2026-09-18): this is NOT the interview flag. The student chart's
// ribbon and the interview rubric's ribbon are the same gesture on two different
// records. `flagged_for_second_interview` says "bring this candidate back for a second
// interview" and reddens their Interview Recommendations row. `flagged_for_followup`
// says "come back to this student", and reaches nothing else. Writing one where the
// other belongs would quietly put rotation students into a hiring queue.
//
// Like the rubric's ribbon, the flag carries NO note. The pull is the whole interaction.
//
// SHIPPING BEFORE THE COLUMN EXISTS. db/migrations/20260921000000_student_followup_flag.sql
// is Owner-gated, so this module is written to be correct on both sides of it:
// `isFollowUpFlagged` reads an absent column as false, and `setFollowUpFlag` turns the
// server's 409 into a `notEnabled` result the ribbon renders as a disabled control. The
// moment the migration is applied the flag starts working with no redeploy, because
// fetchStudents selects '*'.

import { supabase } from './supabase'

export const FOLLOW_UP_FLAG_COLUMN = 'flagged_for_followup'

/** True only when the column exists AND is set. An absent column is not a flag. */
export function isFollowUpFlagged(student) {
  return student?.[FOLLOW_UP_FLAG_COLUMN] === true
}

/**
 * Whether this student record came back from a database that has the column at all.
 * `select('*')` omits a column that does not exist, so `undefined` means "not migrated"
 * while `false` means "migrated, not flagged". The ribbon uses this to decide whether it
 * is a live control or an inert one, rather than letting the user pull a ribbon that
 * cannot save.
 */
export function followUpFlagAvailable(student) {
  return !!student && student[FOLLOW_UP_FLAG_COLUMN] !== undefined
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

/**
 * Set the flag. Resolves to { ok: true } on a write, { ok: false, notEnabled: true } when
 * the migration has not been applied, and throws for every other failure so the caller
 * can show a real error. Never sends a note, and never touches the interview flag.
 */
export async function setFollowUpFlag(studentId, flagged) {
  const res = await fetch('/api/student-update', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      action: 'set_followup_flag',
      student_id: studentId,
      [FOLLOW_UP_FLAG_COLUMN]: !!flagged,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 409 && data.error === 'not_enabled') return { ok: false, notEnabled: true, message: data.message }
  if (!res.ok) throw new Error(data.message || data.error || 'Could not change the follow-up flag')
  return { ok: true }
}
