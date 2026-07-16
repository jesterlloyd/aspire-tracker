// MESSAGES-PHASE3-A-FIX: static guard for the Phase 3 Stage A corrective
// migration that closes the delivery invariant gap. The applied 00002 RPCs could
// commit an authoritative message with no durable delivery row (null p_delivery,
// missing idempotency_key, silently ignored conflict, unasserted null
// delivery_id). These tests pin the corrected behavior and confirm the applied
// migrations are untouched.
//
// Run: node --test test/messagesPhase3DeliveryInvariant.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')

const fix = read('../supabase/migrations/20260716000003_messages_phase3_delivery_invariant_fix.sql')
const p1 = read('../supabase/migrations/20260716000000_messages_phase1_schema_foundation.sql')
const p2 = read('../supabase/migrations/20260716000001_messages_phase2_notification_delivery_foundation.sql')
const p3 = read('../supabase/migrations/20260716000002_messages_phase3_api_foundation.sql')
const verify = read('../db/audit/messages_phase3_delivery_invariant_verification.sql')
const baseVerify = read('../db/audit/messages_phase3_verification.sql')

const executable = fix.replace(/--[^\n]*/g, '')

// Slice one corrected function, comments stripped.
const fnBody = (name) => {
  const start = fix.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)
  assert.notEqual(start, -1, `function ${name} not found`)
  const next = fix.indexOf('CREATE OR REPLACE FUNCTION', start + 10)
  const end = next === -1 ? fix.indexOf('-- ── 4.') : next
  return fix.slice(start, end).replace(/--[^\n]*/g, '')
}

const WRITE_RPCS = ['messages_start_conversation', 'messages_post_reply']

test('Phase 3 corrective migration: applied migrations remain untouched', async (t) => {
  await t.test('Phase 1 migration unchanged', () => {
    assert.match(p1, /CREATE TABLE IF NOT EXISTS public\.conversations\b/)
    assert.match(p1, /CREATE OR REPLACE FUNCTION public\.my_message_conversation_ids\b/)
    assert.doesNotMatch(p1, /message_assert_valid_delivery/)
  })

  await t.test('Phase 2 migration unchanged', () => {
    assert.match(p2, /CREATE TABLE IF NOT EXISTS public\.message_notification_deliveries\b/)
    assert.doesNotMatch(p2, /message_assert_valid_delivery/)
  })

  await t.test('applied Phase 3 migration 00002 is unchanged and still carries the original pattern', () => {
    // 00002 is applied and locked. It must NOT be edited: the corrective work
    // lives only in 00003. Its original (defective) guard is still present here,
    // which is exactly why 00003 replaces the function bodies.
    assert.match(p3, /CREATE OR REPLACE FUNCTION public\.messages_start_conversation\b/)
    assert.match(p3, /ON CONFLICT \(idempotency_key\) DO NOTHING/)
    assert.doesNotMatch(p3, /message_assert_valid_delivery/)
  })

  await t.test('the corrective migration is a new file that replaces only the affected functions', () => {
    assert.match(fix, /^BEGIN;/m)
    assert.match(fix, /^COMMIT;/m)
    assert.doesNotMatch(executable, /CREATE TABLE/i, 'must create no table')
    assert.doesNotMatch(executable, /CREATE POLICY/i, 'must create no policy')
    assert.doesNotMatch(executable, /ALTER TABLE/i, 'must alter no table')
    // Only the two write RPCs plus the validator are replaced.
    const created = [...fix.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1])
    assert.deepEqual(created.sort(), [
      'message_assert_valid_delivery', 'messages_post_reply', 'messages_start_conversation',
    ])
  })
})

