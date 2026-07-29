// MESSAGES-PHASE3-B: pure, service-layer, and static tests for the Phase 3
// Stage B backend APIs. All database and Resend interaction is mocked through
// dependency injection. No real provider call is ever made.
//
// Run: node --test test/messagesPhase3StageB.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  validateSubject, validateBody, validateCategory, validateStatus,
  parseLimit, parseCursor, nextCursorFrom, isUuid, normalizeBody, MESSAGE_CATEGORIES,
} from '../lib/server/messages/validation.js';
import { buildRpcDeliveryIdempotencyKey } from '../lib/server/messages/idempotency.js';
import {
  startConversationForPortal, replyForPortal, startConversationForStaff, replyForStaff,
} from '../lib/server/messages/conversationService.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

const authSrc = read('../api/lib/messagesAuth.js');
const apiSrc = read('../api/lib/messagesApi.js');
const svcSrc = read('../lib/server/messages/conversationService.js');
const deliverySrc = read('../lib/server/messages/deliveryService.js');
const p1 = read('../supabase/migrations/20260716000000_messages_phase1_schema_foundation.sql');
const p2 = read('../supabase/migrations/20260716000001_messages_phase2_notification_delivery_foundation.sql');
const p3a = read('../supabase/migrations/20260716000002_messages_phase3_api_foundation.sql');
const p3fix = read('../supabase/migrations/20260716000003_messages_phase3_delivery_invariant_fix.sql');

const PORTAL_FILES = [
  'messages-list', 'messages-thread', 'messages-start', 'messages-reply',
  'messages-mark-read', 'messages-unread-count',
];
const STAFF_FILES = [
  'messages-staff-list', 'messages-staff-thread', 'messages-staff-start',
  'messages-staff-reply', 'messages-staff-manage', 'messages-staff-read',
];
const portalSrc = Object.fromEntries(PORTAL_FILES.map((f) => [f, read(`../api/portal/${f}.js`)]));
const staffSrc = Object.fromEntries(STAFF_FILES.map((f) => [f, read(`../api/${f}.js`)]));

// ── Mock database and Resend ────────────────────────────────────────────────
function mockDb({ rpcResult = null, rpcError = null, claimRow = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (rpcError) return { data: null, error: rpcError };
      return { data: typeof rpcResult === 'function' ? rpcResult(name, args) : rpcResult, error: null };
    },
    from: () => ({
      update: () => ({
        eq: () => ({
          in: () => ({ select: () => ({ maybeSingle: async () => ({ data: claimRow, error: null }) }) }),
        }),
      }),
      insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'log-1' }, error: null }) }) }),
    }),
  };
}
// A Resend double that records calls and NEVER contacts the provider.
function mockResend({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    emails: {
      send: async (payload, opts) => {
        sent.push({ payload, opts });
        if (fail) return { data: null, error: { name: 'rate_limit_exceeded', message: 'slow down' } };
        return { data: { id: 're_mock_1' }, error: null };
      },
    },
  };
}

const PROFILE = { id: '11111111-1111-4111-8111-111111111111', email: 'stu@school.edu', full_name: 'Sam Student' };
const STAFF = { id: '22222222-2222-4222-8222-222222222222', email: 'jester@cshs.org', full_name: 'Jester Bautista' };
const CONV_ID = '33333333-3333-4333-8333-333333333333';
const STUDENT_ID = '44444444-4444-4444-8444-444444444444';

const startOk = { conversation_id: CONV_ID, message_id: 'm1', delivery_id: 'd1', created_at: 'T', status: 'open' };
const replyOk = { message_id: 'm2', delivery_id: 'd2', created_at: 'T', reopened: false };

