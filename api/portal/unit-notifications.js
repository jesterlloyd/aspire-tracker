// api/portal/unit-notifications.js
//
// UL-PORTAL: the in-app notification feed and the email preference controls.
//
// GET   the derived feed plus the caller's current preferences
// POST  set one preference (this is also the unsubscribe path)
//
// THE FEED IS DERIVED, NOT STORED. Every item is computed from the caller's own
// authorized rows at request time, through the same scope source of truth every
// other Unit Leader endpoint uses. That means:
//   - it can never disagree with reality, because there is no second copy
//   - an item disappears the moment the underlying work is done, so nothing needs
//     marking read and nothing can be stale
//   - it needs no new table, and therefore no migration
//
// In-app items are NOT filtered by email preference. A preference governs email,
// which arrives uninvited; the in-app feed only ever shows a Unit Leader their own
// current work inside their own units, so suppressing it would hide real work.

import {
  verifyPortalUnitLeaderCaller,
  resolveUnitScopedStudents,
  narrowScopes,
} from '../lib/unitLeaderScope.js'
import {
  ALERT_TYPES, ALERT_LABEL, EMAIL_ELIGIBLE, DEFAULT_EMAIL_ENABLED, isAlertType,
} from '../../lib/server/notifications/unitLeaderAlerts.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const auth = await verifyPortalUnitLeaderCaller(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.reason })
  const { db, profile, scopes } = auth

  return req.method === 'GET'
    ? getFeed(req, res, { db, profile, scopes })
    : setPreference(req, res, { db, profile })
}

async function getFeed(req, res, { db, profile, scopes }) {
  const prefs = await loadPreferences(db, profile.id)

  if (scopes.length === 0) {
    return res.status(200).json({ notifications: [], unread_count: 0, preferences: prefs })
  }

  const requestedUnit = typeof req.query?.unit_key === 'string' ? req.query.unit_key : null
  const effective = narrowScopes(scopes, requestedUnit)
  if (effective === null) return res.status(403).json({ error: 'unit_not_in_scope' })

  const keys = [...new Set(effective.map(s => s.unit_key))]
  const items = []

  try {
    // placement_request and response_deadline
    const { data: requests } = await db
      .from('unit_placement_requests')
      .select('id, unit_key, cohort_id, unit_response, aspire_status, due_at, created_at')
      .in('unit_key', keys)
      .eq('aspire_status', 'open')
    for (const r of inScope(requests, effective)) {
      if (r.unit_response !== 'pending') continue
      items.push(item('placement_request', r.id, r.unit_key,
        'A placement request is awaiting your response.', r.created_at, 'placements'))
      if (r.due_at && new Date(r.due_at).getTime() - Date.now() < 3 * 86400000) {
        items.push(item('response_deadline', r.id, r.unit_key,
          'A placement response is due soon.', r.due_at, 'placements'))
      }
    }

    // capacity_review_outcome
    const { data: caps } = await db
      .from('unit_capacity_submissions')
      .select('id, unit_key, cohort_id, review_status, reviewed_at, period_label')
      .in('unit_key', keys)
      .neq('review_status', 'submitted')
      .is('superseded_at', null)
    for (const c of inScope(caps, effective)) {
      items.push(item('capacity_review_outcome', c.id, c.unit_key,
        `ASPIRE reviewed your capacity for ${c.period_label}: ${c.review_status}.`,
        c.reviewed_at, 'capacity'))
    }

    // preceptor_assignment_update
    const { data: noms } = await db
      .from('unit_preceptor_nominations')
      .select('id, unit_key, cohort_id, status, decided_at')
      .in('unit_key', keys)
      .neq('status', 'nominated')
    for (const n of inScope(noms, effective)) {
      items.push(item('preceptor_assignment_update', n.id, n.unit_key,
        `ASPIRE ${n.status} a preceptor nomination.`, n.decided_at, 'preceptors'))
    }

    // onboarding_issue, derived from the same rollup the Students screen shows.
    const { students } = await resolveUnitScopedStudents(db, effective)
    for (const s of students) {
      if (s.bucket !== 'upcoming' && s.bucket !== 'active') continue
      const done = [s.badge_created === true, s.cs_link_complete === true,
        !!s.student_form_privacy_ack_at].filter(Boolean).length
      if (done < 3) {
        items.push(item('onboarding_issue', s.id, s.unit_key,
          'A student has outstanding onboarding requirements.', null, 'students'))
      }
    }
  } catch {
    return res.status(500).json({ error: 'internal_error' })
  }

  items.sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0))

  return res.status(200).json({
    notifications: items,
    unread_count: items.length,
    preferences: prefs,
  })
}

async function setPreference(req, res, { db, profile }) {
  const body = req.body && typeof req.body === 'object' ? req.body : {}

  const allowed = new Set(['alert_type', 'email_enabled'])
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) return res.status(400).json({ error: 'unexpected_field', field: k })
  }

  const alertType = body.alert_type
  const emailEnabled = body.email_enabled
  if (!isAlertType(alertType)) return res.status(400).json({ error: 'invalid_alert_type' })
  if (typeof emailEnabled !== 'boolean') return res.status(400).json({ error: 'invalid_email_enabled' })
  // An alert that never sends email has no email preference to set.
  if (!EMAIL_ELIGIBLE.has(alertType)) return res.status(400).json({ error: 'alert_type_is_in_app_only' })

  const { error } = await db
    .from('unit_leader_notification_prefs')
    .upsert(
      { user_profile_id: profile.id, alert_type: alertType, email_enabled: emailEnabled, updated_at: new Date().toISOString() },
      { onConflict: 'user_profile_id,alert_type' },
    )
  if (error) return res.status(500).json({ error: 'internal_error' })

  return res.status(200).json({ preferences: await loadPreferences(db, profile.id) })
}

/**
 * Every alert type with its effective email setting. An absent row reports the
 * stable default, so the client renders the true state rather than an empty one.
 */
async function loadPreferences(db, profileId) {
  let rows
  try {
    const { data } = await db
      .from('unit_leader_notification_prefs')
      .select('alert_type, email_enabled')
      .eq('user_profile_id', profileId)
    rows = data || []
  } catch {
    // An unreadable preference table falls back to the stable defaults rather
    // than failing the whole feed.
    rows = []
  }
  const byType = new Map(rows.map(r => [r.alert_type, r.email_enabled]))
  return ALERT_TYPES.map(t => ({
    alert_type: t,
    label: ALERT_LABEL[t],
    email_supported: EMAIL_ELIGIBLE.has(t),
    email_enabled: EMAIL_ELIGIBLE.has(t)
      ? (byType.has(t) ? byType.get(t) === true : DEFAULT_EMAIL_ENABLED)
      : false,
  }))
}

/** Reapply the scope's cohort restriction after a fetch, as every list does. */
function inScope(rows, effective) {
  return (rows || []).filter(r =>
    effective.some(s => s.unit_key === r.unit_key && (s.cohort_id === null || s.cohort_id === r.cohort_id)))
}

function item(alertType, subjectId, unitKey, summary, occurredAt, section) {
  return {
    id: `${alertType}:${subjectId}`,
    alert_type: alertType,
    label: ALERT_LABEL[alertType],
    unit_key: unitKey,
    summary,
    occurred_at: occurredAt || null,
    section,
  }
}
