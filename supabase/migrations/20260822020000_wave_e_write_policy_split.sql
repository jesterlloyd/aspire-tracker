-- ============================================================================
-- S-04: WAVE E WRITE POLICY SPLIT
-- ============================================================================
-- APPLY MANUALLY (Owner/Jester) in the Supabase SQL Editor, as ONE COMPLETE
-- BLOCK. The whole file is a single transaction, so it either applies fully or
-- not at all. Run db/audit/wave_e_write_split_preflight_and_verification.sql
-- (PRE-APPLY section) first, one section at a time.
--
-- WHAT THIS FIXES
-- Migration 20260712000004 (Wave E) created
--   FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff())
-- on a set of staff tables. public.is_staff() returns true for owner, admin,
-- co_lead, co-lead, interviewer AND viewer. Several of these tables are written
-- directly from the browser through PostgREST with only a client-side canEdit
-- check in front, so any active Viewer or Interviewer session could update
-- students, delete cohorts and slots, and edit contacts by calling PostgREST
-- directly. RLS was the only real gate and it was open to every staff role.
--
-- APPROVED DECISION
-- Read stays open to all staff (is_staff, unchanged). Write becomes active
-- Owner, Admin, or Co-Lead. Interviewer and Viewer become read-only on these
-- tables.
--
-- TABLES DELIBERATELY NOT TOUCHED, and why
--   interview_rubrics  20260822010000 already replaced the FOR ALL policy with
--                      four per-author policies keyed on
--                      can_manage_all_interview_rubrics(). Re-splitting it here
--                      would REGRESS that author restriction. Left alone.
--   program_events     20260805000002 already split it: SELECT on is_staff()
--                      excluding keith_tool_call rows, INSERT on
--                      is_staff_event_writer() (Viewer excluded), and no UPDATE
--                      or DELETE policy for anyone. Already narrower.
--   preceptors,        Their write policies are already Owner-only
--   preceptor_cohort_  (owners_insert/update/delete_*, is_owner = true), from
--   participation      the legacy migration_preceptor_schema_v2.sql. Wave E
--                      replaced only their read policy. Already narrower.
--   activity_logs      Its INSERT is is_staff() by design: logActivity() fires
--                      as a side effect of actions an Interviewer legitimately
--                      performs (saving a rubric). Narrowing it would break
--                      rubric saving for Interviewers. Left alone.
--   students DELETE,   20260818000000 already narrowed both to
--   student_shift_logs is_active_owner_or_admin(), which EXCLUDES Co-Lead and is
--   DELETE             therefore narrower than this migration's helper. Left
--                      alone rather than widened back.
--
-- This migration changes POLICIES ONLY. It writes no row in any application
-- table, and it drops no data.
-- ============================================================================

BEGIN;

-- ── 1. The write predicate ───────────────────────────────────────────────────
-- Active Owner, Admin, or Co-Lead. Matches the capability model already declared
-- in lib/server/access.js (student_manage and placement_manage are
-- ['admin','co-lead'], with Owner implicit through the can() Owner bypass), so
-- this is the same rule expressed in the database rather than a second
-- definition.
--
-- Both legacy spellings are accepted, exactly as is_staff() already tolerates
-- them, and normalizeRole() in access.js folds co_lead to co-lead.
--
-- is_owner is honored independently of role, matching every other helper in this
-- codebase.
--
-- NOTE: public.can_manage_all_interview_rubrics() (20260822010000) is the same
-- predicate, scoped by name to rubrics. That function is left untouched; this is
-- the general-purpose form. If the two ever need to diverge, they can.
--
-- Conventions follow is_active_owner_or_admin(): SECURITY DEFINER so the lookup
-- is not subject to user_profiles' own RLS, STABLE, and a pinned search_path.
CREATE OR REPLACE FUNCTION public.is_active_staff_writer()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.auth_user_id = auth.uid()
      AND COALESCE(up.is_active, true) = true
      AND (
        COALESCE(up.is_owner, false) = true
        OR up.role IN ('owner', 'admin', 'co-lead', 'co_lead')
      )
  );
$$;

COMMENT ON FUNCTION public.is_active_staff_writer() IS
  'S-04 write predicate: active Owner, Admin, or Co-Lead. Read stays on is_staff(). '
  'Accepts both co_lead and co-lead spellings.';

