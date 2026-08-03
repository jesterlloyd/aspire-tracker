-- ============================================================================
-- PHASE 2D PREFLIGHT for
--   supabase/migrations/20260803000000_phase2d_clear_primary_preceptor.sql
-- ============================================================================
-- READ-ONLY. Every statement is a SELECT. Run as the service role or an
-- owner/admin in the Supabase SQL editor BEFORE applying the 2D migration.
-- The migration's PRECHECK block re-asserts P1-P5 transactionally and aborts
-- the apply on drift; this file lets you see the live state first and records
-- the definitions the migration depends on.
-- ============================================================================

-- P1. The events action CHECK the migration replaces. EXPECT: exactly the nine
--     known actions (assign_primary, add_secondary, add_coverage,
--     replace_secondary, replace_coverage, end_secondary, end_coverage,
--     create_preceptor, matches_anomaly) and NOT clear_primary. If the live
--     list differs, STOP and reconcile before applying.
SELECT conname, pg_get_constraintdef(oid) AS live_definition
FROM pg_constraint
WHERE conrelid = 'public.preceptor_assignment_events'::regclass
  AND conname = 'preceptor_assignment_events_action_check';

-- P1b. The parsed action list, sorted, for an exact eyeball-free comparison.
SELECT ARRAY(
  SELECT DISTINCT (regexp_matches(pg_get_constraintdef(oid), '''([a-z_]+)''', 'g'))[1] ORDER BY 1
) AS live_actions_sorted
FROM pg_constraint
WHERE conrelid = 'public.preceptor_assignment_events'::regclass
  AND conname = 'preceptor_assignment_events_action_check';

-- P2. The actor-assertion helper: exactly one overload, and its definition
--     contains the exact role literal 'owner_admin' the clear RPC gates on
--     (and 'unit_leader', the value it must reject).
SELECT p.proname, p.pronargs,
       position('''owner_admin''' IN pg_get_functiondef(p.oid)) > 0  AS has_owner_admin_literal,
       position('''unit_leader''' IN pg_get_functiondef(p.oid)) > 0  AS has_unit_leader_literal
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = '_preceptor_assert_actor_for_student';

-- P3. Request-idempotency helpers exist and begin_request enforces a nonblank
--     request id (expect both rows; enforces_nonblank_request true).
SELECT p.proname,
       position('a request id is required' IN pg_get_functiondef(p.oid)) > 0 AS enforces_nonblank_request
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('_preceptor_begin_request', '_preceptor_finish_request')
ORDER BY p.proname;

-- P4. The two triggers the clear path relies on, both enabled ('O') on
--     public.students: the 2C BEFORE guard and the 2B AFTER mirror sync.
--     Also confirm the 2B function still contains its NULL clear branch.
SELECT t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) AS live_definition
FROM pg_trigger t
WHERE t.tgrelid = 'public.students'::regclass
  AND t.tgname IN ('trg_guard_students_preceptor_id', 'trg_sync_primary_preceptor_mirror')
ORDER BY t.tgname;

SELECT position('Primary CLEARED for the current cohort' IN pg_get_functiondef(p.oid)) > 0
         AS sync_fn_has_clear_branch
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'sync_primary_preceptor_mirror';

-- P5. The notification fan-out helper and its table: helper exists; the
--     staff_notifications columns the clear writes through it all exist.
SELECT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_emit_staff_notifications'
) AS emit_helper_exists;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'staff_notifications'
  AND column_name IN ('correlation_id', 'recipient_profile_id', 'recipient_email', 'event_type',
                      'actor_profile_id', 'actor_name', 'actor_role', 'student_id', 'preceptor_id',
                      'unit_key', 'assignment_role', 'old_value', 'new_value', 'reason',
                      'was_override', 'subject', 'dest_url', 'queue_status', 'next_attempt_at')
ORDER BY column_name;   -- expect all 19

-- P6. The audit-event columns the clear writes (expect all 15).
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'preceptor_assignment_events'
  AND column_name IN ('actor_profile_id', 'actor_role', 'action', 'student_id', 'preceptor_id',
                      'cohort_id', 'unit_key', 'assignment_role', 'old_value', 'new_value',
                      'reason', 'was_override', 'correlation_id', 'request_id', 'metadata')
ORDER BY column_name;

-- P7. The idempotency ledger the request claim uses (expect request_id PK plus
--     actor_profile_id, rpc, fingerprint, result).
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'preceptor_assignment_requests'
ORDER BY ordinal_position;

-- P8. No function named clear_primary_preceptor exists yet (expect zero rows;
--     a row here means a prior partial apply or a name collision to reconcile).
SELECT p.proname, p.pronargs
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'clear_primary_preceptor';

-- P9. Grant baseline of the three existing preceptor RPCs, for the V3
--     after-comparison (expect can_authenticated false, can_service true).
SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS can_authenticated,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS can_anon,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS can_service
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('assign_primary_preceptor', 'set_secondary_coverage_preceptor', 'create_unit_preceptor')
ORDER BY p.proname;
