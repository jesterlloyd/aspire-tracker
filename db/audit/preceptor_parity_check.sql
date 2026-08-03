-- ============================================================================
-- PRECEPTOR ASSIGNMENT INTEGRITY CHECK (PRECEPTOR-INTEGRITY-1)
--   SQL companion to Settings > Preceptor Assignment Integrity
--   (src/components/settings/PreceptorParityPanel.jsx)
-- ============================================================================
-- READ-ONLY. Every statement is a SELECT; this file writes nothing.
-- Run as the service role or an owner/admin in the Supabase SQL editor.
--
-- WHEN TO RUN: after ANY manual SQL session that touches students, preceptors,
-- student_preceptor_assignments, or matches (see docs/security/OWNER_SQL_GATE.md,
-- "After application"). The applied Phase 2C guard routes every application
-- primary change through the audited assign_primary_preceptor RPC, and the
-- applied Phase 2B trigger (sync_primary_preceptor_mirror) maintains the
-- mirror on every accepted write, so drift can only come from out-of-band
-- changes: manual SQL, restores, or a trigger regression.
--
-- MODEL: students.preceptor_id is the CANONICAL primary-preceptor identity.
-- The ACTIVE-PRIMARY row (role='primary' AND status='active') in
-- student_preceptor_assignments is its synchronized mirror. Parity is computed
-- BY IDENTITY (preceptor_id vs preceptor_id), both directions; names are
-- display-only and never affect classification. Same logic as the UI panel.
--
-- EXPECTED RESULT: check 1 returns match rows only (zero mismatch_changed,
-- mismatch_cleared, missing); checks 2 and 3 return zero rows. Any other
-- result is a drift signal: investigate before closing the SQL session, and
-- repair through the application workflow (or a reviewed, gated migration),
-- never with ad-hoc SQL.
-- ============================================================================

-- 1. SUMMARY. The union of students with a current canonical primary and
--    students with an active-primary assignment row, classified by identity:
--      match            same preceptor_id on both sides
--      mismatch_changed both sides present, DIFFERENT preceptor_ids
--      mismatch_cleared canonical primary cleared, active-primary row remains
--      missing          canonical primary present, no active-primary row
WITH current_side AS (
  SELECT s.id AS student_id, s.preceptor_id
  FROM students s
  WHERE s.preceptor_id IS NOT NULL
),
active_side AS (
  SELECT a.student_id, a.preceptor_id
  FROM student_preceptor_assignments a
  WHERE a.role = 'primary' AND a.status = 'active'
),
unioned AS (
  SELECT
    COALESCE(c.student_id, a.student_id) AS student_id,
    c.preceptor_id AS current_id,
    a.preceptor_id AS active_id
  FROM current_side c
  FULL OUTER JOIN active_side a ON a.student_id = c.student_id
)
SELECT
  CASE
    WHEN current_id IS NOT NULL AND active_id IS NOT NULL AND current_id = active_id  THEN 'match'
    WHEN current_id IS NOT NULL AND active_id IS NOT NULL                             THEN 'mismatch_changed'
    WHEN current_id IS NULL                                                           THEN 'mismatch_cleared'
    ELSE 'missing'
  END AS parity,
  count(*) AS students
FROM unioned
GROUP BY 1
ORDER BY 1;

-- 2. DETAIL: every non-match row (expect ZERO rows). Names are display-only
--    context for the investigation; the classification above is ID-based.
WITH current_side AS (
  SELECT s.id AS student_id, s.preceptor_id
  FROM students s
  WHERE s.preceptor_id IS NOT NULL
),
active_side AS (
  SELECT a.student_id, a.cohort_id, a.preceptor_id, a.status, a.updated_at
  FROM student_preceptor_assignments a
  WHERE a.role = 'primary' AND a.status = 'active'
),
unioned AS (
  SELECT
    COALESCE(c.student_id, a.student_id) AS student_id,
    c.preceptor_id AS current_id,
    a.preceptor_id AS active_id,
    a.cohort_id    AS assignment_cohort_id,
    a.updated_at   AS assignment_updated_at
  FROM current_side c
  FULL OUTER JOIN active_side a ON a.student_id = c.student_id
)
SELECT
  u.student_id,
  s.last_name || ', ' || s.first_name AS student,
  u.current_id,
  pc.full_name AS current_name,
  u.active_id,
  pa.full_name AS active_name,
  u.assignment_cohort_id,
  u.assignment_updated_at,
  CASE
    WHEN u.current_id IS NOT NULL AND u.active_id IS NOT NULL THEN 'mismatch_changed'
    WHEN u.current_id IS NULL                                  THEN 'mismatch_cleared'
    ELSE 'missing'
  END AS parity
FROM unioned u
JOIN students s        ON s.id  = u.student_id
LEFT JOIN preceptors pc ON pc.id = u.current_id
LEFT JOIN preceptors pa ON pa.id = u.active_id
WHERE u.current_id IS DISTINCT FROM u.active_id
ORDER BY parity, student;

-- 3. DUPLICATE ACTIVE PRIMARIES (expect ZERO rows). The partial unique index
--    allows one active primary per (student, cohort); more than one ACROSS
--    cohorts for the same student is out-of-band drift the UI panel would
--    collapse to a single row, so it is asserted separately here.
SELECT a.student_id, count(*) AS active_primary_rows
FROM student_preceptor_assignments a
WHERE a.role = 'primary' AND a.status = 'active'
GROUP BY a.student_id
HAVING count(*) > 1
ORDER BY active_primary_rows DESC;
