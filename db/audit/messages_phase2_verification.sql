-- ============================================================================
-- ASPIRE MESSAGES, PHASE 2 (STAGE A): READ-ONLY VERIFICATION QUERIES.
-- RUN ONLY AFTER THE MIGRATION HAS BEEN APPLIED.
-- ============================================================================
-- Companion to
-- supabase/migrations/20260716000001_messages_phase2_notification_delivery_foundation.sql.
--
-- HOW TO RUN: paste this ENTIRE file into the Supabase SQL editor and run it as
-- one block. Every statement is a SELECT against system catalogs. It changes
-- nothing and is safe to run against production at any time. The Supabase SQL
-- editor shows one result grid per statement.
--
-- Expected high-level outcome: both tables present with RLS enabled; queue and
-- provider status are separate constrained columns; event-type and
-- recipient-kind constraints correct; idempotency_key unique; retry/claim
-- fields and bounds present; the atomic claim function, the active-recipient
-- gating function, and the portal-user rate-limit function exist, are
-- SECURITY DEFINER with fixed search_path, and are EXECUTE-granted to
-- service_role only (not anon or authenticated); recipient gating uses an active
-- student grant and active student link and no related/assignment context; no
-- body/preview/snippet/content/metadata column exists anywhere; anon and
-- authenticated portal users have no access to either table; active Owner/Admin
-- have SELECT observability on deliveries only; service_role cannot DELETE or
-- TRUNCATE deliveries; no direct portal policy exists; no unexpected grants.
-- ============================================================================

-- 1. Both Phase 2 tables exist with RLS enabled. Expect two rows, rls = true.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN ('message_notification_deliveries', 'message_rate_limit_counters')
ORDER BY c.relname;

-- 2. All CHECK constraints on the two tables, with definitions. Confirm the
--    queue_status set (queued/processing/retry_wait/sent/failed/suppressed),
--    the separate provider_status set (sent/delivered/opened/clicked/bounced/
--    complained), event_type (new_conversation/portal_reply/staff_reply),
--    recipient_kind (shared_inbox/assigned_staff/portal_user), attempts bounds,
--    processing-claim, retry_wait scheduling, terminal-not-retryable, rate-limit
--    action_kind, and count non-negativity.
SELECT rel.relname AS table_name, con.conname AS constraint_name,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND con.contype IN ('c', 'u')
  AND rel.relname IN ('message_notification_deliveries', 'message_rate_limit_counters')
ORDER BY rel.relname, con.contype DESC, con.conname;

-- 3. idempotency_key carries a UNIQUE constraint. Expect one row.
SELECT con.conname AS unique_constraint
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND rel.relname = 'message_notification_deliveries'
  AND con.contype = 'u';

-- 4. Recipient identity and retry/claim fields exist on the delivery table.
--    Expect all listed columns present.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'message_notification_deliveries'
  AND column_name IN (
    'recipient_email', 'recipient_kind', 'recipient_profile_id', 'event_type',
    'idempotency_key', 'queue_status', 'provider_status', 'attempts',
    'max_attempts', 'last_attempt_at', 'next_attempt_at', 'locked_at',
    'locked_by', 'resend_email_id', 'notification_log_id', 'error_code',
    'error_detail'
  )
ORDER BY column_name;

-- 5. NO body, preview, snippet, content, or free-form metadata column exists on
--    either table. Expect ZERO rows.
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('message_notification_deliveries', 'message_rate_limit_counters')
  AND (
    column_name IN ('body', 'message_body', 'preview', 'snippet', 'content', 'metadata', 'text', 'html')
    OR column_name ~ '(body|preview|snippet|content)'
  );

-- 6. The three Phase 2 functions exist, are SECURITY DEFINER, and carry the
--    fixed search_path. Expect three rows, security_definer = true.
SELECT p.proname AS function_name, p.prosecdef AS security_definer,
       p.provolatile AS volatility, p.proconfig AS config_settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'claim_due_message_notification_deliveries',
    'message_recipient_has_active_access',
    'consume_message_rate_limit'
  )
ORDER BY p.proname;

