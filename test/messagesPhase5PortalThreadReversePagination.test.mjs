// MESSAGES-PHASE5A: static guard for the Student Portal thread reverse-pagination
// migration. The applied messages_portal_get_thread pages FORWARD from the oldest
// message, so a student opens a long thread on the wrong end and "Load earlier
// messages" is inexpressible. This migration adds a distinctly named v2 that
// opens at the newest messages and pages backward, leaving the original
// untouched for rollback.
//
// Run: node --test test/messagesPhase5PortalThreadReversePagination.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')
const strip = (s) => s.replace(/--[^\n]*/g, '')

const M = '../supabase/migrations/20260716000006_messages_phase5_portal_thread_reverse_pagination.sql'
const sql = read(M)
// Executable SQL with line comments removed.
const code = strip(sql)
// The function body only, excluding the COMMENT ON literal, whose prose
// legitimately names things the body must never do.
const fnBody = strip(sql.slice(
  sql.indexOf('CREATE OR REPLACE FUNCTION public.messages_portal_get_thread_v2'),
  sql.indexOf('COMMENT ON FUNCTION'),
))
const verify = read('../db/audit/messages_phase5_portal_thread_reverse_pagination_verification.sql')
const p3 = read('../supabase/migrations/20260716000002_messages_phase3_api_foundation.sql')
const p5staff = read('../supabase/migrations/20260716000005_messages_phase4_staff_thread_reverse_pagination.sql')

test('Phase 5A migration: existence and non-interference', async (t) => {
  await t.test('the migration and its verification exist and are atomic', () => {
    assert.match(sql, /^BEGIN;/m)
    assert.match(sql, /^COMMIT;/m)
    assert.ok(sql.indexOf('\nCOMMIT;') > sql.lastIndexOf('GRANT EXECUTE ON FUNCTION'), 'COMMIT after the grant')
    assert.match(sql, /NOTIFY pgrst, 'reload schema';/)
    assert.ok(verify.length > 0)
  })

  await t.test('all six earlier migrations are unchanged', () => {
    const m = (f) => read(`../supabase/migrations/${f}`)
    assert.match(m('20260716000000_messages_phase1_schema_foundation.sql'), /CREATE TABLE IF NOT EXISTS public\.conversations\b/)
    assert.match(m('20260716000001_messages_phase2_notification_delivery_foundation.sql'), /message_notification_deliveries/)
    assert.match(m('20260716000002_messages_phase3_api_foundation.sql'), /messages_portal_get_thread\(/)
    assert.match(m('20260716000003_messages_phase3_delivery_invariant_fix.sql'), /message_assert_valid_delivery/)
    assert.match(m('20260716000004_messages_phase4_staff_inbox_filter_modes.sql'), /messages_staff_list_conversations_v2/)
    assert.match(m('20260716000005_messages_phase4_staff_thread_reverse_pagination.sql'), /messages_staff_get_thread_v2/)
    // The portal v2 never leaked backwards into a locked migration.
    for (const f of ['20260716000000_messages_phase1_schema_foundation.sql',
      '20260716000002_messages_phase3_api_foundation.sql',
      '20260716000004_messages_phase4_staff_inbox_filter_modes.sql',
      '20260716000005_messages_phase4_staff_thread_reverse_pagination.sql']) {
      assert.doesNotMatch(m(f), /messages_portal_get_thread_v2/, `${f} must not contain the portal v2 RPC`)
    }
  })

  await t.test('the original portal thread RPC is untouched and still forward-paging', () => {
    // This is the defect that motivated v2; it must remain exactly as applied so
    // it stays available for rollback.
    assert.match(p3, /\(m\.created_at, m\.id\) > \(p_cursor_ts, p_cursor_id\)/)
    assert.doesNotMatch(code, /CREATE OR REPLACE FUNCTION public\.messages_portal_get_thread\s*\(/)
    assert.doesNotMatch(code, /DROP FUNCTION/)
  })

  await t.test('the staff v2 and mark-read RPCs are untouched', () => {
    assert.match(p5staff, /messages_staff_get_thread_v2/)
    assert.doesNotMatch(code, /CREATE OR REPLACE FUNCTION public\.messages_staff_get_thread_v2/)
    assert.doesNotMatch(code, /CREATE OR REPLACE FUNCTION public\.messages_mark_read/)
    assert.doesNotMatch(fnBody, /messages_staff_get_thread|messages_mark_read/)
  })

  await t.test('exactly one new function, distinctly named, no overload', () => {
    const created = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1])
    assert.deepEqual(created, ['messages_portal_get_thread_v2'])
  })

  await t.test('creates no table, no policy, and mutates no data', () => {
    assert.doesNotMatch(code, /CREATE TABLE/i)
    assert.doesNotMatch(code, /CREATE POLICY/i)
    assert.doesNotMatch(code, /ALTER TABLE/i)
    assert.doesNotMatch(code, /\b(INSERT INTO|UPDATE |DELETE FROM|TRUNCATE)\b/i)
  })
})