test('validation', async (t) => {
  await t.test('subject is required, trimmed, and 3 to 120 characters', () => {
    assert.equal(validateSubject('  Placement  ').value, 'Placement');
    assert.equal(validateSubject('ab').ok, false);
    assert.equal(validateSubject('   ').ok, false);
    assert.equal(validateSubject('x'.repeat(121)).ok, false);
    assert.equal(validateSubject(undefined).ok, false);
    assert.equal(validateSubject('x'.repeat(120)).ok, true);
  });

  await t.test('body must be non-blank and at most 5000 characters', () => {
    assert.equal(validateBody('   ').ok, false);
    assert.equal(validateBody('x'.repeat(5001)).ok, false);
    assert.equal(validateBody('x'.repeat(5000)).ok, true);
    assert.equal(validateBody('hello').value, 'hello');
  });

  await t.test('body normalizes line endings and is never treated as HTML', () => {
    assert.equal(normalizeBody('a\r\nb\rc'), 'a\nb\nc');
    // Plain text is preserved verbatim; nothing is sanitized or stripped.
    assert.equal(validateBody('<b>not html</b>').value, '<b>not html</b>');
  });

  await t.test('category is optional and allowlisted', () => {
    assert.equal(validateCategory(null).value, null);
    assert.equal(validateCategory('').value, null);
    assert.equal(validateCategory('Scheduling').value, 'Scheduling');
    assert.equal(validateCategory('Nonsense').ok, false);
    assert.equal(MESSAGE_CATEGORIES.length, 7);
  });

  await t.test('status is allowlisted', () => {
    for (const s of ['open', 'waiting', 'resolved']) assert.equal(validateStatus(s).ok, true);
    assert.equal(validateStatus('Closed').ok, false);
  });

  await t.test('limits are capped and malformed limits rejected', () => {
    assert.equal(parseLimit(undefined, { fallback: 25, max: 100 }).value, 25);
    assert.equal(parseLimit('500', { fallback: 25, max: 100 }).value, 100);
    assert.equal(parseLimit('0').ok, false);
    assert.equal(parseLimit('abc').ok, false);
    assert.equal(parseLimit('-3').ok, false);
  });

  await t.test('cursors are all-or-nothing and validated', () => {
    assert.deepEqual(parseCursor({}).value, { ts: null, id: null });
    assert.equal(parseCursor({ cursorTs: '2026-07-16T00:00:00Z' }).ok, false, 'partial cursor rejected');
    assert.equal(parseCursor({ cursorId: CONV_ID }).ok, false, 'partial cursor rejected');
    assert.equal(parseCursor({ cursorTs: 'not-a-date', cursorId: CONV_ID }).ok, false);
    assert.equal(parseCursor({ cursorTs: '2026-07-16T00:00:00Z', cursorId: 'nope' }).ok, false);
    assert.equal(parseCursor({ cursorTs: '2026-07-16T00:00:00Z', cursorId: CONV_ID }).ok, true);
  });

  await t.test('next cursor uses the last row and its id tie-breaker', () => {
    const rows = [{ id: 'a', last_message_at: 't1' }, { id: 'b', last_message_at: 't2' }];
    assert.deepEqual(nextCursorFrom(rows, 2), { cursor_ts: 't2', cursor_id: 'b' });
    assert.equal(nextCursorFrom(rows, 5), null, 'partial page has no next cursor');
    assert.equal(nextCursorFrom([], 5), null);
  });

  await t.test('uuid validation rejects enumeration probes', () => {
    assert.equal(isUuid(CONV_ID), true);
    assert.equal(isUuid('1 OR 1=1'), false);
    assert.equal(isUuid(''), false);
  });
});

