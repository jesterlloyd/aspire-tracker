-- ============================================================================
-- PROGRAM_EVENTS RLS LOCKDOWN: PRECHECK AND VERIFICATION
--   SQL companion to
--   supabase/migrations/20260805000002_program_events_rls_lockdown.sql
-- ============================================================================
-- READ-ONLY. Every statement is a SELECT; this file writes nothing, creates
-- nothing, and drops nothing. Run as the service role or an owner/admin in the
-- Supabase SQL editor, one query at a time, and keep the output.
--
-- WHY: public.program_events is the APPEND-ONLY audit and milestone trail. It is
-- the only database trace of Keith tool calls (event_type = 'keith_tool_call',
-- written by api/keith.js) and it carries every program milestone. Before the
-- lockdown, role `anon` (the key embedded in the public browser bundle) held full
-- SELECT/INSERT/UPDATE/DELETE on it, and `authenticated` held FOR ALL true/true.
-- Finding R6 in docs/product/KEITH_SKILLS_KNOWLEDGE_VAULT_PLAN.md, decision D12.
--
-- HOW TO USE
--   Section 1 (PRECHECK)     : run BEFORE applying the migration. Record the
--                              policy inventory, the grants, and the row counts.
--                              STOP and decide separately if query 1.1 lists a
--                              policy the migration header does not account for.
--   Section 2 (VERIFICATION) : run AFTER applying. Every query states its PASS
--                              condition. Any other result means STOP.
--   Section 3 (EVIDENCE)     : run after the live staff smoke test, to prove the
--                              preserved write paths still land rows.
--
-- INTENDED POST-LOCKDOWN POSTURE
--   anon          : no policy, no grant.
--   authenticated : staff only (public.is_staff()), SELECT + INSERT only, and
--                   never for event_type = 'keith_tool_call'.
--   service_role  : unchanged full access (and it bypasses RLS anyway).
--   No UPDATE policy and no DELETE policy exists for any client role.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 1. PRECHECK (run BEFORE applying)
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1 CURRENT POLICY INVENTORY. This is the set the migration will snapshot into
--     public.program_events_rls_policy_backup and then drop. Expect to see some
--     subset of: the four "Anon * access on program_events" policies, "Service
--     role full access on program_events", "authenticated_all_program_events" or
--     its dashboard-created twin "Authenticated full access on program_events",
--     and (if Phase 0B Wave E was applied) "staff_all_program_events".
--     STOP and review separately if any OTHER policy appears here: the migration
--     drops every policy on this table by enumeration, deliberately, because
--     name-based drops silently no-opped in Wave E (see Wave E-2's root cause).
SELECT
  policyname,
  cmd,
  permissive,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'program_events'
ORDER BY policyname;

-- 1.2 THE EXPOSURE, STATED PLAINLY. Every command role `anon` can currently
--     perform on the audit trail. Expect SELECT, INSERT, UPDATE, DELETE (or ALL)
--     before the lockdown; the same query returns ZERO rows afterwards (2.1).
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'program_events'
  AND 'anon' = ANY(roles)
ORDER BY cmd, policyname;

-- 1.3 CURRENT TABLE GRANTS (authoritative source: pg_class.relacl). Policies do
--     not matter if a table grant is missing, and an inherited PUBLIC grant
--     reaches anon. Record this: the migration restores it verbatim on rollback.
SELECT
  COALESCE(pg_get_userbyid(NULLIF(a.grantee, 0)), 'PUBLIC')                  AS grantee,
  string_agg(a.privilege_type, ', ' ORDER BY a.privilege_type)               AS privileges
FROM pg_class c
CROSS JOIN LATERAL aclexplode(c.relacl) AS a
WHERE c.oid = 'public.program_events'::regclass
GROUP BY 1
ORDER BY 1;

-- 1.4 RLS FLAGS. PASS: relrowsecurity = true. If it is false, the policies above
--     are decorative and the table is fully open regardless of them.
--     RECORD BOTH VALUES. The migration captures them into
--     program_events_rls_lockdown_runs and the ROLLBACK restores them exactly,
--     rather than assuming RLS was already enabled - so if relrowsecurity is
--     false today, a rollback will correctly turn it back off.
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE oid = 'public.program_events'::regclass;

-- 1.4b STALE ARTIFACT PROBE. PASS: 'PASS' notices only, no WARNING.
--      The migration refuses to run if either condition holds, because a
--      leftover open run or an older-shape artifact makes "restore the previous
--      state" ambiguous. An open run means this lockdown is already applied -
--      roll it back before re-applying. An older-shape artifact must be archived
--      (ALTER TABLE ... RENAME TO ..._legacy) before re-running.
--
--      Written as a DO block with dynamic SQL on purpose: on a FIRST application
--      none of these tables exist, and a plain SELECT naming them would fail with
--      "relation does not exist" - alarming output for what is the expected,
--      healthy first-run state.
DO $probe$
DECLARE
  v_open    integer := 0;
  v_missing text;
BEGIN
  IF to_regclass('public.program_events_rls_lockdown_runs') IS NULL THEN
    RAISE NOTICE 'PASS: no lockdown run registry yet (this is a first application).';
  ELSE
    EXECUTE 'SELECT count(*) FROM public.program_events_rls_lockdown_runs WHERE rolled_back_at IS NULL'
      INTO v_open;
    IF v_open = 0 THEN
      RAISE NOTICE 'PASS: registry present, no open lockdown run.';
    ELSE
      RAISE WARNING 'STOP: % open lockdown run(s). The lockdown is already applied; roll back before re-applying.', v_open;
    END IF;
  END IF;

  SELECT string_agg(problem, '; ' ORDER BY problem) INTO v_missing
  FROM (
    SELECT 'program_events_rls_policy_backup is missing run_id' AS problem
     WHERE to_regclass('public.program_events_rls_policy_backup') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema='public' AND table_name='program_events_rls_policy_backup'
                          AND column_name='run_id')
    UNION ALL
    SELECT 'program_events_rls_grant_backup is missing run_id'
     WHERE to_regclass('public.program_events_rls_grant_backup') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema='public' AND table_name='program_events_rls_grant_backup'
                          AND column_name='run_id')
    UNION ALL
    SELECT 'program_events_rls_lockdown_runs is missing ' || c.needed
      FROM (VALUES ('run_id'), ('prior_rowsecurity'), ('prior_forcerowsecurity'), ('rolled_back_at')) AS c(needed)
     WHERE to_regclass('public.program_events_rls_lockdown_runs') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema='public' AND table_name='program_events_rls_lockdown_runs'
                          AND column_name=c.needed)
  ) AS problems;

  IF v_missing IS NULL THEN
    RAISE NOTICE 'PASS: no older-shape lockdown artifacts.';
  ELSE
    RAISE WARNING 'STOP: older-shape lockdown artifacts present (%). Archive them before applying.', v_missing;
  END IF;
