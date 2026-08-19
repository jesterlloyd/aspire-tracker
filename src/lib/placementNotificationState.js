// src/lib/placementNotificationState.js
//
// PLACEMENT-NOTIFICATION-CONTROL-1 - the ONE rule for "has staff confirmed this
// person was notified?", shared by the Placement Board's unit-leader row, its
// preceptor row, and the Action Center.
//
// ── THE DISTINCTION THIS FILE EXISTS TO ENFORCE ─────────────────────────────
//
// Two different facts were being conflated:
//
//   PROVIDER DELIVERY HISTORY - Resend accepted a message, and the webhook has
//   been advancing its status ever since. It is evidence that a system did
//   something, and it lives in notification_log as 'direct_message_sent'.
//
//   HUMAN CONFIRMATION - a member of staff says "yes, this unit leader / this
//   preceptor has been notified about this placement." It is the only thing the
//   board's status claims, and it is the only thing staff can be accountable for.
//
// A send is not a confirmation. Staff edit drafts, close windows, send to the
// wrong person, and send things that bounce. So delivery history never decides
// the board's state - it stays available as history, and the state comes from an
// explicit human act. This module reads ONLY confirmation and correction events.
//
// ── WHY notification_log, AND WHY NO MIGRATION ──────────────────────────────
//
// The confirmation ledger has to be append-only: a correction must preserve the
// record it corrects, together with who made it and why. notification_log
// already satisfies that in practice - it is written by service-role endpoints,
// and the ONLY writer that ever UPDATEs a row is api/webhooks/resend.js, which
// finds rows by resend_email_id. A confirmation row has no resend_email_id, so
// nothing in the system can rewrite one. A correction is therefore a NEW row,
// and the original survives untouched.
//
// (The honest limit: that is a property of the writers, not a database
// constraint. REVOKE UPDATE on the table would enforce it and would also break
// delivery tracking, so the constraint is deliberately not added.)
//
// ── THE LEGACY BOOLEAN ──────────────────────────────────────────────────────
//
// matches.notification_sent predates this ledger and holds real production
// confirmations. It is honoured as a BASELINE: a match with no ledger event at
// all, but a true flag, reads as confirmed (legacy). The moment any event
// exists for that target, the ledger is authoritative - which is what lets a
// correction reverse a legacy confirmation without lying about it.

export const NOTIFICATION_TARGETS = Object.freeze({
  UNIT_LEADER: 'unit_leader',
  PRECEPTOR: 'preceptor',
})

/** The notification_log types this module reads. Neither is a provider send. */
export const CONFIRMED_TYPE = 'placement_notification_confirmed'
export const CORRECTED_TYPE = 'placement_notification_corrected'
export const CONFIRMED_STATUS = 'confirmed'
export const CORRECTED_STATUS = 'corrected'

// The PRECEPTOR-DRAFT-CONTINUITY-1 manual confirmation. Nothing writes this type
// any more, but real production rows exist: an Owner answered "yes, I sent it"
// about a specific placement and preceptor, and that was a human confirmation in
// exactly the sense this module means. Discarding it would quietly un-notify a
// placement somebody really did confirm, so it is read as a first-class confirm
// event on the same timeline - which also means a correction can supersede it.
export const LEGACY_MANUAL_TYPE = 'placement_manual_confirmation'
export const LEGACY_MANUAL_STATUS = 'confirmed'

/** The metadata keys both the endpoint and this reducer speak. */
export const NOTIFY_META = Object.freeze({
  target: 'notification_target',
  match: 'placement_match_id',
  student: 'placement_student_id',
  unit: 'placement_unit_id',
  preceptor: 'placement_preceptor_id',
  cohort: 'placement_cohort_id',
  actor: 'confirmed_by',
  actorName: 'confirmed_by_name',
  reason: 'correction_reason',
  corrects: 'corrects_notification_id',
})

const trim = (v) => (typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim()))

/**
 * The identity a confirmation belongs to.
 *
 * A unit-leader confirmation belongs to the MATCH - the placement itself.
 * A preceptor confirmation belongs to the match AND that preceptor, so
 * replacing the preceptor starts the new one unnotified while the previous
 * person's record survives as history.
 *
 * Match ids are never reused, so a deleted-and-recreated placement cannot
 * inherit anything, and a multi-unit student's placements are separate rows and
 * therefore separate keys.
 */
export function notificationKey({ target, matchId, preceptorId } = {}) {
  const t = trim(target)
  const m = trim(matchId)
  if (!t || !m) return ''
  if (t === NOTIFICATION_TARGETS.PRECEPTOR) {
    const p = trim(preceptorId)
    return p ? `${t}|${m}|${p}` : ''
  }
  return `${t}|${m}`
}

function keyOfRow(meta, isLegacy) {
  return notificationKey({
    // A legacy manual row predates the target field; it could only ever have
    // been about the preceptor, so it is read as one.
    target: isLegacy ? NOTIFICATION_TARGETS.PRECEPTOR : meta[NOTIFY_META.target],
    matchId: meta[NOTIFY_META.match],
    preceptorId: meta[NOTIFY_META.preceptor],
  })
}

function timeOf(row) {
  const t = trim(row?.sent_at) || trim(row?.created_at)
  const ms = t ? new Date(t).getTime() : NaN
  return Number.isNaN(ms) ? 0 : ms
}