test('idempotency for the transactional RPC path', async (t) => {
  const base = {
    eventType: 'staff_reply', conversationId: CONV_ID, attemptId: 'att-1',
    recipientKind: 'portal_user', recipientProfileId: PROFILE.id, recipientEmail: 'A@School.edu',
  };
  await t.test('is deterministic for the same attempt and normalizes the email', () => {
    assert.equal(buildRpcDeliveryIdempotencyKey(base),
      buildRpcDeliveryIdempotencyKey({ ...base, recipientEmail: 'a@school.edu' }));
  });
  await t.test('different recipients produce different keys', () => {
    assert.notEqual(buildRpcDeliveryIdempotencyKey(base),
      buildRpcDeliveryIdempotencyKey({ ...base, recipientProfileId: STAFF.id, recipientEmail: 'x@cshs.org' }));
  });
  await t.test('different attempts produce different keys', () => {
    assert.notEqual(buildRpcDeliveryIdempotencyKey(base), buildRpcDeliveryIdempotencyKey({ ...base, attemptId: 'att-2' }));
  });
  await t.test('a new conversation has no conversation id in the key', () => {
    assert.match(buildRpcDeliveryIdempotencyKey({ ...base, conversationId: null }), /:new:attempt:/);
  });
  await t.test('requires an attempt id', () => {
    assert.throws(() => buildRpcDeliveryIdempotencyKey({ ...base, attemptId: null }));
  });
});

test('service layer: portal start conversation', async (t) => {
  await t.test('routes to the shared inbox once and builds a safe delivery payload', async () => {
    const db = mockDb({ rpcResult: startOk, claimRow: null });
    const out = await startConversationForPortal({ db, resend: mockResend() }, {
      profile: PROFILE, studentId: STUDENT_ID, subject: 'Placement', category: 'Scheduling', body: 'hi',
    });
    assert.equal(out.ok, true);
    const call = db.calls.find((c) => c.name === 'messages_start_conversation');
    const d = call.args.p_delivery;
    assert.equal(d.recipient_kind, 'shared_inbox');
    assert.equal(d.recipient_email, 'aspire@cshs.org');
    assert.equal(d.event_type, 'new_conversation');
    assert.ok(d.idempotency_key && d.idempotency_key.length > 0);
    assert.equal(d.snapshot_subject, 'Placement');
    assert.equal(d.snapshot_category, 'Scheduling');
    assert.equal(d.cta_path, '/messages');
    assert.equal(call.args.p_actor_kind, 'student');
    assert.equal(call.args.p_actor_profile_id, PROFILE.id);
  });

  await t.test('the delivery payload contains no body-like field and no nested object', async () => {
    const db = mockDb({ rpcResult: startOk });
    await startConversationForPortal({ db, resend: mockResend() }, {
      profile: PROFILE, studentId: STUDENT_ID, subject: 'S', category: null, body: 'secret body text',
    });
    const d = db.calls[0].args.p_delivery;
    const serialized = JSON.stringify(d);
    assert.doesNotMatch(serialized, /secret body text/, 'message body must never enter the delivery payload');
    for (const k of Object.keys(d)) {
      assert.doesNotMatch(k, /(^|_)(body|preview|snippet|content|html|text|quote|quoted|metadata)(_|$)/i, `forbidden key ${k}`);
      // Scalars only (null is permitted for an absent category).
      assert.ok(d[k] === null || typeof d[k] !== 'object', `delivery field ${k} must not be a nested object`);
    }
    assert.deepEqual(Object.keys(d).sort(), [
      'cta_path', 'event_type', 'idempotency_key', 'recipient_email', 'recipient_kind',
      'recipient_profile_id', 'snapshot_category', 'snapshot_sender_name', 'snapshot_subject',
    ]);
  });

  await t.test('requires a non-null delivery_id from the RPC', async () => {
    const db = mockDb({ rpcResult: { conversation_id: CONV_ID, message_id: 'm1', delivery_id: null } });
    await assert.rejects(
      () => startConversationForPortal({ db, resend: mockResend() }, {
        profile: PROFILE, studentId: STUDENT_ID, subject: 'S', category: null, body: 'b',
      }),
      /delivery_not_created/,
    );
  });

  await t.test('surfaces an RPC error without sending', async () => {
    const resend = mockResend();
    const db = mockDb({ rpcError: { code: 'MS409', message: 'participant portal access is not active' } });
    const out = await startConversationForPortal({ db, resend }, {
      profile: PROFILE, studentId: STUDENT_ID, subject: 'S', category: null, body: 'b',
    });
    assert.equal(out.ok, false);
    assert.equal(out.rpcError.code, 'MS409');
    assert.equal(resend.sent.length, 0, 'no email may be attempted when the write fails');
  });
});

