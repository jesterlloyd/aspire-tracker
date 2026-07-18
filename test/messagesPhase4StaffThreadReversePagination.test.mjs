// MESSAGES-PHASE4B2A-A: static guard for the staff thread reverse-pagination
// migration. The applied messages_staff_get_thread pages FORWARD from the oldest
// message, so "Load earlier messages" is impossible and staff would open a long
// thread on the wrong end. This migration adds a distinctly named v2 that opens
// at the newest messages and pages backward, leaving the original untouched.
//
// Run: node --test test/messagesPhase4StaffThreadReversePagination.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')
const strip = (s) => s.replace(/--[^\n]*/g, '')

const M = '../supabase/migrations/20260716000005_messages_phase4_staff_thread_reverse_pagination.sql'
const sql = read(M)
const code = strip(sql)
// The function body only, excluding the COMMENT ON literal, whose prose
// legitimately names things the body must never do.
const fnBody = strip(sql.slice(
  sql.indexOf('CREATE OR REPLACE FUNCTION public.messages_staff_get_thread_v2'),
  sql.indexOf('COMMENT ON FUNCTION'),
))
const verify = read('../db/audit/messages_phase4_staff_thread_reverse_pagination_verification.sql')
const p3 = read('../supabase/migrations/20260716000002_messages_phase3_api_foundation.sql')
const connect = read('../src/pages/Connect.jsx')
const app = read('../src/App.jsx')

test('Stage A migration: existence and non-interference', async (t) => {
  await t.test('the migration and its verification exist and are atomic', () => {
    assert.match(sql, /^BEGIN;/m)
    assert.match(sql, /^COMMIT;/m)
    assert.ok(sql.indexOf('\nCOMMIT;') > sql.lastIndexOf('GRANT EXECUTE ON FUNCTION'))
    assert.ok(verify.length > 0)
  })

  await t.test('all five earlier migrations are unchanged', () => {
    const m = (f) => read(`../supabase/migrations/${f}`)
    assert.match(m('20260716000000_messages_phase1_schema_foundation.sql'), /CREATE TABLE IF NOT EXISTS public\.conversations\b/)
    assert.match(m('20260716000001_messages_phase2_notification_delivery_foundation.sql'), /message_notification_deliveries/)
    assert.match(m('20260716000002_messages_phase3_api_foundation.sql'), /messages_staff_get_thread\(/)
    assert.match(m('20260716000003_messages_phase3_delivery_invariant_fix.sql'), /message_assert_valid_delivery/)
    assert.match(m('20260716000004_messages_phase4_staff_inbox_filter_modes.sql'), /messages_staff_list_conversations_v2/)
    // The v2 thread function never leaked backwards into a locked migration.
    for (const f of ['20260716000000_messages_phase1_schema_foundation.sql',
      '20260716000002_messages_phase3_api_foundation.sql',
      '20260716000004_messages_phase4_staff_inbox_filter_modes.sql']) {
      assert.doesNotMatch(m(f), /messages_staff_get_thread_v2/, `${f} must not contain the v2 thread RPC`)
    }
  })

  await t.test('the original staff thread RPC is untouched and still forward-paging', () => {
    // This is the defect that motivated v2; it must remain exactly as applied.
    assert.match(p3, /\(m\.created_at, m\.id\) > \(p_cursor_ts, p_cursor_id\)/)
    assert.doesNotMatch(code, /CREATE OR REPLACE FUNCTION public\.messages_staff_get_thread\s*\(/)
    assert.doesNotMatch(code, /DROP FUNCTION/)
  })

  await t.test('the portal thread and mark-read RPCs are untouched', () => {
    // Guard actual definition statements: the COMMENT ON prose legitimately
    // names both to record that they are deliberately left alone.
    assert.doesNotMatch(code, /CREATE OR REPLACE FUNCTION public\.messages_portal_get_thread/)
    assert.doesNotMatch(code, /CREATE OR REPLACE FUNCTION public\.messages_mark_read/)
    // The new function body never calls or alters them.
    assert.doesNotMatch(fnBody, /messages_portal_get_thread|messages_mark_read/)
    // No portal v2 is created here: that is a documented Phase 5 prerequisite.
    assert.doesNotMatch(code, /CREATE OR REPLACE FUNCTION public\.messages_portal_get_thread_v2/)
  })

  await t.test('exactly one new function, distinctly named, no overload', () => {
    const created = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1])
    assert.deepEqual(created, ['messages_staff_get_thread_v2'])
  })

  await t.test('creates no table, no policy, and mutates no data', () => {
    assert.doesNotMatch(code, /CREATE TABLE/i)
    assert.doesNotMatch(code, /CREATE POLICY/i)
    assert.doesNotMatch(code, /ALTER TABLE/i)
    assert.doesNotMatch(code, /\b(INSERT INTO|UPDATE |DELETE FROM|TRUNCATE)\b/i)
    assert.doesNotMatch(fnBody, /message_archive/i)
  })
})