/**
 * Reduce notification_log rows to the CURRENT confirmation state per target.
 *
 * The ledger is append-only, so the effective state is simply the most recent
 * confirmation-or-correction event for a target. A correction after a
 * confirmation returns the target to unnotified; a fresh confirmation after a
 * correction confirms it again. Ordering is by time with the row id as a stable
 * tiebreak, so two events written in the same second resolve identically for
 * every reader, forever.
 *
 * @param rows [{ id, notification_type, status, sent_at, created_at, metadata }]
 * @returns Map<key, {confirmed, at, byName, actorId, corrected, reason, count, id}>
 */
export function notificationStateIndex(rows) {
  const events = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue
    const type = trim(row.notification_type)
    const status = trim(row.status)
    const isLegacy  = type === LEGACY_MANUAL_TYPE && status === LEGACY_MANUAL_STATUS
    const isConfirm = (type === CONFIRMED_TYPE && status === CONFIRMED_STATUS) || isLegacy
    const isCorrect = type === CORRECTED_TYPE && status === CORRECTED_STATUS
    if (!isConfirm && !isCorrect) continue          // provider history is NOT this
    const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : null
    if (!meta) continue
    const key = keyOfRow(meta, isLegacy)
    if (!key) continue
    events.push({ key, isConfirm, isLegacy, at: timeOf(row), id: trim(row.id), row, meta })
  }
  events.sort((a, b) => (a.at !== b.at ? a.at - b.at : a.id.localeCompare(b.id)))

  const index = new Map()
  for (const e of events) {
    const prev = index.get(e.key)
    index.set(e.key, {
      confirmed: e.isConfirm,
      corrected: !e.isConfirm,
      legacyManual: !!e.isLegacy,
      at: trim(e.row.sent_at) || trim(e.row.created_at) || null,
      byName: trim(e.meta[NOTIFY_META.actorName]) || null,
      actorId: trim(e.meta[NOTIFY_META.actor]) || null,
      reason: e.isConfirm ? null : (trim(e.meta[NOTIFY_META.reason]) || null),
      id: e.id || null,
      // Every event for this target, so a details view can show the full audit
      // trail without the board having to carry it.
      count: (prev?.count || 0) + 1,
    })
  }
  return index
}

/**
 * The display state for one notification target.
 *
 * `legacyNotified` is matches.notification_sent - honoured ONLY when the ledger
 * has nothing to say about this target, so real production confirmations made
 * before the ledger existed keep showing as confirmed.
 *
 * @returns {{confirmed, source, at, byName, corrected, reason, hasHistory}}
 */
export function notificationStateFor(index, ref, { legacyNotified = false } = {}) {
  const key = notificationKey(ref)
  const hit = key && index instanceof Map ? index.get(key) : null
  if (hit) {
    return {
      confirmed: hit.confirmed,
      corrected: hit.corrected,
      source: 'ledger',
      at: hit.at,
      byName: hit.byName,
      reason: hit.reason,
      hasHistory: true,
      lastEventId: hit.id,
    }
  }
  if (legacyNotified) {
    return {
      confirmed: true, corrected: false, source: 'legacy',
      at: null, byName: null, reason: null, hasHistory: false, lastEventId: null,
    }
  }
  return {
    confirmed: false, corrected: false, source: 'none',
    at: null, byName: null, reason: null, hasHistory: false, lastEventId: null,
  }
}

// ── The words. One set, both targets. ───────────────────────────────────────
//
// Deliberately SHORT. The previous board carried a full sentence in a tooltip
// ("X was sent the assignment email for this placement on ... Sent 3 times.")
// which is a paragraph hanging off a 26px icon. Who confirmed it and when is
// real, useful information - it belongs in the details view, not here.

export const NOTIFY_LABELS = Object.freeze({
  [NOTIFICATION_TARGETS.UNIT_LEADER]: {
    envelope: 'Notify Unit Leader',
    check: 'Mark Unit Leader as Notified',
    confirmed: 'Unit Leader Notified',
    noun: 'unit leader',
  },
  [NOTIFICATION_TARGETS.PRECEPTOR]: {
    envelope: 'Notify Preceptor',
    check: 'Mark Preceptor as Notified',
    confirmed: 'Preceptor Notified',
    noun: 'preceptor',
  },
})

export function labelsFor(target) {
  return NOTIFY_LABELS[target] || NOTIFY_LABELS[NOTIFICATION_TARGETS.UNIT_LEADER]
}

/** The one sentence the confirmation dialog states, for either target. */
export function confirmationPrompt({ target, personName, studentName, unitName } = {}) {
  const l = labelsFor(target)
  const who = trim(personName) || `the ${l.noun}`
  const student = trim(studentName) || 'this student'
  const unit = trim(unitName) || 'this unit'
  return `Record that ${who} has been notified about ${student} on ${unit}. The placement will show as notified on the Placement Board.`
}

/** What a correction dialog states before it asks for a reason. */
export function correctionPrompt({ target, personName } = {}) {
  const l = labelsFor(target)
  const who = trim(personName) || `the ${l.noun}`
  return `This will record that ${who} was NOT notified after all. The original confirmation is kept as history, and the notify actions return.`
}
