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
-- BEFORE (read-only). Expect: 6a_name=4, 6a_email=0, 7a=4, everything else 0.
-- ############################################################################

-- B1. Defect counts, COLUMN-PRECISE. The free-text defect is split so it is explicit that
--     for the accepted data only matched_preceptor is wrong (email is already canonical).
WITH
missing AS (SELECT s.id FROM students s WHERE s.preceptor_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM student_preceptor_assignments a
    WHERE a.student_id=s.id AND a.cohort_id=s.cohort_id AND a.role='primary' AND a.status='active')),
stale AS (SELECT s.id FROM students s
  JOIN student_preceptor_assignments a ON a.student_id=s.id AND a.cohort_id=s.cohort_id AND a.role='primary' AND a.status='active'
  WHERE s.preceptor_id IS DISTINCT FROM a.preceptor_id),
name_drift AS (SELECT s.id FROM students s JOIN preceptors p ON p.id=s.preceptor_id
  WHERE s.preceptor_id IS NOT NULL
    AND btrim(lower(coalesce(s.matched_preceptor,''))) IS DISTINCT FROM btrim(lower(coalesce(p.full_name,'')))),
email_drift AS (SELECT s.id FROM students s JOIN preceptors p ON p.id=s.preceptor_id
  WHERE s.preceptor_id IS NOT NULL
    AND btrim(lower(coalesce(s.preceptor_email,''))) IS DISTINCT FROM btrim(lower(coalesce(p.email,'')))),
matchfk AS (SELECT m.id FROM matches m JOIN students s ON s.id=m.student_id AND s.cohort_id=m.cohort_id
  WHERE m.preceptor_id IS DISTINCT FROM s.preceptor_id)
SELECT '1_primary_missing_mirror'     AS category, count(*) FROM missing
UNION ALL SELECT '2_primary_stale_mirror',        count(*) FROM stale
UNION ALL SELECT '6a_matched_preceptor_disagrees', count(*) FROM name_drift
UNION ALL SELECT '6a_preceptor_email_disagrees',   count(*) FROM email_drift
UNION ALL SELECT '7a_match_preceptor_disagrees',   count(*) FROM matchfk
ORDER BY category;

-- B2. Baseline count of student_preceptor_assignments rows by (role, status). Record this;
--     the repair must leave it UNCHANGED (it writes no assignment rows).
SELECT role, status, count(*) AS rows
FROM student_preceptor_assignments
GROUP BY role, status
ORDER BY role, status;

-- B2b. MATCHES CARDINALITY. Students with more than one match row in their OWN cohort.
--      Expect ZERO rows. Any row here means the "single current match" rule is undecided for
--      that student: the repair and the trigger will NOT touch that student's match FK, and a
--      data decision (which match row is canonical) is required before those rows are repaired.
SELECT m.student_id, m.cohort_id, count(*) AS same_cohort_match_rows, array_agg(m.id) AS match_ids
FROM matches m
JOIN students s ON s.id = m.student_id AND s.cohort_id = m.cohort_id
GROUP BY m.student_id, m.cohort_id
HAVING count(*) > 1
ORDER BY m.student_id;

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

-- A1. Defect counts now ZERO (re-run B1's column-precise CTEs). Expect all five = 0.
WITH
missing AS (SELECT s.id FROM students s WHERE s.preceptor_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM student_preceptor_assignments a
    WHERE a.student_id=s.id AND a.cohort_id=s.cohort_id AND a.role='primary' AND a.status='active')),
stale AS (SELECT s.id FROM students s
  JOIN student_preceptor_assignments a ON a.student_id=s.id AND a.cohort_id=s.cohort_id AND a.role='primary' AND a.status='active'
  WHERE s.preceptor_id IS DISTINCT FROM a.preceptor_id),
name_drift AS (SELECT s.id FROM students s JOIN preceptors p ON p.id=s.preceptor_id
  WHERE s.preceptor_id IS NOT NULL
    AND btrim(lower(coalesce(s.matched_preceptor,''))) IS DISTINCT FROM btrim(lower(coalesce(p.full_name,'')))),
email_drift AS (SELECT s.id FROM students s JOIN preceptors p ON p.id=s.preceptor_id
  WHERE s.preceptor_id IS NOT NULL
    AND btrim(lower(coalesce(s.preceptor_email,''))) IS DISTINCT FROM btrim(lower(coalesce(p.email,'')))),
matchfk AS (SELECT m.id FROM matches m JOIN students s ON s.id=m.student_id AND s.cohort_id=m.cohort_id
  WHERE m.preceptor_id IS DISTINCT FROM s.preceptor_id
    AND (SELECT count(*) FROM matches m2 WHERE m2.student_id=s.id AND m2.cohort_id=s.cohort_id) = 1)
SELECT '1_primary_missing_mirror'     AS category, count(*) FROM missing
UNION ALL SELECT '2_primary_stale_mirror',        count(*) FROM stale
UNION ALL SELECT '6a_matched_preceptor_disagrees', count(*) FROM name_drift
UNION ALL SELECT '6a_preceptor_email_disagrees',   count(*) FROM email_drift
UNION ALL SELECT '7a_match_preceptor_disagrees',   count(*) FROM matchfk
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

-- A5. Repaired-row provenance from the audit, one row per repaired column. For the accepted
--     production data expect EXACTLY:
--        students | matched_preceptor | 4
--        matches  | preceptor_id      | 4
--     and NO students/preceptor_email row (email was already canonical) -> 8 audit rows total.
SELECT entity, col, count(*) AS repaired_rows
FROM public.preceptor_mirror_repair_audit
WHERE batch = 'phase2b-preceptor-mirror'
GROUP BY entity, col
ORDER BY entity, col;

-- A5b. Total audit rows for the batch. Expect 8 for the accepted data.
SELECT count(*) AS total_audit_rows
FROM public.preceptor_mirror_repair_audit
WHERE batch = 'phase2b-preceptor-mirror';

-- A6. The trigger exists, is an AFTER trigger on students, and the function is
--     SECURITY DEFINER with a fixed search_path and no PUBLIC/anon/authenticated execute.
SELECT t.tgname, t.tgenabled, p.prosecdef AS security_definer, p.proconfig AS settings
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.students'::regclass
  AND t.tgname = 'trg_sync_primary_preceptor_mirror';

SELECT p.proname,
  EXISTS (
    SELECT 1
    FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) AS public_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'sync_primary_preceptor_mirror';
  -- Expect: all three execute columns = false.

-- A6b. Rollback-audit table privileges are fail-closed. PUBLIC/anon/authenticated have no table
--      privileges; service_role has the SELECT/INSERT/UPDATE/DELETE access needed for support and
--      rollback operations. Expect every public/anon/authenticated column false and every
--      service_role column true.
WITH target AS (
  SELECT c.oid, c.relacl, c.relowner
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'preceptor_mirror_repair_audit'
)
SELECT
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
FROM target t;

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
