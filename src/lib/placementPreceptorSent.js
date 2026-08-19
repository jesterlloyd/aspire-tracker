// src/lib/placementPreceptorSent.js
//
// PLACEMENT-COMMUNICATION-HANDOFF-1A - "has this placement's preceptor been sent
// their assignment email?", answered from evidence that already exists.
//
// THE AUDIT BEHIND THIS FILE. Five candidate homes were examined before writing
// anything:
//
//   matches.notification_sent / notified_at
//       REJECTED. That pair is the UNIT LEADER's notification, read by the board's
//       "N of M notified" count, by lib/attention.js, and by the Action Center
//       task. Reusing it would make one preceptor email silence a different
//       unanswered question, and there is no second pair on the table.
//   student_preceptor_assignments
//       REJECTED. It carries no unit dimension at all (student, preceptor, cohort,
//       role, status), so it cannot distinguish a multi-unit student's two
//       placements - the exact case this state has to keep apart.
//   communications
//       REJECTED. student_id + cohort_id + a type string. No unit, no preceptor,
//       and it is written from compose-time paths, so its rows do not mean "sent".
//   message_archive
//       REJECTED. It belongs to the student Messages threads, not to ASPIRE
//       Connect outreach.
//   notification_log
//       ACCEPTED. api/connect-send-direct-email.js writes exactly one row, with
//       notification_type='direct_message_sent' and status='sent', and it writes
//       it ONLY after Resend has accepted the message - a failed send returns 500
//       several lines earlier and logs nothing. So the row's existence IS
//       confirmed send-success evidence, which is what this display needs.
//
// WHAT WAS ADDED, AND WHAT WAS NOT. No column, no table, no boolean. The row was
// already being written; it simply did not say WHICH placement it was about, so
// the send endpoint now records the placement identity inside the metadata jsonb
// it already populates. Nothing else changed about how or when the row is written.
//
// THE IDENTITY IS THE MATCH ROW, NOT THE STUDENT-UNIT PAIR. See placementSentKey
// below: a placement that is unmatched and rematched is a NEW match row, and it
// must not inherit the deleted one's Sent chip.
//
// AND THE RECORD IS NOT SELF-ASSERTED. api/lib/placementSendGuard.js proves every
// part of the claimed placement against the database before the mail provider is
// contacted, and builds the stamped metadata from the rows it read - so the
// evidence this module reduces was never copied from a browser payload.
//
// WHY THE REQUIRED BEHAVIOR FALLS OUT:
//   • Opening a draft records nothing - only the send endpoint writes this row.
//   • Cancelling records nothing, for the same reason.
//   • A failed send records nothing: the endpoint returns before the log write.
//   • A rejected placement records nothing: the guard returns before the send.
//   • Replacing the preceptor cannot inherit anything: the preceptor id is part
//     of the key, so a new preceptor simply has no matching row.
//   • Deleting and recreating a placement cannot inherit anything either: the new
//     match row has a new id, and ids are never reused.
//   • A multi-unit student stays isolated: each placement is its own match row.
//   • Repeated sends append history rather than mutating a flag, so there is no
//     duplicate state to become misleading - "sent" means "at least one confirmed
//     send exists", which more rows can only re-confirm.
//   • It survives a refresh because it is a durable row, not local state.

/** The metadata keys the send endpoint stamps. Server and client share them. */
export const PLACEMENT_META = Object.freeze({
  template: 'placement_template_key',
  student: 'placement_student_id',
  unit: 'placement_unit_id',
  preceptor: 'placement_preceptor_id',
  cohort: 'placement_cohort_id',
  match: 'placement_match_id',
})

/** The one template whose sends this module tracks. */
export const PRECEPTOR_ASSIGNMENT_TEMPLATE = 'preceptor_assignment'

/** The provider-send source of this evidence. */
export const DIRECT_MESSAGE_TYPE = 'direct_message_sent'