test('Stage A migration: reverse pagination', async (t) => {
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

  await t.test('no offset pagination anywhere', () => {
    assert.doesNotMatch(fnBody, /\bOFFSET\b/i)
  })

  await t.test('a partial cursor is rejected', () => {
    assert.match(sql, /\(p_cursor_ts IS NULL\) <> \(p_cursor_id IS NULL\)/)
    assert.match(sql, /invalid cursor' USING ERRCODE = 'MS400'/)
  })

  await t.test('the limit defaults to 50 and caps at 100', () => {
    assert.match(sql, /p_limit\s+integer\s+DEFAULT 50/)
    assert.match(sql, /LEAST\(GREATEST\(COALESCE\(p_limit, 50\), 1\), 100\)/)
  })
})

test('Stage A migration: contract, authorization, privileges', async (t) => {
  await t.test('preserves the conversation, message, and event contract', () => {
    for (const f of ['id', 'subject', 'category', 'status', 'last_message_at', 'resolved_at',
      'assigned_staff_profile_id', 'assignee_name', 'follow_up_flagged', 'related_student_id',
      'related_cohort_id', 'participant_profile_id', 'participant_name', 'participant_access_active']) {
      assert.ok(sql.includes(`'${f}'`), `conversation field ${f} missing`)
    }
    for (const f of ['author_role', 'author_name', 'body', 'created_at']) {
      assert.ok(sql.includes(`'${f}'`), `message field ${f} missing`)
    }
    assert.match(sql, /'conversation', v_conv,\s*\n\s*'messages', v_msgs,\s*\n\s*'events', v_events/)
    // No email is ever projected.
    assert.doesNotMatch(fnBody, /up\.email|\.email/)
  })

  await t.test('gates on active Owner/Admin, never is_staff', () => {
    assert.match(sql, /IF NOT public\.is_active_owner_or_admin\(\) THEN/)
    assert.match(sql, /staff access required' USING ERRCODE = 'MS403'/)
    assert.doesNotMatch(fnBody, /is_staff/)
  })

  await t.test('assignment and related context never authorize', () => {
    const authBlock = sql.slice(sql.indexOf('BEGIN\n'), sql.indexOf('SELECT jsonb_build_object('))
    assert.doesNotMatch(authBlock, /related_student_id|related_unit_key|related_school_key|related_cohort_id/)
    assert.doesNotMatch(authBlock, /assigned_staff_profile_id/)
  })

  await t.test('an inaccessible conversation stays non-enumerating', () => {
    assert.match(sql, /IF v_conv IS NULL THEN\s*\n\s*RETURN NULL;/)
  })

  await t.test('is SECURITY DEFINER with a fixed search_path', () => {
    assert.match(sql, /LANGUAGE plpgsql SECURITY DEFINER STABLE\s*\nSET search_path = public, pg_catalog/)
  })

  await t.test('revokes PUBLIC and anon, grants authenticated and service_role', () => {
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.messages_staff_get_thread_v2\(uuid, integer, timestamptz, uuid\)\s*\n\s*FROM PUBLIC, anon;/)
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.messages_staff_get_thread_v2\(uuid, integer, timestamptz, uuid\)\s*\n\s*TO authenticated, service_role;/)
    assert.doesNotMatch(sql, /GRANT EXECUTE[^;]*TO[^;]*\banon\b/)
  })

  await t.test('every custom SQLSTATE is five characters', () => {
    const codes = [...sql.matchAll(/ERRCODE = '([^']+)'/g)].map((m) => m[1])
    assert.ok(codes.length > 0)
    for (const c of new Set(codes)) assert.equal(c.length, 5, `SQLSTATE ${c} must be 5 characters`)
  })

  await t.test('contains no em dash', () => {
    // Escaped so this guard does not itself contain the character it forbids.
    const EM_DASH = /\u2014/
    assert.doesNotMatch(sql, EM_DASH)
    assert.doesNotMatch(verify, EM_DASH)
  })
})