test('Phase 3 corrective migration: delivery invariant is enforced', async (t) => {
  await t.test('no ON CONFLICT DO NOTHING remains in start or reply delivery insertion', () => {
    for (const fn of WRITE_RPCS) {
      assert.doesNotMatch(fnBody(fn), /ON CONFLICT \(idempotency_key\) DO NOTHING/,
        `${fn} must not silently skip a conflicting delivery`)
    }
  })

  await t.test('the optional-delivery guard is gone', () => {
    for (const fn of WRITE_RPCS) {
      assert.doesNotMatch(fnBody(fn), /p_delivery IS NOT NULL AND p_delivery \?/,
        `${fn} must not make the delivery optional`)
    }
  })

  await t.test('both RPCs validate the delivery payload before any authoritative write', () => {
    for (const fn of WRITE_RPCS) {
      const body = fnBody(fn)
      assert.match(body, /PERFORM public\.message_assert_valid_delivery\(p_delivery, v_expected_event, p_actor_profile_id\)/,
        `${fn} must validate the delivery payload`)
      // Validation precedes the first authoritative INSERT.
      assert.ok(
        body.indexOf('message_assert_valid_delivery') < body.indexOf('INSERT INTO public.messages'),
        `${fn} must validate before writing the message`,
      )
    }
  })

  await t.test('a duplicate idempotency key aborts the transaction with MS409', () => {
    for (const fn of WRITE_RPCS) {
      const body = fnBody(fn)
      assert.match(body, /EXCEPTION WHEN unique_violation THEN/, `${fn} must handle a unique violation`)
      assert.match(body, /duplicate notification delivery for this message'\s*\n?\s*USING ERRCODE = 'MS409'/,
        `${fn} must raise MS409 on a duplicate`)
    }
  })

  await t.test('both RPCs assert a non-null delivery_id before returning', () => {
    for (const fn of WRITE_RPCS) {
      const body = fnBody(fn)
      assert.match(body, /IF v_delivery_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'delivery row was not created'/,
        `${fn} must assert the delivery row exists`)
      assert.match(body, /'delivery_id', v_delivery_id/, `${fn} must return delivery_id`)
    }
  })

  await t.test('the message and the delivery row are created in the same transaction', () => {
    for (const fn of WRITE_RPCS) {
      const body = fnBody(fn)
      assert.ok(
        body.indexOf('INSERT INTO public.messages') < body.indexOf('INSERT INTO public.message_notification_deliveries'),
        `${fn} must insert the message then the delivery in one body`,
      )
      assert.match(body, /'queued'/, `${fn} must enqueue the delivery`)
    }
  })
})

test('Phase 3 corrective migration: delivery payload validation', async (t) => {
  const helper = fnBody('message_assert_valid_delivery')

  await t.test('rejects a null or non-object delivery', () => {
    assert.match(helper, /p_delivery IS NULL OR jsonb_typeof\(p_delivery\) <> 'object'/)
    assert.match(helper, /'delivery payload is required'/)
  })

  await t.test('rejects a missing or blank idempotency_key', () => {
    assert.match(helper, /v_key\s+:= btrim\(coalesce\(p_delivery->>'idempotency_key', ''\)\)/)
    assert.match(helper, /IF v_key = '' THEN[\s\S]*?'delivery idempotency_key is required'/)
  })

  await t.test('rejects a missing or blank recipient_email', () => {
    assert.match(helper, /IF v_email = '' THEN[\s\S]*?'delivery recipient_email is required'/)
  })

  await t.test('rejects an invalid recipient_kind and event_type', () => {
    assert.match(helper, /v_kind NOT IN \('shared_inbox', 'assigned_staff', 'portal_user'\)/)
    assert.match(helper, /v_event NOT IN \('new_conversation', 'portal_reply', 'staff_reply'\)/)
  })

  await t.test('requires the event type appropriate to the operation', () => {
    assert.match(helper, /v_event <> p_expected_event/)
    assert.match(fnBody('messages_start_conversation'), /v_expected_event := 'new_conversation'/)
    assert.match(fnBody('messages_start_conversation'), /v_expected_event := 'staff_reply'/)
    assert.match(fnBody('messages_post_reply'), /v_expected_event := 'portal_reply'/)
    assert.match(fnBody('messages_post_reply'), /v_expected_event := 'staff_reply'/)
  })

  await t.test('enforces the approved Phase 2 routing shape for recipient_kind', () => {
    assert.match(helper, /v_event = 'new_conversation' AND v_kind <> 'shared_inbox'/)
    assert.match(helper, /v_event = 'portal_reply' AND v_kind NOT IN \('shared_inbox', 'assigned_staff'\)/)
    assert.match(helper, /v_event = 'staff_reply' AND v_kind <> 'portal_user'/)
    assert.match(helper, /v_kind = 'portal_user' AND v_rp IS NULL/)
  })

  await t.test('the sender is never the recipient', () => {
    assert.match(helper, /v_rp = p_actor_profile_id/)
    assert.match(helper, /'sender may not be the notification recipient'/)
  })

  await t.test('a staff reply must target the active conversation participant', () => {
    assert.match(fnBody('messages_post_reply'),
      /NULLIF\(p_delivery->>'recipient_profile_id', ''\)::uuid IS DISTINCT FROM v_participant/)
  })

  await t.test('requires the safe snapshot and CTA fields', () => {
    for (const field of ['snapshot_sender_name', 'snapshot_subject', 'cta_path']) {
      assert.ok(helper.includes(`'delivery ${field} is required'`), `missing required check for ${field}`)
    }
  })

  await t.test('rejects any body-like field entering delivery data', () => {
    assert.match(helper, /\(body\|preview\|snippet\|content\|html\|text\|quote\|quoted\)/)
    assert.match(helper, /'delivery payload may not contain message content'/)
    // The insert only ever writes the explicit safe snapshot columns.
    for (const fn of WRITE_RPCS) {
      const body = fnBody(fn)
      assert.doesNotMatch(body, /p_delivery->>'(body|preview|snippet|content|metadata)'/,
        `${fn} must not read a body-like field from the payload`)
    }
  })
})