/**
 * The MANUAL source (PRECEPTOR-DRAFT-CONTINUITY-1): an Owner/Admin answering the
 * board's follow-up question - "Were you able to send the assignment email?" -
 * with Yes. It is deliberately a DIFFERENT notification_type with a different
 * status, so it can never masquerade as a provider-confirmed send: the row says
 * a human confirmed it, and the tooltip says so too. Written only by
 * api/placement-notification-confirm.js, which re-proves the placement against the
 * database (same guard as a real send) before recording anything.
 */
export const MANUAL_CONFIRMATION_TYPE = 'placement_manual_confirmation'
export const MANUAL_CONFIRMATION_STATUS = 'confirmed'

/**
 * The statuses that count as "this email was sent".
 *
 * THE DEFECT THIS FIXES. status is not a constant - it is a LIFECYCLE.
 * api/webhooks/resend.js advances it monotonically as Resend reports delivery:
 * sent -> delivered -> opened -> clicked (or delayed). The first version of this
 * module accepted only 'sent', so the moment a real email was DELIVERED - usually
 * seconds after sending - the row stopped matching and the board's Sent state
 * silently vanished. The fixture QC never saw it because the harness writes
 * 'sent' and no webhook ever advances it; production always advances it.
 *
 * Every later state in this list is STRONGER evidence than 'sent', not weaker:
 * delivered means the inbox accepted it, opened/clicked mean the preceptor read
 * it. 'delayed' means Resend is still trying after accepting it.
 *
 * DELIBERATELY EXCLUDED: 'bounced' and 'complained'. The message was dispatched
 * but did NOT reach the preceptor, so showing "Sent" would hide exactly the
 * situation where staff need to fix the address and send again - and clearing
 * the state leaves the envelope clickable for that retry. 'queued' and 'failed'
 * were never success. (The evaluation endpoints' ALREADY_SENT_STATUSES list
 * includes bounces because it answers a different question - "should we
 * auto-send AGAIN?" - where a bounce still means don't.)
 */
export const SENT_EVIDENCE_STATUSES = Object.freeze([
  'sent', 'delivered', 'opened', 'clicked', 'delayed',
])

const trim = (v) => (typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim()))

/**
 * The metadata block for a preceptor-assignment send, or null when the placement
 * cannot be fully identified.
 *
 * ALL FIVE IDENTIFIERS OR NONE - and the MATCH ID is one of them, because it is
 * the identity the board reads back. A record missing it could never be matched
 * to a placement row, and a record missing any other part could be matched to the
 * wrong one. Under-claiming is recoverable; a misattributed "Sent" is not, so an
 * incomplete placement is simply not recorded.
 */
export function placementSendMetadata(ref) {
  const studentId = trim(ref?.studentId)
  const unitId = trim(ref?.unitId)
  const preceptorId = trim(ref?.preceptorId)
  const cohortId = trim(ref?.cohortId)
  const matchId = trim(ref?.matchId)
  if (!studentId || !unitId || !preceptorId || !cohortId || !matchId) return null
  return {
    [PLACEMENT_META.template]: PRECEPTOR_ASSIGNMENT_TEMPLATE,
    [PLACEMENT_META.student]: studentId,
    [PLACEMENT_META.unit]: unitId,
    [PLACEMENT_META.preceptor]: preceptorId,
    [PLACEMENT_META.cohort]: cohortId,
    [PLACEMENT_META.match]: matchId,
  }
}

/**
 * The key a placement is looked up by: THE CURRENT MATCH ROW, and the preceptor
 * currently assigned to it.
 *
 * WHY THE MATCH ID AND NOT THE STUDENT-UNIT PAIR. A match can be deleted and
 * recreated for the same student and the same unit - unmatching and rematching a
 * placement does exactly that - and the new row is a NEW placement that nobody
 * has emailed about. Keying on (student, unit) would let the recreated placement
 * inherit the deleted one's Sent chip, which is the fabricated state this key
 * exists to prevent. A match id is never reused, so history cannot leak forward.
 *
 * WHY THE PRECEPTOR TOO. The same placement can change hands. A send belongs to
 * the preceptor it was addressed to, so replacing them leaves the new preceptor
 * unsent - while the previous preceptor's record stays intact as history.
 */
