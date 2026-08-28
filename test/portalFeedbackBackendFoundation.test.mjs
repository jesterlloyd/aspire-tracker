// Portal feedback backend foundation tests. No live database calls.
// Run: node --test test/portalFeedbackBackendFoundation.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  validatePortalFeedbackPayload,
  buildPortalFeedbackFingerprint,
  normalizePortalPathname,
} from '../lib/server/portalFeedback/validation.js';
import {
  PORTAL_FEEDBACK_ALLOWED_FIELDS,
  PORTAL_FEEDBACK_RATE_LIMIT,
  PORTAL_FEEDBACK_ROLES,
} from '../lib/server/portalFeedback/config.js';
import {
  classifyPortalFeedbackSendError,
  nextPortalFeedbackDeliveryState,
  sanitizePortalFeedbackError,
} from '../lib/server/portalFeedback/deliveryLogic.js';
import { buildPortalFeedbackEmail } from '../lib/server/portalFeedback/emailContent.js';
import { submitPortalFeedback } from '../lib/server/portalFeedback/submissionService.js';
import { createPortalFeedbackSubmitHandler } from '../api/portal/feedback-submit.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

const migration = read('../supabase/migrations/20260724000000_portal_feedback_backend_foundation.sql');
const endpointSrc = read('../api/portal/feedback-submit.js');
const workerSrc = read('../api/cron/portal-feedback-delivery-worker.js');
const serviceSrc = read('../lib/server/portalFeedback/submissionService.js');
const deliverySrc = read('../lib/server/portalFeedback/deliveryService.js');
const clientSrc = read('../src/lib/portalFeedbackApiClient.js');
const migrationCode = migration
  .replace(/--[^\n]*/g, '')
  .replace(/COMMENT ON [\s\S]*?;\n/g, '');

const validFeedback = {
  request_id: 'req-123456',
  type: 'feedback',
  message: 'This page is helpful.',
  pathname: '/portal/unit-preceptors',
  section: 'Preceptors',
  build_sha: 'abc123',
  environment: 'production',
};

