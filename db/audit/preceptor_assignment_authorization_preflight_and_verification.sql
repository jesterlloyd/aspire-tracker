-- ============================================================================
-- PHASE 2C PREFLIGHT + VERIFICATION + ROLLBACK for
--   supabase/migrations/20260723000000_preceptor_assignment_authorization.sql
-- ============================================================================
-- Run BEFORE (read-only) then apply the migration, then run AFTER (read-only). The ROLLBACK
-- block is a WRITE script. Run as the service role or an owner/admin. Phase 2B must be applied
-- first (this migration's RPCs rely on the 2B sync trigger).
-- ============================================================================


-- ############################################################################
-- BEFORE (read-only)
-- ############################################################################

-- B1. Phase 2B dependency present (the sync trigger must already exist). Expect ONE row.
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.students'::regclass AND tgname = 'trg_sync_primary_preceptor_mirror';

-- B2. The 2C guard/objects do NOT yet exist. Expect ZERO rows each.
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.students'::regclass AND tgname = 'trg_guard_students_preceptor_id';
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('preceptor_assignment_events', 'staff_notification_queue');

-- B3. Baseline: preceptors has no provenance columns yet. Expect ZERO rows.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'preceptors'
  AND column_name IN ('created_by', 'created_by_role');

-- B4. Confirm the helper functions this migration depends on exist. Expect is_active_owner_or_admin.
SELECT proname FROM pg_proc WHERE proname = 'is_active_owner_or_admin';


-- ############################################################################
-- AFTER (read-only)
-- ############################################################################

-- A1. The guard trigger exists, is BEFORE UPDATE, and its function is SECURITY INVOKER with a
--     fixed search_path. Expect prosecdef = false (INVOKER) and proconfig showing search_path.
SELECT t.tgname, t.tgtype, p.prosecdef AS security_definer, p.proconfig AS settings
FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.students'::regclass AND t.tgname = 'trg_guard_students_preceptor_id';

-- A2. The three RPCs are SECURITY DEFINER, and EXECUTE is granted to service_role only (never
--     to anon/authenticated/public). Expect prosecdef = true for each.
SELECT p.proname, p.prosecdef AS security_definer, p.proconfig AS settings
FROM pg_proc p
WHERE p.proname IN ('assign_primary_preceptor', 'set_secondary_coverage_preceptor', 'create_unit_preceptor')
ORDER BY p.proname;

-- A2b. Grants: PUBLIC/anon/authenticated must NOT be able to execute the RPCs; service_role must.
SELECT 'assign_primary_preceptor' AS fn,
  has_function_privilege('authenticated', 'public.assign_primary_preceptor(uuid,uuid,uuid,text,text,text)', 'EXECUTE') AS authenticated_can,
  has_function_privilege('anon',          'public.assign_primary_preceptor(uuid,uuid,uuid,text,text,text)', 'EXECUTE') AS anon_can,
  has_function_privilege('service_role',  'public.assign_primary_preceptor(uuid,uuid,uuid,text,text,text)', 'EXECUTE') AS service_role_can;
-- Expect: authenticated_can = false, anon_can = false, service_role_can = true.

-- A3. New tables exist with RLS enabled and exactly one owner/admin SELECT policy each; NO write
--     policy. Expect two 'SELECT' policies, none for INSERT/UPDATE/DELETE/ALL.
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('preceptor_assignment_events', 'staff_notification_queue')
ORDER BY tablename, cmd;

SELECT c.relname, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('preceptor_assignment_events', 'staff_notification_queue');

-- A4. preceptors gained the provenance columns. Expect two rows (both nullable text/uuid).
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'preceptors'
  AND column_name IN ('created_by', 'created_by_role')
ORDER BY column_name;

-- A5. No RLS was widened elsewhere: the students / student_preceptor_assignments / preceptors /
--     matches write policies are unchanged. Compare to the known baseline (visual).
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('students', 'student_preceptor_assignments', 'preceptors', 'matches')
ORDER BY tablename, policyname;

-- A6. Behavioral smoke (OPTIONAL, run only in a scratch transaction and ROLLBACK): a direct
--     UPDATE of students.preceptor_id as a non-owner/admin must fail with MS403. Do NOT run in
--     production without a wrapping ROLLBACK.
-- BEGIN;
--   SET LOCAL ROLE authenticated;   -- simulate a client (auth.uid() will be NULL, so is_active_owner_or_admin() = false)
--   UPDATE public.students SET preceptor_id = preceptor_id WHERE id = (SELECT id FROM public.students LIMIT 1);
--   -- expect: ERROR MS403 (guarded)
-- ROLLBACK;


-- ############################################################################
-- ROLLBACK (WRITE script; run ONLY to revert). Order: triggers, functions, tables, columns.
-- ############################################################################
-- BEGIN;
--   DROP TRIGGER IF EXISTS trg_guard_students_preceptor_id ON public.students;
--   DROP FUNCTION IF EXISTS public.guard_students_preceptor_id_change();
--   DROP FUNCTION IF EXISTS public.assign_primary_preceptor(uuid, uuid, uuid, text, text, text);
--   DROP FUNCTION IF EXISTS public.set_secondary_coverage_preceptor(uuid, uuid, text, text, uuid, uuid, text, text, text, text);
--   DROP FUNCTION IF EXISTS public.create_unit_preceptor(uuid, text, text, text, text, text, text, text);
--   DROP FUNCTION IF EXISTS public._preceptor_assert_actor_for_student(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public._enqueue_staff_notification(text, text, uuid, text, jsonb, text);
--   -- Audit + queue rows are history. Drop the tables only if a full revert is intended:
--   DROP TABLE IF EXISTS public.staff_notification_queue;
--   DROP TABLE IF EXISTS public.preceptor_assignment_events;
--   ALTER TABLE public.preceptors DROP COLUMN IF EXISTS created_by_role;
--   ALTER TABLE public.preceptors DROP COLUMN IF EXISTS created_by;
-- COMMIT;
--
-- NOTE: dropping the guard REOPENS the broad students UPDATE RLS path. If reverting 2C, either
-- keep the guard or re-verify that no untrusted role can change students.preceptor_id.
