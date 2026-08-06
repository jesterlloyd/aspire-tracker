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
--   authenticated  : STAFF ONLY (public.is_staff()), and only SELECT + INSERT,
--                    and only for events that are not Keith audit rows.
--                    No UPDATE policy and no DELETE policy exists for any client
--                    role, so the trail becomes append-only from the browser.
--   service_role   : unchanged full access (it also bypasses RLS); every server
--                    endpoint keeps writing exactly as it does today.
--   PUBLIC         : no grant (it would otherwise be inherited by anon).
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
END $$;

-- ── 2. Policy backup artifact (exact definitions, for an exact rollback) ─────
-- Every policy this migration drops is snapshotted here first, together with the
-- exact CREATE POLICY statement that recreates it. The rollback replays
-- restore_sql verbatim; it never guesses or reconstructs a policy definition.
CREATE TABLE IF NOT EXISTS public.program_events_rls_policy_backup (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
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

INSERT INTO public.program_events_rls_policy_backup
  (policyname, cmd, permissive, roles, qual, with_check, restore_sql)
SELECT
  p.policyname,
  p.cmd,
  p.permissive,
  p.roles::text[],
  p.qual,
  p.with_check,
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
WHERE p.schemaname = 'public'
  AND p.tablename  = 'program_events'
  AND NOT EXISTS (
    SELECT 1 FROM public.program_events_rls_policy_backup b
    WHERE b.policyname = p.policyname
  );

-- ── 3. Grant backup artifact (privileges are restored from capture, not guessed) ──
-- Captured from pg_class.relacl via aclexplode (not information_schema, which is
-- filtered by the querying role's own privileges and can under-report).
CREATE TABLE IF NOT EXISTS public.program_events_rls_grant_backup (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  grantee        text        NOT NULL,
  privilege_type text        NOT NULL,
  is_grantable   boolean,
  restore_sql    text        NOT NULL,
  captured_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.program_events_rls_grant_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.program_events_rls_grant_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.program_events_rls_grant_backup TO service_role;

INSERT INTO public.program_events_rls_grant_backup
  (grantee, privilege_type, is_grantable, restore_sql)
SELECT
  g.grantee_name,
  g.privilege_type,
  g.is_grantable,
  format(
    'GRANT %s ON public.program_events TO %s;',
    g.privilege_type,
    CASE WHEN g.grantee_name = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(g.grantee_name) END
  )
FROM (
  SELECT
    COALESCE(pg_get_userbyid(NULLIF(a.grantee, 0)), 'PUBLIC') AS grantee_name,
    a.privilege_type,
    a.is_grantable
  FROM pg_class c
  CROSS JOIN LATERAL aclexplode(c.relacl) AS a
  WHERE c.oid = 'public.program_events'::regclass
) g
WHERE NOT EXISTS (
  SELECT 1 FROM public.program_events_rls_grant_backup b
  WHERE b.grantee = g.grantee_name AND b.privilege_type = g.privilege_type
);

-- ── 4. Drop EVERY existing policy on program_events (by enumeration, not name) ──
-- Name-based drops are what failed in Wave E (see Wave E-2's root-cause note), so
-- this loop is name-agnostic. Step 2 has already captured each definition. The
-- table is never left policy-less in a usable state: step 5 recreates the complete
-- intended set inside this same transaction, and RLS stays enabled throughout, so
-- even a mid-transaction failure rolls back to the prior state rather than to an
-- open table.
DO $$
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
END $$;

-- ── 5. The intended policy set ───────────────────────────────────────────────
ALTER TABLE public.program_events ENABLE ROW LEVEL SECURITY;

-- 5a. service_role: explicit, mirroring the policy the original
--     migration_program_events_rls.sql created. service_role also BYPASSES RLS, so
--     this is documentation-grade belt and braces; every server endpoint listed in
--     the header keeps working with or without it.
CREATE POLICY "service_role_all_program_events" ON public.program_events
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- 5b. Staff read. Keith audit rows are excluded: no browser query can return one
--     today, and the audited subject must not read its own audit trail.
CREATE POLICY "staff_select_program_events" ON public.program_events
  FOR SELECT TO authenticated
  USING (
    public.is_staff()
    AND event_type IS DISTINCT FROM 'keith_tool_call'
  );

-- 5c. Staff append. created_by is intentionally NOT constrained: logEvent() writes
--     created_by = 'system' for every auto-logged event from the browser.
CREATE POLICY "staff_insert_program_events" ON public.program_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_staff()
    AND event_type IS DISTINCT FROM 'keith_tool_call'
  );

-- 5d. Deliberately absent: no UPDATE policy and no DELETE policy for any client
--     role. Nothing in the repository updates program_events, and the only DELETE
--     call site is behind a disabled UI block. Corrections are made through the
--     service role.

-- ── 6. Table grants ──────────────────────────────────────────────────────────
-- Policies alone are not enough: a surviving table grant to anon (or an inherited
-- PUBLIC grant) is what makes the anon key dangerous in the first place. PUBLIC is
-- revoked because anon and authenticated inherit from it; both roles then get only
-- what they are supposed to have, explicitly.
REVOKE ALL ON public.program_events FROM PUBLIC;
REVOKE ALL ON public.program_events FROM anon;
REVOKE ALL ON public.program_events FROM authenticated;

GRANT SELECT, INSERT ON public.program_events TO authenticated;
GRANT ALL    ON public.program_events TO service_role;

-- ── 7. Reload PostgREST schema cache ─────────────────────────────────────────
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
--     three rows, in this order:
--       service_role_all_program_events  | ALL    | {service_role}
--       staff_insert_program_events      | INSERT | {authenticated}
--       staff_select_program_events      | SELECT | {authenticated}
--     Both staff policies must mention is_staff() and 'keith_tool_call'. There must
--     be NO row with cmd = 'UPDATE' or cmd = 'DELETE'.
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
-- V5. Table grants. Expected: authenticated has exactly SELECT and INSERT;
--     service_role has the full set; anon and PUBLIC appear on ZERO rows.
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
-- ============================================================================
-- ROLLBACK (restores the pre-lockdown state exactly, from the captured artifacts).
-- Only for a real regression: it reinstates anon full CRUD on the audit trail.
-- Every recreated policy and every regranted privilege is replayed verbatim from
-- the backup tables; nothing is reconstructed by hand. No row of program_events is
-- touched in either direction.
-- ============================================================================
/*
BEGIN;

-- 1. Remove the lockdown policies.
DROP POLICY IF EXISTS "service_role_all_program_events" ON public.program_events;
DROP POLICY IF EXISTS "staff_select_program_events"     ON public.program_events;
DROP POLICY IF EXISTS "staff_insert_program_events"     ON public.program_events;

-- 2. Replay every captured policy definition that is not already present.
DO $$
DECLARE
  b record;
BEGIN
  FOR b IN
    SELECT policyname, restore_sql
    FROM public.program_events_rls_policy_backup
    ORDER BY captured_at, policyname
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
END $$;

-- 3. Replay every captured table grant.
DO $$
DECLARE
  g record;
BEGIN
  FOR g IN
    SELECT restore_sql FROM public.program_events_rls_grant_backup
    ORDER BY captured_at, grantee, privilege_type
  LOOP
    EXECUTE g.restore_sql;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
*/