function createRes() {
  const headers = {};
  return {
    statusCode: null,
    body: null,
    headers,
    setHeader(key, value) { headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('migration creates purpose-specific, least-privilege feedback storage', async (t) => {
  await t.test('dedicated role-neutral tables and columns exist', () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.portal_feedback_submissions/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.portal_feedback_deliveries/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.portal_feedback_rate_limits/);
    for (const token of [
      'request_id',
      'payload_fingerprint',
      'reporter_profile_id',
      'portal_role',
      'portal_type',
      'submission_type',
      'expected_behavior',
      'actual_behavior',
      'reproduction_steps',
      'viewport_width',
      'viewport_height',
      'review_status',
    ]) {
      assert.match(migration, new RegExp(`\\b${token}\\b`));
    }
    assert.deepEqual(PORTAL_FEEDBACK_ROLES, ['student', 'unit_leader', 'academic_partner', 'nursing_academic']);
  });

  await t.test('idempotency, rate limit, and delivery state are durable and scoped', () => {
    assert.match(migration, /UNIQUE \(reporter_profile_id, request_id\)/);
    assert.match(migration, /payload_fingerprint <> p_payload_fingerprint/);
    assert.match(migration, /USING ERRCODE = 'PF409'/);
    assert.match(migration, /pg_advisory_xact_lock/);
    assert.match(migration, /portal_feedback_rate_limits/);
    assert.match(migration, /count > 5/);
    assert.deepEqual(PORTAL_FEEDBACK_RATE_LIMIT, {
      action: 'portal_feedback_submission',
      maxPerWindow: 5,
      windowSeconds: 3600,
    });
    for (const status of ['pending', 'processing', 'sent', 'retryable_failure', 'permanent_failure']) {
      assert.match(migration, new RegExp(status));
    }
  });

  await t.test('worker claim uses SKIP LOCKED, stale-claim recovery, and service-role function grants', () => {
    assert.match(migration, /claim_due_portal_feedback_deliveries/);
    assert.match(migration, /FOR UPDATE SKIP LOCKED/);
    assert.match(migration, /locked_at < v_now - \(p_stale_seconds \|\| ' seconds'\)::interval/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.claim_due_portal_feedback_deliveries/);
    assert.match(migration, /TO service_role/);
  });

  await t.test('portal users do not get direct writes and Owner/Admin read is explicit', () => {
    assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
    assert.match(migration, /REVOKE ALL ON public\.portal_feedback_submissions,[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
    assert.match(migration, /GRANT SELECT ON public\.portal_feedback_submissions TO authenticated/);
    assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON public\.portal_feedback_submissions TO service_role/);
    assert.match(migration, /public\.is_active_owner_or_admin\(\)/);
    assert.doesNotMatch(migration, /GRANT INSERT ON public\.portal_feedback_submissions TO authenticated/);
    assert.doesNotMatch(migration, /GRANT UPDATE ON public\.portal_feedback_submissions TO authenticated/);
  });

  await t.test('does not reuse forbidden tables or change Academic Partner Messages', () => {
    assert.doesNotMatch(migrationCode, /message_notification_deliveries|messages_start_conversation|communications|staff_notifications|notification_log|support_needed|shift_support/i);
    assert.doesNotMatch(migrationCode, /user_school_scopes|academic_partner_message|participant_role = 'academic_partner'/i);
  });
});

test('payload validation and fingerprinting', async (t) => {
  await t.test('accepts normalized feedback and stable fingerprints', () => {
    const out = validatePortalFeedbackPayload(validFeedback);
    assert.equal(out.ok, true);
    assert.equal(out.value.section, 'Preceptors');
    assert.equal(out.payloadFingerprint, buildPortalFeedbackFingerprint(out.value));
  });

  await t.test('accepts bug-only fields for bug reports', () => {
    const out = validatePortalFeedbackPayload({
      ...validFeedback,
      type: 'bug',
      expected_behavior: 'It should save.',
      actual_behavior: 'It stays pending.',
      reproduction_steps: 'Open drawer\nClick save',
      viewport_width: 390,
      viewport_height: 844,
    });
    assert.equal(out.ok, true);
    assert.equal(out.value.viewport_width, 390);
  });

  await t.test('rejects forbidden identity and routing fields', () => {
    for (const field of ['profile_id', 'user_id', 'role', 'unit', 'school', 'student_id', 'actor_profile_id', 'email']) {
      const out = validatePortalFeedbackPayload({ ...validFeedback, [field]: 'x' });
      assert.equal(out.ok, false);
      assert.equal(out.error, 'unexpected_fields');
      assert.deepEqual(out.fields, [field]);
    }
  });

  await t.test('rejects invalid content, path, viewport, HTML, and oversized fields', () => {
    assert.equal(validatePortalFeedbackPayload({ ...validFeedback, request_id: 'short' }).error, 'invalid_request_id');
    assert.equal(validatePortalFeedbackPayload({ ...validFeedback, type: 'question' }).error, 'invalid_report_type');
    assert.equal(validatePortalFeedbackPayload({ ...validFeedback, message: '' }).error, 'message_required');
    assert.equal(validatePortalFeedbackPayload({ ...validFeedback, message: '<b>hi</b>' }).error, 'message_html_not_allowed');
    assert.equal(validatePortalFeedbackPayload({ ...validFeedback, pathname: 'https://example.com/portal' }).error, 'invalid_pathname');
    assert.equal(validatePortalFeedbackPayload({ ...validFeedback, type: 'bug', viewport_width: 0 }).error, 'invalid_viewport_dimensions');
    assert.equal(validatePortalFeedbackPayload({ ...validFeedback, message: 'x'.repeat(5001) }).error, 'message_too_long');
    assert.equal(normalizePortalPathname('/portal/messages').value, '/portal/messages');
  });

  await t.test('allowlist is exact', () => {
    assert.deepEqual(PORTAL_FEEDBACK_ALLOWED_FIELDS, [
      'request_id',
      'type',
      'message',
      'pathname',
      'section',
      'build_sha',
      'environment',
      'expected_behavior',
      'actual_behavior',
      'reproduction_steps',
      'viewport_width',
      'viewport_height',
    ]);
  });
});

test('endpoint contract', async (t) => {
  await t.test('POST only, JSON only, no-store', async () => {
    const handler = createPortalFeedbackSubmitHandler();
    const res = createRes();
    await handler({ method: 'GET', headers: {}, body: {} }, res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.Allow, 'POST');
    assert.equal(res.headers['Cache-Control'], 'no-store');
  });

  await t.test('requires active portal feedback caller', async () => {
    const handler = createPortalFeedbackSubmitHandler({
      verifyCaller: async () => ({ ok: false, status: 401, reason: 'missing_token' }),
    });
    const res = createRes();
    await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: validFeedback }, res);
    assert.equal(res.statusCode, 401);
  });

  await t.test('submits only server-derived Unit Leader reporter context', async () => {
    let received;
    const handler = createPortalFeedbackSubmitHandler({
      verifyCaller: async () => ({
        ok: true,
        db: { label: 'db' },
        scopes: [{ unit_key: 'ICU' }],
        profile: { id: 'profile-1', full_name: 'Unit Leader', email: 'ul@example.edu' },
      }),
      makeResend: () => ({ label: 'resend' }),
      submit: async (deps, input) => {
        received = { deps, input };
        return {
          ok: true,
          status: 201,
          result: { submission_id: 'sub-1', created_at: '2026-07-22T00:00:00Z', replayed: false },
          send: { outcome: 'retryable_failure' },
        };
      },
    });
    const res = createRes();
    await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: validFeedback }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.notification_status, 'pending');
    assert.equal(received.input.reporterContext.profileId, 'profile-1');
    assert.equal(received.input.reporterContext.portalRole, 'unit_leader');
    assert.equal(received.input.reporterContext.portalType, 'unit_leader');
    assert.equal(received.input.payload.role, undefined);
  });

  await t.test('submits only server-derived Student reporter context', async () => {
    let received;
    const handler = createPortalFeedbackSubmitHandler({
      verifyCaller: async () => ({
        ok: true,
        actorKind: 'student',
        db: { label: 'db' },
        studentIds: ['student-1'],
        profile: { id: 'profile-s1', full_name: 'Student User', email: 'student@example.edu' },
      }),
      makeResend: () => ({ label: 'resend' }),
      submit: async (deps, input) => {
        received = { deps, input };
        return {
          ok: true,
          status: 201,
          result: { submission_id: 'sub-s1', created_at: '2026-07-22T00:00:00Z', replayed: false },
          send: { outcome: 'sent' },
        };
      },
    });
    const res = createRes();
    await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: validFeedback }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(received.input.reporterContext.profileId, 'profile-s1');
    assert.equal(received.input.reporterContext.portalRole, 'student');
    assert.equal(received.input.reporterContext.portalType, 'student');
    assert.equal(received.input.payload.student_id, undefined);
  });

  await t.test('rate limit returns Retry-After and stable code', async () => {
    const handler = createPortalFeedbackSubmitHandler({
      verifyCaller: async () => ({
        ok: true,
        db: {},
        scopes: [{ unit_key: 'ICU' }],
        profile: { id: 'profile-1' },
      }),
      makeResend: () => ({}),
      submit: async () => ({ ok: false, status: 429, error: 'rate_limited', retryAfterSeconds: 600 }),
    });
    const res = createRes();
    await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: validFeedback }, res);
    assert.equal(res.statusCode, 429);
    assert.equal(res.headers['Retry-After'], '600');
  });
});

