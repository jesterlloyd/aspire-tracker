// MESSAGES-PHASE4B-A: static guard for the staff inbox null-filter migration.
// The applied Phase 3 list RPC treats a null p_assignee or p_category as
// "no filter", so Unassigned and Uncategorized are inexpressible. This migration
// adds a distinctly named v2 with explicit filter modes and leaves the original
// untouched. These tests pin that contract and the Phase 4A dormancy guarantee.
//
// Run: node --test test/messagesPhase4StaffInboxFilterModes.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, p), 'utf8')
const strip = (s) => s.replace(/--[^\n]*/g, '')

const M = '../supabase/migrations/20260716000004_messages_phase4_staff_inbox_filter_modes.sql'
const sql = read(M)
// Executable SQL with line comments removed.
const code = strip(sql)
// The function body only, excluding the COMMENT ON literal (whose prose
// legitimately names the things the body must never do).
const fnBody = strip(sql.slice(
  sql.indexOf('CREATE OR REPLACE FUNCTION public.messages_staff_list_conversations_v2'),
  sql.indexOf('COMMENT ON FUNCTION'),
))
const verify = read('../db/audit/messages_phase4_staff_inbox_filter_modes_verification.sql')
const p1 = read('../supabase/migrations/20260716000000_messages_phase1_schema_foundation.sql')
const p2 = read('../supabase/migrations/20260716000001_messages_phase2_notification_delivery_foundation.sql')
const p3 = read('../supabase/migrations/20260716000002_messages_phase3_api_foundation.sql')
const p3fix = read('../supabase/migrations/20260716000003_messages_phase3_delivery_invariant_fix.sql')
const connect = read('../src/pages/Connect.jsx')
const app = read('../src/App.jsx')

const SIG = 'integer, timestamptz, uuid, text, text, uuid, text, text, boolean, text'

test('Stage A migration: existence and non-interference', async (t) => {
  await t.test('the new migration exists and is atomic', () => {
    assert.match(sql, /^BEGIN;/m)
    assert.match(sql, /^COMMIT;/m)
    assert.ok(sql.indexOf('\nCOMMIT;') > sql.lastIndexOf('GRANT EXECUTE ON FUNCTION'), 'COMMIT after the grant')
  })

  await t.test('all four earlier migrations remain unchanged', () => {
    assert.match(p1, /CREATE TABLE IF NOT EXISTS public\.conversations\b/)
    assert.match(p2, /CREATE TABLE IF NOT EXISTS public\.message_notification_deliveries\b/)
    assert.match(p3, /CREATE OR REPLACE FUNCTION public\.messages_staff_list_conversations\(/)
    assert.match(p3fix, /message_assert_valid_delivery/)
    // The v2 function never leaked backwards into a locked migration.
    for (const [name, f] of Object.entries({ p1, p2, p3, p3fix })) {
      assert.doesNotMatch(f, /messages_staff_list_conversations_v2/, `${name} must not contain v2`)
    }
  })

  await t.test('the original Phase 3 list function is not modified or replaced', () => {
    // It still carries the null-means-no-filter predicates that motivated v2.
    assert.match(p3, /p_assignee IS NULL OR c\.assigned_staff_profile_id = p_assignee/)
    assert.match(p3, /p_category IS NULL OR c\.category = p_category/)
    // This migration does not redefine it.
    assert.doesNotMatch(code, /CREATE OR REPLACE FUNCTION public\.messages_staff_list_conversations\s*\(/)
    assert.doesNotMatch(code, /DROP FUNCTION/)
  })

  await t.test('the new RPC has a distinct name and creates no ambiguous overload', () => {
    const created = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1])
    assert.deepEqual(created, ['messages_staff_list_conversations_v2'], 'exactly one new function, distinctly named')
  })

  await t.test('creates no table, no policy, and mutates no data', () => {
    assert.doesNotMatch(code, /CREATE TABLE/i)
    assert.doesNotMatch(code, /CREATE POLICY/i)
    assert.doesNotMatch(code, /ALTER TABLE/i)
    assert.doesNotMatch(code, /\b(INSERT INTO|UPDATE |DELETE FROM|TRUNCATE)\b/i)
    assert.doesNotMatch(fnBody, /message_archive/i)
  })
})

