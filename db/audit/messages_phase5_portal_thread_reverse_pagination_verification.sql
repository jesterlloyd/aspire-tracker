-- ============================================================================
-- ASPIRE MESSAGES, PHASE 5A: READ-ONLY VERIFICATION QUERIES.
-- RUN ONLY AFTER THE MIGRATION HAS BEEN APPLIED.
-- ============================================================================
-- Companion to
-- supabase/migrations/20260716000006_messages_phase5_portal_thread_reverse_pagination.sql.
--
-- HOW TO RUN: paste this ENTIRE file into the Supabase SQL editor and run it as
-- one block. Every statement is a SELECT against system catalogs. It changes
-- nothing and is safe against production at any time.
--
-- Expected high-level outcome: audit 5 returns TEN rows all 'PASS'; audits 8 and
-- 11 return ZERO rows. Beyond that: messages_portal_get_thread_v2 exists, is
-- SECURITY DEFINER with a fixed search_path, is executable by authenticated and
-- service_role but never anon or PUBLIC, authorizes through
-- my_message_conversation_ids() only, never uses is_staff() or any staff helper,
-- selects the newest rows with a DESC order and LIMIT before returning them
-- chronologically, pages backward with a less-than tuple cursor, and never uses
-- OFFSET or an unbounded full-thread fetch. The original
-- messages_portal_get_thread and messages_staff_get_thread_v2 are both still
-- present and unchanged, exactly one function exists per name (no ambiguous
-- overload), and no table, policy, or data changed.
--
-- NOTE ON REGEX AUDITS: pg_get_functiondef() returns the body VERBATIM,
-- including its SQL comments. Every source assertion below therefore strips line
-- comments first. A previous phase produced a false failure because the word
-- OFFSET appeared inside an explanatory comment.
-- ============================================================================

-- 1. The new function exists with its full signature, SECURITY DEFINER, and the
--    fixed search_path. Expect ONE row, security_definer = true, volatility 's'.
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       p.proconfig AS config_settings
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_portal_get_thread_v2';

-- 2. No ambiguous overload: exactly ONE function per name. Expect THREE rows,
--    each with overload_count = 1.
SELECT p.proname AS function_name, count(*) AS overload_count
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('messages_portal_get_thread_v2',
                    'messages_portal_get_thread',
                    'messages_staff_get_thread_v2')
GROUP BY p.proname ORDER BY p.proname;

-- 3. Privileges: authenticated and service_role may execute; anon and PUBLIC may
--    not. Expect exactly TWO rows: authenticated and service_role.
SELECT r.rolname AS grantee
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN pg_roles r
WHERE n.nspname = 'public'
  AND p.proname = 'messages_portal_get_thread_v2'
  AND r.rolname IN ('anon', 'authenticated', 'service_role', 'public')
  AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
ORDER BY r.rolname;

-- 4. Explicit anon and PUBLIC denial. Expect TWO rows, both 'PASS'.
SELECT 'anon cannot execute' AS check_name,
       CASE WHEN NOT has_function_privilege('anon', p.oid, 'EXECUTE')
            THEN 'PASS' ELSE 'FAIL' END AS result
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_portal_get_thread_v2'
UNION ALL
SELECT 'PUBLIC cannot execute',
       CASE WHEN NOT has_function_privilege('public', p.oid, 'EXECUTE')
            THEN 'PASS' ELSE 'FAIL' END
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_portal_get_thread_v2';

-- 5. Source assertions on the new function, comments stripped. Each check is its
--    own row so one failure cannot collapse the whole audit to zero rows.
--    Expect TEN rows, ALL 'PASS'.
WITH src AS (
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') AS s
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'messages_portal_get_thread_v2'
)
SELECT 'newest page selected DESC' AS check_name,
       CASE WHEN s ~ 'ORDER BY m\.created_at DESC, m\.id DESC' THEN 'PASS' ELSE 'FAIL' END AS result FROM src
UNION ALL
SELECT 'bounded by LIMIT before aggregation',
       CASE WHEN s ~ 'ORDER BY m\.created_at DESC, m\.id DESC\s*\n\s*LIMIT v_limit' THEN 'PASS' ELSE 'FAIL' END FROM src
UNION ALL
SELECT 'backward tuple cursor (less-than)',
       CASE WHEN s ~ '\(m\.created_at, m\.id\) < \(p_cursor_ts, p_cursor_id\)' THEN 'PASS' ELSE 'FAIL' END FROM src
UNION ALL
SELECT 'no forward cursor remains',
       CASE WHEN s !~ '\(m\.created_at, m\.id\) > \(p_cursor_ts, p_cursor_id\)' THEN 'PASS' ELSE 'FAIL' END FROM src
UNION ALL
SELECT 'page returned chronologically',
       CASE WHEN s ~ 'ORDER BY p\.created_at, p\.id' THEN 'PASS' ELSE 'FAIL' END FROM src
UNION ALL
SELECT 'page size bounded 1..100 default 50',
       CASE WHEN s ~ 'LEAST\(GREATEST\(COALESCE\(p_limit, 50\), 1\), 100\)' THEN 'PASS' ELSE 'FAIL' END FROM src
UNION ALL
SELECT 'no OFFSET pagination',
       CASE WHEN s !~* '\mOFFSET\M' THEN 'PASS' ELSE 'FAIL' END FROM src
UNION ALL
SELECT 'authorizes via my_message_conversation_ids',
       CASE WHEN s ~ 'p_conversation_id NOT IN \(SELECT public\.my_message_conversation_ids\(\)\)' THEN 'PASS' ELSE 'FAIL' END FROM src