END
$probe$;

-- 1.5 PREREQUISITE. PASS: one row, prosecdef = true. public.is_staff() is created
--     by supabase/migrations/20260712000000_phase0b_wave_a_is_staff_helper.sql
--     (Phase 0B Wave A). The migration ABORTS in its first step if this returns
--     no row, so a missing helper costs nothing but a re-run.
SELECT p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'is_staff';

-- 1.5b VIEWER-EXCLUDING WRITER PREDICATE. Expect ZERO rows BEFORE applying: the
--      migration creates public.is_staff_event_writer(). After applying, section
--      2 expects exactly one row with prosecdef = true.
SELECT p.proname, p.prosecdef
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'is_staff_event_writer';

-- 1.5c WHO WILL LOSE WRITE ACCESS. The lockdown lets every staff role READ the
--      trail but restricts INSERT to Owner, Admin, Co-Lead and Interviewer.
--      This lists the active Viewers who will keep read access and lose write
--      access. Expect that to be acceptable; if a Viewer is currently relied on
--      to change student statuses, resolve that before applying.
SELECT role, count(*) AS active_accounts
FROM public.user_profiles
WHERE COALESCE(is_active, true) = true
GROUP BY role
ORDER BY role;

-- 1.6 BASELINE ROW COUNTS. Record these. The migration touches NO row, so the
--     same numbers must come back in 2.6.
SELECT
  count(*)                                                AS total_rows,
  count(*) FILTER (WHERE event_type = 'keith_tool_call')  AS keith_audit_rows,
  count(DISTINCT event_type)                              AS distinct_event_types,
  min(created_at)                                         AS first_event,
  max(created_at)                                         AS last_event