test('submission and delivery services', async (t) => {
  await t.test('submission calls the atomic RPC and maps idempotency conflict', async () => {
    const calls = [];
    const db = {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { error: { code: 'PF409', message: 'raw details' } };
      },
    };
    const out = await submitPortalFeedback({ db }, {
      reporterContext: { profileId: 'p1', portalRole: 'unit_leader', portalType: 'unit_leader' },
      payload: validFeedback,
      payloadFingerprint: 'f'.repeat(64),
    });
    assert.equal(calls[0].name, 'submit_portal_feedback_report');
    assert.equal(calls[0].args.p_reporter_context.reporter_profile_id, 'p1');
    assert.equal(out.status, 409);
    assert.equal(out.error, 'request_id_payload_conflict');
  });

  await t.test('delivery email uses approved recipient identity and escapes user text', () => {
    const email = buildPortalFeedbackEmail({
      id: 'sub-1',
      submission_type: 'bug',
      reporter_display_name: 'Nurse <Lead>',
      reporter_email: 'lead@example.edu',
      portal_role: 'unit_leader',
      portal_type: 'unit_leader',
      pathname: '/portal/unit-preceptors',
      section: 'Roster',
      build_sha: 'abc',
      environment: 'prod',
      created_at: '2026-07-22T00:00:00Z',
      message: '<script>alert(1)</script>',
      expected_behavior: 'Save',
      actual_behavior: 'Fail',
      reproduction_steps: 'Click',
    });
    assert.match(email.subject, /ASPIRE Portal Bug report/);
    assert.match(email.html, /Nurse &lt;Lead&gt;/);
    assert.doesNotMatch(email.html, /<script>alert/);
    assert.match(email.text, /Message:/);
  });

  await t.test('retry logic is bounded and errors are sanitized', () => {
    assert.deepEqual(nextPortalFeedbackDeliveryState({ outcome: 'sent', attemptsMade: 1 }), { deliveryStatus: 'sent', delaySeconds: 0 });
    assert.equal(nextPortalFeedbackDeliveryState({ outcome: 'transient', attemptsMade: 1 }).deliveryStatus, 'retryable_failure');
    assert.equal(nextPortalFeedbackDeliveryState({ outcome: 'transient', attemptsMade: 5 }).deliveryStatus, 'permanent_failure');
    assert.equal(classifyPortalFeedbackSendError('validation_error'), 'permanent');
    assert.equal(classifyPortalFeedbackSendError('rate_limit_exceeded'), 'transient');
    const safe = sanitizePortalFeedbackError('failed https://x.test/t Bearer abc');
    assert.doesNotMatch(safe, /https?:\/\//);
    assert.doesNotMatch(safe, /Bearer abc/);
  });
});