REVOKE ALL ON FUNCTION public.is_active_staff_writer() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_staff_writer() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_active_staff_writer() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_staff_writer() TO service_role;

-- ── 2. Split the FOR ALL policies ────────────────────────────────────────────
-- One SELECT policy on is_staff() (read unchanged) plus separate INSERT, UPDATE
-- and DELETE policies on the new helper, for each table that still carries a
-- Wave E FOR ALL policy. The old policy name is named explicitly rather than
-- discovered, so this cannot drop a policy some later migration introduced.
DO $split$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('cohorts',                       'staff_all_cohorts'),
      ('communications',                'staff_all_communications'),
      ('units',                         'staff_all_units'),
      ('matches',                       'staff_all_matches'),
      ('interview_sessions',            'staff_all_interview_sessions'),
      ('interviewers',                  'staff_all_interviewers'),
      ('interviews',                    'staff_all_interviews'),
      ('interview_availability_blocks', 'staff_all_availability_blocks'),
      ('interview_slots',               'staff_all_interview_slots'),
      ('ngrp_outcomes',                 'staff_all_ngrp_outcomes'),
      ('cohort_snapshots',              'staff_all_cohort_snapshots')
    ) AS v(tbl, old_policy)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.old_policy, t.tbl);

    -- Idempotent: drop the new names too, so a re-run is safe.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_staff_select', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_writer_insert', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_writer_update', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_writer_delete', t.tbl);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_staff())',
      t.tbl || '_staff_select', t.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_staff_writer())',
      t.tbl || '_writer_insert', t.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.is_active_staff_writer()) WITH CHECK (public.is_active_staff_writer())',
      t.tbl || '_writer_update', t.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.is_active_staff_writer())',
      t.tbl || '_writer_delete', t.tbl);

    RAISE NOTICE 'split write policies on public.%', t.tbl;
  END LOOP;
END
$split$;

-- ── 3. contacts: replace the three write policies, keep the read ─────────────
-- Wave E already used per-command policies here, so only the three write ones
-- change. contacts_staff_select is deliberately untouched.
DROP POLICY IF EXISTS "contacts_staff_insert" ON public.contacts;
DROP POLICY IF EXISTS "contacts_staff_update" ON public.contacts;
DROP POLICY IF EXISTS "contacts_staff_delete" ON public.contacts;
DROP POLICY IF EXISTS "contacts_writer_insert" ON public.contacts;
DROP POLICY IF EXISTS "contacts_writer_update" ON public.contacts;
DROP POLICY IF EXISTS "contacts_writer_delete" ON public.contacts;

CREATE POLICY "contacts_writer_insert" ON public.contacts
  FOR INSERT TO authenticated WITH CHECK (public.is_active_staff_writer());
CREATE POLICY "contacts_writer_update" ON public.contacts
  FOR UPDATE TO authenticated USING (public.is_active_staff_writer()) WITH CHECK (public.is_active_staff_writer());
CREATE POLICY "contacts_writer_delete" ON public.contacts
  FOR DELETE TO authenticated USING (public.is_active_staff_writer());

-- ── 4. students and student_shift_logs: INSERT and UPDATE only ───────────────
-- 20260818000000 already split these. Its SELECT (is_staff) stays as is, and its
-- DELETE (is_active_owner_or_admin, which excludes Co-Lead) is NARROWER than
-- this migration's helper and is deliberately NOT widened. Only the two write
-- policies that still carry is_staff() are replaced.
DROP POLICY IF EXISTS "staff_insert_students" ON public.students;
DROP POLICY IF EXISTS "staff_update_students" ON public.students;
DROP POLICY IF EXISTS "students_writer_insert" ON public.students;
DROP POLICY IF EXISTS "students_writer_update" ON public.students;

CREATE POLICY "students_writer_insert" ON public.students
  FOR INSERT TO authenticated WITH CHECK (public.is_active_staff_writer());
CREATE POLICY "students_writer_update" ON public.students
  FOR UPDATE TO authenticated USING (public.is_active_staff_writer()) WITH CHECK (public.is_active_staff_writer());

DROP POLICY IF EXISTS "staff_insert_student_shift_logs" ON public.student_shift_logs;
DROP POLICY IF EXISTS "staff_update_student_shift_logs" ON public.student_shift_logs;
DROP POLICY IF EXISTS "student_shift_logs_writer_insert" ON public.student_shift_logs;
DROP POLICY IF EXISTS "student_shift_logs_writer_update" ON public.student_shift_logs;