FROM public.program_events;

-- 1.7 WHAT THE TABLE ACTUALLY HOLDS, by event type and writer. Context for the
--     policy decision: the browser-written types (form_received, placement,
--     interview, rubric_saved, rubric_save_failed, manual status changes) must
--     keep working; 'keith_tool_call' is server-written only and is fenced off
--     from the browser by both new policies.
SELECT
  event_type,
  created_by,
  count(*) AS rows,
  min(created_at) AS first_seen,
  max(created_at) AS last_seen
FROM public.program_events
GROUP BY event_type, created_by
ORDER BY rows DESC, event_type, created_by;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 2. VERIFICATION (run AFTER applying)
-- ════════════════════════════════════════════════════════════════════════════

-- 2.1 (V1) NO anon policy remains. PASS: ZERO rows.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'program_events'
  AND 'anon' = ANY(roles);

-- 2.2 (V2) NO permissive true/true policy remains for any client role.
--     PASS: ZERO rows.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'program_events'
  AND roles && ARRAY['anon','authenticated','public']::name[]
  AND (COALESCE(qual, '') = 'true' OR COALESCE(with_check, '') = 'true');

-- 2.3 (V3) THE EXPECTED POLICY SET, AND NOTHING ELSE.
--     PASS: exactly FOUR rows, all with expected_shape = 'ok':
--       service_role_insert_program_events | INSERT | {service_role}
--       service_role_select_program_events | SELECT | {service_role}
--       staff_insert_program_events        | INSERT | {authenticated}
--       staff_select_program_events        | SELECT | {authenticated}
--     There must be NO row with cmd = 'UPDATE' or cmd = 'DELETE', and no
--     a FOR ALL service_role policy (the pre-revision shape).
--     THE ONE TO READ CLOSELY: staff_insert must reference
--     is_staff_event_writer, NOT is_staff. If it says is_staff, Viewers can write
--     and the read/write split has been lost.
SELECT
  policyname,
  cmd,
  roles,
  qual,
  with_check,
  CASE
    WHEN policyname = 'service_role_select_program_events'
      AND cmd = 'SELECT' AND roles = ARRAY['service_role']::name[]                    THEN 'ok'
    WHEN policyname = 'service_role_insert_program_events'
      AND cmd = 'INSERT' AND roles = ARRAY['service_role']::name[]                    THEN 'ok'
    WHEN policyname = 'staff_select_program_events'
      AND cmd = 'SELECT' AND roles = ARRAY['authenticated']::name[]
      AND qual LIKE '%is_staff()%' AND qual LIKE '%keith_tool_call%'                  THEN 'ok'
    WHEN policyname = 'staff_insert_program_events'
      AND cmd = 'INSERT' AND roles = ARRAY['authenticated']::name[]
      AND with_check LIKE '%is_staff_event_writer%'
      AND with_check LIKE '%keith_tool_call%'                                         THEN 'ok'
    ELSE 'UNEXPECTED - STOP'
  END AS expected_shape
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'program_events'
ORDER BY policyname;

