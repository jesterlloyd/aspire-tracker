-- ============================================================================
-- PHASE 2B PREFLIGHT + VERIFICATION + ROLLBACK for
--   supabase/migrations/20260722000000_preceptor_mirror_repair_and_sync.sql
-- ============================================================================
-- Run the BEFORE block (read-only) immediately before applying the migration and confirm
-- the counts match the accepted Phase 2A findings. Run the AFTER block (read-only)
-- immediately after COMMIT. The ROLLBACK block is a WRITE script; run it only to revert.
-- Run as the service role or an owner/admin.
-- ============================================================================


-- ############################################################################
-- BEFORE (read-only). Expect exactly: 6a=4, 7a=4, everything else 0.
-- ############################################################################

-- B1. Defect counts (must match the accepted Phase 2A findings before applying).
WITH
missing AS (SELECT s.id FROM students s WHERE s.preceptor_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM student_preceptor_assignments a
    WHERE a.student_id=s.id AND a.cohort_id=s.cohort_id AND a.role='primary' AND a.status='active')),
stale AS (SELECT s.id FROM students s
  JOIN student_preceptor_assignments a ON a.student_id=s.id AND a.cohort_id=s.cohort_id AND a.role='primary' AND a.status='active'
  WHERE s.preceptor_id IS DISTINCT FROM a.preceptor_id),
freetext AS (SELECT s.id FROM students s JOIN preceptors p ON p.id=s.preceptor_id
  WHERE s.preceptor_id IS NOT NULL AND (
    btrim(lower(coalesce(s.matched_preceptor,''))) IS DISTINCT FROM btrim(lower(coalesce(p.full_name,'')))
    OR btrim(lower(coalesce(s.preceptor_email,''))) IS DISTINCT FROM btrim(lower(coalesce(p.email,''))))),
matchfk AS (SELECT m.id FROM matches m JOIN students s ON s.id=m.student_id AND s.cohort_id=m.cohort_id
  WHERE m.preceptor_id IS DISTINCT FROM s.preceptor_id)
SELECT '1_primary_missing_mirror' AS category, count(*) FROM missing
UNION ALL SELECT '2_primary_stale_mirror',       count(*) FROM stale
UNION ALL SELECT '6a_freetext_disagrees',        count(*) FROM freetext
UNION ALL SELECT '7a_match_preceptor_disagrees', count(*) FROM matchfk
ORDER BY category;

-- B2. Baseline count of student_preceptor_assignments rows by (role, status). Record this;
--     the repair must leave it UNCHANGED (it writes no assignment rows).
SELECT role, status, count(*) AS rows
FROM student_preceptor_assignments
GROUP BY role, status
ORDER BY role, status;

-- B3. The equivalence gate (should already be clean per Phase 2A). MUST RETURN ZERO ROWS.
SELECT s.id AS student_id, s.preceptor_id AS canonical, a.preceptor_id AS active_primary
FROM students s
LEFT JOIN student_preceptor_assignments a
  ON a.student_id=s.id AND a.cohort_id=s.cohort_id AND a.role='primary' AND a.status='active'
WHERE s.preceptor_id IS DISTINCT FROM a.preceptor_id;

-- B4. Confirm the trigger does not already exist (fresh apply). Expect ZERO rows.
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.students'::regclass AND tgname = 'trg_sync_primary_preceptor_mirror';


-- ############################################################################
-- AFTER (read-only). Run immediately after COMMIT.
-- ############################################################################

-- A1. Defect counts now ZERO for 6a and 7a (re-run B1's CTEs). Expect all four = 0.
WITH
missing AS (SELECT s.id FROM students s WHERE s.preceptor_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM student_preceptor_assignments a
    WHERE a.student_id=s.id AND a.cohort_id=s.cohort_id AND a.role='primary' AND a.status='active')),
stale AS (SELECT s.id FROM students s
  JOIN student_preceptor_assignments a ON a.student_id=s.id AND a.cohort_id=s.cohort_id AND a.role='primary' AND a.status='active'
  WHERE s.preceptor_id IS DISTINCT FROM a.preceptor_id),
freetext AS (SELECT s.id FROM students s JOIN preceptors p ON p.id=s.preceptor_id
  WHERE s.preceptor_id IS NOT NULL AND (
    btrim(lower(coalesce(s.matched_preceptor,''))) IS DISTINCT FROM btrim(lower(coalesce(p.full_name,'')))
    OR btrim(lower(coalesce(s.preceptor_email,''))) IS DISTINCT FROM btrim(lower(coalesce(p.email,''))))),