test('Phase 3 corrective migration: preserved behavior', async (t) => {
  await t.test('preserves the 5000-character limit and subject rule', () => {
    for (const fn of WRITE_RPCS) {
      assert.match(fnBody(fn), /char_length\(p_body\) > 5000/, `${fn} lost the body limit`)
    }
    assert.match(fnBody('messages_start_conversation'), /char_length\(v_subject\) < 3 OR char_length\(v_subject\) > 120/)
  })

  await t.test('preserves every authorization check', () => {
    const start = fnBody('messages_start_conversation')
    assert.match(start, /message_profile_has_active_student_link\(p_participant_profile_id, p_student_id\)/)
    assert.match(start, /message_profile_is_active_owner_or_admin\(p_actor_profile_id\)/)
    assert.match(start, /student may only start their own conversation/)
    const reply = fnBody('messages_post_reply')
    assert.match(reply, /message_recipient_has_active_access\(p_conversation_id, p_actor_profile_id\)/)
    assert.match(reply, /message_profile_is_active_owner_or_admin\(p_actor_profile_id\)/)
    assert.match(reply, /participant portal access is not active'\s*\n?\s*USING ERRCODE = 'MS409'/)
  })

  await t.test('preserves sender-only read-pointer updates', () => {
    for (const fn of WRITE_RPCS) {
      const body = fnBody(fn)
      assert.match(body, /INSERT INTO public\.participant_conversation_reads/)
      assert.match(body, /INSERT INTO public\.staff_conversation_reads/)
      // Only the actor's own pointer is written.
      assert.match(body, /VALUES \(p_actor_profile_id, /)
    }
  })

  await t.test('preserves automatic reopening and the reopened audit event', () => {
    const reply = fnBody('messages_post_reply')
    assert.match(reply, /IF v_status = 'resolved' THEN/)
    assert.match(reply, /status = 'open', resolved_at = NULL/)
    assert.match(reply, /'reopened'/)
    assert.match(reply, /'reopened', v_reopened/)
  })

  await t.test('keeps the service-role-only grant posture and 5-character SQLSTATEs', () => {
    for (const fn of [...WRITE_RPCS, 'message_assert_valid_delivery']) {
      assert.match(fix, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`))
      assert.match(fix, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`))
    }
    const codes = [...fix.matchAll(/ERRCODE = '([^']+)'/g)].map((m) => m[1])
    for (const c of new Set(codes)) assert.equal(c.length, 5, `SQLSTATE ${c} must be 5 characters`)
    assert.doesNotMatch(executable, /is_staff/)
  })
})

test('Phase 3 corrective verification files', async (t) => {
  await t.test('the corrective verification is read-only and guards the invariant', () => {
    assert.match(verify, /READ-ONLY VERIFICATION QUERIES\.\s*\n--\s*RUN ONLY AFTER THE MIGRATION HAS BEEN APPLIED\./)
    assert.match(verify, /ON CONFLICT \\\(idempotency_key\\\) DO NOTHING/, 'must guard against the old conflict skip')
    assert.match(verify, /message_assert_valid_delivery/)
    assert.match(verify, /v_delivery_id IS NULL/)
    assert.match(verify, /unique_violation/)
  })

  await t.test('the base verification clarifies message_archive and the audit 7 expectation', () => {
    assert.match(baseVerify, /message_archive is NOT part of\n--\s*ASPIRE Messages/)
    assert.match(baseVerify, /20260625000000_message_archive\.sql/)
    assert.match(baseVerify, /INSPECTION \(not a zero-row guard\)/)
    for (const fn of ['messages_start_conversation', 'messages_set_assignment',
      'messages_staff_list_conversations', 'messages_staff_get_thread']) {
      assert.ok(baseVerify.includes(fn), `audit 7 expectation must name ${fn}`)
    }
    // The over-broad LIKE 'message%' inventory pattern is gone.
    assert.doesNotMatch(baseVerify, /relname LIKE 'message%'/)
  })
})
