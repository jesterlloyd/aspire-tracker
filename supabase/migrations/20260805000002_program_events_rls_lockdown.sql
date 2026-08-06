-- ============================================================================
-- PROGRAM_EVENTS RLS LOCKDOWN (Keith risk R6)
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester) in the Supabase SQL editor, ONLY AFTER      ***
-- *** running the PRECHECK section of                                           ***
-- *** db/audit/program_events_rls_verification.sql and reviewing its output.     ***
-- *** Run the ENTIRE file once, as one block (it is a single transaction).       ***
--
-- PURPOSE
--   public.program_events is an APPEND-ONLY AUDIT AND MILESTONE table. It is the
--   only database trace of Keith tool calls (event_type = 'keith_tool_call',
--   written by api/keith.js on both allowed and denied calls) and it carries the
--   program milestone trail (form_received, interview, placement, rotation_start,
--   rotation_end, rubric_saved, manual_status_update, note, ...).
--
--   Today that table is protected by nothing:
--     - migration_program_events_rls.sql grants role `anon` SELECT, INSERT,
--       UPDATE and DELETE with USING (true) / WITH CHECK (true). The anon key is
--       embedded in the public browser bundle, so anyone can read, forge, rewrite
--       or DELETE the audit trail.
--     - migration_authenticated_rls_audit_v2.sql (lines 84-86) grants
--       `authenticated` FOR ALL USING (true) WITH CHECK (true), i.e. every signed-in
--       account including future/current PORTAL accounts (students, unit leaders,
--       academic partners) has full CRUD on the same trail.
--   Finding R6 in docs/product/KEITH_SKILLS_KNOWLEDGE_VAULT_PLAN.md; decision D12
--   queued this lockdown as its own Owner SQL gate item.
--
-- INTENDED POST-LOCKDOWN POSTURE
--   anon           : NO policy, NO grant. Zero access of any kind.
--   authenticated  : STAFF ONLY, split by capability, and never for Keith audit
--                    rows:
--                      SELECT - every staff role INCLUDING Viewer
--                               (public.is_staff()).
--                      INSERT - Owner, Admin, Co-Lead and Interviewer only
--                               (public.is_staff_event_writer()). A VIEWER MAY
--                               READ THE TRAIL BUT MAY NOT WRITE TO IT.
--                    No UPDATE policy and no DELETE policy exists for any client
--                    role, so the trail is append-only from the browser.
--   service_role   : SELECT + INSERT only. Narrowed from full access, because
--                    nothing on the server updates or deletes program_events -
--                    verified by grep across api/, src/ and lib/: the single
--                    delete call site in the repository is
--                    src/components/StudentSidePanel.jsx:768, which runs in the
--                    BROWSER behind the disabled Program Timeline block, not on
--                    the server. Least privilege therefore costs nothing here and
--                    means a future server bug cannot silently rewrite history.
--   PUBLIC         : no grant (it would otherwise be inherited by anon).
--
-- WHY THE VIEWER SPLIT LIVES IN THE POLICY, NOT THE GRANT
--   Viewer, Interviewer, Admin and Owner are all the same Postgres role
--   (`authenticated`); the app's role lives in public.user_profiles. A table
--   GRANT therefore cannot express "Viewer may select but not insert" - the grant
--   permits the STATEMENT, and the policy decides the ROWS. So `authenticated`
--   keeps GRANT SELECT, INSERT, and a Viewer's INSERT is refused by the WITH
--   CHECK of staff_insert_program_events, surfacing as an RLS violation rather
--   than a silent no-op.
--
-- WHY is_staff_event_writer() IS A SECURITY DEFINER FUNCTION
--   The obvious alternative - an inline EXISTS against user_profiles inside the
--   policy - would itself be subject to user_profiles' own RLS for the
--   `authenticated` role, could return no rows, and would then deny everyone
--   while looking correct. public.is_staff() is SECURITY DEFINER for exactly this
--   reason; the new helper mirrors it, minus 'viewer'.
--
-- WHY THAT EXACT SET (verified against the deployed code, 2026-08-05)
--   SERVER (service-role clients, RLS-exempt) - unaffected either way:
--     api/keith.js (audit insert, allowed + denied), api/interview-book.js,
--     api/update-rotation-dates.js, api/student-intake-submit.js,
--     api/availability.js, api/portal/my-profile.js, api/shift-log/check-out.js,
--     api/shift-log/submit-past-shift.js, api/lib/schoolPlacementUpsert.js,
--     api/admin/resend-coordinator-digest.js, api/cron/coordinator-weekly-digest.js.
--   BROWSER (staff session, role `authenticated`) - THESE MUST KEEP WORKING:
--     SELECT  src/hooks/useUnreadStudents.js  reads event_type = 'form_received'
--             for the active cohort; it drives the unread-student badges. LIVE.
--     SELECT  src/lib/logEvent.js eventExists() reads by student_id + event_type
--             before every deduplicated auto-log. LIVE.
--     SELECT  src/components/StudentSidePanel.jsx (queryKey student_program_events)
--             reads all events for one student. The query still runs on every side
--             panel open; only its Program Timeline render is behind `false &&`.
--     INSERT  src/lib/logEvent.js, called from src/App.jsx (placement),
--             src/components/RubricSession.jsx (rubric_saved, rubric_save_failed,
--             interview) and src/components/StudentSidePanel.jsx (manual status
--             change). Auto-logged rows carry created_by = 'system', which is why
--             this migration does NOT constrain created_by. LIVE.
--     UPDATE  none. No client and no server path updates program_events anywhere
--             in the repository, so no UPDATE policy is created.
--     DELETE  only src/components/StudentSidePanel.jsx handleDeleteEvent, which is
--             reachable exclusively from the disabled `false &&` Program Timeline
--             block. It is therefore NOT a live surface and no DELETE policy is
--             created. See "IF YOU EVER NEED CLIENT DELETE BACK" below.
--     ANON (logged-out public forms) : none. /student-form and /shift-log were
--             rewired server-side (74526e5 / WS1e-A0 and WS1e-A0b); their
--             program_events writes now happen inside api/student-intake-submit.js
--             and api/shift-log/submit-past-shift.js as service_role.
--   KEITH AUDIT ROWS are additionally fenced off from the browser entirely
--     (event_type IS DISTINCT FROM 'keith_tool_call' in both the SELECT and the
--     INSERT policy). No client query can produce one: useUnreadStudents filters to
--     'form_received', eventExists filters by event_type, and the side panel filters
--     by student_id while every Keith row has student_id = NULL. So the audited
--     subject can neither read nor forge its own audit trail, and nothing breaks.
--     IS DISTINCT FROM (not <>) so a NULL event_type is not silently rejected.
--
-- WHAT BREAKS IF THIS IS APPLIED CARELESSLY
--   1. WITHOUT public.is_staff() (Phase 0B Wave A,
--      20260712000000_phase0b_wave_a_is_staff_helper.sql): the CREATE POLICY
--      statements fail. Step 1 aborts the transaction first with a clear message.
--      Nothing is changed. Apply Wave A, then re-run this file.
--   2. If a future surface is added that DELETEs or UPDATEs program_events from the
--      browser, it will fail with an RLS error, not a silent no-op. That is
--      intended: audit rows are not client-mutable. Route such a change through a
--      service-role endpoint, or add a reviewed policy.
--   3. If any staff account is deactivated (is_active = false) or holds a role
--      outside is_staff(), it loses program_events access along with the rest of the
--      Wave E surface. That is the same boundary already applied elsewhere.
--   4. Portal accounts (role = 'portal') lose the read/write access the v2 audit
--      migration accidentally gave them. No portal code reads or writes
--      program_events from the browser (all portal traffic goes through
--      api/portal/*, service_role), so this removes exposure, not function.
--   5. This migration drops EVERY policy currently on public.program_events, by
--      enumeration rather than by name. That is deliberate: Wave E-2
--      (20260712000005) documents how name-based DROP POLICY IF EXISTS statements
--      silently no-opped against dashboard-created policies and left permissive
--      policies alive. Every dropped policy is snapshotted with its exact
--      regenerating CREATE POLICY statement into
--      public.program_events_rls_policy_backup first, and the table grants are
--      snapshotted into public.program_events_rls_grant_backup, so the rollback
--      replays captured statements verbatim and never reconstructs anything by hand.
--      REVIEW the PRECHECK inventory before applying: if it lists a policy you do
--      not recognize from this header, STOP and decide about it separately.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   It touches no other table, no function, no view, no storage object, and NO ROW
--   of program_events. It deletes nothing, rewrites nothing, and backfills nothing.
--   Row counts before and after are identical (verification V6 proves it).
--
-- VERIFICATION (exact steps)
--   1. BEFORE: run the PRECHECK section of
--      db/audit/program_events_rls_verification.sql and keep the output
--      (policy inventory, grants, row counts by role/event_type).
--   2. Apply this whole file as one block.
--   3. AFTER: run V1 through V6 at the foot of this file, or the whole
--      VERIFICATION section of db/audit/program_events_rls_verification.sql, and
--      confirm every stated expectation.
--   4. Live smoke test on the deployed app, signed in as staff (do it as an
--      INTERVIEWER as well as an owner/admin):
--        a. Open /students: the unread badges still render (useUnreadStudents
--           SELECT succeeded; a failure shows zero badges and a console error).
--        b. Open a student side panel: it loads with no console RLS error.
--        c. Save a rubric in /interviews: a rubric_saved row appears
--           (verification V7 in the audit file finds it by created_at).
--        d. Change a student's ASPIRE status: a manual_status_update row appears.
--        e. Ask Keith a question that runs a tool: a keith_tool_call row appears
--           when queried as service_role, and NOT through a browser session.
--      Logged out, load /student-form and /shift-log and submit: both still work
--      (they are server-mediated) and neither writes through the anon key.
--
-- IF YOU EVER NEED CLIENT DELETE BACK (do not add it casually):
--   CREATE POLICY "staff_delete_program_events" ON public.program_events
--     FOR DELETE TO authenticated
--     USING (public.is_staff() AND event_type IS DISTINCT FROM 'keith_tool_call');
--   GRANT DELETE ON public.program_events TO authenticated;
--   The Program Timeline UI in StudentSidePanel.jsx must be re-enabled in the same
--   change, and the audit posture recorded in docs/security/OWNER_SQL_GATE.md.
--
-- Related: docs/product/KEITH_SKILLS_KNOWLEDGE_VAULT_PLAN.md (R6, D12),
--          docs/security/PHASE_0A_ACCESS_AUDIT.md (5.10, F1, F6),
--          supabase/migrations/20260712000001_phase0b_wave_b_drop_orphan_anon_policies.sql
--            (drops the same four anon policies as part of Wave B; this migration is
--            idempotent with respect to it and safe whether or not Wave B ran),
--          supabase/migrations/20260712000004_phase0b_wave_e_staff_rescope.sql
--            (created staff_all_program_events, FOR ALL: this migration REPLACES it
--            with the narrower SELECT + INSERT pair).
-- ============================================================================

BEGIN;

-- ── 1. FAIL-CLOSED GATE: prerequisites must exist before anything is written ──
DO $$
DECLARE
  v_open_runs integer := 0;
  v_missing   text;
BEGIN
  IF to_regclass('public.program_events') IS NULL THEN
    RAISE EXCEPTION
      'PROGRAM_EVENTS LOCKDOWN ABORTED: public.program_events does not exist.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_staff' AND p.pronargs = 0
  ) THEN
    RAISE EXCEPTION
      'PROGRAM_EVENTS LOCKDOWN ABORTED: public.is_staff() is missing. Apply '
      'supabase/migrations/20260712000000_phase0b_wave_a_is_staff_helper.sql '
      '(Phase 0B Wave A) first, then re-run this file. Nothing has been changed.';
  END IF;

  -- STALE BACKUP GUARD 1: an earlier run that was never rolled back. Applying
  -- again on top of it would leave two candidate snapshots and make "restore the
  -- previous state" ambiguous. Resolve the open run first, deliberately.
  --
  -- The lookup is DYNAMIC on purpose. plpgsql evaluates `IF a AND b` as a single
  -- SQL expression, so a static `FROM public.program_events_rls_lockdown_runs`
  -- would be parsed and name-resolved even when the to_regclass guard is false -
  -- i.e. this file would fail with "relation does not exist" on the very FIRST
  -- application, the one case it must handle. EXECUTE defers resolution until we
  -- already know the table is there.
  IF to_regclass('public.program_events_rls_lockdown_runs') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.program_events_rls_lockdown_runs WHERE rolled_back_at IS NULL'
      INTO v_open_runs;
    IF v_open_runs > 0 THEN
      RAISE EXCEPTION
        'PROGRAM_EVENTS LOCKDOWN ABORTED: % previous run(s) still open (not '
        'rolled back). This lockdown is already applied. If you intend to '
        're-apply, first run the ROLLBACK block at the foot of this file, which '
        'marks the run closed. Inspect with: SELECT * FROM '
        'public.program_events_rls_lockdown_runs ORDER BY captured_at DESC; '
        'Nothing has been changed.', v_open_runs;
    END IF;
  END IF;

  -- STALE BACKUP GUARD 2: artifacts from the pre-run_id draft of this migration,
  -- or a partially-created registry. Rows that cannot be attributed to a run
  -- would let a rollback replay a definition captured against a different
  -- starting state, so ALL THREE artifacts are validated when present.
  --
  -- These probes read information_schema only, which is safe whether or not the
  -- tables exist, so no dynamic SQL is needed here.
  SELECT string_agg(problem, '; ' ORDER BY problem) INTO v_missing
  FROM (
    SELECT 'program_events_rls_policy_backup is missing run_id' AS problem
     WHERE to_regclass('public.program_events_rls_policy_backup') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema='public'
                          AND table_name='program_events_rls_policy_backup'
                          AND column_name='run_id')
    UNION ALL
    SELECT 'program_events_rls_grant_backup is missing run_id'
     WHERE to_regclass('public.program_events_rls_grant_backup') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema='public'
                          AND table_name='program_events_rls_grant_backup'
                          AND column_name='run_id')
    UNION ALL
    SELECT 'program_events_rls_lockdown_runs is missing ' || c.needed
      FROM (VALUES ('run_id'), ('prior_rowsecurity'), ('prior_forcerowsecurity'), ('rolled_back_at')) AS c(needed)
     WHERE to_regclass('public.program_events_rls_lockdown_runs') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema='public'
                          AND table_name='program_events_rls_lockdown_runs'
                          AND column_name=c.needed)
  ) AS problems;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'PROGRAM_EVENTS LOCKDOWN ABORTED: lockdown artifacts exist in an older or '
      'incomplete shape (%). Their rows cannot be attributed to a run, so a '
      'rollback could replay a stale definition. Review and archive them (for '
      'example ALTER TABLE ... RENAME TO ..._legacy), then re-run this file. '
      'Nothing has been changed.', v_missing;
  END IF;
END $$;

-- ── 2. Run registry: one row per application of this lockdown ───────────────
-- This exists to make rollback EXACT and to make stale backup reuse impossible.
--
-- The earlier draft captured into two tables with CREATE TABLE IF NOT EXISTS and
-- INSERT ... WHERE NOT EXISTS. That has a trap: apply, roll back, apply again, and
-- the second run's capture is skipped because rows with the same policyname are
-- already present from the FIRST run. A later rollback would then replay a stale,
-- no-longer-true definition. Every run now captures a COMPLETE fresh snapshot
-- under its own run_id, and the rollback replays exactly one run.
CREATE TABLE IF NOT EXISTS public.program_events_rls_lockdown_runs (
  run_id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at            timestamptz NOT NULL DEFAULT now(),
  applied_by             text        NOT NULL DEFAULT current_user,
  -- The pre-lockdown RLS flags, so rollback restores the prior state rather than
  -- assuming RLS was already enabled.
  prior_rowsecurity      boolean     NOT NULL,
  prior_forcerowsecurity boolean     NOT NULL,
  rolled_back_at         timestamptz NULL
);
ALTER TABLE public.program_events_rls_lockdown_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.program_events_rls_lockdown_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.program_events_rls_lockdown_runs TO service_role;

-- ── 3. Policy backup artifact (exact definitions, for an exact rollback) ────
CREATE TABLE IF NOT EXISTS public.program_events_rls_policy_backup (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid        NOT NULL REFERENCES public.program_events_rls_lockdown_runs(run_id) ON DELETE CASCADE,
  policyname  text        NOT NULL,
  cmd         text        NOT NULL,
  permissive  text        NOT NULL,
  roles       text[]      NOT NULL,
  qual        text,
  with_check  text,
  restore_sql text        NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.program_events_rls_policy_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.program_events_rls_policy_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.program_events_rls_policy_backup TO service_role;

-- ── 4. Grant backup artifact (privileges restored from capture, not guessed) ─
-- Captured from pg_class.relacl via aclexplode (not information_schema, which is
-- filtered by the querying role's own privileges and can under-report).
-- is_grantable is now REPLAYED as WITH GRANT OPTION; the earlier draft recorded
-- the flag and then silently dropped it on restore, which would have quietly
-- downgraded any grantable privilege.
CREATE TABLE IF NOT EXISTS public.program_events_rls_grant_backup (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid        NOT NULL REFERENCES public.program_events_rls_lockdown_runs(run_id) ON DELETE CASCADE,
  grantee        text        NOT NULL,
  privilege_type text        NOT NULL,
  is_grantable   boolean,
  restore_sql    text        NOT NULL,
  captured_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.program_events_rls_grant_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.program_events_rls_grant_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.program_events_rls_grant_backup TO service_role;

-- ── 5. Capture the CURRENT state under one new run_id ───────────────────────
DO $capture$
DECLARE
  v_run       uuid;
  v_rls       boolean;
  v_force     boolean;
  v_policies  integer;
  v_grants    integer;
BEGIN
  SELECT c.relrowsecurity, c.relforcerowsecurity
    INTO v_rls, v_force
    FROM pg_class c
   WHERE c.oid = 'public.program_events'::regclass;

  INSERT INTO public.program_events_rls_lockdown_runs (prior_rowsecurity, prior_forcerowsecurity)
  VALUES (v_rls, v_force)
  RETURNING run_id INTO v_run;

  INSERT INTO public.program_events_rls_policy_backup
    (run_id, policyname, cmd, permissive, roles, qual, with_check, restore_sql)
  SELECT
    v_run, p.policyname, p.cmd, p.permissive, p.roles::text[], p.qual, p.with_check,
    format(
      'CREATE POLICY %I ON public.program_events AS %s FOR %s TO %s%s%s;',
      p.policyname,
      p.permissive,
      p.cmd,
      (SELECT string_agg(CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END, ', ')
         FROM unnest(p.roles::text[]) AS r),
      CASE WHEN p.qual       IS NULL THEN '' ELSE ' USING (' || p.qual || ')' END,
      CASE WHEN p.with_check IS NULL THEN '' ELSE ' WITH CHECK (' || p.with_check || ')' END
    )
  FROM pg_policies p
  WHERE p.schemaname = 'public' AND p.tablename = 'program_events';
  GET DIAGNOSTICS v_policies = ROW_COUNT;

  INSERT INTO public.program_events_rls_grant_backup
    (run_id, grantee, privilege_type, is_grantable, restore_sql)
  SELECT
    v_run, g.grantee_name, g.privilege_type, g.is_grantable,
    format(
      'GRANT %s ON public.program_events TO %s%s;',
      g.privilege_type,
      CASE WHEN g.grantee_name = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(g.grantee_name) END,
      CASE WHEN g.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END
    )
  FROM (
    SELECT
      COALESCE(pg_get_userbyid(NULLIF(a.grantee, 0)), 'PUBLIC') AS grantee_name,
      a.privilege_type,
      a.is_grantable
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) AS a
    WHERE c.oid = 'public.program_events'::regclass
  ) g;
  GET DIAGNOSTICS v_grants = ROW_COUNT;

  RAISE NOTICE 'lockdown run %: captured % policies and % grants; prior RLS enabled=%, forced=%',
    v_run, v_policies, v_grants, v_rls, v_force;
  RAISE NOTICE 'ROLLBACK USES THIS run_id: %', v_run;
END
$capture$;

-- ── 6. The viewer-excluding write predicate ─────────────────────────────────
-- Mirrors public.is_staff() exactly, minus 'viewer'. SECURITY DEFINER for the
-- reason given in the header: an inline subquery would be subject to
-- user_profiles' own RLS. is_owner is honored as well as the role string, because
-- Owner is a flag elsewhere in this application.
CREATE OR REPLACE FUNCTION public.is_staff_event_writer()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
-- pg_catalog FIRST: a SECURITY DEFINER function runs with elevated rights, so a
-- same-named object planted in public must not be able to shadow a catalog
-- function or operator it relies on. Every reference below is schema-qualified
-- anyway, so the ordering costs nothing.
SET search_path = pg_catalog, public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE auth_user_id = auth.uid()
      AND COALESCE(is_active, true) = true
      AND (is_owner = true
           OR role IN ('owner', 'admin', 'co_lead', 'co-lead', 'interviewer'))
  );
$fn$;
REVOKE ALL ON FUNCTION public.is_staff_event_writer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_staff_event_writer() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_staff_event_writer() TO authenticated;

-- ── 7. Drop EVERY existing policy on program_events (by enumeration, not name) ─
-- Name-based drops are what failed in Wave E (see Wave E-2's root-cause note), so
-- this loop is name-agnostic. Step 5 has already captured each definition. Step 8
-- recreates the complete intended set inside this same transaction, so even a
-- mid-transaction failure rolls back to the prior state rather than to an open
-- table.
DO $drop$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'program_events'
    ORDER BY policyname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.program_events', p.policyname);
    RAISE NOTICE 'dropped program_events policy: %', p.policyname;
  END LOOP;
END
$drop$;

-- ── 8. The intended policy set ──────────────────────────────────────────────
ALTER TABLE public.program_events ENABLE ROW LEVEL SECURITY;

-- 8a/8b. service_role, split to match its narrowed grant. service_role also
--        BYPASSES RLS, so these are documentation-grade: the GRANT in step 9 is
--        the control that actually binds. They are written as two policies rather
--        than FOR ALL so that anyone reading pg_policies sees the same SELECT +
--        INSERT shape the grants express.
CREATE POLICY "service_role_select_program_events" ON public.program_events
  FOR SELECT TO service_role
  USING (true);

CREATE POLICY "service_role_insert_program_events" ON public.program_events
  FOR INSERT TO service_role
  WITH CHECK (true);

-- 8c. Staff read, Viewer INCLUDED. Keith audit rows are excluded: no browser
--     query returns one today, and the audited subject must not read its own
--     audit trail.
CREATE POLICY "staff_select_program_events" ON public.program_events
  FOR SELECT TO authenticated
  USING (
    public.is_staff()
    AND event_type IS DISTINCT FROM 'keith_tool_call'
  );

-- 8d. Staff append, Viewer EXCLUDED. created_by is intentionally NOT constrained:
--     logEvent() writes created_by = 'system' for every auto-logged browser event.
CREATE POLICY "staff_insert_program_events" ON public.program_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_staff_event_writer()
    AND event_type IS DISTINCT FROM 'keith_tool_call'
  );

-- 8e. Deliberately absent: no UPDATE policy and no DELETE policy for any role,
--     client or server. Nothing in the repository updates program_events, and the
--     only DELETE call site is a browser path behind a disabled UI block.
--     Corrections are made by an Owner in SQL, deliberately.

-- ── 9. Table grants ─────────────────────────────────────────────────────────
-- Policies alone are not enough: a surviving grant to anon (or an inherited
-- PUBLIC grant) is what makes the anon key dangerous in the first place.
-- service_role is revoked and re-granted narrowly rather than left with ALL.
REVOKE ALL ON public.program_events FROM PUBLIC;
REVOKE ALL ON public.program_events FROM anon;
REVOKE ALL ON public.program_events FROM authenticated;
REVOKE ALL ON public.program_events FROM service_role;

GRANT SELECT, INSERT ON public.program_events TO authenticated;
GRANT SELECT, INSERT ON public.program_events TO service_role;

-- ── 10. Reload PostgREST schema cache ───────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;


-- ============================================================================
-- VERIFICATION (run AFTER applying; every query below is READ-ONLY).
-- The same queries, with more context, are in
-- db/audit/program_events_rls_verification.sql.
-- ============================================================================
--
-- V1. NO anon policy remains. Expected: ZERO rows.
--
--   SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'program_events'
--     AND 'anon' = ANY(roles);
--
-- V2. NO permissive true/true policy remains for any client role.
--     Expected: ZERO rows.
--
--   SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'program_events'
--     AND roles && ARRAY['anon','authenticated','public']::name[]
--     AND (COALESCE(qual, '') = 'true' OR COALESCE(with_check, '') = 'true');
--
-- V3. The expected policy set exists, and NOTHING else. Expected: EXACTLY these
--     four rows, in this order:
--       service_role_insert_program_events | INSERT | {service_role}
--       service_role_select_program_events | SELECT | {service_role}
--       staff_insert_program_events        | INSERT | {authenticated}
--       staff_select_program_events        | SELECT | {authenticated}
--     staff_select must mention is_staff() and 'keith_tool_call'.
--     staff_insert must mention is_staff_event_writer() and 'keith_tool_call' -
--     if it says is_staff() instead, VIEWERS CAN WRITE and the split has been
--     lost. There must be NO row with cmd = 'UPDATE' or cmd = 'DELETE', and no
--     policy named service_role_all_program_events.
--
--   SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'program_events'
--   ORDER BY policyname;
--
-- V4. RLS is enabled (and not merely policy-covered). Expected: one row,
--     relrowsecurity = true, relforcerowsecurity = false.
--
--   SELECT relname, relrowsecurity, relforcerowsecurity
--   FROM pg_class
--   WHERE oid = 'public.program_events'::regclass;
--
-- V5. Table grants. Expected EXACTLY two grantees, each with exactly
--     "INSERT, SELECT": authenticated and service_role. anon and PUBLIC must
--     appear on ZERO rows, and NO grantee may show UPDATE, DELETE, TRUNCATE,
--     REFERENCES or TRIGGER.
--
--   SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND table_name = 'program_events'
--   GROUP BY grantee
--   ORDER BY grantee;
--
-- V6. Row preservation. Expected: total_rows and keith_audit_rows match the
--     PRECHECK numbers taken before applying (this migration touches no row), and
--     first_event / last_event are unchanged.
--
--   SELECT
--     count(*)                                                 AS total_rows,
--     count(*) FILTER (WHERE event_type = 'keith_tool_call')   AS keith_audit_rows,
--     count(DISTINCT event_type)                               AS distinct_event_types,
--     min(created_at)                                          AS first_event,
--     max(created_at)                                          AS last_event
--   FROM public.program_events;
--
-- V7. Post-smoke-test evidence (run after step 4 of the header's verification
--     steps). Expected: the rubric_saved / manual_status_update rows written from
--     the browser during the smoke test, and the keith_tool_call rows written by
--     the server, all present.
--
--   SELECT event_type, created_by, created_at, left(notes, 80) AS notes_head
--   FROM public.program_events
--   WHERE created_at > now() - interval '1 hour'
--   ORDER BY created_at DESC
--   LIMIT 20;
--
-- V8. The Viewer split is real. Expected: is_staff_event_writer() exists, is
--     SECURITY DEFINER, and its body lists owner/admin/co_lead/co-lead/
--     interviewer and NOT 'viewer'.
--
--   SELECT p.proname, p.prosecdef, p.provolatile, pg_get_functiondef(p.oid) AS def
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'is_staff_event_writer';
--   EXPECT: one row, prosecdef = true, provolatile = 's', and def contains
--           'interviewer' but NOT 'viewer'.
--
--   Live confirmation (do this in the app, it is the one that matters):
--   signed in as a VIEWER, open a student side panel - it must load, and the
--   unread badges on /students must still render (SELECT works). Then trigger a
--   path that writes an event (change a student's ASPIRE status). The write must
--   be REFUSED with an RLS error, not silently succeed.
--
-- V9. Exactly one open lockdown run, with the prior RLS state recorded.
--     Expected: one row, rolled_back_at IS NULL, and prior_rowsecurity /
--     prior_forcerowsecurity matching what the PRECHECK reported before applying.
--
--   SELECT run_id, captured_at, applied_by, prior_rowsecurity,
--          prior_forcerowsecurity, rolled_back_at
--   FROM public.program_events_rls_lockdown_runs
--   ORDER BY captured_at DESC;
--
-- V10. The captured snapshot is complete and attributable. Expected: policy and
--      grant counts matching the PRECHECK inventory, all under the single open
--      run_id, and zero orphan rows.
--
--   SELECT r.run_id,
--          (SELECT count(*) FROM public.program_events_rls_policy_backup b WHERE b.run_id = r.run_id) AS policies_captured,
--          (SELECT count(*) FROM public.program_events_rls_grant_backup  g WHERE g.run_id = r.run_id) AS grants_captured
--   FROM public.program_events_rls_lockdown_runs r
--   WHERE r.rolled_back_at IS NULL;
--
--   -- Grant options were captured AND are replayable:
--   SELECT grantee, privilege_type, is_grantable, restore_sql
--   FROM public.program_events_rls_grant_backup
--   ORDER BY grantee, privilege_type;
--   EXPECT: every row with is_grantable = true has a restore_sql ending in
--           'WITH GRANT OPTION;'.
--
-- ============================================================================
-- ROLLBACK (restores the pre-lockdown state exactly, from the captured artifacts).
-- Only for a real regression: it reinstates whatever access existed before,
-- including anon full CRUD on the audit trail if that is what was captured.
--
-- EXACTNESS, in order. Each step exists because skipping it leaves residue:
--   1. Refuse to run when there is no open run to restore (nothing to do, or
--      already rolled back) - so a second rollback cannot silently re-grant.
--   2. Drop the lockdown policies AND the helper function this migration added.
--   3. REVOKE the lockdown grants BEFORE replaying. Without this, a privilege
--      this migration granted but the prior state did not have (for example
--      service_role INSERT, if it previously held only SELECT) would survive the
--      replay, because GRANT is additive and never removes anything.
--   4. Replay captured policies verbatim.
--   5. Replay captured grants verbatim, INCLUDING WITH GRANT OPTION.
--   6. Restore the prior RLS flags, rather than assuming RLS was already on.
--   7. Mark the run rolled back, so the apply-side guard lets a future re-apply
--      capture a fresh snapshot.
-- No row of program_events is touched in either direction.
-- ============================================================================
/*
BEGIN;

DO $rollback$
DECLARE
  v_run   uuid;
  v_rls   boolean;
  v_force boolean;
  b       record;
  g       record;
BEGIN
  -- 1. The one run to restore.
  SELECT run_id, prior_rowsecurity, prior_forcerowsecurity
    INTO v_run, v_rls, v_force
    FROM public.program_events_rls_lockdown_runs
   WHERE rolled_back_at IS NULL
   ORDER BY captured_at DESC
   LIMIT 1;

  IF v_run IS NULL THEN
    RAISE EXCEPTION
      'ROLLBACK ABORTED: no open lockdown run found. Either this lockdown was '
      'never applied, or it has already been rolled back. Inspect with: SELECT * '
      'FROM public.program_events_rls_lockdown_runs ORDER BY captured_at DESC;';
  END IF;
  RAISE NOTICE 'rolling back lockdown run %', v_run;

  -- 2. Remove everything this migration created.
  DROP POLICY IF EXISTS "service_role_select_program_events" ON public.program_events;
  DROP POLICY IF EXISTS "service_role_insert_program_events" ON public.program_events;
  DROP POLICY IF EXISTS "staff_select_program_events"        ON public.program_events;
  DROP POLICY IF EXISTS "staff_insert_program_events"        ON public.program_events;
  DROP FUNCTION IF EXISTS public.is_staff_event_writer();

  -- 3. Clear the lockdown grants so the replay is exact, not additive.
  REVOKE ALL ON public.program_events FROM PUBLIC;
  REVOKE ALL ON public.program_events FROM anon;
  REVOKE ALL ON public.program_events FROM authenticated;
  REVOKE ALL ON public.program_events FROM service_role;

  -- 4. Replay captured policies for THIS run only.
  FOR b IN
    SELECT policyname, restore_sql
      FROM public.program_events_rls_policy_backup
     WHERE run_id = v_run
     ORDER BY policyname
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'program_events'
         AND policyname = b.policyname
    ) THEN
      EXECUTE b.restore_sql;
      RAISE NOTICE 'restored program_events policy: %', b.policyname;
    END IF;
  END LOOP;

  -- 5. Replay captured grants for THIS run only, grant options included.
  FOR g IN
    SELECT restore_sql
      FROM public.program_events_rls_grant_backup
     WHERE run_id = v_run
     ORDER BY grantee, privilege_type
  LOOP
    EXECUTE g.restore_sql;
  END LOOP;

  -- 6. Restore the prior RLS flags exactly as captured.
  IF v_rls THEN
    ALTER TABLE public.program_events ENABLE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE public.program_events DISABLE ROW LEVEL SECURITY;
  END IF;
  IF v_force THEN
    ALTER TABLE public.program_events FORCE ROW LEVEL SECURITY;
  ELSE
    ALTER TABLE public.program_events NO FORCE ROW LEVEL SECURITY;
  END IF;
  RAISE NOTICE 'restored prior RLS flags: enabled=%, forced=%', v_rls, v_force;

  -- 7. Close the run so a future re-apply captures fresh.
  UPDATE public.program_events_rls_lockdown_runs
     SET rolled_back_at = now()
   WHERE run_id = v_run;
END
$rollback$;

NOTIFY pgrst, 'reload schema';
COMMIT;
*/