UNION ALL
SELECT 'partial cursor rejected',
       CASE WHEN s ~ '\(p_cursor_ts IS NULL\) <> \(p_cursor_id IS NULL\)' THEN 'PASS' ELSE 'FAIL' END FROM src
UNION ALL
SELECT 'has_more is a bounded EXISTS check',
       CASE WHEN s ~ 'SELECT EXISTS \(' AND s ~ '\(m\.created_at, m\.id\) < \(v_oldest_ts, v_oldest_id\)'
            THEN 'PASS' ELSE 'FAIL' END FROM src;

-- 6. Authorization boundary, comments stripped. Expect SIX rows, ALL 'PASS'.
WITH src AS (
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') AS s
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'messages_portal_get_thread_v2'
)
SELECT 'no is_staff() dependency' AS check_name,
       CASE WHEN s !~ 'is_staff\s*\(' THEN 'PASS' ELSE 'FAIL' END AS result FROM src
UNION ALL
SELECT 'no staff authorization helper',
       CASE WHEN s !~ 'is_active_owner_or_admin\s*\(|message_profile_is_active_owner_or_admin\s*\('
            THEN 'PASS' ELSE 'FAIL' END FROM src
UNION ALL
SELECT 'no email-based authorization',
       CASE WHEN s !~* 'email' THEN 'PASS' ELSE 'FAIL' END FROM src
UNION ALL
SELECT 'identity resolved via portal_profile_id()',
       CASE WHEN s ~ 'public\.portal_profile_id\(\)' THEN 'PASS' ELSE 'FAIL' END FROM src
UNION ALL
SELECT 'no direct auth.uid() equality on a profile id',
       CASE WHEN s !~ 'profile_id\s*=\s*auth\.uid\(\)' THEN 'PASS' ELSE 'FAIL' END FROM src
UNION ALL
SELECT 'inaccessible conversation returns NULL (non-enumerating)',
       CASE WHEN s ~ 'RETURN NULL;' THEN 'PASS' ELSE 'FAIL' END FROM src;

-- 7. Privacy of the return contract, comments stripped. Expect FOUR rows, ALL
--    'PASS'. The portal projection must never carry routing or delivery data.
WITH src AS (
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') AS s
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'messages_portal_get_thread_v2'
)
SELECT 'no notification delivery metadata' AS check_name,
       CASE WHEN s !~* 'message_notification_deliveries|idempotency_key|recipient_kind|recipient_email'
            THEN 'PASS' ELSE 'FAIL' END AS result FROM src
UNION ALL
SELECT 'no provider or service-role details',
       CASE WHEN s !~* 'resend|provider|service_role' THEN 'PASS' ELSE 'FAIL' END FROM src
UNION ALL
SELECT 'no staff workflow fields leaked to the student',
       CASE WHEN s !~ 'assigned_staff_profile_id|follow_up_flagged|related_cohort_id'
            THEN 'PASS' ELSE 'FAIL' END FROM src
UNION ALL
SELECT 'status is the coarse portal label',
       CASE WHEN s ~ 'public\.message_portal_status_label\(c\.status\)' THEN 'PASS' ELSE 'FAIL' END FROM src;

-- 8. GUARD: the original portal thread function must be UNCHANGED and still
--    forward-paging (that is the defect v2 replaces; v1 is kept for rollback).
--    Expect ZERO rows.
WITH src AS (
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') AS s
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'messages_portal_get_thread'
)
SELECT 'v1 portal thread was modified' AS violation
FROM src
WHERE s !~ '\(m\.created_at, m\.id\) > \(p_cursor_ts, p_cursor_id\)'
   OR s !~ 'my_message_conversation_ids\(\)';

-- 9. The v1 portal function and the staff v2 both still exist. Expect TWO rows.
SELECT p.proname AS function_name, p.prosecdef AS security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('messages_portal_get_thread', 'messages_staff_get_thread_v2')
ORDER BY p.proname;

-- 10. GUARD: the staff v2 must be untouched by this migration. Expect ZERO rows.
WITH src AS (
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') AS s
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'messages_staff_get_thread_v2'
)
SELECT 'staff v2 was modified' AS violation
FROM src
WHERE s !~ 'is_active_owner_or_admin\(\)'
   OR s !~ 'ORDER BY m\.created_at DESC, m\.id DESC';

-- 11. GUARD: no anonymous execute anywhere on the Messages portal read surface.
--     Expect ZERO rows.
SELECT p.proname AS function_name
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'messages_portal%'
  AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- 12. RLS is still enabled on every Messages table, and this migration added no
--     table and no policy. Expect SIX rows, all rls_enabled = true.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('conversations', 'conversation_participants', 'messages',
                    'staff_conversation_reads', 'participant_conversation_reads',
                    'conversation_events')
ORDER BY c.relname;

-- 13. Policy inventory is unchanged: participant_conversation_reads still has NO
--     policy (deny by default) and no portal base-table SELECT policy was added.
--     Expect ZERO rows.
SELECT pol.polname AS policy_name, c.relname AS table_name
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('participant_conversation_reads')
UNION ALL
SELECT pol.polname, c.relname
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND pol.polname LIKE '%portal%';

-- 14. The supporting index for the reverse scan exists. Expect ONE row.
--     (conversation_id, created_at) supports the backward ordered scan.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'messages'
  AND indexname = 'idx_messages_conversation_created';