-- 2.3b THE VIEWER SPLIT, AT THE PREDICATE LEVEL. PASS: one row, prosecdef = true,
--      lists_interviewer = true, lists_viewer = FALSE.
--      Both tests match the QUOTED role literal, not a bare substring: the word
--      'interviewer' contains "viewer", so a naive LIKE '%viewer%' would report
--      the split as broken on a correct function.
SELECT
  p.proname,
  p.prosecdef,
  pg_get_functiondef(p.oid) LIKE '%''interviewer''%' AS lists_interviewer,
  pg_get_functiondef(p.oid) LIKE '%''viewer''%'      AS lists_viewer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'is_staff_event_writer';

-- 2.4 (V4) RLS still enabled. PASS: relrowsecurity = true.
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE oid = 'public.program_events'::regclass;

-- 2.5 (V5) TABLE GRANTS. PASS: exactly two rows, each reading "INSERT, SELECT".
--       authenticated : INSERT, SELECT
--       service_role  : INSERT, SELECT   (narrowed from ALL: nothing on the
--                                         server updates or deletes this table)
--     anon and PUBLIC must not appear at all, and no grantee may show UPDATE,
--     DELETE, TRUNCATE, REFERENCES or TRIGGER.
SELECT
  COALESCE(pg_get_userbyid(NULLIF(a.grantee, 0)), 'PUBLIC')     AS grantee,
  string_agg(a.privilege_type, ', ' ORDER BY a.privilege_type)  AS privileges
FROM pg_class c
CROSS JOIN LATERAL aclexplode(c.relacl) AS a
WHERE c.oid = 'public.program_events'::regclass
GROUP BY 1
ORDER BY 1;

-- 2.5b (V10) THE CAPTURED SNAPSHOT IS COMPLETE, ATTRIBUTABLE, AND REPLAYABLE.
--      PASS: exactly one open run; policies_captured and grants_captured match
--      the counts you recorded from 1.1 and 1.3; and every captured grant that
--      was grantable replays WITH GRANT OPTION, so a rollback cannot silently
--      downgrade a privilege.
SELECT r.run_id, r.captured_at, r.applied_by,
       r.prior_rowsecurity, r.prior_forcerowsecurity, r.rolled_back_at,
       (SELECT count(*) FROM public.program_events_rls_policy_backup b WHERE b.run_id = r.run_id) AS policies_captured,
       (SELECT count(*) FROM public.program_events_rls_grant_backup  g WHERE g.run_id = r.run_id) AS grants_captured
FROM public.program_events_rls_lockdown_runs r
ORDER BY r.captured_at DESC;

SELECT grantee, privilege_type, is_grantable, restore_sql,
       CASE
         WHEN is_grantable AND restore_sql LIKE '%WITH GRANT OPTION;' THEN 'ok'
         WHEN NOT is_grantable AND restore_sql NOT LIKE '%WITH GRANT OPTION;' THEN 'ok'
         ELSE 'MISMATCH - STOP'
       END AS grant_option_replay
FROM public.program_events_rls_grant_backup
ORDER BY grantee, privilege_type;

-- 2.6 (V6) ROW PRESERVATION. PASS: identical to 1.6 in every column. This
--     migration changes access, never data.
SELECT
  count(*)                                                AS total_rows,
  count(*) FILTER (WHERE event_type = 'keith_tool_call')  AS keith_audit_rows,
  count(DISTINCT event_type)                              AS distinct_event_types,
  min(created_at)                                         AS first_event,
  max(created_at)                                         AS last_event
FROM public.program_events;

-- 2.7 BACKUP ARTIFACTS EXIST AND ARE USABLE. PASS: policy_rows equals the number
--     of rows returned by 1.1, grant_rows equals the number of (grantee,
--     privilege) pairs behind 1.3, and every captured row has a non-empty
--     restore_sql. This is what the rollback replays; without it the rollback
--     would be a reconstruction.
SELECT
  (SELECT count(*) FROM public.program_events_rls_policy_backup)                       AS policy_rows,
  (SELECT count(*) FROM public.program_events_rls_policy_backup
     WHERE coalesce(restore_sql, '') = '')                                             AS policy_rows_missing_sql,
  (SELECT count(*) FROM public.program_events_rls_grant_backup)                        AS grant_rows,
  (SELECT count(*) FROM public.program_events_rls_grant_backup
     WHERE coalesce(restore_sql, '') = '')                                             AS grant_rows_missing_sql;

