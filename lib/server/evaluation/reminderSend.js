/* global process */
// lib/server/evaluation/reminderSend.js
//
// EVALUATION-REMINDERS-1: the reminder send core.
//
// THE PROBLEM THIS SOLVES. A provider idempotency key only protects you if the
// request under it is IDENTICAL. An earlier draft of this file re-minted a fresh
// random token on every attempt while reusing one key, which is the one
// combination guaranteed to fail: Resend answers a reused key carrying a changed
// payload with 409 invalid_idempotent_request. The retry it was meant to make
// safe was the exact case it broke.
//
// So the token is DERIVED, not minted:
//
//     raw = base64url(HMAC-SHA256(pepper, "evalrem:v1:<assignment>:<n>:<epoch>"))
//
// It is 256 bits of HMAC output under the same pepper that already protects
// every token hash in this system, it matches the existing 43-character token
// shape exactly, and it is still never stored - only recomputed. Because it is
// stable for a given epoch, a retry reproduces a byte-identical request.
//
// delivery_epoch advances ONLY on a KNOWN provider failure, never on a crash:
//
//   • Crash after the provider accepted -> epoch unchanged -> the retry sends
//     the same bytes under the same key -> Resend returns the ORIGINAL result
//     instead of sending again. One email, and we recover the message id.
//   • Known failure -> epoch advances -> a genuinely new token and key, the
//     undelivered token is revoked, and the previously delivered link is
//     untouched.
//
// A RETRY IS ONLY IDENTICAL IF WE CHECK. Recipients move between attempts - a
// student is hired, changes address, or leaves Active Rotation - so the request
// is rebuilt and fingerprinted (payloadFingerprint) before every send. If the
// fingerprint differs from the attempt already made under this key, nothing is
// sent: reusing the key would be refused and minting a new one could duplicate.
//
// PROVIDER ANSWERS ARE CLASSIFIED BY WHAT THEY PROVE (classifyProviderError):
//   • definitive rejection (structured 4xx) -> nothing was sent; revoke this
//     attempt's token and advance the epoch.
//   • ambiguous (timeout, reset, 5xx, unknown) -> proves NOTHING; the token, the
//     epoch and the fingerprint all stand and the row stays recoverable.
//   • concurrent_idempotent_requests -> the same request is already in flight.
//     Not delivery, not failure - retry later with the same key.
//   • invalid_idempotent_request -> the key carried a DIFFERENT body. Something
//     was sent, but not this; unresolved, and a person decides.
//   • invalid_idempotency_key -> the key was rejected outright; nothing was sent.
//
// THE PROVIDER FORGETS A KEY AFTER 24 HOURS AND THIS CRON IS WEEKLY, so provider
// de-duplication is never leaned on across that gap. An hourly recovery sweep
// reconciles in-flight attempts within the window, and anything still unresolved
// when the window closes becomes needs_reconciliation for a human rather than
// being retried on a key the provider no longer remembers.
//
// TOKEN RETIREMENT IS RECOVERABLE. Retiring superseded tokens can fail; when it
// does, the ledger says 'cleanup_pending' rather than claiming a clean 'sent'.
// The row stays claimable, and because the surviving token is derivable, cleanup
// recomputes "the one link that must live" and revokes everything else - so it
// is safe to run again as many times as needed.
//
// Revocation is always BY TOKEN ID. The existing evaluation endpoints revoke
// with `.eq('assignment_id', ...)`, which kills every token for the assignment;
// that would destroy the link we just delivered.
//
// NOTHING PERSISTED HERE CARRIES A SECRET. The raw token exists only as a local
// const and inside the outbound HTML. It is not written to the ledger, to
// notification_log, to the archive (the fail-closed secure snapshot redacts it),
// or to any log line.

import crypto from 'node:crypto';
import { hashToken, hashPrefixOf } from './tokens.js';
import { archiveSentMessage } from '../../../api/lib/messageArchive.js';
import { buildEvaluationReminderEmail, formatExpiresAt } from './reminderEmailTemplates.js';
import { resolveReminderRecipient } from './reminderRecipient.js';
import {
  classifyAssignment, certificateKindFor, workflowForSlug,
} from '../../../src/lib/evaluation/reminderSchedule.js';

