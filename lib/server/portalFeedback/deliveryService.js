import { randomUUID } from 'node:crypto';
import { buildPortalFeedbackEmail } from './emailContent.js';
import {
  classifyPortalFeedbackSendError,
  nextPortalFeedbackDeliveryState,
  sanitizePortalFeedbackError,
} from './deliveryLogic.js';
import {
  PORTAL_FEEDBACK_CLAIM_BATCH_LIMIT,
  PORTAL_FEEDBACK_CLAIM_STALE_SECONDS,
  PORTAL_FEEDBACK_MAX_ATTEMPTS,
} from './config.js';
import { MESSAGE_FROM, MESSAGE_REPLY_TO, SHARED_INBOX_EMAIL } from '../messages/config.js';

const nowIso = () => new Date().toISOString();

export async function claimAndSendPortalFeedbackDeliveryById(db, resend, deliveryId, { worker } = {}) {
  const { data: row, error } = await db
    .from('portal_feedback_deliveries')
    .update({
      delivery_status: 'processing',
      locked_at: nowIso(),
      locked_by: worker || `portal-feedback-api:${randomUUID()}`,
      updated_at: nowIso(),
    })
    .eq('id', deliveryId)
    .in('delivery_status', ['pending', 'retryable_failure'])
    .select('*')
    .maybeSingle();

  if (error || !row) return null;
  return processClaimedPortalFeedbackDelivery(db, resend, row);
}

export async function processClaimedPortalFeedbackDelivery(db, resend, row) {
  const { data: submission, error: subErr } = await db
    .from('portal_feedback_submissions')
    .select('*')
    .eq('id', row.submission_id)
    .maybeSingle();

  if (subErr || !submission) {
    return finalize(db, row, { outcome: 'transient', errorCode: 'submission_lookup_failed', errorDetail: subErr?.message });
  }

  const email = buildPortalFeedbackEmail(submission);
  let resendId = null;
  let outcome = 'sent';
  let errorCode = null;
  let errorDetail = null;

  try {
    const { data, error } = await resend.emails.send(
      {
        from: MESSAGE_FROM,
        reply_to: MESSAGE_REPLY_TO,
        to: [SHARED_INBOX_EMAIL],
        subject: email.subject,
        html: email.html,
        text: email.text,
        tags: [
          { name: 'type', value: 'portal_feedback' },
          { name: 'submission_type', value: submission.submission_type },
        ],
      },
      { idempotencyKey: row.idempotency_key },
    );
    if (error) {
      outcome = classifyPortalFeedbackSendError(error.name || error.code);
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

  return finalize(db, row, { outcome, resendId, errorCode, errorDetail });
}

async function finalize(db, row, { outcome, resendId = null, errorCode = null }) {
  const attemptsMade = (row.attempt_count || 0) + 1;
  const { deliveryStatus, delaySeconds } = nextPortalFeedbackDeliveryState({
    outcome,
    attemptsMade,
    maxAttempts: row.max_attempts || PORTAL_FEEDBACK_MAX_ATTEMPTS,
  });
  const nextRetryAt = deliveryStatus === 'retryable_failure'
    ? new Date(Date.now() + delaySeconds * 1000).toISOString()
    : null;

  const update = {
    delivery_status: deliveryStatus,
    attempt_count: attemptsMade,
    last_attempt_at: nowIso(),
    next_retry_at: nextRetryAt,
    locked_at: null,
    locked_by: null,
    last_error_code: sanitizePortalFeedbackError(errorCode),
    updated_at: nowIso(),
  };
  if (resendId) {
    update.resend_email_id = resendId;
    update.sent_at = nowIso();
  }

  await db.from('portal_feedback_deliveries').update(update).eq('id', row.id);
  return { outcome, deliveryStatus };
}

export async function runPortalFeedbackDeliveryWorker(db, resend, {
  worker,
  limit = PORTAL_FEEDBACK_CLAIM_BATCH_LIMIT,
  staleSeconds = PORTAL_FEEDBACK_CLAIM_STALE_SECONDS,
} = {}) {
  const { data: claimed, error } = await db.rpc('claim_due_portal_feedback_deliveries', {
    p_worker: worker,
    p_limit: limit,
    p_stale_seconds: staleSeconds,
  });
  if (error) throw new Error(`claim failed: ${sanitizePortalFeedbackError(error.message)}`);

  const rows = claimed || [];
  const counts = { claimed: rows.length, sent: 0, retried: 0, failed: 0, errored: 0 };
  for (const row of rows) {
    try {
      const { deliveryStatus } = await processClaimedPortalFeedbackDelivery(db, resend, row);
      if (deliveryStatus === 'sent') counts.sent += 1;
      else if (deliveryStatus === 'retryable_failure') counts.retried += 1;
      else if (deliveryStatus === 'permanent_failure') counts.failed += 1;
    } catch {
      counts.errored += 1;
    }
  }
  return counts;
}
