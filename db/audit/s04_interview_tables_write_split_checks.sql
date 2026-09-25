-- Checks for supabase/migrations/20261004000000_s04_interview_tables_write_split.sql
-- READ ONLY. Nothing here creates, alters, writes or deletes anything. No names or
-- emails are selected; only catalog facts.
--
-- Run each numbered section on its own in the Supabase SQL editor, in this order:
--   PRE 1 to 3, then the migration as ONE block, then POST 1 to 4.
-- Do NOT run the migration until the application commit S04-1 is live in production
-- (interviewers' self-service writes go through the endpoint from that commit; before it
-- they are browser writes this migration would silently refuse).

-- ── PRE 1: every policy on the three tables today ────────────────────────────
-- Expect exactly 3 rows, one per table: staff_all_availability_blocks,
-- staff_all_interview_slots, staff_all_interview_sessions, each cmd ALL, roles
-- {authenticated}, qual (public.is_staff()). Any OTHER row is a policy the migration
-- leaves alone; note it, and STOP if it grants a write to anon (that is a different
-- finding, not this one).
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('interview_availability_blocks', 'interview_slots', 'interview_sessions')
ORDER BY tablename, policyname;

-- ── PRE 2: the two predicates the new policies call ──────────────────────────
-- Expect 2 rows: is_staff and is_active_staff_writer, both security_definer true.
-- STOP if either is missing.
SELECT p.proname, p.prosecdef AS security_definer, p.proconfig AS search_path
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('is_staff', 'is_active_staff_writer')
ORDER BY p.proname;

-- ── PRE 3: RLS is on, and what a browser role may do at the table level ──────
-- Expect 3 rows: rls_enabled true; authenticated_update true (the table grant; the
-- policies are what narrow it). This is the baseline POST 4 compares against.
SELECT c.relname AS tablename,
       c.relrowsecurity AS rls_enabled,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
       has_table_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_update,
       has_table_privilege('anon',          c.oid, 'UPDATE') AS anon_update
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('interview_availability_blocks', 'interview_slots', 'interview_sessions')
ORDER BY c.relname;

-- ═════════════════════════════════════════════════════════════════════════════
-- APPLY supabase/migrations/20261004000000_s04_interview_tables_write_split.sql
-- as ONE block. Expected: "Success. No rows returned." and three NOTICE lines
-- "S-04: split write policies on public.<table>".
-- ═════════════════════════════════════════════════════════════════════════════

-- ── POST 1: four policies per table, in the split shape ──────────────────────
-- Expect 12 rows (plus any extra row PRE 1 showed, unchanged). Per table:
--   <table>_staff_select   SELECT  qual (public.is_staff())
--   <table>_writer_insert  INSERT  with_check (public.is_active_staff_writer())
--   <table>_writer_update  UPDATE  qual and with_check (public.is_active_staff_writer())
--   <table>_writer_delete  DELETE  qual (public.is_active_staff_writer())
-- STOP if any staff_all_* row remains.
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('interview_availability_blocks', 'interview_slots', 'interview_sessions')
ORDER BY tablename, policyname;

-- ── POST 2: no write on the three tables is gated on is_staff() any more ─────
-- Expect: no rows. A row is a write policy still open to every staff role.
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('interview_availability_blocks', 'interview_slots', 'interview_sessions')
  AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  AND (coalesce(qual, '') ~ 'is_staff\(\)' OR coalesce(with_check, '') ~ 'is_staff\(\)');

-- ── POST 3: every write policy names the active-writer predicate ─────────────
-- Expect: writes 9, writer_gated 9 (three tables, three write commands each).
SELECT count(*) AS writes,
       count(*) FILTER (WHERE coalesce(with_check, qual, '') ~ 'is_active_staff_writer\(\)'
                          AND coalesce(qual, with_check, '') ~ 'is_active_staff_writer\(\)') AS writer_gated
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('interview_availability_blocks', 'interview_slots', 'interview_sessions')
  AND cmd IN ('INSERT', 'UPDATE', 'DELETE');

-- ── POST 4: RLS still on, table grants unchanged ─────────────────────────────
-- Expect: the same 3 rows PRE 3 returned. The migration changes policies only.
SELECT c.relname AS tablename,
       c.relrowsecurity AS rls_enabled,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
       has_table_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_update,
       has_table_privilege('anon',          c.oid, 'UPDATE') AS anon_update
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('interview_availability_blocks', 'interview_slots', 'interview_sessions')
ORDER BY c.relname;