test('Phase 5A migration: reverse pagination', async (t) => {
  await t.test('the first page selects the NEWEST rows', () => {
    assert.match(sql, /ORDER BY m\.created_at DESC, m\.id DESC/)
    // No cursor means no lower bound, so the newest v_limit rows are taken.
    assert.match(sql, /p_cursor_ts IS NULL OR \(m\.created_at, m\.id\) < \(p_cursor_ts, p_cursor_id\)/)
  })

  await t.test('older pages use the less-than tuple cursor', () => {
    assert.match(sql, /\(m\.created_at, m\.id\) < \(p_cursor_ts, p_cursor_id\)/)
    // The old forward comparison must not appear anywhere in the new function.
    assert.doesNotMatch(fnBody, /\(m\.created_at, m\.id\) > \(p_cursor_ts, p_cursor_id\)/)
  })

  await t.test('the inner page orders DESC and LIMITs before anything else', () => {
    assert.match(sql, /ORDER BY m\.created_at DESC, m\.id DESC\s*\n\s*LIMIT v_limit/)
    // The page CTE bounds the scan; the thread is never aggregated unbounded.
    assert.match(sql, /WITH page AS \(/)
  })

  await t.test('the bounded page is returned chronologically', () => {
    assert.match(sql, /\) ORDER BY p\.created_at, p\.id\s*\n\s*\), '\[\]'::jsonb\)/)
  })

  await t.test('the next cursor derives from the OLDEST returned row', () => {
    assert.match(sql, /oldest AS \(\s*\n\s*SELECT p\.created_at, p\.id FROM page p ORDER BY p\.created_at, p\.id LIMIT 1\s*\n\s*\)/)
    assert.match(sql, /jsonb_build_object\('cursor_ts', v_oldest_ts, 'cursor_id', v_oldest_id\)/)
    assert.match(sql, /'next_cursor', CASE WHEN v_has_more/)
  })

  await t.test('has_more is a bounded existence check, not a full fetch', () => {
    assert.match(sql, /SELECT EXISTS \(\s*\n\s*SELECT 1 FROM public\.messages m[\s\S]{0,200}?\(m\.created_at, m\.id\) < \(v_oldest_ts, v_oldest_id\)/)
    assert.match(sql, /'has_more', v_has_more/)
  })

  await t.test('the id tie-breaker makes ordering deterministic', () => {
    // Every ordering and every comparison carries the id, so equal timestamps
    // still paginate exactly once.
    assert.doesNotMatch(fnBody, /ORDER BY m\.created_at DESC(?!, m\.id DESC)/)
    assert.doesNotMatch(fnBody, /\(m\.created_at\) < \(p_cursor_ts\)/)
  })

  await t.test('no offset pagination anywhere', () => {
    assert.doesNotMatch(fnBody, /\bOFFSET\b/i)
  })

  await t.test('a partial cursor is rejected', () => {
    assert.match(sql, /\(p_cursor_ts IS NULL\) <> \(p_cursor_id IS NULL\)/)
    assert.match(sql, /invalid cursor' USING ERRCODE = 'MS400'/)
  })

  await t.test('the limit defaults to 50 and caps at 100, matching staff v2', () => {
    assert.match(sql, /p_limit\s+integer\s+DEFAULT 50/)
    assert.match(sql, /LEAST\(GREATEST\(COALESCE\(p_limit, 50\), 1\), 100\)/)
    // Same bounds as the staff v2, so both sides share one pagination model.
    assert.match(p5staff, /LEAST\(GREATEST\(COALESCE\(p_limit, 50\), 1\), 100\)/)
  })
})