CREATE POLICY "student_shift_logs_writer_insert" ON public.student_shift_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_active_staff_writer());
CREATE POLICY "student_shift_logs_writer_update" ON public.student_shift_logs
  FOR UPDATE TO authenticated USING (public.is_active_staff_writer()) WITH CHECK (public.is_active_staff_writer());

-- ── 5. Consistency: revoke the default grant on a trigger-only function ──────
-- message_assert_participant_limit() was created by 20260720000000, AFTER the
-- Wave F-1 EXECUTE sweep (20260712000006) had already run, so it kept Postgres's
-- default PUBLIC EXECUTE grant. It returns trigger, which Postgres refuses to
-- call outside a trigger context and PostgREST does not expose, so this is
-- consistency with every other function in the schema rather than a live
-- exposure being closed.
REVOKE ALL ON FUNCTION public.message_assert_participant_limit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.message_assert_participant_limit() FROM anon;

-- ── 6. S-07: one booking per student, enforced by the database ───────────────
-- api/interview-book.js claims a slot with a conditional UPDATE, which makes two
-- callers racing for the SAME slot safe. What it cannot make deterministic is one
-- student claiming two DIFFERENT slots concurrently: the pre-claim check cannot
-- see a booking made by a request still in flight, so the endpoint falls back to
-- a post-claim re-check that releases the slot it just took. Safe, but
-- retry-dependent. This index makes it deterministic.
--
-- GUARD FIRST: a CREATE UNIQUE INDEX over existing duplicates fails with a
-- message that does not say which rows caused it. This raises a descriptive
-- error instead, and because the whole file is one transaction, nothing is
-- applied when it fires. PRE-APPLY query 6 lists the same rows.
DO $one_booking$
DECLARE
  v_dupes text;
BEGIN
  SELECT string_agg(format('student %s holds %s booked slots', booked_by_student_id, n), E'\n  ')
    INTO v_dupes
  FROM (
    SELECT booked_by_student_id, count(*) AS n
    FROM public.interview_slots
    WHERE is_booked = true AND booked_by_student_id IS NOT NULL
    GROUP BY booked_by_student_id
    HAVING count(*) > 1
  ) d;

  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION
      'S-04 ABORTED: interview_slots already violates one-booking-per-student.%  %'
      'Resolve these before applying (cancel the extra bookings), then re-run.',
      E'\n  ', v_dupes;
  END IF;
END
$one_booking$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_interview_slots_one_booking_per_student
  ON public.interview_slots (booked_by_student_id)
  WHERE is_booked = true AND booked_by_student_id IS NOT NULL;

COMMENT ON INDEX public.uq_interview_slots_one_booking_per_student IS
  'S-07: a student may hold at most one booked interview slot. Makes the '
  'application-level guard in api/interview-book.js deterministic rather than '
  'retry-dependent.';