const FROM = 'ASPIRE at Cedars-Sinai <noreply@aspire-program.com>';
const REPLY_TO = 'JesterLloyd.Bautista@cshs.org';

/** notification_log type for every reminder, regardless of workflow. */
export const REMINDER_NOTIFICATION_TYPE = 'evaluation_reminder_sent';

/** Token expiry grace beyond the assignment window, matching every send endpoint. */
export const TOKEN_GRACE_DAYS = 2;

/** Gentle pacing between provider calls. */
export const SEND_DELAY_MS = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Control-flow marker: this delivery already has an audit row. Not an error. */
class AuditRowExists extends Error {}

/** Outcome tokens written to the ledger. Kept snake_case for chk_erd_reason_shape. */
export const SEND_REASONS = Object.freeze({
  PROVIDER_ERROR: 'provider_error',
  TOKEN_WRITE_FAILED: 'token_write_failed',
  TOKEN_CLEANUP_FAILED: 'token_cleanup_failed',
  NO_LONGER_DUE: 'no_longer_due',
  ASSIGNMENT_MISSING: 'assignment_missing',
  SENDING_NOT_RECORDED: 'sending_not_recorded',
  PAYLOAD_DRIFT: 'payload_drift',
  IDEMPOTENCY_PAYLOAD_MISMATCH: 'idempotency_payload_mismatch',
  DELIVERY_UNCONFIRMED: 'delivery_unconfirmed',
});

/**
 * The reminder's token, derived rather than minted.
 *
 * Stable for a given (assignment, reminder, epoch), so a retry reproduces the
 * same URL and therefore the same request body. 32 bytes of HMAC-SHA256 encode
 * to exactly the 43 base64url characters isWellFormedRawToken() expects, so this
 * is indistinguishable from a randomly minted token everywhere downstream.
 *
 * TRADEOFF, STATED PLAINLY: unlike crypto.randomBytes, this value is
 * reproducible by anyone holding EVALUATION_TOKEN_PEPPER together with the
 * assignment id. The pepper is already the root secret protecting every token
 * hash, and assignment ids are internal, so this does not widen who can forge a
 * link - but it does mean a pepper compromise is more useful to an attacker than
 * it would be against random tokens. It is the price of crash-safe delivery, and
 * the alternative (storing the raw token so it can be replayed) is strictly worse.
 */
export function deriveReminderToken(assignmentId, reminderNumber, epoch = 0) {
  const pepper = process.env.EVALUATION_TOKEN_PEPPER;
  if (!pepper) throw new Error('EVALUATION_TOKEN_PEPPER is not configured');
  return crypto
    .createHmac('sha256', pepper)
    .update(`evalrem:v1:${assignmentId}:${reminderNumber}:${epoch}`)
    .digest('base64url');
}

/**
 * Force any reason into the ledger's snake_case shape. A rejected ledger update
 * would leave a row claimed and looking stuck, so this can never be allowed to
 * fail the CHECK - even for an unexpected input.
 */
export function sanitizeReason(value) {
  const s = String(value || 'unknown').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return (s || 'unknown').slice(0, 64);
}

/**
 * The provider idempotency key. Derived from no secret, and - critically - it
 * changes exactly when the payload changes, because both are seeded by epoch.
 */
export function reminderIdempotencyKey(assignmentId, reminderNumber, epoch = 0) {
  return `evalrem:${assignmentId}:${reminderNumber}:${epoch}`;
}

/**
 * The fingerprint of an exact provider request. Comparing this across attempts
 * is what proves a retry really is byte-identical, rather than assuming it.
 * A digest, so it carries no address, no name and no token.
 */
export function payloadFingerprint(params) {
  return crypto.createHash('sha256').update(JSON.stringify([
    params.from, params.to, params.reply_to, params.subject, params.html, params.tags,
  ])).digest('hex');
}

