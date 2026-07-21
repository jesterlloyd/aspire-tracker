// lib/server/notifications/unitLeaderAlerts.js
//
// UL-PORTAL: the Unit Leader notification layer.
//
// Reuses the existing infrastructure rather than building a parallel framework:
// Resend through src/lib/notifications, and public.notification_log for the
// delivery record. The only new table is the one already applied,
// public.unit_leader_notification_prefs.
//
// TWO DELIVERY CHANNELS, ONE SOURCE OF TRUTH.
//
//   In-app   DERIVED, not stored. The feed is computed from the caller's own
//            authorized domain rows on every request. There is no notification
//            store to drift, nothing to mark read that could disagree with
//            reality, and no migration: a placement request that has been answered
//            simply stops appearing. This is why in-app needs no preference check
//            either, since it only ever shows the caller their own current work.
//
//   Email    SENT, and therefore deduplicated. It respects preferences, honors
//            unsubscribe, and is recorded in notification_log so a repeat of the
//            same alert for the same subject is never sent twice.
//
// FAILURE NEVER BREAKS THE ACTION. Every send path is best effort and returns a
// result rather than throwing, so a placement response or a capacity submission
// always succeeds even if email is down. The domain row is the authoritative
// record, exactly as with the audit layer.

import { sendNotification } from '../../../src/lib/notifications/index.js'

// The eight approved alert types. This list is the contract with
// chk_ulnp_alert_type, so a value that is not here is not storable either.
export const ALERT_TYPES = [
  'placement_request',
  'response_deadline',
  'onboarding_issue',
  'schedule_change',
  'new_message',
  'capacity_review_outcome',
  'preceptor_assignment_update',
  'concern_follow_up',
]

// Which alerts may send email at all. The others are in-app only, which is how
// "do not email every state change" is enforced structurally rather than by
// remembering not to call the sender.
export const EMAIL_ELIGIBLE = new Set([
  'placement_request',
  'response_deadline',
  'onboarding_issue',
  'schedule_change',
  'new_message',
])

// Stable defaults. An absent preference row means the default applies, so a Unit
// Leader who has never touched preferences still receives the approved alerts.
export const DEFAULT_EMAIL_ENABLED = true

export const ALERT_LABEL = {
  placement_request: 'New placement request',
  response_deadline: 'Response deadline approaching',
  onboarding_issue: 'Onboarding needs attention',
  schedule_change: 'Schedule change',
  new_message: 'New ASPIRE message',
  capacity_review_outcome: 'Capacity review outcome',
  preceptor_assignment_update: 'Preceptor assignment update',
  concern_follow_up: 'Concern follow up',
}

/**
 * Is this alert type valid? Anything else is refused rather than stored, because
 * the database CHECK would refuse it anyway and a silent mismap would corrupt the
 * preference model.
 */
export const isAlertType = (t) => ALERT_TYPES.includes(t)

/**
 * Resolve email preference for one profile and alert type.
 * Absent row means the stable default. A disabled row means unsubscribed.
 * Fails CLOSED to "do not send" on a lookup error, because an unwanted email
 * cannot be recalled while a missing one is recoverable.
 */
export async function emailEnabledFor(db, profileId, alertType) {
  if (!EMAIL_ELIGIBLE.has(alertType)) return false
  try {
    const { data, error } = await db
      .from('unit_leader_notification_prefs')
      .select('email_enabled')
      .eq('user_profile_id', profileId)
      .eq('alert_type', alertType)
      .maybeSingle()
    if (error) return false
    if (!data) return DEFAULT_EMAIL_ENABLED
    return data.email_enabled === true
  } catch {
    return false
  }
}

/**
 * The Unit Leaders who should hear about something happening on a unit.
 *
 * AUDIENCE IS SCOPE, NOT A LIST. It is derived from an ACTIVE unit_leader role
 * grant plus an ACTIVE user_unit_scopes row for that unit, so a revoked or expired
 * assignment stops receiving alerts immediately and nobody is ever addressed by
 * name, title, or email.
 */
