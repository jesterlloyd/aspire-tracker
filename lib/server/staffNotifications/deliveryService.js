// lib/server/staffNotifications/deliveryService.js
//
// PHASE 2C: the Owner/Admin notification email worker. Receives an injected service-role Supabase
// client and a Resend client (no process access here). The durable staff_notifications row is
// created transactionally by the assignment RPCs (enqueue-before-send); this worker only claims
// due rows atomically (SKIP LOCKED via claim_due_staff_notifications), sends one email per row, and
// records the queue state. A send failure never touches the authoritative assignment.
//
// Idempotency: the DB UNIQUE(correlation_id, recipient_profile_id) guarantees one row per event
// per recipient, and the Resend Idempotency-Key (correlation_id:recipient) guarantees the provider
// never sends the same event to the same recipient twice, even across retries. A row that reaches
// 'sent' is never re-claimed (only queued/retry_wait rows are due).

import { nextDeliveryState, classifyResendError, sanitizeErrorText } from '../messages/deliveryLogic.js'
import { buildStaffNotificationEmail } from './emailContent.js'
import { STAFF_NOTIFICATION_FROM, STAFF_NOTIFICATION_REPLY_TO, MAX_ATTEMPTS } from './config.js'

const nowIso = () => new Date().toISOString()

// Send one claimed (processing) row. Returns { outcome, queueStatus }. Never throws for an
// ordinary send failure; a thrown transport error is treated as transient.
export async function processClaimedStaffNotification(db, resend, row) {
  const email = buildStaffNotificationEmail(row)
  const idempotencyKey = `${row.correlation_id}:${row.recipient_profile_id}`

  let resendId = null
  let outcome = 'sent'
  let errorCode = null
  let errorDetail = null

  try {
    const { data, error } = await resend.emails.send(
      {
        from: STAFF_NOTIFICATION_FROM,
        reply_to: STAFF_NOTIFICATION_REPLY_TO,
        to: [row.recipient_email],
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: [{ name: 'type', value: `staff_${row.event_type}` }],
      },
      { idempotencyKey },
    )
    if (error) {
      outcome = classifyResendError(error.name || error.code)
      errorCode = error.name || error.code || 'send_error'
      errorDetail = error.message || null
    } else {
      resendId = data?.id || null
    }
  } catch (err) {
    outcome = 'transient'
    errorCode = 'send_threw'
    errorDetail = err?.message || null
  }

  return finalize(db, row, { outcome, resendId, errorCode, errorDetail })
}

async function finalize(db, row, { outcome, resendId = null, errorCode = null, errorDetail = null }) {
  const attemptsMade = (row.attempts || 0) + 1
  const { queueStatus, delaySeconds } = nextDeliveryState({ outcome, attemptsMade, maxAttempts: MAX_ATTEMPTS })
  const nextAttemptAt = queueStatus === 'retry_wait'
    ? new Date(Date.now() + delaySeconds * 1000).toISOString()
    : null

  const update = {
    queue_status: queueStatus,
    attempts: attemptsMade,
    last_attempt_at: nowIso(),
    next_attempt_at: nextAttemptAt,
    locked_at: null,
    locked_by: null,
    error_code: errorCode,
    error_detail: sanitizeErrorText(errorDetail),
    updated_at: nowIso(),
  }
  if (resendId) update.resend_email_id = resendId

  await db.from('staff_notifications').update(update).eq('id', row.id)
  return { outcome, queueStatus }
}

// Claim due rows atomically (SKIP LOCKED via the RPC), then send each independently. Safe under
// overlapping invocations.
export async function runStaffNotificationWorker(db, resend, { worker, limit, staleSeconds }) {
  const { data: claimed, error } = await db.rpc('claim_due_staff_notifications', {
    p_worker: worker, p_limit: limit, p_stale_seconds: staleSeconds,
  })
  if (error) throw new Error(`claim failed: ${sanitizeErrorText(error.message)}`)

  const rows = claimed || []
  const counts = { claimed: rows.length, sent: 0, retried: 0, failed: 0, suppressed: 0, errored: 0 }

  for (const row of rows) {
    try {
      const { queueStatus } = await processClaimedStaffNotification(db, resend, row)
      if (queueStatus === 'sent') counts.sent += 1
      else if (queueStatus === 'retry_wait') counts.retried += 1
      else if (queueStatus === 'failed') counts.failed += 1
      else if (queueStatus === 'suppressed') counts.suppressed += 1
    } catch {
      // Leave the row processing; stale-claim recovery re-queues it later.
      counts.errored += 1
    }
  }
  return counts
}