/**
 * What a provider outcome actually tells us. The distinction that matters is
 * EVIDENCE: only a structured refusal proves nothing was sent. Everything else -
 * a timeout, a reset connection, a 5xx, an unrecognised exception - is ambiguous,
 * and ambiguity must never be written down as failure.
 */
export const PROVIDER_OUTCOME = Object.freeze({
  ACCEPTED: 'accepted',
  DEFINITIVE_REJECTION: 'definitive_rejection',
  AMBIGUOUS: 'ambiguous',
  IDEMPOTENCY_CONCURRENT: 'idempotency_concurrent',
  IDEMPOTENCY_PAYLOAD_MISMATCH: 'idempotency_payload_mismatch',
  IDEMPOTENCY_KEY_INVALID: 'idempotency_key_invalid',
});

/**
 * Errors that prove the request was refused before any mail was created. The
 * list is an ALLOWLIST on purpose: anything unrecognised falls through to
 * AMBIGUOUS, so a new or unexpected provider error can never be mistaken for
 * proof that nothing was sent.
 */
const DEFINITIVE_ERROR_NAMES = new Set([
  'validation_error', 'invalid_parameter', 'missing_required_field',
  'invalid_from_address', 'invalid_to_address', 'invalid_attachment',
  'restricted_api_key', 'invalid_api_key', 'invalid_access',
  'not_found', 'method_not_allowed',
]);

/**
 * Classify a provider error.
 *
 * The three idempotency responses are genuinely different things and are kept
 * apart:
 *   • concurrent_idempotent_requests - the SAME request is already in flight.
 *     That is not delivery and not failure; the same key stays valid, so the
 *     right move is simply to try again later.
 *   • invalid_idempotent_request - the key was reused with a DIFFERENT payload.
 *     Something was sent under this key, but not what we just built, so we
 *     cannot claim delivery of this message. A person has to look.
 *   • invalid_idempotency_key - the key itself was rejected. Nothing was sent.
 */
export function classifyProviderError(err) {
  if (!err) return PROVIDER_OUTCOME.ACCEPTED;
  const name = String(err.name || err.code || '').toLowerCase();
  const message = String(err.message || '').toLowerCase();
  const status = Number(err.statusCode ?? err.status ?? 0);
  const text = `${name} ${message}`;

  if (text.includes('concurrent_idempotent_requests')) return PROVIDER_OUTCOME.IDEMPOTENCY_CONCURRENT;
  if (text.includes('invalid_idempotency_key')) return PROVIDER_OUTCOME.IDEMPOTENCY_KEY_INVALID;
  if (text.includes('invalid_idempotent_request')) return PROVIDER_OUTCOME.IDEMPOTENCY_PAYLOAD_MISMATCH;

  // A bare 409 with no recognisable body could be either idempotency case, and
  // guessing "delivered" would be the dangerous guess. Treat it as unresolved.
  if (status === 409) return PROVIDER_OUTCOME.AMBIGUOUS;

  // Server-side and transport problems say nothing about whether mail was sent.
  if (status >= 500) return PROVIDER_OUTCOME.AMBIGUOUS;
  if (/timeout|timed out|etimedout|econnreset|econnrefused|epipe|socket hang up|network|fetch failed|aborted/.test(text)) {
    return PROVIDER_OUTCOME.AMBIGUOUS;
  }

  if (DEFINITIVE_ERROR_NAMES.has(name)) return PROVIDER_OUTCOME.DEFINITIVE_REJECTION;
  // Rate limiting refused the request, but retrying the same key is always safe,
  // so it is handled as unresolved rather than burning an epoch.
  if (status === 429) return PROVIDER_OUTCOME.AMBIGUOUS;

  return PROVIDER_OUTCOME.AMBIGUOUS;
}

// ── Ledger writes ───────────────────────────────────────────────────────────