test('service layer: delivery attempt ordering and failure isolation', async (t) => {
  await t.test('email is attempted only after the RPC commits the delivery row', async () => {
    const order = [];
    const resend = {
      emails: { send: async () => { order.push('send'); return { data: { id: 're_1' }, error: null }; } },
    };
    const db = {
      calls: [],
      rpc: async (n) => { order.push(`rpc:${n}`); return { data: startOk, error: null }; },
      from: () => ({
        update: () => ({ eq: () => ({ in: () => ({ select: () => ({ maybeSingle: async () => {
          order.push('claim'); return { data: { id: 'd1', attempts: 0, max_attempts: 5, recipient_kind: 'shared_inbox', recipient_email: 'aspire@cshs.org', event_type: 'new_conversation', idempotency_key: 'k', conversation_id: CONV_ID, snapshot_subject: 'S' }, error: null };
        } }) }) }) }),
        insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'log' }, error: null }) }) }),
      }),
    };
    await startConversationForPortal({ db, resend }, {
      profile: PROFILE, studentId: STUDENT_ID, subject: 'S', category: null, body: 'b',
    });
    assert.deepEqual(order.slice(0, 3), ['rpc:messages_start_conversation', 'claim', 'send'],
      'the durable row must exist and be claimed before any send');
  });

  await t.test('an email failure still returns authoritative success', async () => {
    const db = mockDb({
      rpcResult: startOk,
      claimRow: {
        id: 'd1', attempts: 0, max_attempts: 5, recipient_kind: 'shared_inbox',
        recipient_email: 'aspire@cshs.org', event_type: 'new_conversation',
        idempotency_key: 'k', conversation_id: CONV_ID, snapshot_subject: 'S',
      },
    });
    const out = await startConversationForPortal({ db, resend: mockResend({ fail: true }) }, {
      profile: PROFILE, studentId: STUDENT_ID, subject: 'S', category: null, body: 'b',
    });
    assert.equal(out.ok, true, 'the authoritative message must succeed even when email fails');
    assert.equal(out.result.message_id, 'm1');
    assert.equal(out.send.outcome, 'retry_wait', 'the durable row stays for the Phase 2 worker');
  });

  await t.test('a row already claimed by the cron worker is not double-sent', async () => {
    const resend = mockResend();
    const db = mockDb({ rpcResult: startOk, claimRow: null });
    const out = await startConversationForPortal({ db, resend }, {
      profile: PROFILE, studentId: STUDENT_ID, subject: 'S', category: null, body: 'b',
    });
    assert.equal(out.ok, true);
    assert.equal(out.send.outcome, 'already_claimed');
    assert.equal(resend.sent.length, 0);
  });
});