export async function unitLeaderAudience(db, unitKey, cohortId = null) {
  const nowIso = new Date().toISOString()

  const { data: scopes, error: sErr } = await db
    .from('user_unit_scopes')
    .select('user_profile_id, cohort_id, starts_at, expires_at, revoked_at')
    .eq('unit_key', unitKey)
    .is('revoked_at', null)
  if (sErr || !scopes) return []

  const candidates = scopes
    .filter(s => s.starts_at <= nowIso && (s.expires_at == null || s.expires_at > nowIso))
    .filter(s => s.cohort_id === null || cohortId === null || s.cohort_id === cohortId)
    .map(s => s.user_profile_id)
  if (candidates.length === 0) return []

  const { data: grants } = await db
    .from('user_role_grants')
    .select('user_profile_id, starts_at, expires_at, revoked_at')
    .eq('role', 'unit_leader')
    .in('user_profile_id', candidates)
    .is('revoked_at', null)

  const granted = new Set((grants || [])
    .filter(g => g.starts_at <= nowIso && (g.expires_at == null || g.expires_at > nowIso))
    .map(g => g.user_profile_id))
  if (granted.size === 0) return []

  const { data: profiles } = await db
    .from('user_profiles')
    .select('id, email, full_name, is_active')
    .in('id', [...granted])

  return (profiles || [])
    .filter(p => p.is_active !== false && p.email)
    .map(p => ({ profileId: p.id, email: p.email, fullName: p.full_name }))
}

/**
 * A stable idempotency key for one alert about one subject for one recipient.
 * Deterministic, so the same event can be emitted repeatedly and only send once.
 */
export function alertIdempotencyKey({ alertType, subjectId, profileId }) {
  return `ul:${alertType}:${subjectId || 'none'}:${profileId}`
}

/** Has this exact alert already been recorded for this recipient? */
async function alreadySent(db, key) {
  try {
    const { data, error } = await db
      .from('notification_log')
      .select('id')
      .eq('notification_type', 'unit_leader_alert')
      .contains('metadata', { idempotency_key: key })
      .limit(1)
    if (error) return false
    return (data || []).length > 0
  } catch {
    return false
  }
}

/**
 * Emit one Unit Leader alert.
 *
 * Returns a RESULT rather than throwing, and never rethrows, so a caller's
 * authoritative write is never rolled back by a notification problem.
 *
 * Order: validate, resolve audience by scope, check preference, check idempotency,
 * send, record. Anything that fails short-circuits to a reported outcome.
 */
export async function emitUnitLeaderAlert(db, {
  alertType, unitKey, cohortId = null, subjectId = null, subject, summary, ctaPath = '/portal/unit/home',
}) {
  const outcomes = []
  try {
    if (!isAlertType(alertType)) {
      return { ok: false, reason: 'invalid_alert_type', outcomes }
    }

    const audience = await unitLeaderAudience(db, unitKey, cohortId)
    if (audience.length === 0) return { ok: true, reason: 'no_audience', outcomes }

    for (const person of audience) {
      const key = alertIdempotencyKey({ alertType, subjectId, profileId: person.profileId })

      const wantsEmail = await emailEnabledFor(db, person.profileId, alertType)
      if (!wantsEmail) {
        outcomes.push({ profileId: person.profileId, sent: false, reason: 'preference_off' })
        continue
      }

      if (await alreadySent(db, key)) {
        outcomes.push({ profileId: person.profileId, sent: false, reason: 'duplicate' })
        continue
      }

      try {
        await sendNotification('unit_leader_alert', {
          recipient: { email: person.email, name: person.fullName, audience: 'unit_leader' },
          alert_type: alertType,
          alert_label: ALERT_LABEL[alertType],
          unit_name: unitKey,
          subject,
          summary,
          cta_path: ctaPath,
          idempotency_key: key,
        })
        outcomes.push({ profileId: person.profileId, sent: true, reason: 'sent' })
      } catch {
        // A send failure leaves no log row, so a later retry is still possible and
        // is not blocked by the idempotency check.
        outcomes.push({ profileId: person.profileId, sent: false, reason: 'send_failed' })
      }
    }
    return { ok: true, outcomes }
  } catch {
    return { ok: false, reason: 'emit_failed', outcomes }
  }
}