/** Returns true when the ledger write actually landed. Callers act on that. */
async function markLedger(db, id, patch) {
  try {
    const { error } = await db
      .from('evaluation_reminder_deliveries')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('[evaluation-reminders] ledger update failed:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[evaluation-reminders] ledger update threw:', e?.message);
    return false;
  }
}

/**
 * Durable "a provider call is about to happen", written BEFORE the send, along
 * with the fingerprint of exactly what is about to be sent and (once only) the
 * moment the provider was first contacted.
 */
const markSending = (db, id, fingerprint, firstAttemptedAt) => markLedger(db, id, {
  status: 'sending',
  payload_fingerprint: fingerprint,
  ...(firstAttemptedAt ? { first_attempted_at: firstAttemptedAt } : {}),
});

/** Unresolved: not delivered, not failed. A person decides. */
const markNeedsReconciliation = (db, id, reason) => markLedger(db, id, {
  status: 'needs_reconciliation', reason: sanitizeReason(reason),
});

const markSent = (db, id, sentAt, notificationLogId, resendEmailId) => markLedger(db, id, {
  status: 'sent', sent_at: sentAt,
  notification_log_id: notificationLogId || null, resend_email_id: resendEmailId || null, reason: null,
});

/** Delivered, but superseded tokens are still live. Claimable, so cleanup retries. */
const markCleanupPending = (db, id, sentAt, notificationLogId, resendEmailId) => markLedger(db, id, {
  status: 'cleanup_pending', sent_at: sentAt,
  notification_log_id: notificationLogId || null, resend_email_id: resendEmailId || null,
  reason: SEND_REASONS.TOKEN_CLEANUP_FAILED,
});

/** A KNOWN failure: the epoch advances so the next attempt is genuinely fresh. */
const markFailed = (db, id, reason, nextEpoch) => markLedger(db, id, {
  status: 'failed', reason: sanitizeReason(reason),
  ...(Number.isInteger(nextEpoch) ? { delivery_epoch: nextEpoch } : {}),
});
const markSuppressed = (db, id, reason) => markLedger(db, id, { status: 'suppressed', reason: sanitizeReason(reason) });

// ── Token helpers ───────────────────────────────────────────────────────────

/** Rows of the tokens that are valid for this assignment right now. */
async function activeTokens(db, assignmentId) {
  const { data, error } = await db
    .from('evaluation_assignment_tokens')
    .select('id, token_hash')
    .eq('assignment_id', assignmentId)
    .is('revoked_at', null)
    .is('used_at', null);
  if (error) return { ok: false, rows: [] };
  return { ok: true, rows: data || [] };
}

/**
 * Ensure the derived token exists as a row. Idempotent: on a retry the hash is
 * identical, so the row is already there and is reused rather than duplicated
 * (token_hash is UNIQUE, so inserting again would fail anyway).
 */
async function ensureTokenRow(db, { assignmentId, tokenHash, tokenExpiresAt }) {
  const existing = await db
    .from('evaluation_assignment_tokens')
    .select('id')
    .eq('token_hash', tokenHash)
    .limit(1);
  if (!existing.error && Array.isArray(existing.data) && existing.data.length > 0) {
    return { ok: true, id: existing.data[0].id, created: false };
  }
  try {
    const { data, error } = await db
      .from('evaluation_assignment_tokens')
      .insert({
        assignment_id: assignmentId,
        token_hash: tokenHash,
        token_hash_prefix: hashPrefixOf(tokenHash),
        expires_at: tokenExpiresAt,
      })
      .select('id')
      .single();
    if (error || !data?.id) return { ok: false, id: null, created: false };
    return { ok: true, id: data.id, created: true };
  } catch {
    return { ok: false, id: null, created: false };
  }
}

/**
 * Revoke exactly the listed token ids. Never a whole-assignment sweep.
 * Returns false when the database refused, so the caller can record that
 * retirement is still owed instead of claiming it happened.
 */