test('service layer: replies and staff sends', async (t) => {
  await t.test('portal reply routes to an eligible assignee, else the shared inbox', async () => {
    const db = mockDb({ rpcResult: replyOk });
    await replyForPortal({ db, resend: mockResend() }, {
      profile: PROFILE, conversationId: CONV_ID, body: 'b',
      conversation: { subject: 'S', category: null, assignedStaff: { profileId: STAFF.id, email: STAFF.email, role: 'owner', isActive: true } },
    });
    let d = db.calls[0].args.p_delivery;
    assert.equal(d.recipient_kind, 'assigned_staff');
    assert.equal(d.event_type, 'portal_reply');

    const db2 = mockDb({ rpcResult: replyOk });
    await replyForPortal({ db: db2, resend: mockResend() }, {
      profile: PROFILE, conversationId: CONV_ID, body: 'b',
      conversation: { subject: 'S', category: null, assignedStaff: { profileId: STAFF.id, email: STAFF.email, role: 'interviewer', isActive: true } },
    });
    d = db2.calls[0].args.p_delivery;
    assert.equal(d.recipient_kind, 'shared_inbox', 'a non-admin assignee falls back to the shared inbox');
  });

  await t.test('staff reply targets the portal participant profile and email', async () => {
    const db = mockDb({ rpcResult: replyOk });
    await replyForStaff({ db, resend: mockResend() }, {
      profile: STAFF, conversationId: CONV_ID, conversation: { subject: 'S', category: null },
      participantProfileId: PROFILE.id, participantEmail: PROFILE.email, body: 'b',
    });
    const call = db.calls[0];
    assert.equal(call.args.p_actor_kind, 'staff');
    assert.equal(call.args.p_delivery.recipient_kind, 'portal_user');
    assert.equal(call.args.p_delivery.event_type, 'staff_reply');
    assert.equal(call.args.p_delivery.recipient_profile_id, PROFILE.id);
    assert.equal(call.args.p_delivery.recipient_email, PROFILE.email);
    assert.equal(call.args.p_delivery.cta_path, '/portal');
  });

  await t.test('staff start uses staff_reply routing to the participant', async () => {
    const db = mockDb({ rpcResult: startOk });
    await startConversationForStaff({ db, resend: mockResend() }, {
      profile: STAFF, participantProfileId: PROFILE.id, participantEmail: PROFILE.email,
      studentId: STUDENT_ID, subject: 'Checking in', category: null, body: 'b',
    });
    const call = db.calls[0];
    assert.equal(call.args.p_actor_kind, 'staff');
    assert.equal(call.args.p_delivery.event_type, 'staff_reply');
    assert.equal(call.args.p_delivery.recipient_kind, 'portal_user');
  });

  await t.test('the sender is never notified of their own message', async () => {
    const db = mockDb({ rpcResult: replyOk });
    const out = await replyForStaff({ db, resend: mockResend() }, {
      profile: STAFF, conversationId: CONV_ID, conversation: { subject: 'S' },
      participantProfileId: STAFF.id, participantEmail: STAFF.email, body: 'b',
    });
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'sender_self');
    assert.equal(db.calls.length, 0, 'no write when the only recipient is the sender');
  });
});

