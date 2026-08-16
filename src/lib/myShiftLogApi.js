// src/lib/myShiftLogApi.js
//
// STUDENT-SHIFT-LOG-MANAGEMENT-1: the browser's ONLY path to changing a shift
// log. Reads keep using the portal_my_shift_logs view (RLS-scoped, SELECT
// only); every write goes through the authenticated portal endpoint, which
// resolves the student from the JWT and performs the change inside a
// service-role transaction. The browser holds no write grant on
// student_shift_logs and never sends a student id.

import { supabase } from './supabase'

async function post(payload) {
  try {
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) return { ok: false, error: 'unauthorized' }
    const res = await fetch('/api/portal/my-shift-log-manage', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: body.error || `http_${res.status}`, reason: body.reason }
    return { ok: true, result: body.result, eligibility: body.eligibility }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}

/** Correct one of my shift logs. Sends only intake fields; never a student id. */
export function editMyShiftLog(fields) {
  return post({ action: 'edit', ...fields })
}

/** Withdraw one of my shift logs (kept as history, removed from totals). */
export function voidMyShiftLog({ shift_id, reason }) {
  return post({ action: 'void', shift_id, reason })
}

/**
 * The AUTHORITATIVE eligibility verdict for one entry - the same
 * student_shift_edit_eligibility() the writer consults. The drawer asks the
 * server rather than guessing locally, so certificate-issued,
 * rotation-concluded, terminal, staff-decided, open, and withdrawn entries all
 * show the correct explanation BEFORE the student attempts anything.
 */
export async function fetchMyShiftEligibility(shiftId) {
  const r = await post({ action: 'eligibility', shift_id: shiftId })
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, eligibility: r.eligibility }
}

/** Student-facing copy for every refusal the endpoint can return. */
export const NOT_EDITABLE_COPY = {
  staff_decided: 'The ASPIRE team has already reviewed this shift, so it can no longer be changed here. Request a correction and the team will take it from there.',
  already_voided: 'This entry has already been withdrawn.',
  shift_in_progress: 'This shift is still open. Check out first, then you can correct it.',
  certificate_issued: 'Your certificate has already been issued, so shift entries are locked. Request a correction and the team will review it.',
  rotation_concluded: 'Your rotation has been marked complete, so shift entries are locked. Request a correction and the team will review it.',
  student_status_terminal: 'Your rotation record is closed, so shift entries are locked. Request a correction and the team will review it.',
  not_editable: 'This entry can no longer be changed here.',
}
