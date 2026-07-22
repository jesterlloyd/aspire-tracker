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
WHERE schemaname = 'public' AND tablename IN ('preceptor_assignment_events', 'staff_notifications', 'preceptor_assignment_requests');

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

-- A2b. Intended RPC grants. Expect PUBLIC=false, anon=false, service_role=true for every row;
--      authenticated=true only for mark_staff_notifications_read and false for all other rows.
WITH expected(fn, signature, authenticated_should) AS (VALUES
  ('assign_primary_preceptor',          'public.assign_primary_preceptor(uuid,uuid,uuid,text,boolean,boolean,text)', false),
  ('set_secondary_coverage_preceptor',  'public.set_secondary_coverage_preceptor(uuid,uuid,text,text,uuid,uuid,text,text,boolean,boolean,text)', false),
  ('create_unit_preceptor',             'public.create_unit_preceptor(uuid,text,text,text,text,text,text)', false),
  ('claim_due_staff_notifications',     'public.claim_due_staff_notifications(text,integer,integer)', false),
  ('mark_staff_notifications_read',     'public.mark_staff_notifications_read(uuid[])', true)
)
SELECT e.fn,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) AS public_can,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can,
  e.authenticated_should,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can
FROM expected e
JOIN pg_proc p ON p.oid = to_regprocedure(e.signature)
ORDER BY e.fn;

-- A2c. Internal functions are never client-callable. Expect five rows with public_can=false,
--      anon_can=false, and authenticated_can=false.
WITH internal(signature) AS (VALUES
  ('public.guard_students_preceptor_id_change()'),
  ('public._preceptor_assert_actor_for_student(uuid,uuid,text,boolean,boolean)'),
  ('public._preceptor_begin_request(text,uuid,text,text)'),
  ('public._preceptor_finish_request(text,jsonb)'),
  ('public._emit_staff_notifications(text,text,uuid,text,text,uuid,uuid,text,text,text,text,text,boolean,text)')
)
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) AS public_can,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can
FROM internal i
JOIN pg_proc p ON p.oid = to_regprocedure(i.signature)
ORDER BY p.proname;

-- A3. New tables: RLS enabled; preceptor_assignment_events has one owner/admin SELECT policy;
--     staff_notifications has one SELECT policy (own-or-admin) and NO client write policy.
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('preceptor_assignment_events', 'staff_notifications', 'preceptor_assignment_requests')
ORDER BY tablename, cmd;
SELECT c.relname, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('preceptor_assignment_events', 'staff_notifications', 'preceptor_assignment_requests');