-- 7. EXECUTE grants on the three functions. Expect service_role ONLY.
--    anon and authenticated must NOT appear.
SELECT routine_name, grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name IN (
    'claim_due_message_notification_deliveries',
    'message_recipient_has_active_access',
    'consume_message_rate_limit'
  )
ORDER BY routine_name, grantee;

-- 8. Guard: anon and authenticated hold NO EXECUTE on any of the three
--    functions. Expect ZERO rows.
SELECT p.proname AS function_name, r.rolname AS role
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN (SELECT unnest(ARRAY['anon', 'authenticated']) AS rolname) r
WHERE n.nspname = 'public'
  AND p.proname IN (
    'claim_due_message_notification_deliveries',
    'message_recipient_has_active_access',
    'consume_message_rate_limit'
  )
  AND has_function_privilege(r.rolname, p.oid, 'EXECUTE');

-- 9. Full definition of message_recipient_has_active_access(). Confirm by
--    inspection: it checks participant_role = 'student', scope_kind = 'student',
--    removed_at IS NULL, an active student role grant (revoked_at IS NULL,
--    starts_at <= now(), expires_at IS NULL OR expires_at > now()), and an
--    active user_student_links row matched to scope_student_id; and that it does
--    NOT reference related_student_id, related_unit_key, related_school_key,
--    related_cohort_id, assigned_staff_profile_id, or portal_profile_id().
SELECT pg_get_functiondef(p.oid) AS recipient_gating_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'message_recipient_has_active_access';

-- 10. Full definition of the atomic claim function. Confirm FOR UPDATE SKIP
--     LOCKED, that only queued/retry_wait due rows are claimed, and that stale
--     processing claims are recovered.
SELECT pg_get_functiondef(p.oid) AS claim_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'claim_due_message_notification_deliveries';

-- 11. Full definition of the rate-limit consume function. Confirm it keys on the
--     profile id argument, enforces the two action kinds, uses bounded window
--     and limit guardrails, and returns the 429-shaped jsonb.
SELECT pg_get_functiondef(p.oid) AS rate_limit_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'consume_message_rate_limit';

-- 12. Table privileges held by anon, authenticated, and service_role on the two
--     Phase 2 tables. Confirm: anon none; authenticated SELECT on deliveries
--     only and nothing on counters; service_role SELECT/INSERT/UPDATE on
--     deliveries (no DELETE/TRUNCATE) and SELECT/INSERT/UPDATE/DELETE on counters
--     (no TRUNCATE).
SELECT grantee, table_name,
       string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('message_notification_deliveries', 'message_rate_limit_counters')
  AND grantee IN ('anon', 'authenticated', 'service_role')
GROUP BY grantee, table_name
ORDER BY grantee, table_name;

-- 13. Guard: service_role holds NO DELETE or TRUNCATE on the delivery table, and
--     no role holds TRUNCATE on either table. Expect ZERO rows.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('message_notification_deliveries', 'message_rate_limit_counters')
  AND (
    (table_name = 'message_notification_deliveries' AND privilege_type IN ('DELETE', 'TRUNCATE'))
    OR privilege_type = 'TRUNCATE'
  );

-- 14. Guard: authenticated holds NO mutation privilege on either table, and anon
--     holds NOTHING at all. Expect ZERO rows.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('message_notification_deliveries', 'message_rate_limit_counters')
  AND (
    (grantee = 'authenticated' AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'))
    OR grantee = 'anon'
  );

-- 15. Every policy on the two tables. Confirm: exactly one policy, the
--     Owner/Admin SELECT observability policy on deliveries using
--     is_active_owner_or_admin(); no portal policy; no policy on the counters
--     table; no policy references related context or my_message_conversation_ids.
SELECT tablename, policyname, cmd, roles, qual AS using_expression, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('message_notification_deliveries', 'message_rate_limit_counters')
ORDER BY tablename, policyname;

-- 16. Required indexes exist (idempotency uniqueness, resend reconciliation, due
--     scan, stale recovery, conversation/message/recipient lookup, counter
--     window). Expect the listed indexes present.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('message_notification_deliveries', 'message_rate_limit_counters')
ORDER BY tablename, indexname;