matchfk AS (SELECT m.id FROM matches m JOIN students s ON s.id=m.student_id AND s.cohort_id=m.cohort_id
  WHERE m.preceptor_id IS DISTINCT FROM s.preceptor_id)
SELECT '1_primary_missing_mirror' AS category, count(*) FROM missing
UNION ALL SELECT '2_primary_stale_mirror',       count(*) FROM stale
UNION ALL SELECT '6a_freetext_disagrees',        count(*) FROM freetext
UNION ALL SELECT '7a_match_preceptor_disagrees', count(*) FROM matchfk
ORDER BY category;

-- A2. student_preceptor_assignments rows by (role, status) are IDENTICAL to B2 (the repair
--     wrote no assignment rows). Compare visually to the B2 output.
SELECT role, status, count(*) AS rows
FROM student_preceptor_assignments
GROUP BY role, status
ORDER BY role, status;

-- A3. No secondary/coverage row was changed by the repair. The repair touched only students
--     and matches, so no secondary/coverage row exists in the rollback audit. Expect ZERO.
SELECT count(*) AS secondary_coverage_rows_in_audit
FROM public.preceptor_mirror_repair_audit
WHERE batch = 'phase2b-preceptor-mirror'
  AND entity = 'student_preceptor_assignments';

-- A4. The equivalence gate still clean: every active primary mirror equals the canonical.
--     MUST RETURN ZERO ROWS.
SELECT s.id AS student_id, s.preceptor_id AS canonical, a.preceptor_id AS active_primary
FROM students s
LEFT JOIN student_preceptor_assignments a
  ON a.student_id=s.id AND a.cohort_id=s.cohort_id AND a.role='primary' AND a.status='active'
WHERE s.preceptor_id IS DISTINCT FROM a.preceptor_id;

-- A5. Repaired-row provenance (before/after values, from the audit). One row per change.
SELECT entity, col, count(*) AS repaired_rows
FROM public.preceptor_mirror_repair_audit
WHERE batch = 'phase2b-preceptor-mirror'
GROUP BY entity, col
ORDER BY entity, col;

-- A6. The trigger exists, is an AFTER trigger on students, and the function is
--     SECURITY DEFINER with a fixed search_path and no PUBLIC execute.
SELECT t.tgname, t.tgenabled, p.prosecdef AS security_definer, p.proconfig AS settings
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.students'::regclass
  AND t.tgname = 'trg_sync_primary_preceptor_mirror';

SELECT has_function_privilege('public', 'public.sync_primary_preceptor_mirror()', 'EXECUTE') AS public_can_execute;
  -- Expect false.

-- A7. No new RLS policy was added to the relationship tables (permissions unchanged).
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('student_preceptor_assignments', 'matches', 'students')
ORDER BY tablename, policyname;
  -- Compare to the known baseline; there must be NO new policy from this migration.


-- ############################################################################
-- ROLLBACK (WRITE script; run ONLY to revert). Restores the one-time repair from the
-- audit table and removes the prevention trigger. It does NOT (and cannot) revert changes
-- the trigger made for real preceptor_id changes committed AFTER apply; those are
-- legitimate. Run inside a transaction.
-- ############################################################################
-- BEGIN;
--
-- -- Restore students display mirror.
-- UPDATE public.students s SET matched_preceptor = a.old_value
-- FROM public.preceptor_mirror_repair_audit a
-- WHERE a.batch='phase2b-preceptor-mirror' AND a.entity='students' AND a.col='matched_preceptor'
--   AND a.ref_id = s.id;
-- UPDATE public.students s SET preceptor_email = a.old_value
-- FROM public.preceptor_mirror_repair_audit a
-- WHERE a.batch='phase2b-preceptor-mirror' AND a.entity='students' AND a.col='preceptor_email'
--   AND a.ref_id = s.id;
--
-- -- Restore current-cohort match FK (NULL preserved).
-- UPDATE public.matches m SET preceptor_id = a.old_value::uuid
-- FROM public.preceptor_mirror_repair_audit a
-- WHERE a.batch='phase2b-preceptor-mirror' AND a.entity='matches' AND a.col='preceptor_id'
--   AND a.ref_id = m.id;
--
-- -- Remove the prevention mechanism.
-- DROP TRIGGER IF EXISTS trg_sync_primary_preceptor_mirror ON public.students;
-- DROP FUNCTION IF EXISTS public.sync_primary_preceptor_mirror();
--
-- -- Optionally retain the audit table as a record, or drop it:
-- -- DROP TABLE IF EXISTS public.preceptor_mirror_repair_audit;
--
-- COMMIT;