test('static wiring and dormant frontend boundary', async (t) => {
  await t.test('endpoint uses portal feedback auth and never client-supplied identity', () => {
    assert.match(endpointSrc, /verifyPortalUnitLeaderCaller/);
    assert.match(endpointSrc, /verifyPortalStudentCaller/);
    assert.match(endpointSrc, /portalRole: 'unit_leader'/);
    assert.match(endpointSrc, /portalRole: 'student'/);
    assert.match(endpointSrc, /portalType: 'unit_leader'/);
    assert.match(endpointSrc, /portalType: 'student'/);
    assert.doesNotMatch(endpointSrc, /profile_id|student_id|school|user_school_scopes/);
  });

  await t.test('worker is protected and sends through purpose-specific service', () => {
    // S-12: replaced by the shared fail-closed helper; same property.
    assert.match(workerSrc, /isAuthorizedCronRequest\(req\)/);
    assert.match(workerSrc, /runPortalFeedbackDeliveryWorker/);
    assert.doesNotMatch(workerSrc, /message_notification_deliveries|conversations|messages/);
  });

  await t.test('delivery service uses approved message constants and provider idempotency', () => {
    assert.match(deliverySrc, /MESSAGE_FROM/);
    assert.match(deliverySrc, /MESSAGE_REPLY_TO/);
    assert.match(deliverySrc, /SHARED_INBOX_EMAIL/);
    assert.match(deliverySrc, /idempotencyKey: row\.idempotency_key/);
    assert.doesNotMatch(deliverySrc, /console\.(log|error).*message/);
  });

  await t.test('frontend helper omits server-derived identity and does not write feedback tables directly', () => {
    assert.match(clientSrc, /api\/portal\/feedback-submit/);
    assert.doesNotMatch(clientSrc, /profile_id|user_id|role|unit|school|student_id|actor_profile_id|email/);
    assert.doesNotMatch(clientSrc, /\.from\('portal_feedback_|portal_feedback_submissions|portal_feedback_deliveries/);
  });

  await t.test('service returns success without claiming email success', () => {
    assert.match(serviceSrc, /claimAndSendPortalFeedbackDeliveryById/);
    assert.doesNotMatch(serviceSrc, /email_delivery_complete|notification_status: 'sent'/);
  });
});
