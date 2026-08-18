// src/lib/placementNotification.js
//
// PLACEMENT-COMMUNICATION-HANDOFF-1 - the ONE definition of "this unit leader has
// been notified", shared by every surface that can claim it.
//
// THE RULE. Opening a compose window proves only that a draft was handed to
// Outlook. It does not prove the draft was sent: the sender may edit it, close
// it, or abandon it. So no surface may record a notification at compose time.
// The notified state is written only after a human confirms the email actually
// went, and every surface says the same thing while it waits.
//
// WHY IT LIVES HERE. Two surfaces offer this action - the Placement Board's unit
// card and the Action Center's task - and they used to implement it separately,
// which is exactly how one of them ended up writing on compose while the other
// did not. The copy, the pending-set rule, and the patch are defined once, so the
// two cannot drift again: a change to the rule changes both, or neither.
//
// IDEMPOTENCY IS STRUCTURAL, NOT A FLAG. `pendingNotifyTargets` re-derives the
// work from the LIVE match rows every time it is asked. Once a row carries
// notification_sent it stops being pending, so a second confirmation - from
// either surface, in any order - has nothing left to write. Nothing needs to
// remember that a click already happened.

/** The exact words both surfaces use while a draft is open but unconfirmed. */
export const NOTIFY_CONFIRM = Object.freeze({
  /** @param names human-readable student names, already joined */
  headline: (names) =>
    `Draft opened for ${names}. Nothing is recorded yet. Confirm only after you have actually sent the email.`,
  /** Short form for a narrow surface (the Action Center task row). */
  shortHeadline: 'Nothing is recorded yet. Confirm only after you have actually sent the email.',
  confirmLabel: 'Mark unit as notified',
  dismissLabel: 'Not sent yet',
  busyLabel: 'Recording…',
})

/** The canonical notified patch. The only shape written to a match row. */
export function notifiedPatch(nowIso = new Date().toISOString()) {
  return { notification_sent: true, notified_at: nowIso }
}

/**
 * Which of these placements still need recording, judged against LIVE match rows.
 *
 * A target names a (student, unit) placement. It survives only when its match row
 * exists and is not already recorded as notified - so an already-notified row,
 * whichever surface recorded it, is silently skipped rather than written twice.
 *
 * @param targets [{ studentId, unitId, label? }]
 * @param matches the cohort's match rows, as currently held in app state
 * @returns [{ studentId, unitId, label, match }]
 */
export function pendingNotifyTargets(targets, matches) {
  const rows = Array.isArray(matches) ? matches : []
  return (Array.isArray(targets) ? targets : [])
    .map(t => {
      if (!t || !t.studentId || !t.unitId) return null
      const match = rows.find(m => m && m.student_id === t.studentId && m.unit_id === t.unitId) || null
      if (!match || match.notification_sent) return null
      return { ...t, match }
    })
    .filter(Boolean)
}

/** The confirmation sentence for a set of pending targets, or '' when none. */
export function notifyConfirmHeadline(pending) {
  const names = (pending || []).map(p => p.label).filter(Boolean)
  if (names.length === 0) return ''
  return NOTIFY_CONFIRM.headline(names.join(', '))
}

/** What to say once a confirmation has been recorded. */
export function notifyRecordedMessage(unitName, count) {
  const n = Number(count) || 0
  return `Recorded: ${unitName} notified about ${n} student${n !== 1 ? 's' : ''}.`
}

/**
 * What to say when a confirmation could not be written. Deliberately explicit
 * that nothing was recorded, because the task and the badge will still be there.
 */
export function notifyFailedMessage(count) {
  const n = Number(count) || 0
  return `${n} notification${n !== 1 ? 's' : ''} could not be recorded. Nothing was changed - you can try again.`
}
