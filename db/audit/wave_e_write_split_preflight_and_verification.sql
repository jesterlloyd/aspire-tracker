-- ============================================================================
-- S-04 WAVE E WRITE POLICY SPLIT: read-only PRE-APPLY and POST-APPLY queries
-- ============================================================================
-- READ ONLY. Nothing here writes, and nothing exposes a secret.
--
-- Run the PRE-APPLY section BEFORE applying
-- supabase/migrations/20260822020000_wave_e_write_policy_split.sql, and the
-- POST-APPLY section after.
--
-- RUN EACH NUMBERED SECTION SEPARATELY. The Supabase SQL Editor returns only one
-- result set when several SELECT statements are submitted together, so running a
-- whole section at once silently hides all but the last result. The migration
-- itself is the opposite: it is transaction-wrapped and must be run as ONE
-- complete block.
-- ============================================================================


-- ############################################################################
-- PRE-APPLY (run BEFORE the migration)
-- ############################################################################

-- ── PRE 1: the current policy set on every table in scope ───────────────────
-- The authoritative "before" picture. SAVE THIS RESULT SET: POST 1 is compared
-- against it, and the rollback restores exactly what appears here.
-- Expected NOW: one FOR ALL row (cmd = 'ALL') per table for the eight tables
-- carrying a Wave E policy that this migration splits, plus the per-command
-- rows for contacts, students and student_shift_logs. Run alone.
SELECT
  p.tablename,
  p.policyname,
  p.cmd,
  p.roles,
  p.qual        AS using_expression,
  p.with_check  AS with_check_expression
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND p.tablename IN (
    'cohorts', 'communications', 'units', 'matches',
    'interviewers', 'interviews', 'ngrp_outcomes', 'cohort_snapshots',
    'contacts', 'students', 'student_shift_logs'
  )
ORDER BY p.tablename, p.cmd, p.policyname;

-- ── PRE 2: every policy anywhere in public that still writes via is_staff() ──
-- The full blast radius of the finding, including tables outside this migration.
-- Expected NOW: rows for the tables above. Rows for activity_logs (INSERT) and
-- program_events (INSERT, via is_staff_event_writer) are EXPECTED to remain
-- after the migration and are deliberately out of scope, because an Interviewer
-- legitimately triggers both when saving a rubric. Run alone.
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd <> 'SELECT'
  AND (COALESCE(qual, '') LIKE '%is_staff%' OR COALESCE(with_check, '') LIKE '%is_staff%')
ORDER BY tablename, cmd, policyname;

-- ── PRE 3: confirm the tables deliberately left alone are NOT about to change ─
-- Two groups are excluded from the migration on purpose. SAVE THIS RESULT SET:
-- POST 6 must be identical to it.
--   Already narrower: interview_rubrics (can_manage_all_interview_rubrics),
--     program_events (is_staff_event_writer INSERT, no UPDATE or DELETE row),
--     preceptors and preceptor_cohort_participation (is_owner subquery), and the
--     two DELETE policies on is_active_owner_or_admin.
--   Self-service: interview_availability_blocks, interview_slots and
--     interview_sessions keep their FOR ALL on is_staff(), because Interviewers
--     manage their own day through them. Expected: one cmd = 'ALL' row each.
-- Run alone.
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    tablename IN ('interview_rubrics', 'program_events', 'preceptors', 'preceptor_cohort_participation',
                  'interview_availability_blocks', 'interview_slots', 'interview_sessions')
    OR policyname IN ('students_owner_admin_delete', 'student_shift_logs_owner_admin_delete')
  )
ORDER BY tablename, cmd, policyname;

-- ── PRE 4: does the new helper name already exist? ──────────────────────────
-- Expected: 0 rows. A row means a prior object owns the name and must be
-- reviewed before applying. Run alone.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'is_active_staff_writer';

-- ── PRE 5: the existing predicate this one mirrors ─────────────────────────
-- Confirms can_manage_all_interview_rubrics is the same rule, so the new helper
-- matches rather than invents. Expected: prosecdef = true, proconfig contains
-- search_path=public, pg_catalog. Run alone.
SELECT p.proname, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('can_manage_all_interview_rubrics', 'is_active_owner_or_admin', 'is_staff');

