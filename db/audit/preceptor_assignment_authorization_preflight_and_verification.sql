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
WHERE schemaname = 'public' AND tablename IN ('preceptor_assignment_events', 'staff_notifications');

-- B3. Baseline: preceptors has no provenance columns yet. Expect ZERO rows.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'preceptors'
  AND column_name IN ('created_by', 'created_by_role');

-- B4. Dependencies exist. Expect is_active_owner_or_admin and portal_profile_id.
SELECT proname FROM pg_proc WHERE proname IN ('is_active_owner_or_admin', 'portal_profile_id') ORDER BY proname;


-- ############################################################################
-- AFTER (read-only)
-- ############################################################################

-- A1. Guard trigger exists, BEFORE UPDATE, function is SECURITY INVOKER + fixed search_path.
--     Expect prosecdef = false (INVOKER) and proconfig showing search_path.
SELECT t.tgname, p.prosecdef AS security_definer, p.proconfig AS settings
FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.students'::regclass AND t.tgname = 'trg_guard_students_preceptor_id';

-- A2. The write + claim RPCs are SECURITY DEFINER and granted to service_role only.
SELECT p.proname, p.prosecdef AS security_definer
FROM pg_proc p
WHERE p.proname IN ('assign_primary_preceptor', 'set_secondary_coverage_preceptor',
                    'create_unit_preceptor', 'claim_due_staff_notifications')
ORDER BY p.proname;

-- A2b. Grants. The write/claim RPCs: authenticated/anon = false, service_role = true. The
--      mark-read RPC is authenticated = true (called with the user's JWT), anon = false.
SELECT 'assign_primary_preceptor' AS fn,
  has_function_privilege('authenticated', 'public.assign_primary_preceptor(uuid,uuid,uuid,text,boolean,boolean,text)', 'EXECUTE') AS authenticated_can,
  has_function_privilege('service_role',  'public.assign_primary_preceptor(uuid,uuid,uuid,text,boolean,boolean,text)', 'EXECUTE') AS service_role_can;
SELECT 'mark_staff_notifications_read' AS fn,
  has_function_privilege('authenticated', 'public.mark_staff_notifications_read(uuid[])', 'EXECUTE') AS authenticated_can,
  has_function_privilege('anon',          'public.mark_staff_notifications_read(uuid[])', 'EXECUTE') AS anon_can;
-- Expect: assign authenticated=false/service_role=true; mark-read authenticated=true/anon=false.

-- A3. New tables: RLS enabled; preceptor_assignment_events has one owner/admin SELECT policy;
--     staff_notifications has one SELECT policy (own-or-admin) and NO client write policy.
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('preceptor_assignment_events', 'staff_notifications')
ORDER BY tablename, cmd;
SELECT c.relname, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('preceptor_assignment_events', 'staff_notifications');

-- A4. preceptors gained the provenance columns.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'preceptors'
  AND column_name IN ('created_by', 'created_by_role')
ORDER BY column_name;

-- A5. No RLS widened elsewhere: students / student_preceptor_assignments / preceptors / matches
--     policies unchanged. Compare to the known baseline (visual).
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('students', 'student_preceptor_assignments', 'preceptors', 'matches')
ORDER BY tablename, policyname;

-- A6. Behavioral smoke (OPTIONAL; run only in a scratch transaction and ROLLBACK):
-- BEGIN;
--   SET LOCAL ROLE authenticated;   -- auth.uid() is NULL, so is_active_owner_or_admin() = false
--   UPDATE public.students SET preceptor_id = preceptor_id WHERE id = (SELECT id FROM public.students LIMIT 1);
--   -- expect: ERROR MS403 (guarded)
-- ROLLBACK;


-- ############################################################################
-- ROLLBACK (WRITE script; run ONLY to revert). Order: trigger, functions, tables, columns.
-- ############################################################################
-- BEGIN;
--   DROP TRIGGER IF EXISTS trg_guard_students_preceptor_id ON public.students;
--   DROP FUNCTION IF EXISTS public.guard_students_preceptor_id_change();
--   DROP FUNCTION IF EXISTS public.assign_primary_preceptor(uuid, uuid, uuid, text, boolean, boolean, text);
--   DROP FUNCTION IF EXISTS public.set_secondary_coverage_preceptor(uuid, uuid, text, text, uuid, uuid, text, text, boolean, boolean, text);
--   DROP FUNCTION IF EXISTS public.create_unit_preceptor(uuid, text, text, text, text, text, text);
--   DROP FUNCTION IF EXISTS public._preceptor_assert_actor_for_student(uuid, uuid, text, boolean, boolean);
--   DROP FUNCTION IF EXISTS public._emit_staff_notifications(text, text, uuid, text, text, uuid, uuid, text, text, text, text, text, boolean, text);
--   DROP FUNCTION IF EXISTS public.claim_due_staff_notifications(text, integer, integer);
--   DROP FUNCTION IF EXISTS public.mark_staff_notifications_read(uuid[]);
--   DROP TABLE IF EXISTS public.staff_notifications;
--   DROP TABLE IF EXISTS public.preceptor_assignment_events;
--   ALTER TABLE public.preceptors DROP COLUMN IF EXISTS created_by_role;
--   ALTER TABLE public.preceptors DROP COLUMN IF EXISTS created_by;
-- COMMIT;
-- NOTE: dropping the guard REOPENS the broad students UPDATE RLS path. Also stop the
-- staff-notification-worker cron before rollback so it does not query a dropped table.