async function revokeTokenIds(db, ids) {
  if (!ids || ids.length === 0) return true;
  try {
    const { error } = await db
      .from('evaluation_assignment_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .in('id', ids);
    if (error) {
      console.error('[evaluation-reminders] token revoke failed:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[evaluation-reminders] token revoke threw:', e?.message);
    return false;
  }
}

/**
 * Has an audit row already been written for this ledger row? A recovered
 * attempt must not add a second one, so the audit write is idempotent too.
 */
async function existingReminderLogId(db, ledgerId) {
  try {
    const { data, error } = await db
      .from('notification_log')
      .select('id')
      .eq('notification_type', REMINDER_NOTIFICATION_TYPE)
      .filter('metadata->>reminder_ledger_id', 'eq', ledgerId)
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    return data[0].id;
  } catch {
    return null;
  }
}

/**
 * Retire every active token for the assignment EXCEPT the reminder's surviving
 * one, which is identified by its recomputed hash. Safe to run repeatedly.
 */
export async function retireSupersededTokens(db, assignmentId, survivingHash) {
  const active = await activeTokens(db, assignmentId);
  if (!active.ok) return false;
  const doomed = active.rows.filter((t) => t.token_hash !== survivingHash).map((t) => t.id);
  return await revokeTokenIds(db, doomed);
}

// ── One reminder ────────────────────────────────────────────────────────────

/**
 * Send a single claimed reminder.
 *
 * @returns {Promise<{outcome:'sent'|'failed'|'suppressed', reason?:string}>}
 */
export async function sendOneReminder({
  db, resend, authAdmin, ledgerRow, assignment, instrument, student, baseUrl, now,
}) {
  const ledgerId = ledgerRow.id;
  const reminderNumber = ledgerRow.reminder_number;
  const epoch = Number(ledgerRow.delivery_epoch || 0);

  if (!assignment) {
    await markSuppressed(db, ledgerId, SEND_REASONS.ASSIGNMENT_MISSING);
    return { outcome: 'suppressed', reason: SEND_REASONS.ASSIGNMENT_MISSING };
  }

  // CLEANUP-ONLY PATH. A claimed row that already carries sent_at was delivered
  // on an earlier attempt and only owes token retirement. It must never be
  // re-sent, so this returns before any provider call.
  if (ledgerRow.sent_at) {
    const survivingHash = hashToken(deriveReminderToken(assignment.id, reminderNumber, epoch));
    const cleaned = await retireSupersededTokens(db, assignment.id, survivingHash);
    if (cleaned) {
      await markSent(db, ledgerId, ledgerRow.sent_at, ledgerRow.notification_log_id, ledgerRow.resend_email_id);
      return { outcome: 'cleanup_completed' };
    }
    await markCleanupPending(db, ledgerId, ledgerRow.sent_at, ledgerRow.notification_log_id, ledgerRow.resend_email_id);
    return { outcome: 'cleanup_pending', reason: SEND_REASONS.TOKEN_CLEANUP_FAILED };
  }

  // Re-check eligibility at SEND time, not just at selection time. A survey
  // completed in the seconds between the two must not still get a reminder -
  // this is the last and most authoritative completion check.
  const verdict = classifyAssignment({ assignment, instrument, now });
  if (!verdict.due || verdict.reminderNumber !== reminderNumber) {
    const reason = verdict.reason || SEND_REASONS.NO_LONGER_DUE;
    await markSuppressed(db, ledgerId, reason);
    return { outcome: 'suppressed', reason };
  }

  const recipient = await resolveReminderRecipient({ db, authAdmin, assignment, student });
  if (!recipient.ok) {
    await markSuppressed(db, ledgerId, recipient.reason);
    return { outcome: 'suppressed', reason: recipient.reason };
  }

  const workflow = workflowForSlug(instrument.slug);

  // 1. Derive this epoch's token and make sure its row exists. Derivation (not
  //    minting) is what lets a retry reproduce the identical request. The prior
  //    link stays live throughout - nothing is retired until delivery is real.
  const rawToken = deriveReminderToken(assignment.id, reminderNumber, epoch);
  const tokenHash = hashToken(rawToken);
  const tokenExpiresAt = new Date(assignment.expires_at);
  tokenExpiresAt.setDate(tokenExpiresAt.getDate() + TOKEN_GRACE_DAYS);

  const tokenRow = await ensureTokenRow(db, {
    assignmentId: assignment.id, tokenHash, tokenExpiresAt: tokenExpiresAt.toISOString(),
  });
  if (!tokenRow.ok) {
    console.error('[evaluation-reminders] token row unavailable:', { assignment_id: assignment.id });
    await markFailed(db, ledgerId, SEND_REASONS.TOKEN_WRITE_FAILED, epoch + 1);
    return { outcome: 'failed', reason: SEND_REASONS.TOKEN_WRITE_FAILED };
  }
  const newTokenId = tokenRow.id;

  const surveyUrl = `${baseUrl}${workflow.surveyPath}#t=${rawToken}`;
  const expiresAtHuman = formatExpiresAt(assignment.expires_at);
  const certificateKind = certificateKindFor(instrument.slug, assignment.timepoint);

  const { subject, html } = buildEvaluationReminderEmail({
    workflowKey: workflow.key,
    reminderNumber,
    recipientName: recipient.name,
    studentName: student ? [student.first_name, student.last_name].filter(Boolean).join(' ').trim() : null,
    surveyUrl,
    expiresAtHuman,
    certificateKind,
  });

  // 2. Build the EXACT request and fingerprint it. Recipient identity, name,
  //    subject, body, token and tags are all inside the digest, so "identical"
  //    is something we verify rather than assume.
  const sendParams = {
    from: FROM,
    to: [recipient.email],
    reply_to: REPLY_TO,
    subject,
    html,
    tags: [
      { name: 'type', value: REMINDER_NOTIFICATION_TYPE },
      { name: 'assignment_id', value: assignment.id },
      { name: 'reminder_number', value: String(reminderNumber) },
    ],
  };
  const fingerprint = payloadFingerprint(sendParams);

  // PAYLOAD DRIFT. A previous attempt already went to the provider under this
  // key. If what we would send now differs - the student was hired, changed
  // address, or moved off rotation - then reusing the key would be rejected and
  // issuing a new one could duplicate. Neither is acceptable, so nothing is sent
  // and a person reconciles it.
  if (ledgerRow.payload_fingerprint && ledgerRow.payload_fingerprint !== fingerprint) {
    console.error('[evaluation-reminders] payload drift; refusing to send', {
      assignment_id: assignment.id, reminder_number: reminderNumber,
    });
    await markNeedsReconciliation(db, ledgerId, SEND_REASONS.PAYLOAD_DRIFT);
    return { outcome: 'needs_reconciliation', reason: SEND_REASONS.PAYLOAD_DRIFT };
  }

  // 3. Record durably that a provider call is about to happen - and DO NOT CALL
  //    THE PROVIDER IF THAT FAILS. An email we cannot prove we attempted is the
  //    one thing recovery has no way to reason about. Leaving the row claimed
  //    keeps it recoverable; nothing is revoked and no epoch is burned.
  const sendingRecorded = await markSending(
    db, ledgerId, fingerprint, ledgerRow.first_attempted_at || new Date().toISOString(),
  );
  if (!sendingRecorded) {
    console.error('[evaluation-reminders] could not record sending; provider NOT called', {
      assignment_id: assignment.id, reminder_number: reminderNumber,
    });
    return { outcome: 'deferred', reason: SEND_REASONS.SENDING_NOT_RECORDED };
  }


  // 4. Send, then classify the answer by what it actually proves.
  let resendEmailId = null;
  let outcomeKind = PROVIDER_OUTCOME.ACCEPTED;
  try {
    const { data: emailData, error: emailErr } = await resend.emails.send(
      sendParams,
      { idempotencyKey: reminderIdempotencyKey(assignment.id, reminderNumber, epoch) },
    );
    if (emailErr) outcomeKind = classifyProviderError(emailErr);
    else resendEmailId = emailData?.id || null;
  } catch (e) {
    outcomeKind = classifyProviderError(e);
  }

  // 4a. DEFINITIVE REJECTION - the provider refused and created no mail. Only
  //     here is it honest to retire this attempt's token and advance the epoch.
  if (outcomeKind === PROVIDER_OUTCOME.DEFINITIVE_REJECTION
      || outcomeKind === PROVIDER_OUTCOME.IDEMPOTENCY_KEY_INVALID) {
    console.error('[evaluation-reminders] provider refused the request:', {
      assignment_id: assignment.id, reminder_number: reminderNumber, outcome: outcomeKind,
    });
    if (tokenRow.created) await revokeTokenIds(db, [newTokenId]);
    await markFailed(db, ledgerId, SEND_REASONS.PROVIDER_ERROR, epoch + 1);
    return { outcome: 'failed', reason: SEND_REASONS.PROVIDER_ERROR, providerOutcome: outcomeKind };
  }

  // 4b. AMBIGUOUS, or the same request already in flight. Nothing is proved
  //     either way, so nothing is changed: the token stays active, the epoch
  //     stands, the fingerprint stands, and the row stays 'sending' so the
  //     hourly sweep reclaims it and retries the identical request.
  if (outcomeKind === PROVIDER_OUTCOME.AMBIGUOUS
      || outcomeKind === PROVIDER_OUTCOME.IDEMPOTENCY_CONCURRENT) {
    console.warn('[evaluation-reminders] unresolved provider outcome; leaving recoverable', {
      assignment_id: assignment.id, reminder_number: reminderNumber, outcome: outcomeKind,
    });
    return { outcome: 'ambiguous', reason: SEND_REASONS.DELIVERY_UNCONFIRMED, providerOutcome: outcomeKind };
  }

  // 4c. The key was reused with a DIFFERENT body. Something went out under it,
  //     but not this message, so claiming delivery of this reminder would be a
  //     lie and re-sending could duplicate. Unresolved, for a person.
  if (outcomeKind === PROVIDER_OUTCOME.IDEMPOTENCY_PAYLOAD_MISMATCH) {
    console.error('[evaluation-reminders] idempotency payload mismatch at the provider', {
      assignment_id: assignment.id, reminder_number: reminderNumber,
    });
    await markNeedsReconciliation(db, ledgerId, SEND_REASONS.IDEMPOTENCY_PAYLOAD_MISMATCH);
    return {
      outcome: 'needs_reconciliation',
      reason: SEND_REASONS.IDEMPOTENCY_PAYLOAD_MISMATCH,
      providerOutcome: outcomeKind,
    };
  }

  // 4d. ACCEPTED.
  const sentAt = new Date().toISOString();
  // A recovered attempt may already have written its audit row before dying.
  let notificationLogId = await existingReminderLogId(db, ledgerId);
  try {
    if (notificationLogId) throw new AuditRowExists();
    const { data: logRow } = await db
      .from('notification_log')
      .insert({
        notification_type: REMINDER_NOTIFICATION_TYPE,
        audience: assignment.respondent_type,
        recipient_email: recipient.email,
        recipient_name: recipient.name,
        recipient_role: assignment.respondent_type === 'preceptor' ? 'Preceptor' : 'Student',
        recipient_type: assignment.respondent_type,
        subject,
        status: 'sent',
        resend_email_id: resendEmailId,
        sent_at: sentAt,
        student_id: assignment.student_id,
        cohort_id: assignment.cohort_id,
        // Counts and identifiers only. No survey link and no token: the link is
        // single-use per recipient and reconstructing it from an audit row must
        // be impossible.
        metadata: {
          assignment_id: assignment.id,
          instrument_id: assignment.instrument_id,
          instrument_slug: instrument.slug,
          timepoint: assignment.timepoint,
          reminder_number: reminderNumber,
          respondent_type: assignment.respondent_type,
          recipient_route: recipient.route,
          // Lets a recovered attempt recognize its own audit row instead of
          // writing a second one for the same delivery.
          reminder_ledger_id: ledgerId,
          source: 'evaluation_reminders_cron',
        },
      })
      .select('id')
      .single();
    notificationLogId = logRow?.id || null;
  } catch (logErr) {
    if (!(logErr instanceof AuditRowExists)) {
      console.error('[evaluation-reminders] log write failed:', { assignment_id: assignment.id, error: logErr?.message });
    }
  }

  // The archive writer is fail-closed on secure content: if it cannot prove the
  // body token-free it stores nothing. Delivery already happened and is never
  // reconsidered here.
  if (notificationLogId) {
    await archiveSentMessage({
      db,
      notificationLogId,
      contentKind: 'secure_link_email',
      html,
      bodyFormat: 'html',
      source: 'evaluation_reminders_cron',
      templateKey: REMINDER_NOTIFICATION_TYPE,
      templateVersion: 1,
    });
  }

  // 5. Only now retire the superseded links, and only by id. If the database
  //    refuses, the ledger says so rather than claiming a clean send: the row
  //    becomes cleanup_pending, stays claimable, and a later run finishes the
  //    job. Delivery is never repeated on that path.
  const cleaned = await retireSupersededTokens(db, assignment.id, tokenHash);
  if (!cleaned) {
    await markCleanupPending(db, ledgerId, sentAt, notificationLogId, resendEmailId);
    return { outcome: 'cleanup_pending', reason: SEND_REASONS.TOKEN_CLEANUP_FAILED };
  }

  const recorded = await markSent(db, ledgerId, sentAt, notificationLogId, resendEmailId);
  if (!recorded) {
    // The email is out and the tokens are tidy, but we could not say so. Leaving
    // it claimed is correct: stale recovery returns it to pending, and the retry
    // reproduces the same request under the same key, so the provider answers
    // with the original result instead of sending a second copy.
    console.error('[evaluation-reminders] delivered but ledger not updated; recovery will reconcile', {
      assignment_id: assignment.id, reminder_number: reminderNumber,
    });
  }
  return { outcome: 'sent' };
}

/**
 * Send a batch of claimed reminders, sequentially and independently. One
 * recipient's failure never aborts another's send.
 */
export async function sendClaimedReminders({
  db, resend, authAdmin, claimed, assignmentsById, instrumentsById, studentsById, baseUrl, now,
  delayMs = SEND_DELAY_MS,
}) {
  const counts = {
    sent: 0, failed: 0, suppressed: 0, cleanup_pending: 0, cleanup_completed: 0,
    ambiguous: 0, needs_reconciliation: 0, deferred: 0,
  };
  const reasons = {};
  let first = true;
  let processedCount = 0;
  const totalCount = claimed.length;

  for (const ledgerRow of claimed) {
    if (!first && delayMs > 0) await sleep(delayMs);
    first = false;

    const assignment = assignmentsById.get(ledgerRow.assignment_id) || null;
    const instrument = assignment ? (instrumentsById.get(assignment.instrument_id) || null) : null;
    const student = assignment ? (studentsById.get(assignment.student_id) || null) : null;

    let result;
    try {
      result = await sendOneReminder({
        db, resend, authAdmin, ledgerRow, assignment, instrument, student, baseUrl, now,
      });
    } catch (e) {
      console.error('[evaluation-reminders] unexpected item error:', e?.message);
      await markFailed(db, ledgerRow.id, 'unexpected_error');
      result = { outcome: 'failed', reason: 'unexpected_error' };
    }

    counts[result.outcome] = (counts[result.outcome] || 0) + 1;
    if (result.reason) reasons[result.reason] = (reasons[result.reason] || 0) + 1;

    // Counts only: enough to locate a future interruption without logging an
    // assignment id, recipient, address, token, or survey URL.
    processedCount += 1;
    if (processedCount === totalCount || processedCount % 5 === 0) {
      console.log(`[evaluation-reminders] progress processed=${processedCount} total=${totalCount}`);
    }
  }

  return { counts, reasons };
}