-- A3b. Exact table-level privileges. Expect for each of the three tables:
--      PUBLIC SELECT/INSERT/UPDATE/DELETE=false; anon SELECT/INSERT/UPDATE/DELETE=false;
--      authenticated SELECT=true and INSERT/UPDATE/DELETE=false;
--      service_role SELECT/INSERT/UPDATE/DELETE=true.
WITH target AS (
  SELECT c.oid, c.relname, c.relacl, c.relowner
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('preceptor_assignment_events', 'staff_notifications', 'preceptor_assignment_requests')
)
SELECT t.relname,
  EXISTS (SELECT 1 FROM aclexplode(COALESCE(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'SELECT') AS public_select,
  EXISTS (SELECT 1 FROM aclexplode(COALESCE(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'INSERT') AS public_insert,
  EXISTS (SELECT 1 FROM aclexplode(COALESCE(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'UPDATE') AS public_update,
  EXISTS (SELECT 1 FROM aclexplode(COALESCE(t.relacl, acldefault('r', t.relowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'DELETE') AS public_delete,
  has_table_privilege('anon', t.oid, 'SELECT') AS anon_select,
  has_table_privilege('anon', t.oid, 'INSERT') AS anon_insert,
  has_table_privilege('anon', t.oid, 'UPDATE') AS anon_update,
  has_table_privilege('anon', t.oid, 'DELETE') AS anon_delete,
  has_table_privilege('authenticated', t.oid, 'SELECT') AS authenticated_select,
  has_table_privilege('authenticated', t.oid, 'INSERT') AS authenticated_insert,
  has_table_privilege('authenticated', t.oid, 'UPDATE') AS authenticated_update,
  has_table_privilege('authenticated', t.oid, 'DELETE') AS authenticated_delete,
  has_table_privilege('service_role', t.oid, 'SELECT') AS service_role_select,
  has_table_privilege('service_role', t.oid, 'INSERT') AS service_role_insert,
  has_table_privilege('service_role', t.oid, 'UPDATE') AS service_role_update,
  has_table_privilege('service_role', t.oid, 'DELETE') AS service_role_delete
FROM target t
ORDER BY t.relname;

-- A3c. Policies remain SELECT-only. Expect non_select_policy_count=0.
SELECT count(*) FILTER (WHERE cmd <> 'SELECT') AS non_select_policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('preceptor_assignment_events', 'staff_notifications', 'preceptor_assignment_requests');

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

-- A8. Preceptor email uniqueness (the guarantee create_unit_preceptor's dedup relies on). Expect
--     ONE row: a UNIQUE, PARTIAL index on a normalized email expression (lower(trim(email))),
--     matching the RPC's lower(btrim(email)). If this returns ZERO rows, STOP and run
--     db/audit/preceptor_email_uniqueness_preflight.sql before enabling Unit Leader preceptor
--     creation (concurrent duplicate creation would otherwise be possible).
SELECT i.relname AS index_name,
       ix.indisunique AS is_unique,
       (ix.indpred IS NOT NULL) AS is_partial,
       pg_get_indexdef(ix.indexrelid) AS definition
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public' AND t.relname = 'preceptors'
  AND ix.indisunique
  AND pg_get_indexdef(ix.indexrelid) ILIKE '%lower(%trim%(email%';
-- Expect: preceptors_email_lower_unique_idx | t | t | ...lower(trim(email))...WHERE...

-- A9. Idempotency ledger present: RLS enabled, ONE owner/admin SELECT policy, NO client write
--     policy; and the two internal helpers exist but are NOT executable by anon/authenticated.
SELECT has_table_privilege('authenticated', 'public.preceptor_assignment_requests', 'INSERT') AS authenticated_insert; -- expect false
SELECT p.proname, p.prosecdef AS security_definer,
  has_function_privilege('authenticated', 'public._preceptor_begin_request(text,uuid,text,text)', 'EXECUTE') AS begin_authenticated_can,
  has_function_privilege('authenticated', 'public._preceptor_finish_request(text,jsonb)', 'EXECUTE')          AS finish_authenticated_can
FROM pg_proc p WHERE p.proname IN ('_preceptor_begin_request', '_preceptor_finish_request')
ORDER BY p.proname;
-- Expect: authenticated_insert=false; both helpers prosecdef=true; begin/finish authenticated_can=false.

-- A10. Fingerprint coverage in the deployed write RPC definitions. Expect common_keys=true and
--      delimiter_fingerprint_absent=true on all three rows; assignment_keys=true for the two
--      assignment RPCs; creation_keys=true for create_unit_preceptor. Non-applicable columns are NULL.
SELECT p.proname,
  (position('jsonb_build_object' IN p.prosrc) > 0
   AND position('actor_profile_id' IN p.prosrc) > 0
   AND position('''rpc''' IN p.prosrc) > 0
   AND position('''action''' IN p.prosrc) > 0) AS common_keys,
  CASE WHEN p.proname IN ('assign_primary_preceptor', 'set_secondary_coverage_preceptor') THEN
    position('student_id' IN p.prosrc) > 0
    AND position('assignment_id' IN p.prosrc) > 0
    AND position('preceptor_id' IN p.prosrc) > 0
    AND position('''role''' IN p.prosrc) > 0
    AND position('''reason''' IN p.prosrc) > 0
    AND position('''notes''' IN p.prosrc) > 0
    AND position('''force''' IN p.prosrc) > 0
    AND position('confirm_override' IN p.prosrc) > 0
  END AS assignment_keys,
  CASE WHEN p.proname = 'create_unit_preceptor' THEN
    position('full_name' IN p.prosrc) > 0
    AND position('''email''' IN p.prosrc) > 0
    AND position('unit_key' IN p.prosrc) > 0
    AND position('''shift''' IN p.prosrc) > 0
    AND position('''phone''' IN p.prosrc) > 0
  END AS creation_keys,
  (position('concat_ws(' IN p.prosrc) = 0) AS delimiter_fingerprint_absent
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('assign_primary_preceptor', 'set_secondary_coverage_preceptor', 'create_unit_preceptor')
ORDER BY p.proname;

-- A6. Guard smoke test (REAL; scratch transaction; ROLLBACK). Picks a student and a DIFFERENT
--     active preceptor than the student's current primary, then attempts an UNAUTHORIZED direct
--     client UPDATE as role authenticated (auth.uid() is NULL, so is_active_owner_or_admin() is
--     false and no per-row marker is set). Because the target preceptor DIFFERS from the current
--     one, the guard's change-detection fires and MUST raise MS403. Uses a genuinely different
--     preceptor id (not the no-op self-assignment). ROLL BACK regardless.
-- BEGIN;
--   SET LOCAL ROLE authenticated;
--   WITH tgt AS (
--     SELECT s.id AS student_id,
--            (SELECT p.id FROM public.preceptors p
--               WHERE p.is_active IS TRUE AND p.id IS DISTINCT FROM s.preceptor_id
--               ORDER BY p.id LIMIT 1) AS other_preceptor
--     FROM public.students s
--     WHERE EXISTS (SELECT 1 FROM public.preceptors p2
--                   WHERE p2.is_active IS TRUE AND p2.id IS DISTINCT FROM s.preceptor_id)
--     ORDER BY s.id LIMIT 1
--   )
--   UPDATE public.students s SET preceptor_id = t.other_preceptor
--   FROM tgt t WHERE s.id = t.student_id;
--   -- EXPECT: ERROR 'preceptor_id may only be changed ...' USING ERRCODE = 'MS403'
-- ROLLBACK;
-- Fixture note: if the dataset has no active preceptor distinct from a chosen student's current
-- primary, substitute a known student id and any active preceptor id that is not currently their
-- primary; the assertion (MS403) is unchanged.


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
--   DROP FUNCTION IF EXISTS public._preceptor_begin_request(text, uuid, text, text);
--   DROP FUNCTION IF EXISTS public._preceptor_finish_request(text, jsonb);
--   DROP FUNCTION IF EXISTS public._emit_staff_notifications(text, text, uuid, text, text, uuid, uuid, text, text, text, text, text, boolean, text);
--   DROP FUNCTION IF EXISTS public.claim_due_staff_notifications(text, integer, integer);
--   DROP FUNCTION IF EXISTS public.mark_staff_notifications_read(uuid[]);
--   DROP TABLE IF EXISTS public.staff_notifications;
--   DROP TABLE IF EXISTS public.preceptor_assignment_requests;
--   DROP TABLE IF EXISTS public.preceptor_assignment_events;
--   ALTER TABLE public.preceptors DROP COLUMN IF EXISTS created_by_role;
--   ALTER TABLE public.preceptors DROP COLUMN IF EXISTS created_by;
-- COMMIT;
-- NOTE: dropping the guard REOPENS the broad students UPDATE RLS path. Also stop the
-- staff-notification-worker cron before rollback so it does not query a dropped table.
