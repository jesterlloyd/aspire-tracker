// lib/server/messages/deliveryService.js
//
// ASPIRE MESSAGES, PHASE 2 (STAGE B): durable enqueue-before-send service and
// bounded retry processing. Receives an injected service-role Supabase client
// and a Resend client (no process access here). Implements Stage B steps 3
// through 8 of the mandatory order:
//   3. create or retrieve the queued delivery row (durable, before any send)
//   4. atomically claim the row (via the Stage A SKIP LOCKED RPC, in the worker)
//   5. attempt the awaited Resend send (reusing the durable key as the provider
//      Idempotency-Key)
//   6. record the notification_log result
//   7. update queue state and resend_email_id
//   8. the webhook later updates provider_status
//
// The in-app message is authoritative: a send failure only updates this delivery
// row and its notification_log entry. No message body is ever sent, stored, or
// logged; only the explicit safe snapshot is used to rebuild the allowed email.

import { buildDeliveryIdempotencyKey } from './idempotency.js';
import { buildMessageNotificationEmail } from './emailContent.js';
import {
  nextDeliveryState, classifyResendError, sanitizeErrorText, buildSafeSnapshot,
} from './deliveryLogic.js';
import { MESSAGE_FROM, MESSAGE_REPLY_TO, MAX_ATTEMPTS } from './config.js';

const nowIso = () => new Date().toISOString();

// Step 3: create or retrieve the durable queued row for one recipient. Idempotent
// on the Stage A UNIQUE(idempotency_key); a duplicate enqueue returns the
// existing row rather than creating a second.
export async function enqueueDelivery(db, {
  conversationId, messageId = null, eventType,
  recipientKind, recipientEmail, recipientProfileId = null,
  triggeredByProfileId = null, snapshot = {},
}) {
  const idempotencyKey = buildDeliveryIdempotencyKey({
    eventType, conversationId, messageId, recipientKind, recipientProfileId, recipientEmail,
  });
  const safeSnapshot = buildSafeSnapshot(snapshot);

  const insertRow = {
    conversation_id: conversationId,
    message_id: messageId,
    triggered_by_profile_id: triggeredByProfileId,
    recipient_profile_id: recipientProfileId,
    recipient_email: recipientEmail,
    recipient_kind: recipientKind,
    event_type: eventType,
    idempotency_key: idempotencyKey,
    queue_status: 'queued',
    next_attempt_at: nowIso(),
    ...safeSnapshot,
  };

  // Insert if absent; ignore a duplicate. Then read the canonical row back.
  await db.from('message_notification_deliveries')
    .insert(insertRow, { count: 'exact' })
    .select('id')
    .then(() => {}, () => {}); // a unique-violation is expected on a duplicate enqueue

  const { data: row, error } = await db
    .from('message_notification_deliveries')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (error) throw new Error(`enqueueDelivery read failed: ${sanitizeErrorText(error.message)}`);
  return row;
}

// Record a suppressed durable row for audit when a recipient email is known but
// routing suppressed the candidate (e.g. sender_self). Terminal, not retryable.
export async function enqueueSuppressed(db, {
  conversationId, messageId = null, eventType, recipientKind,
  recipientEmail, recipientProfileId = null, triggeredByProfileId = null,
  reason = 'suppressed', snapshot = {},
}) {
  if (!recipientEmail) return null; // nothing to record (e.g. no_participant)
  const idempotencyKey = buildDeliveryIdempotencyKey({
    eventType, conversationId, messageId, recipientKind, recipientProfileId, recipientEmail,
  });
  const safeSnapshot = buildSafeSnapshot(snapshot);
  await db.from('message_notification_deliveries')
    .insert({
      conversation_id: conversationId,
      message_id: messageId,
      triggered_by_profile_id: triggeredByProfileId,
      recipient_profile_id: recipientProfileId,
      recipient_email: recipientEmail,
      recipient_kind: recipientKind,
      event_type: eventType,
      idempotency_key: idempotencyKey,
      queue_status: 'suppressed',
      next_attempt_at: null,
      error_code: reason,
      ...safeSnapshot,
    })
    .then(() => {}, () => {});
  const { data: row } = await db.from('message_notification_deliveries')
    .select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
  return row;
}

