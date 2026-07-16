-- ============================================================================
-- ASPIRE MESSAGES, PHASE 1: READ-ONLY VERIFICATION QUERIES.
-- RUN ONLY AFTER THE MIGRATION HAS BEEN APPLIED.
-- ============================================================================
-- Companion to supabase/migrations/20260716000000_messages_phase1_schema_foundation.sql.
--
-- HOW TO RUN: paste this ENTIRE file into the Supabase SQL editor and run it as
-- one block. Every statement is a SELECT against system catalogs. It changes
-- nothing, takes no locks of consequence, and is safe to run against production
-- at any time. The Supabase SQL editor shows one result grid per statement; use
-- the result tabs, or run sections one at a time. Both are safe.
--
-- Expected high-level outcome: all six tables present with RLS enabled; the two
-- helpers SECURITY DEFINER with a fixed search_path and EXECUTE granted to
-- authenticated and service_role only; every documented CHECK constraint
-- present; authenticated holds SELECT only (no write) on Messages tables;
-- service_role cannot UPDATE/DELETE/TRUNCATE messages or conversation_events and
-- cannot DELETE/TRUNCATE conversations; anon holds no privilege; only active
-- Owner/Admin staff SELECT policies exist; no policy or helper references
-- related student, unit, school, or cohort context; is_staff() appears nowhere.
-- ============================================================================

-- 1. All six Messages tables exist, and RLS is enabled on each.
--    Expect exactly six rows, rls_enabled = true for all.
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'conversations', 'conversation_participants', 'messages',
    'staff_conversation_reads', 'participant_conversation_reads',
    'conversation_events'
  )
ORDER BY c.relname;

-- 2. Every CHECK constraint on the Messages tables, with its definition.
--    Confirm: subject trimmed + length 3..120; category value set; status
--    open/waiting/resolved; created_by_role and participant/author role sets;
--    scope-kind and role-to-scope shape; body non-blank and <= 5000;
--    follow-up and resolved consistency; event_type value set.
SELECT
  rel.relname AS table_name,
  con.conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public'
  AND con.contype = 'c'
  AND rel.relname IN (
    'conversations', 'conversation_participants', 'messages',
    'conversation_events'
  )
ORDER BY rel.relname, con.conname;

-- 3. related_cohort_id (and the other related_* metadata columns) exist on
--    conversations as nullable context metadata. Expect four related_* columns.
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'conversations'
  AND column_name IN ('related_student_id', 'related_unit_key', 'related_school_key', 'related_cohort_id')
ORDER BY column_name;

-- 4. The messages table has NO edit, delete, or system columns.
--    Expect ZERO rows.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'messages'
  AND column_name IN ('edited_at', 'deleted_at', 'is_system', 'deleted', 'edited');

-- 5. Both helpers are SECURITY DEFINER (prosecdef = true), STABLE, and carry a
--    fixed search_path = public, pg_catalog. Expect two rows, both true.
SELECT
  p.proname AS function_name,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,           -- 's' = STABLE
  p.proconfig AS config_settings          -- expect {search_path=public, pg_catalog}
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('is_active_owner_or_admin', 'my_message_conversation_ids')
ORDER BY p.proname;

-- 6. EXECUTE grants on both helpers. Expect authenticated and service_role only.
--    anon and PUBLIC must NOT appear.
SELECT
  routine_name,
  grantee,
  privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name IN ('is_active_owner_or_admin', 'my_message_conversation_ids')
ORDER BY routine_name, grantee;

-- 7. Confirm anon and PUBLIC hold NO EXECUTE on either helper. Expect ZERO rows.
SELECT
  'anon has execute on ' || p.proname AS finding
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('is_active_owner_or_admin', 'my_message_conversation_ids')
  AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- 8. Full definition of my_message_conversation_ids(). Confirm by inspection:
--    participant_role = 'student' and scope_kind = 'student' only; the canonical
--    active predicate (revoked_at IS NULL, starts_at <= now(), expires_at IS
--    NULL OR expires_at > now()) on the student role grant; an active student
--    link (revoked_at IS NULL) matched to scope_student_id; NO branch for
--    unit_leader, academic_partner, or preceptor; and no reference to a
--    conversation's related_* columns or to assigned staff.
SELECT pg_get_functiondef(p.oid) AS my_message_conversation_ids_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'my_message_conversation_ids';

-- 9. Full definition of is_active_owner_or_admin(). Confirm role IN
--    ('owner','admin'), COALESCE(is_active, true) = true, and NO call to
--    is_staff().
SELECT pg_get_functiondef(p.oid) AS is_active_owner_or_admin_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'is_active_owner_or_admin';

-- 10. Every policy on the six Messages tables, with its USING and WITH CHECK.
--     Confirm: only active-Owner/Admin SELECT policies (plus the staff self
--     read-pointer policy); no INSERT/UPDATE/DELETE policy; no portal base-table
--     SELECT policy; NO reference to is_staff(); NO reference to
--     related_student_id / related_unit_key / related_school_key /
--     related_cohort_id; participant_conversation_reads has NO policy.
SELECT
  tablename,
  policyname,
  cmd,
  roles,
  qual AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'conversations', 'conversation_participants', 'messages',
    'staff_conversation_reads', 'participant_conversation_reads',
    'conversation_events'
  )
ORDER BY tablename, policyname;

-- 11. Guard: no Messages policy references is_staff() or related_* context.
--     Expect ZERO rows.
SELECT tablename, policyname, 'references forbidden token' AS finding
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'conversations', 'conversation_participants', 'messages',
    'staff_conversation_reads', 'participant_conversation_reads',
    'conversation_events'
  )
  AND (
    COALESCE(qual, '')       ~ '(is_staff|related_student_id|related_unit_key|related_school_key|related_cohort_id)'
    OR COALESCE(with_check, '') ~ '(is_staff|related_student_id|related_unit_key|related_school_key|related_cohort_id)'
  );

-- 12. Table privileges held by anon, authenticated, and service_role on the six
--     Messages tables. Confirm: anon has none; authenticated has SELECT only;
--     service_role has SELECT/INSERT/UPDATE on conversations, participants, and
--     both read tables, and SELECT/INSERT only on messages and
--     conversation_events; no grantee holds DELETE or TRUNCATE.
SELECT
  grantee,
  table_name,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'conversations', 'conversation_participants', 'messages',
    'staff_conversation_reads', 'participant_conversation_reads',
    'conversation_events'
  )
  AND grantee IN ('anon', 'authenticated', 'service_role')
GROUP BY grantee, table_name
ORDER BY grantee, table_name;

-- 13. Guard: authenticated holds NO mutation privilege on any Messages table.
--     Expect ZERO rows.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'authenticated'
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  AND table_name IN (
    'conversations', 'conversation_participants', 'messages',
    'staff_conversation_reads', 'participant_conversation_reads',
    'conversation_events'
  );

-- 14. Guard: service_role holds NO DELETE/TRUNCATE on any Messages table, and NO
--     UPDATE on the append-only messages/conversation_events tables.
--     Expect ZERO rows.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'service_role'
  AND table_name IN (
    'conversations', 'conversation_participants', 'messages',
    'staff_conversation_reads', 'participant_conversation_reads',
    'conversation_events'
  )
  AND (
    privilege_type IN ('DELETE', 'TRUNCATE')
    OR (table_name IN ('messages', 'conversation_events') AND privilege_type = 'UPDATE')
  );

-- 15. Guard: anon holds NO privilege at all on any Messages table.
--     Expect ZERO rows.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'anon'
  AND table_name IN (
    'conversations', 'conversation_participants', 'messages',
    'staff_conversation_reads', 'participant_conversation_reads',
    'conversation_events'
  );

-- 16. The active-participant partial unique index exists on
--     conversation_participants (removed_at IS NULL). Expect one row.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'conversation_participants'
  AND indexname = 'uq_conversation_participants_active';