test('API handlers: security and privacy posture', async (t) => {
  await t.test('every endpoint guards methods and verifies a caller', () => {
    for (const [name, src] of Object.entries({ ...portalSrc, ...staffSrc })) {
      assert.match(src, /methodGuard\(req, res, \[/, `${name} must guard methods`);
      assert.match(src, /verify(PortalStudentCaller|PortalMessagesCaller|StaffCaller)\(req\)/, `${name} must verify the caller`);
    }
  });

  await t.test('portal endpoints require an active student caller; staff endpoints require active Owner/Admin', () => {
    for (const [name, src] of Object.entries(portalSrc)) {
      // UL-PORTAL: the read path and mark-read now admit a student OR a unit
      // leader. Both go through verifyPortalMessagesCaller, which returns the
      // student result untouched, so Student Portal behavior is unchanged. The
      // security property asserted here is that SOME active portal caller is
      // verified before any data access, which both helpers guarantee.
      assert.match(src, /verifyPortal(StudentCaller|MessagesCaller)/,
        `${name} must verify an active portal caller`);
    }
    for (const [name, src] of Object.entries(staffSrc)) {
      assert.match(src, /verifyStaffCaller/, `${name} must require active Owner/Admin`);
    }
  });

  await t.test('no endpoint or helper uses is_staff', () => {
    for (const [name, src] of Object.entries({ ...portalSrc, ...staffSrc, auth: authSrc, api: apiSrc })) {
      assert.doesNotMatch(src.replace(/\/\/[^\n]*/g, ''), /is_staff/, `${name} must not use is_staff`);
    }
  });

  await t.test('staff authorization is active owner or admin only', () => {
    assert.match(authSrc, /const STAFF_ROLES = \['owner', 'admin'\]/);
    assert.match(authSrc, /is_active === false/);
    assert.match(authSrc, /reason: 'inactive_staff'/);
  });

  await t.test('portal authorization requires an active grant and an active link', () => {
    assert.match(authSrc, /\.eq\('role', 'student'\)/);
    assert.match(authSrc, /no_active_student_grant/);
    assert.match(authSrc, /no_active_student_link/);
    assert.match(authSrc, /expires_at == null \|\| g\.expires_at > nowIso/);
    // UL-PORTAL: unit_leader is deliberately activated. AP-PORTAL: academic_partner is now admitted
    // too, via the shared verifyPortalAcademicPartnerCaller (fail-closed at the DB layer until the
    // Owner SQL gate). Preceptor REMAINS a schema reservation and must still not appear anywhere.
    assert.match(authSrc, /verifyPortalAcademicPartnerCaller/);
    assert.doesNotMatch(authSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''), /preceptor/);
  });

  await t.test('no client-supplied delivery payload is ever accepted', () => {
    for (const [name, src] of Object.entries({ ...portalSrc, ...staffSrc })) {
      const code = src.replace(/\/\/[^\n]*/g, '');
      for (const field of ['p_delivery', 'idempotency_key', 'recipient_kind', 'recipient_email', 'snapshot_sender_name', 'cta_path']) {
        assert.doesNotMatch(code, new RegExp(`parsed\\.body\\.${field}`), `${name} must not read ${field} from the client`);
      }
    }
    // Only the service layer constructs the payload.
    assert.match(svcSrc, /function buildDeliveryPayload/);
    assert.match(svcSrc, /buildRpcDeliveryIdempotencyKey/);
  });

  await t.test('handlers never log a message body and return no internal SQL', () => {
    for (const [name, src] of Object.entries({ ...portalSrc, ...staffSrc })) {
      assert.doesNotMatch(src, /console\.log\([^)]*body/i, `${name} must not log a body`);
      assert.doesNotMatch(src, /error: error\.message/, `${name} must not leak internal SQL text`);
    }
    assert.match(apiSrc, /Bearer\s*\\s\+\\S\+\/gi, 'Bearer \[redacted\]'/);
    assert.match(apiSrc, /internal_error/);
  });

  await t.test('inaccessible conversations return a non-enumerating 404', () => {
    assert.match(portalSrc['messages-thread'], /if \(!data\) return notFound\(res\)/);
    assert.match(apiSrc, /MS404: 404/);
    assert.match(apiSrc, /export function notFound/);
  });

  await t.test('rate limits are consumed with a server-verified profile id only', () => {
    assert.match(portalSrc['messages-start'], /consumeNewConversation\(db, caller\.profile\.id\)/);
    assert.match(portalSrc['messages-start'], /consumeMessage\(db, caller\.profile\.id\)/);
    assert.match(portalSrc['messages-reply'], /consumeMessage\(db, caller\.profile\.id\)/);
    // Fail closed.
    assert.match(portalSrc['messages-start'], /catch \(err\) \{[\s\S]*?rate_limit_failed[\s\S]*?429/);
    // Staff are not portal-rate-limited.
    for (const [name, src] of Object.entries(staffSrc)) {
      assert.doesNotMatch(src, /consumeNewConversation|consumeMessage\(/, `${name} must not use portal rate limits`);
    }
  });

  await t.test('reads use the caller-scoped client, writes use the service-role RPC', () => {
    assert.match(portalSrc['messages-list'], /getUserScopedDb\(req\)/);
    assert.match(portalSrc['messages-thread'], /getUserScopedDb\(req\)/);
    assert.match(portalSrc['messages-unread-count'], /getUserScopedDb\(req\)/);
    assert.match(staffSrc['messages-staff-list'], /getUserScopedDb\(req\)/);
    assert.match(staffSrc['messages-staff-thread'], /getUserScopedDb\(req\)/);
    assert.match(portalSrc['messages-mark-read'], /getServiceDb\(\)\.rpc\('messages_mark_read'/);
  });

  await t.test('mark read never accepts a client timestamp and is per-user', () => {
    assert.doesNotMatch(portalSrc['messages-mark-read'], /last_read_at:\s*parsed\.body/);
    // UL-PORTAL: the actor kind is now the VERIFIED caller's kind rather than a
    // hardcoded 'student', because a unit leader may also mark a thread read. The
    // security property is unchanged and is what this asserts: the kind comes from
    // the server-verified caller, never from the request body.
    assert.match(portalSrc['messages-mark-read'], /p_actor_kind: caller\.actorKind/);
    assert.doesNotMatch(portalSrc['messages-mark-read'], /p_actor_kind: (req|parsed|body)/);
    assert.match(staffSrc['messages-staff-read'], /p_actor_kind: 'staff'/);
  });

  await t.test('staff management actions are allowlisted and send no email', () => {
    // MESSAGES-ARCHIVE-P1: archive joined the allowlist (per-user visibility,
    // wired to messages_set_conversation_archived below); MESSAGES-LIFECYCLE-
    // PHASE3A-REACTIONS adds react alongside it. Every prior action is unchanged.
    assert.match(staffSrc['messages-staff-manage'], /const ACTIONS = \['assign', 'status', 'category', 'flag', 'archive', 'react'\]/);
    for (const rpc of [
      'messages_set_assignment', 'messages_set_status', 'messages_set_category',
      'messages_set_follow_up', 'messages_set_conversation_archived',
    ]) {
      assert.ok(staffSrc['messages-staff-manage'].includes(rpc), `manage must wire ${rpc}`);
    }
    assert.doesNotMatch(staffSrc['messages-staff-manage'], /Resend|resend/, 'management actions must never send email');
  });

  await t.test('staff reply blocks an inactive participant with a conflict', () => {
    assert.match(staffSrc['messages-staff-reply'], /no_active_participant/);
    assert.match(staffSrc['messages-staff-reply'], /409/);
    // Messages always notifies the portal account email. Guard the CODE: the
    // comments legitimately name the student columns they must never use.
    const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(stripComments(staffSrc['messages-staff-reply']), /school_email|personal_email/);
    assert.doesNotMatch(stripComments(staffSrc['messages-staff-start']), /school_email|personal_email/);
  });
});

test('regression: applied migrations and prior phases untouched', async (t) => {
  await t.test('Phase 1, Phase 2, and both Phase 3 migrations are unchanged', () => {
    assert.match(p1, /CREATE TABLE IF NOT EXISTS public\.conversations\b/);
    assert.match(p2, /CREATE TABLE IF NOT EXISTS public\.message_notification_deliveries\b/);
    assert.match(p3a, /CREATE OR REPLACE FUNCTION public\.messages_start_conversation\b/);
    assert.match(p3fix, /message_assert_valid_delivery/);
    // Stage B adds no SQL.
    assert.doesNotMatch(svcSrc, /CREATE OR REPLACE FUNCTION|ALTER TABLE/);
  });

  await t.test('the Phase 2 delivery service gained only the by-id claim helper', () => {
    assert.match(deliverySrc, /export async function claimAndSendDeliveryById/);
    assert.match(deliverySrc, /\.in\('queue_status', \['queued', 'retry_wait'\]\)/, 'claim must be conditional');
    // The worker path is unchanged.
    assert.match(deliverySrc, /export async function runDeliveryWorker/);
    assert.match(deliverySrc, /claim_due_message_notification_deliveries/);
  });

  await t.test('no UI, navigation, polling, or realtime was added', () => {
    // MESSAGES-LIFECYCLE-PHASE3A-REACTIONS legitimately names its own 'react'
    // action and 'reaction'/'reactions' terminology in messages-staff-manage.js,
    // which a bare /react/i would flag. The guard now looks for actual frontend
    // React signatures (an import from 'react' or a JSX tag) instead of the
    // bare word, so it still catches real UI code without false-positiving on
    // our own feature name.
    for (const [name, src] of Object.entries({ ...portalSrc, ...staffSrc })) {
      assert.doesNotMatch(
        src,
        /from\s+['"]react['"]|<[A-Z]\w*[\s/>]|jsx|useState|useEffect|refetchInterval|realtime/i,
        `${name} must contain no UI code`,
      );
    }
  });
});
