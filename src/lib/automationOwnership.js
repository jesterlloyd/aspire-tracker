// ACTION-OWNERSHIP-1: who owns a piece of work, a person or a cron?
//
// THE DEFECT THIS EXISTS TO FIX
// The Action Center showed "Send Interview Reminder" as an unresolved manual
// task for students whose reminder is sent by api/cron/interview-reminders.js.
// It was not merely noisy, it was unresolvable: the cron records its sends in
// `notification_log`, and the Action Center predicate only ever looked in
// `communications`. Those are different tables, so a reminder the automation
// had already delivered could never clear the card. The item persisted past the
// interview itself, which is why completed interviews still read
// "Reminder not sent."
//
// THE RULE
// The Action Center answers "what needs my attention?", not "what is happening
// soon?". Work owned by a healthy automation is not the Owner's work. It
// becomes the Owner's work only when the automation cannot do it: the send
// failed, its window passed without a send, or the automation is switched off.
//
// WHY THIS IS A REGISTRY AND NOT AN `if (interview_reminder)` BRANCH
// Every scheduled automation already declares itself in three places that this
// module simply joins: automation_settings (allowed to run?), cron_runs (did it
// run?), and notification_log (did it send?). Ownership is therefore derivable
// from existing state, so a second automation added later needs a registry
// entry, not new branching in the attention engine.

/** An action a person must perform. */
export const OWNER_HUMAN = 'human'
/** An action a scheduled cron performs without anyone's involvement. */
export const OWNER_AUTOMATION = 'automation'

// ── Resolved states ─────────────────────────────────────────────────────────
// Only EXCEPTION_STATES produce an Action Needed item. PASSIVE_STATES may be
// shown as status but never counted.
export const STATE = Object.freeze({
  SENT: 'sent',             // automation (or a manual resend) delivered it
  SCHEDULED: 'scheduled',   // automation owns it and its moment has not arrived
  NOT_DUE: 'not_due',       // too far out for the automation to have acted
  PAST: 'past',             // the event happened; no reminder is meaningful
  FAILED: 'failed',         // a send was attempted and failed
  MISSED: 'missed',         // the window passed with no send and no retry
  DISABLED: 'disabled',     // automation switched off, so a person owns it
  // The automation has no send scheduled for this subject at all, so it was
  // never going to act. Distinct from MISSED, which accuses a healthy
  // automation of dropping work it actually owned.
  UNSCHEDULED: 'unscheduled',
  UNKNOWN: 'unknown',       // delivery state not loaded yet - never invent work
})

const EXCEPTION_STATES = new Set([STATE.FAILED, STATE.MISSED, STATE.DISABLED, STATE.UNSCHEDULED])
const PASSIVE_STATES = new Set([STATE.SCHEDULED, STATE.NOT_DUE])

/** True only when a person genuinely has to do something. */
export function requiresHuman(state) {
  return EXCEPTION_STATES.has(state)
}

/** True when the state is worth showing as status but is nobody's task. */
export function isPassiveStatus(state) {
  return PASSIVE_STATES.has(state)
}

// ── Registry ────────────────────────────────────────────────────────────────
// Mirrors AUTOMATION_CARDS in src/components/connect/AutomationView.jsx, which
// is the operator-facing catalog of the same automations. The fields here are
// the ones ownership depends on; see api/cron/<cronName>.js for behavior.
export const AUTOMATED_ACTIONS = Object.freeze({
  interview_reminder: Object.freeze({
    automationKey: 'interview_reminders',   // automation_settings.automation_key
    cronName: 'interview-reminders',        // cron_runs.cron_name
    notificationType: 'interview_reminder', // notification_log.notification_type
    manualType: 'interview_reminder',       // communications.type (manual resend)
    // The cron runs daily at 17:00 UTC and targets interviews on the NEXT
    // Pacific calendar date, so the send moment for an interview on date D is
    // 17:00 UTC on D-1.
    leadDays: 1,
    runHourUtc: 17,
    // The cron dedupes over 48h but only ever targets *tomorrow*, so a student
    // it misses is never retried: the next day's run no longer considers them.
    // A miss is therefore terminal and genuinely needs a person.
    retries: false,
    // Grace after the scheduled moment before calling a send missed, so a run
    // still in flight is not reported as a failure.
    graceHours: 3,
    label: 'Interview reminder',
  }),
})

/** UTC ms for the moment the automation should act on an event date. */
function scheduledSendUtc(eventDate, { leadDays, runHourUtc }) {
  const [y, m, d] = String(eventDate).split('-').map(Number)
  if (!y || !m || !d) return null
  return Date.UTC(y, m - 1, d - leadDays, runHourUtc, 0, 0)
}