test('Stage A migration: filter modes', async (t) => {
  await t.test('declares the explicit mode parameters', () => {
    for (const p of ['p_limit', 'p_cursor_ts', 'p_cursor_id', 'p_status', 'p_assignee_mode',
      'p_assignee_profile_id', 'p_category_mode', 'p_category', 'p_flagged', 'p_search']) {
      assert.ok(sql.includes(p), `missing parameter ${p}`)
    }
  })

  await t.test('assignee mode supports any, unassigned, and specific', () => {
    assert.match(sql, /v_amode NOT IN \('any', 'unassigned', 'specific'\)/)
    assert.match(sql, /v_amode = 'any'\s*\n\s*OR \(v_amode = 'unassigned' AND c\.assigned_staff_profile_id IS NULL\)/)
    assert.match(sql, /v_amode = 'specific'\s+AND c\.assigned_staff_profile_id = p_assignee_profile_id/)
  })

  await t.test('an invalid assignee mode is rejected and specific requires a profile id', () => {
    assert.match(sql, /invalid assignee mode' USING ERRCODE = 'MS400'/)
    assert.match(sql, /v_amode = 'specific' AND p_assignee_profile_id IS NULL THEN[\s\S]*?specific assignee mode requires an assignee profile id/)
  })

  await t.test('Me is not a database mode', () => {
    assert.doesNotMatch(fnBody, /'me'/i, 'Me must be expressed as specific plus the verified profile id')
  })

  await t.test('category mode supports any, uncategorized, and specific', () => {
    assert.match(sql, /v_cmode NOT IN \('any', 'uncategorized', 'specific'\)/)
    assert.match(sql, /v_cmode = 'any'\s*\n\s*OR \(v_cmode = 'uncategorized' AND c\.category IS NULL\)/)
    assert.match(sql, /v_cmode = 'specific'\s+AND c\.category = v_category/)
  })

  await t.test('an invalid category mode is rejected and specific requires an approved category', () => {
    assert.match(sql, /invalid category mode' USING ERRCODE = 'MS400'/)
    assert.match(sql, /specific category mode requires a category/)
    assert.match(sql, /invalid category' USING ERRCODE = 'MS400'/)
    for (const c of ['Placement and matching', 'Scheduling', 'Onboarding requirements',
      'Clinical rotation support', 'Preceptor support', 'Portal or account help', 'General question']) {
      assert.ok(sql.includes(`'${c}'`), `missing approved category ${c}`)
    }
    // A blank category cannot pass as specific.
    assert.match(sql, /v_category text\s+:= NULLIF\(btrim\(COALESCE\(p_category, ''\)\), ''\)/)
  })

  await t.test('status values are validated and null means all', () => {
    assert.match(sql, /p_status IS NOT NULL AND p_status NOT IN \('open', 'waiting', 'resolved'\)/)
    assert.match(sql, /invalid status' USING ERRCODE = 'MS400'/)
    assert.match(sql, /\(p_status IS NULL OR c\.status = p_status\)/)
  })

  await t.test('p_flagged keeps its nullable three-state behavior', () => {
    assert.match(sql, /p_flagged\s+boolean\s+DEFAULT NULL/)
    assert.match(sql, /\(p_flagged IS NULL OR c\.follow_up_flagged = p_flagged\)/)
  })
})

test('Stage A migration: pagination, search, and safety', async (t) => {
  await t.test('the cursor stays last_message_at with an id tie-breaker', () => {
    assert.match(sql, /\(c\.last_message_at, c\.id\) < \(p_cursor_ts, p_cursor_id\)/)
    assert.match(sql, /ORDER BY c\.last_message_at DESC, c\.id DESC/)
    assert.doesNotMatch(fnBody, /\bOFFSET\b/i, 'no offset pagination')
  })

  await t.test('a partial cursor is rejected safely', () => {
    assert.match(sql, /\(p_cursor_ts IS NULL\) <> \(p_cursor_id IS NULL\)/)
    assert.match(sql, /invalid cursor' USING ERRCODE = 'MS400'/)
  })

  await t.test('limit defaults to 25 and caps at 100', () => {
    assert.match(sql, /p_limit\s+integer\s+DEFAULT 25/)
    assert.match(sql, /LEAST\(GREATEST\(COALESCE\(p_limit, 25\), 1\), 100\)/)
  })

  await t.test('filters are applied server side before the limit', () => {
    const body = sql.slice(sql.indexOf('FROM public.conversations c'), sql.indexOf('  ) r;'))
    assert.ok(body.indexOf('WHERE') < body.indexOf('LIMIT v_limit'), 'filters precede the limit')
    assert.match(body, /LIMIT v_limit/)
  })

  await t.test('search covers subject only and never a message body', () => {
    assert.match(sql, /c\.subject ILIKE '%' \|\| v_search \|\| '%'/)
    assert.doesNotMatch(fnBody, /m\.body ILIKE|body ILIKE/i, 'message bodies must never be searched')
    // Trimmed consistently; a blank search is no filter.
    assert.match(sql, /v_search\s+text\s+:= NULLIF\(btrim\(COALESCE\(p_search, ''\)\), ''\)/)
  })

  await t.test('the only body read is the approved latest preview', () => {
    assert.match(sql, /left\(m\.body, 160\)/)
    const bodyReads = [...fnBody.matchAll(/m\.body/g)]
    assert.equal(bodyReads.length, 1, 'exactly one body reference, the truncated preview')
  })
})

test('Stage A migration: authorization and privileges', async (t) => {
  await t.test('gates on active Owner/Admin and never uses is_staff', () => {
    assert.match(sql, /IF NOT public\.is_active_owner_or_admin\(\) THEN/)
    assert.match(sql, /staff access required' USING ERRCODE = 'MS403'/)
    // Guard the function BODY: the COMMENT ON prose legitimately names is_staff
    // to record that it is deliberately never used.
    assert.doesNotMatch(fnBody, /is_staff/)
  })

  await t.test('assignment and related context never authorize', () => {
    // They appear only inside the SELECT projection or a caller-supplied filter,
    // never in the authorization branch.
    const authBlock = sql.slice(sql.indexOf('BEGIN\n'), sql.indexOf('SELECT COALESCE(jsonb_agg'))
    assert.doesNotMatch(authBlock, /related_student_id|related_unit_key|related_school_key|related_cohort_id/)
    assert.doesNotMatch(authBlock, /assigned_staff_profile_id/)
  })

  await t.test('preserves the three-identity model', () => {
    assert.match(sql, /v_me\s+uuid\s+:= public\.portal_profile_id\(\)/)
    assert.doesNotMatch(fnBody, /profile_id\s*=\s*auth\.uid\(\)/)
  })

  await t.test('is SECURITY DEFINER with a fixed search_path', () => {
    assert.match(sql, /LANGUAGE plpgsql SECURITY DEFINER STABLE\s*\nSET search_path = public, pg_catalog/)
  })

  await t.test('revokes PUBLIC and anon, grants authenticated and service_role', () => {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.messages_staff_list_conversations_v2\\(${SIG.replace(/[()]/g, '\\$&')}\\)\\s*\\n\\s*FROM PUBLIC, anon;`))
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.messages_staff_list_conversations_v2\\(${SIG.replace(/[()]/g, '\\$&')}\\)\\s*\\n\\s*TO authenticated, service_role;`))
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
  await t.test('is labeled read-only and run-after-apply', () => {
    assert.match(verify, /READ-ONLY VERIFICATION QUERIES\.\s*\n--\s*RUN ONLY AFTER THE MIGRATION HAS BEEN APPLIED\./)
    assert.doesNotMatch(strip(verify), /\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP)\b/i, 'verification must be SELECT only')
  })

  await t.test('covers the required checks', () => {
    for (const tok of ['messages_staff_list_conversations_v2', 'p_assignee_mode', 'p_category_mode',
      'prosecdef', 'search_path', 'has_function_privilege', 'role_routine_grants',
      'is_active_owner_or_admin', 'is_staff', 'assigned_staff_profile_id IS NULL',
      'pg_policies', 'message_archive', 'overloads']) {
      assert.ok(verify.includes(tok), `verification missing ${tok}`)
    }
  })
})

test('Phase 4A remains dormant and Messages stays unexposed', async (t) => {
  await t.test('Messages is gated in Connect; App.jsx is untouched', () => {
    assert.match(connect, /const VALID_TABS = new Set\(\['contacts', 'outreach', 'messages', 'broadcasts'\]\)/)
    assert.match(connect, /const canUseMessages = \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/, 'Messages is activated in Phase 4B2b-ii and gated to an active Owner or Admin')
    assert.match(connect, /const canUseMessages = \['owner', 'admin'\]\.includes\(userProfile\?\.role\)/, 'Messages is activated in Phase 4B2b-ii and gated to an active Owner or Admin')
    assert.doesNotMatch(app, /MessagesInbox/)
  })

  await t.test('the inbox is mounted only through the gated Connect workspace', () => {
    assert.match(connect, /navigate\('\/connect\/messages'\)/)
    assert.doesNotMatch(app, /\/connect\/messages/)
  })

  await t.test('no Student Portal Messages UI exists', () => {
    for (const f of ['../src/portal/PortalApp.jsx', '../src/portal/PortalShell.jsx', '../src/portal/StudentPortal.jsx']) {
      assert.doesNotMatch(read(f), /MessagesInbox|messagesApiClient/)
    }
  })

  await t.test('Stage A added no interface code', () => {
    // The v2 RPC is not wired into any client yet; Stage B does that.
    assert.doesNotMatch(read('../src/lib/messages/messagesApiClient.js'), /_v2/)
  })
})
