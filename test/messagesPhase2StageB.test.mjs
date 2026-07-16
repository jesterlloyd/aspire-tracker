// MESSAGES-PHASE2-B: static and pure-function guard for the ASPIRE Messages
// Phase 2 Stage B server delivery and rate-limit code. No live database calls.
// Exercises the pure logic (idempotency, routing, backoff, provider
// monotonicity, snapshot allowlist, email content, rate-limit config) and
// statically asserts the server service, worker, and webhook wiring.
//
// Run: node --test test/messagesPhase2StageB.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildDeliveryIdempotencyKey, normalizeEmail } from '../lib/server/messages/idempotency.js';
import { planNotificationRecipients } from '../lib/server/messages/routing.js';
import {
  nextAttemptDelaySeconds, nextDeliveryState, shouldApplyProviderStatus,
  assertNoBodyFields, buildSafeSnapshot, sanitizeErrorText, classifyResendError,
} from '../lib/server/messages/deliveryLogic.js';
import { buildMessageNotificationEmail } from '../lib/server/messages/emailContent.js';
import {
  MESSAGE_RATE_LIMITS, MESSAGE_MAX_BODY_CHARS, MAX_ATTEMPTS, BACKOFF_SECONDS,
  SHARED_INBOX_EMAIL, MESSAGE_FROM, MESSAGE_REPLY_TO,
} from '../lib/server/messages/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');
const deliveryServiceSrc = read('../lib/server/messages/deliveryService.js');
const rateLimitSrc = read('../lib/server/messages/rateLimitUtil.js');
const workerSrc = read('../api/cron/messages-delivery-worker.js');
const webhookSrc = read('../api/webhooks/resend.js');
const vercelJson = JSON.parse(read('../vercel.json'));
const phase1Sql = read('../supabase/migrations/20260716000000_messages_phase1_schema_foundation.sql');
const phase2aSql = read('../supabase/migrations/20260716000001_messages_phase2_notification_delivery_foundation.sql');

test('idempotency key', async (t) => {
  const base = {
    eventType: 'staff_reply', conversationId: 'c1', messageId: 'm1',
    recipientKind: 'portal_user', recipientProfileId: 'p1', recipientEmail: 'A@Example.com',
  };
  await t.test('is deterministic and email-normalized', () => {
    assert.equal(buildDeliveryIdempotencyKey(base), buildDeliveryIdempotencyKey({ ...base, recipientEmail: 'a@example.com' }));
    assert.equal(normalizeEmail('  A@Example.COM '), 'a@example.com');
  });
  await t.test('different recipients produce different keys', () => {
    const k1 = buildDeliveryIdempotencyKey(base);
    const k2 = buildDeliveryIdempotencyKey({ ...base, recipientProfileId: 'p2', recipientEmail: 'b@example.com' });
    assert.notEqual(k1, k2);
  });
  await t.test('shared inbox key ignores profile id but not email', () => {
    const s1 = buildDeliveryIdempotencyKey({ eventType: 'new_conversation', conversationId: 'c1', recipientKind: 'shared_inbox', recipientEmail: 'aspire@cshs.org' });
    const s2 = buildDeliveryIdempotencyKey({ eventType: 'new_conversation', conversationId: 'c1', recipientKind: 'shared_inbox', recipientProfileId: 'x', recipientEmail: 'aspire@cshs.org' });
    assert.equal(s1, s2);
  });
  await t.test('event and conversation are part of the key', () => {
    assert.notEqual(buildDeliveryIdempotencyKey(base), buildDeliveryIdempotencyKey({ ...base, conversationId: 'c2' }));
    assert.notEqual(buildDeliveryIdempotencyKey(base), buildDeliveryIdempotencyKey({ ...base, eventType: 'portal_reply' }));
  });
});