-- ── 7. S-03: bind stored file references to the owning student ───────────────
-- api/student-intake-submit.js, api/portal/my-profile.js and api/student-update.js
-- now validate that resume_url and headshot_url equal the canonical path for the
-- student they are stored on. This makes that structural: it holds no matter
-- which code path writes, including a future one and including direct SQL.
--
-- The rule is the same one lib/server/studentFiles.js refBelongsToStudent()
-- applies on read: the path's SECOND segment must be the row's own id. The cohort
-- segment is deliberately not compared, for the same reason it is not compared on
-- read (see that function's comment).
--
-- Tolerant of every legitimate shape: NULL, empty string, and a legacy full
-- public URL (reduced to its object path first, exactly as the resolver does).
CREATE OR REPLACE FUNCTION public.students_assert_file_ref_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_col   text;
  v_raw   text;
  v_path  text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['resume_url', 'headshot_url'] LOOP
    v_raw := CASE v_col WHEN 'resume_url' THEN NEW.resume_url ELSE NEW.headshot_url END;

    -- Nothing stored: always allowed (this is how a reference is cleared).
    CONTINUE WHEN v_raw IS NULL OR btrim(v_raw) = '';

    -- Mirror parseStoredFileRef: a legacy public URL yields the path after the
    -- bucket marker, with any query string or fragment dropped.
    v_path := btrim(v_raw);
    IF position('/object/public/student-files/' in v_path) > 0 THEN
      v_path := regexp_replace(split_part(v_path, '/object/public/student-files/', 2), '[?#].*$', '');
    END IF;
    v_path := regexp_replace(v_path, '^/+', '');

    IF array_length(string_to_array(v_path, '/'), 1) IS DISTINCT FROM 3
       OR lower(split_part(v_path, '/', 2)) IS DISTINCT FROM lower(NEW.id::text) THEN
      RAISE EXCEPTION
        'students.% must reference this student''s own file path (expected second segment %)',
        v_col, NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.students_assert_file_ref_owner() IS
  'S-03: rejects a resume_url or headshot_url whose object path names a different '
  'student. Mirrors lib/server/studentFiles.js refBelongsToStudent().';

DROP TRIGGER IF EXISTS trg_students_assert_file_ref_owner ON public.students;
CREATE TRIGGER trg_students_assert_file_ref_owner
  BEFORE INSERT OR UPDATE OF resume_url, headshot_url ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.students_assert_file_ref_owner();

COMMIT;


-- ── Verification ─────────────────────────────────────────────────────────────
-- See db/audit/wave_e_write_split_preflight_and_verification.sql, POST-APPLY
-- section. Run each numbered section separately.


-- ============================================================================
-- ROLLBACK (INERT). Restores the exact prior state: the Wave E FOR ALL policies,
-- the three contacts write policies, the two is_staff() write policies on
-- students and student_shift_logs, the PUBLIC grant on
-- message_assert_participant_limit, and removes the new index, trigger, function
-- and helper. Nothing else is touched, because nothing else was changed.
--
-- Reintroduces the S-04 exposure by design: only for emergency recovery.
-- ============================================================================
/*
BEGIN;

DROP TRIGGER IF EXISTS trg_students_assert_file_ref_owner ON public.students;
DROP FUNCTION IF EXISTS public.students_assert_file_ref_owner();
DROP INDEX IF EXISTS public.uq_interview_slots_one_booking_per_student;

GRANT EXECUTE ON FUNCTION public.message_assert_participant_limit() TO PUBLIC;

DO $rb$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('cohorts',                       'staff_all_cohorts'),
      ('communications',                'staff_all_communications'),
      ('units',                         'staff_all_units'),
      ('matches',                       'staff_all_matches'),
      ('interview_sessions',            'staff_all_interview_sessions'),
      ('interviewers',                  'staff_all_interviewers'),
      ('interviews',                    'staff_all_interviews'),
      ('interview_availability_blocks', 'staff_all_availability_blocks'),
      ('interview_slots',               'staff_all_interview_slots'),
      ('ngrp_outcomes',                 'staff_all_ngrp_outcomes'),
      ('cohort_snapshots',              'staff_all_cohort_snapshots')
    ) AS v(tbl, old_policy)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_staff_select', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_writer_insert', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_writer_update', t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t.tbl || '_writer_delete', t.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff())',
      t.old_policy, t.tbl);
  END LOOP;
END
$rb$;

DROP POLICY IF EXISTS "contacts_writer_insert" ON public.contacts;
DROP POLICY IF EXISTS "contacts_writer_update" ON public.contacts;
DROP POLICY IF EXISTS "contacts_writer_delete" ON public.contacts;
CREATE POLICY "contacts_staff_insert" ON public.contacts
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());
CREATE POLICY "contacts_staff_update" ON public.contacts
  FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY "contacts_staff_delete" ON public.contacts
  FOR DELETE TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "students_writer_insert" ON public.students;
DROP POLICY IF EXISTS "students_writer_update" ON public.students;
CREATE POLICY "staff_insert_students" ON public.students
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());
CREATE POLICY "staff_update_students" ON public.students
  FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS "student_shift_logs_writer_insert" ON public.student_shift_logs;
DROP POLICY IF EXISTS "student_shift_logs_writer_update" ON public.student_shift_logs;
CREATE POLICY "staff_insert_student_shift_logs" ON public.student_shift_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());
CREATE POLICY "staff_update_student_shift_logs" ON public.student_shift_logs
  FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP FUNCTION IF EXISTS public.is_active_staff_writer();

COMMIT;
*/