test('Phase 5A migration: authorization', async (t) => {
  await t.test('access requires active student participation only', () => {
    assert.match(sql, /p_conversation_id NOT IN \(SELECT public\.my_message_conversation_ids\(\)\)/)
    assert.match(sql, /v_me\s+uuid := public\.portal_profile_id\(\);/)
    assert.match(sql, /IF v_me IS NULL OR p_conversation_id NOT IN[\s\S]{0,80}?RETURN NULL;/)
  })

  await t.test('the participant helper it relies on is genuinely participant-scoped', () => {
    // Proof the reuse is correct rather than convenient: the Phase 1 helper
    // requires an unremoved student participant row, a live student role grant,
    // and an active student link matching the participant scope.
    const p1 = read('../supabase/migrations/20260716000000_messages_phase1_schema_foundation.sql')
    const helper = strip(p1.slice(
      p1.indexOf('CREATE OR REPLACE FUNCTION public.my_message_conversation_ids'),
      p1.indexOf('REVOKE ALL ON FUNCTION public.my_message_conversation_ids'),
    ))
    assert.match(helper, /p\.participant_profile_id = public\.portal_profile_id\(\)/)
    assert.match(helper, /p\.removed_at IS NULL/)
    assert.match(helper, /g\.revoked_at IS NULL/)
    assert.match(helper, /g\.starts_at <= now\(\)/)
    assert.match(helper, /g\.expires_at IS NULL OR g\.expires_at > now\(\)/)
    assert.match(helper, /public\.user_student_links l/)
    assert.match(helper, /l\.revoked_at IS NULL/)
    // It grants nothing from staff context.
    assert.doesNotMatch(helper, /is_staff|is_active_owner_or_admin|assigned_staff/)
  })

  await t.test('no staff authorization helper is used', () => {
    assert.doesNotMatch(fnBody, /is_staff\s*\(/)
    assert.doesNotMatch(fnBody, /is_active_owner_or_admin\s*\(/)
    assert.doesNotMatch(fnBody, /message_profile_is_active_owner_or_admin\s*\(/)
  })

  await t.test('access is never granted by email, student_id, or related context', () => {
    assert.doesNotMatch(fnBody, /email/i)
    // No authorization branch keys on related context. related_student_id is not
    // even projected to the portal.
    assert.doesNotMatch(fnBody, /^\s*IF[^\n]*\b(school|cohort|unit|placement|preceptor)\b/mi)
    assert.doesNotMatch(fnBody, /related_student_id|related_cohort_id/)
    assert.doesNotMatch(fnBody, /assigned_staff_profile_id/)
  })

  await t.test('the three-identity model is respected', () => {
    // portal_profile_id() resolves auth.uid() to user_profiles.id; the function
    // never compares a profile id to auth.uid() directly.
    assert.doesNotMatch(fnBody, /profile_id\s*=\s*auth\.uid\(\)/)
    const authz = read('../supabase/migrations/20260712000007_phase2_authz_foundation.sql')
    assert.match(authz, /SELECT id FROM public\.user_profiles WHERE auth_user_id = auth\.uid\(\)/)
  })

  await t.test('an inaccessible conversation is non-enumerating', () => {
    // Identical NULL for inaccessible and missing, matching v1.
    assert.match(fnBody, /RETURN NULL;/)
    assert.match(sql, /IF v_conv IS NULL THEN\s*\n\s*RETURN NULL;/)
  })
})

test('Phase 5A migration: security and privileges', async (t) => {
  await t.test('security definer with a fixed search_path, per repository convention', () => {
    assert.match(sql, /LANGUAGE plpgsql SECURITY DEFINER STABLE\s*\n\s*SET search_path = public, pg_catalog/)
  })

  await t.test('granted to authenticated and service_role, never anon or PUBLIC', () => {
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.messages_portal_get_thread_v2\(uuid, integer, timestamptz, uuid\)\s*\n\s*FROM PUBLIC, anon;/)
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.messages_portal_get_thread_v2\(uuid, integer, timestamptz, uuid\)\s*\n\s*TO authenticated, service_role;/)
  })

  await t.test('no anonymous access and no direct table grant', () => {
    assert.doesNotMatch(code, /GRANT[^;]*TO[^;]*anon/i)
    assert.doesNotMatch(code, /GRANT (SELECT|INSERT|UPDATE|DELETE)[^;]*ON public\.(messages|conversations)/i)
  })

  await t.test('service_role is not the normal portal read path', () => {
    // The function is executable by authenticated so the endpoint can call it as
    // the signed-in user; service_role is present only for server tooling.
    assert.match(sql, /TO authenticated, service_role;/)
    assert.doesNotMatch(fnBody, /service_role/)
  })

  await t.test('RLS is not weakened', () => {
    assert.doesNotMatch(code, /DISABLE ROW LEVEL SECURITY/i)
    assert.doesNotMatch(code, /DROP POLICY/i)
    assert.doesNotMatch(code, /FORCE ROW LEVEL SECURITY/i)
  })
})

test('Phase 5A migration: return contract and privacy', async (t) => {
  await t.test('the conversation projection is preserved from v1', () => {
    for (const f of ['id', 'subject', 'category', 'status', 'last_message_at', 'can_reply']) {
      assert.ok(sql.includes(`'${f}'`), `conversation field ${f} missing`)
    }
    assert.match(sql, /public\.message_portal_status_label\(c\.status\)/)
  })

  await t.test('the message projection is preserved from v1', () => {
    for (const f of ['id', 'body', 'created_at', 'author_type', 'author_label', 'author_name']) {
      assert.ok(sql.includes(`'${f}'`), `message field ${f} missing`)
    }
    assert.match(sql, /CASE WHEN p\.author_role = 'staff' THEN 'staff' ELSE 'me' END/)
    assert.match(sql, /CASE WHEN p\.author_role = 'staff' THEN 'ASPIRE Team' ELSE 'You' END/)
  })

  await t.test('reverse-pagination metadata is added', () => {
    assert.match(sql, /'has_more', v_has_more/)
    assert.match(sql, /'next_cursor', CASE WHEN v_has_more/)
    assert.match(sql, /'limit', v_limit/)
  })

  await t.test('no email, routing, delivery, or provider data is returned', () => {
    assert.doesNotMatch(fnBody, /email/i)
    assert.doesNotMatch(fnBody, /message_notification_deliveries|idempotency_key|recipient_kind|recipient_profile_id/i)
    assert.doesNotMatch(fnBody, /resend|provider_message_id|raw_auth|user_metadata/i)
  })

  await t.test('no staff workflow field reaches the student', () => {
    for (const f of ['assigned_staff_profile_id', 'assignee_name', 'follow_up_flagged',
      'related_cohort_id', 'resolved_at', 'internal']) {
      assert.doesNotMatch(fnBody, new RegExp(f), `${f} must not be projected to the portal`)
    }
  })
})

test('Phase 5A: documentation and hygiene', async (t) => {
  await t.test('the COMMENT ON documents the required behavior', () => {
    const comment = sql.slice(sql.indexOf('COMMENT ON FUNCTION'), sql.indexOf('-- ── 2.'))
    for (const topic of [/newest page/i, /backward/i, /chronological/i,
      /Authorization boundary/i, /tie-breaker/i, /Bounded page size/i]) {
      assert.match(comment, topic)
    }
  })

  await t.test('no em dash anywhere in the migration or verification', () => {
    assert.doesNotMatch(sql, /\u2014/)
    assert.doesNotMatch(verify, /\u2014/)
  })

  await t.test('uses ASPIRE, never the deprecated long form', () => {
    assert.doesNotMatch(sql, /ASPIRE Program/)
    assert.doesNotMatch(verify, /ASPIRE Program/)
  })

  await t.test('the verification strips comments before every source assertion', () => {
    // A previous phase produced a false failure because the word OFFSET appeared
    // inside an explanatory comment; pg_get_functiondef returns the body
    // verbatim, so every regex audit must strip comments first.
    // Count executable SQL only: the file's own header comment names
    // pg_get_functiondef while explaining this very rule.
    const executable = strip(verify)
    const srcBlocks = executable.match(/pg_get_functiondef/g) || []
    const stripped = executable.match(/regexp_replace\(pg_get_functiondef/g) || []
    assert.ok(srcBlocks.length > 0)
    assert.equal(stripped.length, srcBlocks.length,
      'every pg_get_functiondef use must strip line comments first')
  })

  await t.test('the verification is read-only', () => {
    assert.doesNotMatch(verify, /\b(INSERT INTO|UPDATE |DELETE FROM|TRUNCATE|CREATE |ALTER |DROP )\b/i)
  })
})

test('Phase 5A: no Student Portal Messages UI was built', async (t) => {
  await t.test('no portal Messages interface exists', () => {
    for (const f of ['../src/portal/PortalApp.jsx', '../src/portal/PortalShell.jsx', '../src/portal/StudentPortal.jsx']) {
      assert.doesNotMatch(read(f), /MessagesWorkspace|MessagesInbox|NewMessageDialog|messagesApiClient/)
    }
  })

  await t.test('the staff workspace remains activated and unchanged', () => {
    const connect = read('../src/pages/Connect.jsx')
    assert.match(connect, /const canUseMessages = \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/)
    assert.match(connect, /<MessagesWorkspace refreshKey=\{refreshKey\} \/>/)
  })
})
