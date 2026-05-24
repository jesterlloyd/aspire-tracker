-- =====================================================================
-- ASPIRE Preceptor Data Backfill
-- Phase B.1 — One-time population of normalized preceptors table
--
-- Run AFTER migration_preceptor_normalization.sql has been applied.
-- Idempotent: safe to re-run (all INSERTs use ON CONFLICT DO NOTHING
-- or ON CONFLICT DO NOTHING with explicit conflict target).
--
-- ROLLBACK PROCEDURE (if needed):
--   1. UPDATE public.students SET preceptor_id = NULL;
--   2. UPDATE public.matches SET preceptor_id = NULL;
--   3. DELETE FROM public.preceptor_cohort_participation;
--   4. DELETE FROM public.preceptors
--        WHERE created_at > '<TIMESTAMP_BEFORE_BACKFILL>';
--      (record current timestamp before running this script)
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- Pre-flight check: print expected counts before making any changes
-- ─────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  students_with_preceptor INTEGER;
  students_with_email     INTEGER;
  distinct_emails         INTEGER;
  participation_count     INTEGER;
BEGIN
  SELECT COUNT(*) INTO students_with_preceptor
  FROM public.students
  WHERE matched_preceptor IS NOT NULL AND trim(matched_preceptor) != '';

  SELECT COUNT(*) INTO students_with_email
  FROM public.students
  WHERE preceptor_email IS NOT NULL AND trim(preceptor_email) != '';

  SELECT COUNT(DISTINCT lower(trim(preceptor_email))) INTO distinct_emails
  FROM public.students
  WHERE preceptor_email IS NOT NULL AND trim(preceptor_email) != ''
    AND matched_preceptor IS NOT NULL AND trim(matched_preceptor) != '';

  -- Distinct (cohort_id, email) pairs = expected participation records
  SELECT COUNT(DISTINCT s.cohort_id::text || lower(trim(s.preceptor_email)))
  INTO participation_count
  FROM public.students s
  WHERE s.preceptor_email IS NOT NULL AND trim(s.preceptor_email) != ''
    AND s.matched_preceptor IS NOT NULL AND trim(s.matched_preceptor) != ''
    AND s.cohort_id IS NOT NULL;

  RAISE NOTICE '=== Pre-flight Check ===';
  RAISE NOTICE 'Students with matched_preceptor populated: %', students_with_preceptor;
  RAISE NOTICE 'Students with preceptor_email populated:   %', students_with_email;
  RAISE NOTICE 'Distinct preceptor emails to insert:       %', distinct_emails;
  RAISE NOTICE 'Cohort participation records to create:    %', participation_count;
  RAISE NOTICE '========================';
END;
$$;


-- ─────────────────────────────────────────────────────────────────────
-- Step 1: Insert preceptor records
-- Source: students with both matched_preceptor AND preceptor_email.
-- Identity key: lower(trim(email)) via partial unique index.
-- Unit linkage resolved through the student's active match record.
-- DISTINCT ON ensures one row per email (most recent student wins for
-- full_name if the same preceptor appears across multiple students).
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO public.preceptors (full_name, email, unit_id, unit_name, is_active)
SELECT DISTINCT ON (lower(trim(s.preceptor_email)))
  s.matched_preceptor  AS full_name,
  s.preceptor_email    AS email,
  m.unit_id            AS unit_id,
  u.unit_name          AS unit_name,
  true                 AS is_active
FROM public.students s
LEFT JOIN public.matches m ON m.student_id = s.id
LEFT JOIN public.units   u ON u.id = m.unit_id
WHERE s.preceptor_email  IS NOT NULL AND trim(s.preceptor_email)  != ''
  AND s.matched_preceptor IS NOT NULL AND trim(s.matched_preceptor) != ''
ORDER BY lower(trim(s.preceptor_email)), s.created_at DESC
ON CONFLICT (lower(trim(email)))
  WHERE email IS NOT NULL AND trim(email) != ''
DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────
-- Step 2: Backfill students.preceptor_id by joining on email
-- Only sets rows that are currently NULL (idempotent).
-- ─────────────────────────────────────────────────────────────────────

UPDATE public.students s
SET preceptor_id = p.id
FROM public.preceptors p
WHERE lower(trim(s.preceptor_email)) = lower(trim(p.email))
  AND s.preceptor_id IS NULL
  AND p.email IS NOT NULL AND trim(p.email) != '';


-- ─────────────────────────────────────────────────────────────────────
-- Step 3: Backfill matches.preceptor_id from the now-resolved student
-- Only sets rows that are currently NULL (idempotent).
-- ─────────────────────────────────────────────────────────────────────

UPDATE public.matches m
SET preceptor_id = s.preceptor_id
FROM public.students s
WHERE m.student_id = s.id
  AND s.preceptor_id IS NOT NULL
  AND m.preceptor_id IS NULL;


-- ─────────────────────────────────────────────────────────────────────
-- Step 4: Create cohort participation records
-- Fires the sync_preceptor_denormalized_fields() trigger automatically,
-- populating cohorts_participated, last_active_cohort, last_active_date
-- on each preceptor row.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO public.preceptor_cohort_participation (preceptor_id, cohort_id, status)
SELECT DISTINCT
  s.preceptor_id,
  s.cohort_id,
  'active'
FROM public.students s
WHERE s.preceptor_id IS NOT NULL
  AND s.cohort_id IS NOT NULL
ON CONFLICT (preceptor_id, cohort_id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────
-- Step 5: Admin review view
-- Surfaces every student-preceptor relationship and its resolution status:
--   resolved    — preceptor_id was successfully set
--   needs_email — preceptor name present but no email to match on
--   unresolved  — email present but no preceptors row matched
-- Use in Phase B.3 admin UI to identify records needing manual triage.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.preceptor_review_queue AS
SELECT DISTINCT
  s.matched_preceptor  AS name_text,
  s.preceptor_email    AS email_text,
  s.id                 AS student_id,
  s.cohort_id,
  c.name               AS cohort_name,
  u.unit_name,
  CASE
    WHEN s.preceptor_id IS NOT NULL                        THEN 'resolved'
    WHEN s.preceptor_email IS NULL
      OR trim(s.preceptor_email) = ''                      THEN 'needs_email'
    ELSE 'unresolved'
  END                  AS status
FROM public.students s
LEFT JOIN public.cohorts c ON c.id = s.cohort_id
LEFT JOIN public.matches m ON m.student_id = s.id
LEFT JOIN public.units   u ON u.id = m.unit_id
WHERE s.matched_preceptor IS NOT NULL
  AND trim(s.matched_preceptor) != '';


-- ─────────────────────────────────────────────────────────────────────
-- Post-run verification — counts printed to query output
-- ─────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  prec_count        INTEGER;
  part_count        INTEGER;
  resolved_students INTEGER;
  unresolved        INTEGER;
  needs_email       INTEGER;
BEGIN
  SELECT COUNT(*) INTO prec_count        FROM public.preceptors;
  SELECT COUNT(*) INTO part_count        FROM public.preceptor_cohort_participation;
  SELECT COUNT(*) INTO resolved_students FROM public.students WHERE preceptor_id IS NOT NULL;
  SELECT COUNT(*) INTO unresolved        FROM public.preceptor_review_queue WHERE status = 'unresolved';
  SELECT COUNT(*) INTO needs_email       FROM public.preceptor_review_queue WHERE status = 'needs_email';

  RAISE NOTICE '=== Post-run Results ===';
  RAISE NOTICE 'Preceptor records inserted:             %', prec_count;
  RAISE NOTICE 'Cohort participation records created:   %', part_count;
  RAISE NOTICE 'Students with preceptor_id resolved:    %', resolved_students;
  RAISE NOTICE 'Unresolved (email present, no match):   %', unresolved;
  RAISE NOTICE 'Needs email (name only, no email):      %', needs_email;
  RAISE NOTICE '========================';
END;
$$;