export function placementSentKey({ matchId, preceptorId } = {}) {
  const m = trim(matchId), p = trim(preceptorId)
  if (!m || !p) return ''
  return `${m}|${p}`
}

/**
 * Reduce notification_log rows to the placements with a confirmed send.
 *
 * Only rows that are BOTH the preceptor-assignment template AND status 'sent'
 * count. The newest send per placement wins for display purposes; earlier ones
 * remain in the log as history.
 *
 * @param rows [{ status, sent_at, metadata }]
 * @returns Map<key, { sentAt, count }>
 */
export function preceptorSentIndex(rows) {
  const index = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue
    // Two admissible sources, each with its own status contract:
    //   provider send  - direct_message_sent, at an accepted-or-better status
    //                    (the webhook ADVANCES status after acceptance, so
    //                    equality with 'sent' would - and did - lose every row
    //                    the moment delivery confirmed);
    //   manual confirm - placement_manual_confirmation at 'confirmed', written
    //                    by the guarded confirm endpoint after a human said the
    //                    email went.
    // Anything else - bounced, failed, queued, a foreign type - is not evidence.
    const type = trim(row.notification_type)
    const status = trim(row.status)
    const isProviderSend = type === DIRECT_MESSAGE_TYPE && SENT_EVIDENCE_STATUSES.includes(status)
    const isManualConfirm = type === MANUAL_CONFIRMATION_TYPE && status === MANUAL_CONFIRMATION_STATUS
    if (!isProviderSend && !isManualConfirm) continue
    const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : null
    if (!meta) continue
    if (trim(meta[PLACEMENT_META.template]) !== PRECEPTOR_ASSIGNMENT_TEMPLATE) continue
    const key = placementSentKey({
      matchId: meta[PLACEMENT_META.match],
      preceptorId: meta[PLACEMENT_META.preceptor],
    })
    if (!key) continue
    const sentAt = trim(row.sent_at) || null
    const prev = index.get(key)
    if (!prev) {
      index.set(key, { sentAt, count: 1, manualOnly: isManualConfirm })
      continue
    }
    // Repeated sends and confirmations re-confirm ONE fact; they never create a
    // second state, and provider evidence outranks a manual answer for display.
    index.set(key, {
      sentAt: newerOf(prev.sentAt, sentAt),
      count: prev.count + 1,
      manualOnly: prev.manualOnly && isManualConfirm,
    })
  }
  return index
}

function newerOf(a, b) {
  if (!a) return b
  if (!b) return a
  return new Date(b).getTime() > new Date(a).getTime() ? b : a
}

/**
 * The display state for one placement row, judged against the row as it stands
 * NOW - its current match id and its currently assigned preceptor.
 * @returns {{sent: boolean, sentAt: string|null, count: number}}
 */
export function preceptorSentState(index, ref) {
  const key = placementSentKey(ref)
  const hit = key && index instanceof Map ? index.get(key) : null
  return hit
    ? { sent: true, sentAt: hit.sentAt, count: hit.count, manualOnly: !!hit.manualOnly }
    : { sent: false, sentAt: null, count: 0, manualOnly: false }
}

/** "Sent Aug 18" - short enough for a placement row, specific enough to trust. */
export function preceptorSentLabel(state) {
  if (!state?.sent) return ''
  if (!state.sentAt) return 'Sent'
  const d = new Date(state.sentAt)
  if (Number.isNaN(d.getTime())) return 'Sent'
  return `Sent ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

/** The full sentence for a tooltip, including how many times it was sent. */
export function preceptorSentTooltip(state, preceptorName) {
  const who = trim(preceptorName) || 'This preceptor'
  if (!state?.sent) {
    return `${who} has not been sent the assignment email from this placement yet.`
  }
  const when = state.sentAt && !Number.isNaN(new Date(state.sentAt).getTime())
    ? new Date(state.sentAt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    })
    : 'an earlier date'
  const again = state.count > 1 ? ` Sent ${state.count} times.` : ''
  // A manual answer is honest about being one: nobody's provider receipt is invented.
  const how = state.manualOnly ? ' Confirmed manually.' : ''
  return `${who} was sent the assignment email for this placement on ${when}.${again}${how}`
}