// Steps 5 through 7 for one claimed (processing) row. Returns
// { outcome, queueStatus }. Never throws for an ordinary send failure; a thrown
// transport error is caught and treated as transient.
export async function processClaimedDelivery(db, resend, row) {
  // Live active-access gating for portal recipients (revoked/expired/removed
  // access suppresses the notification; email presence alone is insufficient).
  if (row.recipient_kind === 'portal_user') {
    const { data: hasAccess, error: gateErr } = await db.rpc(
      'message_recipient_has_active_access',
      { p_conversation_id: row.conversation_id, p_profile_id: row.recipient_profile_id },
    );
    if (gateErr) {
      return finalize(db, row, { outcome: 'transient', errorCode: 'gate_error', errorDetail: gateErr.message });
    }
    if (hasAccess !== true) {
      return finalize(db, row, { outcome: 'suppressed', errorCode: 'recipient_inactive' });
    }
  }

  const email = buildMessageNotificationEmail({
    senderDisplayName: row.snapshot_sender_name || 'The ASPIRE Team',
    conversationSubject: row.snapshot_subject || '',
    category: row.snapshot_category || null,
    recipientKind: row.recipient_kind,
    ctaPath: row.cta_path || null,
  });

  let resendId = null;
  let outcome = 'sent';
  let errorCode = null;
  let errorDetail = null;

  try {
    const { data, error } = await resend.emails.send(
      {
        from: MESSAGE_FROM,
        reply_to: MESSAGE_REPLY_TO,
        to: [row.recipient_email],
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: [
          { name: 'type', value: `messages_${row.event_type}` },
          { name: 'recipient_kind', value: row.recipient_kind },
        ],
      },
      // Reuse the durable idempotency key as the Resend Idempotency-Key.
      { idempotencyKey: row.idempotency_key },
    );
    if (error) {
      outcome = classifyResendError(error.name || error.code);
      errorCode = error.name || error.code || 'send_error';
      errorDetail = error.message || null;
    } else {
      resendId = data?.id || null;
    }
  } catch (err) {
    outcome = 'transient';
    errorCode = 'send_threw';
    errorDetail = err?.message || null;
  }

  // Step 6: record the notification_log result (no body, sanitized metadata).
  let notificationLogId;
  try {
    const { data: logRow } = await db.from('notification_log').insert({
      notification_type: `messages_${row.event_type}`,
      audience: row.recipient_kind,
      recipient_email: row.recipient_email,
      subject: email.subject,
      resend_email_id: resendId,
      status: outcome === 'sent' ? 'sent' : 'failed',
      error_message: sanitizeErrorText(errorDetail),
      metadata: { context: { conversationId: row.conversation_id, deliveryId: row.id, recipientKind: row.recipient_kind } },
    }).select('id').maybeSingle();
    notificationLogId = logRow?.id || null;
  } catch {
    // Non-fatal: the delivery row remains the authoritative job record.
    notificationLogId = null;
  }

  return finalize(db, row, { outcome, resendId, errorCode, errorDetail, notificationLogId });
}

// Step 7: update queue state, attempts, timing, and correlation ids.
async function finalize(db, row, { outcome, resendId = null, errorCode = null, errorDetail = null, notificationLogId = null }) {
  const attemptsMade = (row.attempts || 0) + 1;
  const { queueStatus, delaySeconds } = nextDeliveryState({ outcome, attemptsMade, maxAttempts: MAX_ATTEMPTS });
  const nextAttemptAt = queueStatus === 'retry_wait'
    ? new Date(Date.now() + delaySeconds * 1000).toISOString()
    : null;

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
  };
  if (resendId) update.resend_email_id = resendId;
  if (notificationLogId) update.notification_log_id = notificationLogId;

  await db.from('message_notification_deliveries').update(update).eq('id', row.id);
  return { outcome, queueStatus };
}

// Phase 3 inline attempt: claim and attempt ONE already-existing delivery row by
// id, then send. The Phase 3 transactional RPC has already inserted the row in
// the same transaction as the authoritative message, so this NEVER creates a row
// and never weakens the unique idempotency guarantee.
//
// The claim is atomic and conditional: only a queued or retry_wait row can be
// taken, so if the cron worker already claimed it this returns null and does
// nothing. Any failure here leaves the durable row for the worker to retry.
export async function claimAndSendDeliveryById(db, resend, deliveryId, { worker }) {
  const { data: row, error } = await db
    .from('message_notification_deliveries')
    .update({
      queue_status: 'processing',
      locked_at: nowIso(),
      locked_by: worker,
      updated_at: nowIso(),
    })
    .eq('id', deliveryId)
    .in('queue_status', ['queued', 'retry_wait'])
    .select('*')
    .maybeSingle();

  if (error || !row) return null; // already claimed elsewhere, or not claimable
  return processClaimedDelivery(db, resend, row);
}

// The retry worker batch: claim due rows atomically (SKIP LOCKED via the Stage A
// RPC), then process each independently. Safe under overlapping invocations.
export async function runDeliveryWorker(db, resend, { worker, limit, staleSeconds }) {
  const { data: claimed, error } = await db.rpc('claim_due_message_notification_deliveries', {
    p_worker: worker, p_limit: limit, p_stale_seconds: staleSeconds,
  });
  if (error) throw new Error(`claim failed: ${sanitizeErrorText(error.message)}`);

  const rows = claimed || [];
  const counts = { claimed: rows.length, sent: 0, retried: 0, failed: 0, suppressed: 0, errored: 0 };

  for (const row of rows) {
    try {
      const { queueStatus } = await processClaimedDelivery(db, resend, row);
      if (queueStatus === 'sent') counts.sent += 1;
      else if (queueStatus === 'retry_wait') counts.retried += 1;
      else if (queueStatus === 'failed') counts.failed += 1;
      else if (queueStatus === 'suppressed') counts.suppressed += 1;
    } catch {
      // Leave the row processing/claimed; stale-claim recovery re-queues it later.
      counts.errored += 1;
    }
  }
  return counts;
}