test('routing', async (t) => {
  await t.test('new_conversation notifies the shared inbox once', () => {
    const { deliveries } = planNotificationRecipients({ eventType: 'new_conversation', senderProfileId: 'student1' });
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].recipientKind, 'shared_inbox');
    assert.equal(deliveries[0].recipientEmail, SHARED_INBOX_EMAIL);
  });
  await t.test('portal_reply routes to an eligible assignee', () => {
    const { deliveries } = planNotificationRecipients({
      eventType: 'portal_reply', senderProfileId: 'student1',
      assignedStaff: { profileId: 'staff1', email: 'jester@cshs.org', role: 'owner', isActive: true },
    });
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].recipientKind, 'assigned_staff');
    assert.equal(deliveries[0].recipientEmail, 'jester@cshs.org');
  });
  await t.test('portal_reply falls back to shared inbox for an inactive or non-admin assignee', () => {
    for (const bad of [
      { profileId: 's', email: 'x@cshs.org', role: 'owner', isActive: false },
      { profileId: 's', email: 'x@cshs.org', role: 'interviewer', isActive: true },
      { profileId: 's', email: 'not-an-email', role: 'admin', isActive: true },
      null,
    ]) {
      const { deliveries } = planNotificationRecipients({ eventType: 'portal_reply', senderProfileId: 'student1', assignedStaff: bad });
      assert.equal(deliveries.length, 1);
      assert.equal(deliveries[0].recipientKind, 'shared_inbox');
    }
  });
  await t.test('assignee whose email is the shared inbox collapses to one shared_inbox delivery', () => {
    const { deliveries } = planNotificationRecipients({
      eventType: 'portal_reply', senderProfileId: 'student1',
      assignedStaff: { profileId: 'staff1', email: 'aspire@cshs.org', role: 'admin', isActive: true },
    });
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].recipientKind, 'shared_inbox');
  });
  await t.test('staff_reply routes to the portal participant and flags an active-access check', () => {
    const { deliveries } = planNotificationRecipients({
      eventType: 'staff_reply', senderProfileId: 'staff1',
      participant: { profileId: 'student1', email: 'stu@school.edu' },
    });
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].recipientKind, 'portal_user');
    assert.equal(deliveries[0].requiresActiveAccessCheck, true);
  });
  await t.test('never notifies the sender of their own message', () => {
    const { deliveries, suppressed } = planNotificationRecipients({
      eventType: 'staff_reply', senderProfileId: 'student1', senderEmail: 'stu@school.edu',
      participant: { profileId: 'student1', email: 'stu@school.edu' },
    });
    assert.equal(deliveries.length, 0);
    assert.equal(suppressed[0].reason, 'sender_self');
  });
  await t.test('rejects events that must never notify', () => {
    for (const ev of ['resolved', 'acknowledged', 'assignment_change', 'flagged', 'email_reply']) {
      assert.throws(() => planNotificationRecipients({ eventType: ev }));
    }
  });
});

test('retry and provider logic', async (t) => {
  await t.test('backoff is bounded and non-decreasing', () => {
    let prev = 0;
    for (let a = 1; a <= 8; a += 1) {
      const d = nextAttemptDelaySeconds(a);
      assert.ok(d >= prev, 'non-decreasing');
      assert.ok(d <= BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1], 'bounded');
      prev = d;
    }
  });
  await t.test('queued to processing to sent', () => {
    assert.deepEqual(nextDeliveryState({ outcome: 'sent', attemptsMade: 1 }), { queueStatus: 'sent', delaySeconds: 0 });
  });
  await t.test('transient failure below the cap goes to retry_wait with backoff', () => {
    const s = nextDeliveryState({ outcome: 'transient', attemptsMade: 1, maxAttempts: MAX_ATTEMPTS });
    assert.equal(s.queueStatus, 'retry_wait');
    assert.ok(s.delaySeconds > 0);
  });
  await t.test('transient failure at the cap goes to failed', () => {
    assert.equal(nextDeliveryState({ outcome: 'transient', attemptsMade: MAX_ATTEMPTS, maxAttempts: MAX_ATTEMPTS }).queueStatus, 'failed');
  });
  await t.test('permanent failure and suppression are terminal', () => {
    assert.equal(nextDeliveryState({ outcome: 'permanent', attemptsMade: 1 }).queueStatus, 'failed');
    assert.equal(nextDeliveryState({ outcome: 'suppressed', attemptsMade: 1 }).queueStatus, 'suppressed');
  });
  await t.test('provider status is monotonic and never a queue status', () => {
    assert.equal(shouldApplyProviderStatus(null, 'sent'), true);
    assert.equal(shouldApplyProviderStatus('delivered', 'sent'), false);
    assert.equal(shouldApplyProviderStatus('sent', 'opened'), true);
    assert.equal(shouldApplyProviderStatus('opened', 'queued'), false); // queue value is not a provider status
  });
  await t.test('resend error classification', () => {
    assert.equal(classifyResendError('validation_error'), 'permanent');
    assert.equal(classifyResendError('rate_limit_exceeded'), 'transient');
    assert.equal(classifyResendError(undefined), 'transient');
  });
});