test('Stage A verification file', async (t) => {
  await t.test('is read-only and run-after-apply', () => {
    assert.match(verify, /READ-ONLY VERIFICATION QUERIES\.\s*\n--\s*RUN ONLY AFTER THE MIGRATION HAS BEEN APPLIED\./)
    assert.doesNotMatch(strip(verify), /\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP)\b/i)
  })

  await t.test('audit guards are comment-stripped and line-anchored (no false positives)', () => {
    // Root cause 1: pg_get_functiondef returns the body VERBATIM including its
    // in-body comments, so the old "no OFFSET" absence check matched the comment
    // documenting "no OFFSET". Every code guard must strip comments first.
    assert.ok(verify.includes("regexp_replace(pg_get_functiondef(p.oid), '--[^"),
      'code guards must strip in-body comments')
    // Root cause 2: the old audit 9 regex (IF|WHERE)[^;]*token[^;]*(THEN|=)
    // spanned a whole multi-line projection statement. The guard must be line
    // anchored so it can only flag a token on an actual IF gate line.
    assert.ok(verify.includes('(?n)^'), 'the context guard must be line anchored with (?n)')
    // Guard the executable SQL: the NOTE comment quotes the old regex on purpose
    // to record the defect, so strip comments before asserting it is gone.
    assert.ok(!strip(verify).includes('(IF|WHERE)[^;]*'),
      'the old span-based regex must be gone from executable SQL')
    // Audit 6 must be self-diagnosing (one row per check), not an 8-way AND.
    assert.ok(verify.includes("THEN 'PASS' ELSE 'FAIL' END"), 'audit 6 must report per-check pass/fail')
    assert.ok(verify.includes('checks(check_name, pattern, must_match)'), 'audit 6 must be a per-check table')
  })

  await t.test('the required separate proofs are present', () => {
    for (const tok of ['9b. POSITIVE PROOF', '9c. EVERY gate', '9d. participant_profile_id',
      '9e. p_conversation_id']) {
      assert.ok(verify.includes(tok), `verification missing proof ${tok}`)
    }
    // Explicit pass expectations, so zero rows never has to be guessed at.
    assert.match(verify, /Expect EIGHT rows, every result = 'PASS'/)
    assert.match(verify, /Expect ZERO rows/)
  })

  await t.test('covers the required checks', () => {
    for (const tok of ['messages_staff_get_thread_v2', 'prosecdef', 'search_path',
      'has_function_privilege', 'role_routine_grants', 'is_active_owner_or_admin', 'is_staff',
      'messages_portal_get_thread', 'messages_mark_read', 'overloads', 'pg_policies',
      'message_archive', 'messages_portal_get_thread_v2']) {
      assert.ok(verify.includes(tok), `verification missing ${tok}`)
    }
  })
})

test('Messages stays dormant and unexposed', async (t) => {
  await t.test('Messages is gated in Connect; App.jsx is untouched', () => {
    assert.match(connect, /const VALID_TABS = new Set\(\['contacts', 'outreach', 'messages', 'broadcasts'\]\)/)
    assert.match(connect, /const canUseMessages = \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/, 'Messages is activated in Phase 4B2b-ii and gated to an active Owner or Admin')
    assert.match(connect, /const canUseMessages = \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/, 'Messages is activated in Phase 4B2b-ii and gated to an active Owner or Admin')
    assert.doesNotMatch(app, /MessagesInbox|MessagesWorkspace/)
    assert.doesNotMatch(app, /\/connect\/messages/)
  })

  await t.test('no workspace, thread UI, composer, or management UI was built', () => {
    // Stage A is SQL only.
    assert.doesNotMatch(code, /jsx|react/i)
  })

  await t.test('Student Portal Messages is activated and mounted only in the student branch', () => {
    // Phase 5B-ii ACTIVATED Student Portal Messages. These guards no longer assert
    // dormancy; they assert the boundary that replaced it. PortalApp is the sole
    // activation point, so PortalShell, StudentPortal, and App.jsx stay untouched.
    const papp = read('../src/portal/PortalApp.jsx')
    assert.match(papp, /<PortalMessagesWorkspace\s[\s\S]*?active=\{studentView === 'messages'\}/,
      'Messages is mounted only in the active student branch')
    assert.doesNotMatch(read('../src/portal/PortalShell.jsx'), /PortalMessagesWorkspace|PortalNav/)
    assert.doesNotMatch(read('../src/portal/StudentPortal.jsx'), /PortalMessagesWorkspace|PortalNav/)
    assert.doesNotMatch(read('../src/App.jsx'), /PortalMessagesWorkspace/)
  })
})