/**
 * Resolve who owns one automation-backed action for one event.
 *
 * Pure: callers pass `now` and the already-fetched delivery rows, so the tests
 * and both consumers exercise identical logic.
 *
 * @param {object}  o
 * @param {string}  o.actionKey        key into AUTOMATED_ACTIONS
 * @param {string}  o.eventDate        'YYYY-MM-DD' the reminder is about
 * @param {string}  o.todayDate        'YYYY-MM-DD' local today
 * @param {Date}    o.now
 * @param {Array}   o.deliveries       notification_log rows for this subject
 * @param {Array}   o.manualLogs       communications rows for this subject
 * @param {boolean} o.deliveriesLoaded false until the delivery query resolves
 * @param {boolean} o.automationEnabled automation_settings toggle
 * @param {boolean} o.automationScheduled is this subject in the cron's scope?
 */
export function resolveAutomationState({
  actionKey,
  eventDate,
  todayDate,
  now = new Date(),
  deliveries = [],
  manualLogs = [],
  deliveriesLoaded = true,
  automationEnabled = true,
  // ACTION-OWNERSHIP-2: does the automation actually have THIS subject
  // scheduled? The interview-reminder cron only ever sees interviews booked
  // through the scheduler (an interview_sessions row with a slot); an
  // interview typed straight onto the student record is invisible to it. The
  // caller resolves that from the same rows the cron reads.
  automationScheduled = true,
}) {
  const spec = AUTOMATED_ACTIONS[actionKey]
  if (!spec) return { state: STATE.UNKNOWN, owner: OWNER_HUMAN, spec: null }

  const result = (state, extra = {}) => ({
    state,
    owner: requiresHuman(state) ? OWNER_HUMAN : OWNER_AUTOMATION,
    spec,
    ...extra,
  })

  if (!eventDate) return result(STATE.UNKNOWN)

  // A manual resend resolves the work regardless of what automation did.
  const manuallySent = manualLogs.some(c => c.type === spec.manualType)
  if (manuallySent) return result(STATE.SENT, { via: 'manual' })

  // Until the delivery rows are loaded we cannot tell sent from missed. Report
  // UNKNOWN so callers surface nothing: inventing an action from missing data
  // is exactly the failure mode this module exists to remove.
  if (!deliveriesLoaded) return result(STATE.UNKNOWN)

  const mine = deliveries.filter(d => d.notification_type === spec.notificationType)
  const succeeded = mine.filter(d => d.status !== 'failed')
  if (succeeded.length > 0) return result(STATE.SENT, { via: 'automation' })

  const failed = mine.filter(d => d.status === 'failed')
  if (failed.length > 0) {
    // An attempted-and-failed send needs a person: this cron does not retry.
    return result(STATE.FAILED, { attemptedAt: failed[0].sent_at || null })
  }

  // Nothing sent. The event itself decides whether that still matters.
  if (eventDate < todayDate) return result(STATE.PAST)

  const sendAt = scheduledSendUtc(eventDate, spec)
  if (sendAt === null) return result(STATE.UNKNOWN)
  const deadline = sendAt + spec.graceHours * 3600 * 1000

  if (!automationEnabled) {
    // Switched off, so nobody is going to send this but a person. Only worth
    // raising while the reminder could still be useful (event not past).
    return result(STATE.DISABLED, { scheduledFor: new Date(sendAt).toISOString() })
  }

  if (now.getTime() < deadline) {
    // Automation still owns it. Distinguish "its moment is near" from "not due
    // for a while" purely for how it reads as status.
    return result(now.getTime() >= sendAt - 24 * 3600 * 1000 ? STATE.SCHEDULED : STATE.NOT_DUE,
      { scheduledFor: new Date(sendAt).toISOString(), automationScheduled })
  }

  // ACTION-OWNERSHIP-2: the window has passed with no send. WHY nothing was
  // sent decides whose fault it is, and the two answers are not the same:
  //
  //   automationScheduled true  - the cron had this subject and did not send.
  //                               That is a genuine miss and it will not retry.
  //   automationScheduled false - the cron never had this subject, so nothing
  //                               was missed. A person owns the reminder and
  //                               always did.
  //
  // Conflating them is what produced "was not sent automatically and will not
  // retry" for interviews the automation could not see, which sent people to
  // investigate a healthy cron.
  if (!automationScheduled) {
    return result(STATE.UNSCHEDULED, { scheduledFor: new Date(sendAt).toISOString() })
  }
  return result(STATE.MISSED, { scheduledFor: new Date(sendAt).toISOString() })
}

/** Human-readable status for a passive/exception row. */
export function describeAutomationState(state, spec) {
  const label = spec?.label || 'Reminder'
  switch (state) {
    case STATE.SCHEDULED:
    case STATE.NOT_DUE: return `${label} scheduled automatically.`
    case STATE.SENT:    return `${label} sent automatically.`
    case STATE.FAILED:  return `${label} failed to send. Send it manually.`
    case STATE.MISSED:  return `${label} was not sent automatically and will not retry.`
    case STATE.DISABLED:return `${label} automation is off. Send it manually.`
    case STATE.UNSCHEDULED:
      return `${label} is not automated for this interview because it was not booked through the scheduler. Send it manually.`
    default:            return `${label} status unavailable.`
  }
}