-- ── PRE 6: BLOCKING. one-booking-per-student violations ─────────────────────
-- The migration raises a descriptive exception and applies nothing if this
-- returns any row, because the partial unique index cannot be created over
-- duplicates. Expected: 0 rows. If not, cancel the extra bookings first.
-- Run alone.
SELECT
  booked_by_student_id,
  count(*)                      AS booked_slots,
  array_agg(id ORDER BY id)     AS slot_ids
FROM public.interview_slots
WHERE is_booked = true AND booked_by_student_id IS NOT NULL
GROUP BY booked_by_student_id
HAVING count(*) > 1
ORDER BY booked_slots DESC;

-- ── PRE 7: BLOCKING. rows the new S-03 trigger would reject ────────────────
-- The trigger fires only on INSERT or UPDATE, so existing rows are not
-- revalidated on apply and this cannot fail the migration. It matters because
-- any row listed here would refuse the NEXT write that touches it. Expected:
-- 0 rows (your production ownership check already returned zero). Run alone.
WITH refs AS (
  SELECT id AS student_id, 'resume_url' AS col, resume_url AS raw
  FROM public.students WHERE resume_url IS NOT NULL AND btrim(resume_url) <> ''
  UNION ALL
  SELECT id, 'headshot_url', headshot_url
  FROM public.students WHERE headshot_url IS NOT NULL AND btrim(headshot_url) <> ''
),
resolved AS (
  SELECT student_id, col, raw,
    regexp_replace(
      CASE WHEN position('/object/public/student-files/' in btrim(raw)) > 0
           THEN regexp_replace(split_part(btrim(raw), '/object/public/student-files/', 2), '[?#].*$', '')
           ELSE btrim(raw) END,
      '^/+', '') AS object_path
  FROM refs
)
SELECT student_id, col, object_path, split_part(object_path, '/', 2) AS path_student_segment
FROM resolved
WHERE array_length(string_to_array(object_path, '/'), 1) IS DISTINCT FROM 3
   OR lower(split_part(object_path, '/', 2)) IS DISTINCT FROM lower(student_id::text)
ORDER BY col, student_id;

-- ── PRE 8: the grant this migration revokes ────────────────────────────────
-- Expected NOW: a PUBLIC (grantee '=') entry in proacl, or proacl IS NULL which
-- also means the PUBLIC default applies. Run alone.
SELECT p.proname, p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'message_assert_participant_limit';


-- ############################################################################
-- POST-APPLY (run AFTER the migration)
-- ############################################################################

-- ── POST 1: no FOR ALL policy remains on any table in scope ────────────────
-- PASS: 0 rows. This is the finding closed. Run alone.
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd = 'ALL'
  AND tablename IN (
    'cohorts', 'communications', 'units', 'matches',
    'interviewers', 'interviews', 'ngrp_outcomes', 'cohort_snapshots',
    'contacts', 'students', 'student_shift_logs'
  )
ORDER BY tablename, policyname;

-- ── POST 2: read is still staff-wide, write names the new helper ───────────
-- PASS: every SELECT row shows is_staff(); every INSERT, UPDATE and DELETE row
-- shows is_active_staff_writer(), EXCEPT students and student_shift_logs DELETE,
-- which correctly still show is_active_owner_or_admin() (narrower, preserved).
-- Run alone.
SELECT
  tablename,
  cmd,
  policyname,
  CASE
    WHEN COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%is_active_staff_writer%'   THEN 'writer helper'
    WHEN COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%is_active_owner_or_admin%' THEN 'owner/admin (preserved, narrower)'
    WHEN COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%is_staff%'                 THEN 'is_staff'
    ELSE 'other: review'
  END AS predicate
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'cohorts', 'communications', 'units', 'matches',
    'interviewers', 'interviews', 'ngrp_outcomes', 'cohort_snapshots',
    'contacts', 'students', 'student_shift_logs'
  )
ORDER BY tablename, cmd, policyname;

-- ── POST 3: no is_staff() write policy remains in scope ────────────────────
-- PASS: rows ONLY for activity_logs, program_events, interview_availability_blocks,
-- interview_slots and interview_sessions. All five are deliberately out of scope:
-- the first two because an Interviewer writes them when saving a rubric, the
-- last three because an Interviewer manages their own interview day through
-- them. Any other table appearing here is a miss. Run alone.
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd <> 'SELECT'
  AND (COALESCE(qual, '') LIKE '%is_staff%' OR COALESCE(with_check, '') LIKE '%is_staff%')