test('no-body snapshot and email content', async (t) => {
  await t.test('allowlist rejects body-like fields', () => {
    for (const bad of ['body', 'message_body', 'preview', 'snippet', 'content', 'html', 'text', 'quoted_content']) {
      assert.throws(() => assertNoBodyFields({ [bad]: 'x' }), new RegExp('body-like'));
    }
  });
  await t.test('safe snapshot keeps only allowlisted keys', () => {
    const snap = buildSafeSnapshot({ senderName: 'Jester', subject: 'Placement', category: 'Scheduling', ctaPath: '/portal' });
    assert.deepEqual(Object.keys(snap).sort(), ['cta_path', 'snapshot_category', 'snapshot_sender_name', 'snapshot_subject']);
  });
  await t.test('email contains the allowed fields and no message body', () => {
    const email = buildMessageNotificationEmail({
      senderDisplayName: 'Jester Bautista', conversationSubject: 'Placement question',
      category: 'Placement and matching', recipientKind: 'portal_user',
    });
    assert.match(email.subject, /Placement question/);
    assert.match(email.html, /Jester Bautista/);
    assert.match(email.html, /Placement and matching/);
    assert.match(email.html, /View message in ASPIRE/);
    assert.match(email.html, /aspireintelligence\.app\/portal/);
    // No token or query context in the CTA URL.
    assert.doesNotMatch(email.html, /token=|\?next=|magic|\/portal\//);
    // The email never embeds a body/preview placeholder.
    assert.doesNotMatch(email.html.toLowerCase(), /message body|preview:|snippet/);
  });
  await t.test('error sanitizer strips urls and bearer tokens', () => {
    const s = sanitizeErrorText('failed https://x.co/secret?tok=abc Bearer zzz over and over');
    assert.doesNotMatch(s, /https?:\/\//);
    assert.doesNotMatch(s, /Bearer zzz/);
  });
});

test('rate-limit config and utility', async (t) => {
  await t.test('windows match the approved limits', () => {
    assert.deepEqual(MESSAGE_RATE_LIMITS.new_conversation, { action: 'new_conversation', maxPerWindow: 5, windowSeconds: 3600 });
    assert.deepEqual(MESSAGE_RATE_LIMITS.message, { action: 'message', maxPerWindow: 20, windowSeconds: 600 });
    assert.equal(MESSAGE_MAX_BODY_CHARS, 5000);
  });
  await t.test('utility calls the service-role RPC with a verified profile id and fails closed', () => {
    assert.match(rateLimitSrc, /consume_message_rate_limit/);
    assert.match(rateLimitSrc, /server-verified profileId is required/);
    assert.match(rateLimitSrc, /failed_closed: true/);
    assert.match(rateLimitSrc, /p_profile_id: profileId/);
  });
});

test('server service, worker, and webhook wiring', async (t) => {
  await t.test('delivery service enqueues before send and uses provider idempotency', () => {
    assert.match(deliveryServiceSrc, /buildDeliveryIdempotencyKey/);
    assert.match(deliveryServiceSrc, /idempotencyKey: row\.idempotency_key/);
    assert.match(deliveryServiceSrc, /await resend\.emails\.send/);
    // Active-recipient gating via the Stage A service-role RPC.
    assert.match(deliveryServiceSrc, /message_recipient_has_active_access/);
    assert.match(deliveryServiceSrc, /recipient_inactive/);
    // notification_log integration, no body.
    assert.match(deliveryServiceSrc, /notification_log/);
    assert.doesNotMatch(deliveryServiceSrc, /\bbody:\s*row\.|message_body|snapshot_body/);
    // Claims via the Stage A SKIP LOCKED RPC.
    assert.match(deliveryServiceSrc, /claim_due_message_notification_deliveries/);
  });
  await t.test('worker authenticates the cron and records cron_runs', () => {
    assert.match(workerSrc, /Bearer \$\{process\.env\.CRON_SECRET\}/);
    assert.match(workerSrc, /startCronRun/);
    assert.match(workerSrc, /finishCronRunSuccess/);
    assert.match(workerSrc, /finishCronRunError/);
    assert.match(workerSrc, /runDeliveryWorker/);
    // The worker never mutates conversations/messages/participants/reads/events.
    assert.doesNotMatch(workerSrc, /\.from\('(conversations|messages|conversation_participants|conversation_events|staff_conversation_reads|participant_conversation_reads)'\)/);
  });
  await t.test('webhook advances provider_status only, never queue_status, never body', () => {
    assert.match(webhookSrc, /reconcileMessageDelivery/);
    assert.match(webhookSrc, /shouldApplyProviderStatus/);
    assert.match(webhookSrc, /provider_status:/);
    // Scope the queue_status guard to code (comments explain what is not touched).
    const webhookCode = webhookSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(webhookCode, /queue_status/, 'webhook code must never write queue_status');
    // Existing notification_log behavior retained.
    assert.match(webhookSrc, /notification_log/);
    assert.match(webhookSrc, /svix-signature/);
  });
  await t.test('vercel.json schedules the worker with a bounded duration', () => {
    const cron = vercelJson.crons.find((c) => c.path === '/api/cron/messages-delivery-worker');
    assert.ok(cron, 'worker cron registered');
    assert.match(cron.schedule, /^\S+ \S+ \S+ \S+ \S+$/);
    assert.ok(vercelJson.functions['api/cron/messages-delivery-worker.js']?.maxDuration >= 30);
  });
});

test('Stage B does not alter migrations or build a conversation surface', async (t) => {
  await t.test('Phase 1 and Stage A migrations are unchanged in shape', () => {
    assert.match(phase1Sql, /CREATE TABLE IF NOT EXISTS public\.conversations\b/);
    assert.match(phase2aSql, /CREATE TABLE IF NOT EXISTS public\.message_notification_deliveries\b/);
  });
  await t.test('no conversation API endpoint or portal UI was added by Stage B code', () => {
    // The worker is the only new API file; it is a cron worker, not a conversation API.
    assert.doesNotMatch(deliveryServiceSrc, /export default async function handler/);
    assert.doesNotMatch(rateLimitSrc, /export default async function handler/);
  });
});