-- 2.8 THE CAPTURED DEFINITIONS THEMSELVES (read them once, so the rollback is not
--     a surprise later). Read-only.
SELECT policyname, cmd, roles, restore_sql, captured_at
FROM public.program_events_rls_policy_backup
ORDER BY captured_at, policyname;

-- 2.9 BACKUP TABLES ARE NOT A NEW EXPOSURE. PASS: both tables report
--     rls_enabled = true, and neither anon nor authenticated nor PUBLIC holds any
--     privilege on them (only service_role appears).
SELECT
  c.relname,
  c.relrowsecurity AS rls_enabled,
  COALESCE(pg_get_userbyid(NULLIF(a.grantee, 0)), 'PUBLIC')     AS grantee,
  string_agg(a.privilege_type, ', ' ORDER BY a.privilege_type)  AS privileges
FROM pg_class c
LEFT JOIN LATERAL aclexplode(c.relacl) AS a ON true
WHERE c.oid IN (
  'public.program_events_rls_policy_backup'::regclass,
  'public.program_events_rls_grant_backup'::regclass
)
GROUP BY c.relname, c.relrowsecurity, 3
ORDER BY c.relname, grantee;


-- ════════════════════════════════════════════════════════════════════════════
-- SECTION 3. POST-SMOKE-TEST EVIDENCE
-- ════════════════════════════════════════════════════════════════════════════
-- Run after the live staff smoke test in the migration header (save a rubric,
-- change a student's ASPIRE status, open /students and a student side panel, ask
-- Keith a question that runs a tool).

-- 3.1 (V7) RECENT ROWS. PASS: the rubric_saved / manual status rows written from
--     the STAFF BROWSER during the smoke test are present (the preserved client
--     INSERT path works), and the keith_tool_call rows written by the SERVER are
--     present here while remaining invisible to any browser session.
SELECT
  created_at,
  event_type,
  created_by,
  student_id,
  left(notes, 90) AS notes_head
FROM public.program_events
WHERE created_at > now() - interval '2 hours'
ORDER BY created_at DESC
LIMIT 30;

-- 3.2 THE PRESERVED READ PATHS, EXERCISED AS SQL. These mirror the exact browser
--     queries that must keep working. PASS: both return the same counts they
--     would have returned before the lockdown (staff SELECT is unchanged for
--     everything except Keith rows). Substitute a real cohort id and student id.
--
--   -- src/hooks/useUnreadStudents.js (unread student badges)
--   SELECT count(*) AS form_received_rows
--   FROM public.program_events
--   WHERE event_type = 'form_received' AND cohort_id = '<cohort-uuid>';
--
--   -- src/components/StudentSidePanel.jsx (student_program_events)
--   SELECT count(*) AS student_event_rows
--   FROM public.program_events
--   WHERE student_id = '<student-uuid>';

-- 3.3 KEITH AUDIT TRAIL INTEGRITY, going forward. PASS: this row count only ever
--     GROWS, and every row has created_by = 'system' and student_id IS NULL.
--     Anything else means a write reached the table from outside api/keith.js.
SELECT
  count(*)                                              AS keith_audit_rows,
  count(*) FILTER (WHERE created_by IS DISTINCT FROM 'system')  AS unexpected_writer_rows,
  count(*) FILTER (WHERE student_id IS NOT NULL)                AS unexpected_student_scoped_rows,
  min(created_at)                                       AS first_audit_row,
  max(created_at)                                       AS last_audit_row
FROM public.program_events
WHERE event_type = 'keith_tool_call';