ORDER BY tablename, cmd, policyname;

-- ── POST 4: the helper's security properties and grants ────────────────────
-- PASS: prosecdef = true, provolatile = 's' (STABLE), proconfig contains
-- search_path=public, pg_catalog, and proacl grants EXECUTE to authenticated and
-- service_role with NO PUBLIC ('=') entry and no anon entry. Run alone.
SELECT
  p.proname,
  p.prosecdef                                   AS security_definer,
  p.provolatile                                 AS volatility,
  p.proconfig                                   AS config,
  p.proacl                                      AS grants,
  (array_to_string(COALESCE(p.proacl, '{}')::text[], ',') LIKE '%=X/%'
     AND array_to_string(COALESCE(p.proacl, '{}')::text[], ',') NOT LIKE '%anon=%') AS looks_correct
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'is_active_staff_writer';

-- ── POST 5: the helper accepts both Co-Lead spellings ──────────────────────
-- PASS: the definition contains 'co-lead' AND 'co_lead', and an is_active check.
-- Run alone.
SELECT
  pg_get_functiondef(p.oid) LIKE '%co-lead%'          AS accepts_hyphen,
  pg_get_functiondef(p.oid) LIKE '%co\_lead%'         AS accepts_underscore,
  pg_get_functiondef(p.oid) LIKE '%is_active%'        AS checks_active,
  pg_get_functiondef(p.oid) LIKE '%interviewer%'      AS wrongly_admits_interviewer,
  pg_get_functiondef(p.oid) LIKE '%viewer%'           AS wrongly_admits_viewer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'is_active_staff_writer';

-- ── POST 6: the tables deliberately left alone are unchanged ───────────────
-- PASS: identical to PRE 3. In particular the three self-service tables still
-- show their single cmd = 'ALL' row on is_staff(). Run alone.
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    tablename IN ('interview_rubrics', 'program_events', 'preceptors', 'preceptor_cohort_participation',
                  'interview_availability_blocks', 'interview_slots', 'interview_sessions')
    OR policyname IN ('students_owner_admin_delete', 'student_shift_logs_owner_admin_delete')
  )
ORDER BY tablename, cmd, policyname;

-- ── POST 7: the new index exists and is partial ────────────────────────────
-- PASS: one row, indisunique = true, and the definition carries the WHERE clause.
-- Run alone.
SELECT i.relname AS index_name, x.indisunique, pg_get_indexdef(i.oid) AS definition
FROM pg_class i
JOIN pg_index x ON x.indexrelid = i.oid
JOIN pg_class t ON t.oid = x.indrelid
WHERE t.relname = 'interview_slots'
  AND i.relname = 'uq_interview_slots_one_booking_per_student';

-- ── POST 8: the new trigger exists on the right columns ────────────────────
-- PASS: one row, BEFORE INSERT OR UPDATE OF resume_url, headshot_url, FOR EACH ROW.
-- Run alone.
SELECT t.tgname, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE c.relname = 'students'
  AND t.tgname = 'trg_students_assert_file_ref_owner'
  AND NOT t.tgisinternal;

-- ── POST 9: the trigger-only function no longer carries the PUBLIC grant ───
-- PASS: proacl has no '=' (PUBLIC) entry and no anon entry. Run alone.
SELECT p.proname, p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'message_assert_participant_limit';

-- ── POST 10: no unexpected policy appeared on any table in scope ───────────
-- PASS: exactly four rows per split table (SELECT, INSERT, UPDATE, DELETE),
-- four for contacts, and four each for students and student_shift_logs. Any
-- other count is a miss. Run alone.
SELECT tablename, count(*) AS policies, array_agg(cmd ORDER BY cmd) AS commands
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'cohorts', 'communications', 'units', 'matches',
    'interviewers', 'interviews', 'ngrp_outcomes', 'cohort_snapshots',
    'contacts', 'students', 'student_shift_logs'
  )
GROUP BY tablename
ORDER BY tablename;
