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
-- mismatch_cleared, missing); checks 2, 3, 4, 5 and 7 return zero rows. Any
-- other result is a drift signal: investigate before closing the SQL session,
-- and repair through the application workflow (or a reviewed, gated migration),
-- never with ad-hoc SQL.
--
-- Check 6 is the exception: it is INFORMATIONAL. A non-zero count there is a
-- work queue of unresolved preceptor names, not a defect, and it should shrink
-- over time rather than being expected at zero.
--
-- RUN EACH NUMBERED CHECK SEPARATELY. The Supabase SQL editor returns only one
-- result set when several SELECT statements are submitted together.
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

-- ============================================================================
-- CHECKS 4 TO 7: lifted from the Phase 2A preflight
-- ============================================================================
-- The Phase 2A consistency preflight (db/audit, branch phase2a-preceptor-preflight,
-- since deleted) ran ten reports once, and Phase 2B was built to repair what it
-- found. Its findings are spent, but four of its questions have no standing home:
-- checks 1 to 3 above compare the canonical primary to its mirror by identity, and
-- say nothing about whether the preceptor on the other end is still active, whether
-- the denormalized name still matches, or whether a row is filed under the right
-- cohort. Those four are below.
--
-- Two of the ten were deliberately NOT lifted, because they cannot happen:
--   * "the same preceptor active in two roles for one (student, cohort)" is
--     prevented by the partial unique index uq_spa_one_active_relationship_per_
--     student_cohort_preceptor (20260622000000) on (student_id, cohort_id,
--     preceptor_id) WHERE status = 'active'. A data check for it would only ever
--     restate that the index exists.
--   * "dangling assignment references" is prevented by the foreign keys (student
--     CASCADE, preceptor RESTRICT, cohort CASCADE).
-- A third, matches.preceptor_id disagreement, already has a standing home in
-- db/audit/preceptor_projection_drift_audit.sql and is not duplicated here.

-- 4. ACTIVE ASSIGNMENTS TO AN INACTIVE OR MISSING PRECEPTOR (expect ZERO rows).
--    The one on this list most likely to fire, because nothing prevents it. No
--    application path sets preceptors.is_active = false: PreceptorFormModal only
--    ever writes true, so deactivation happens by manual SQL or in the dashboard.
--    Nothing cascades that to student_preceptor_assignments, and checks 1 to 3
--    compare preceptor_id to preceptor_id without ever looking at the preceptor
--    row, so a student can hold a live assignment to a preceptor who has been
--    switched off and every check above still reports a clean match.
--
--    Covers EVERY role, not just primary: a secondary or coverage preceptor going
--    inactive is the same operational problem. preceptor_missing should always be
--    false (ON DELETE RESTRICT); is_active is the real signal.
SELECT a.id            AS assignment_id,
       a.student_id,
       a.cohort_id,
       a.role,
       a.preceptor_id,
       (p.id IS NULL)  AS preceptor_missing,
       p.is_active     AS preceptor_is_active,
       p.full_name     AS preceptor_name
FROM student_preceptor_assignments a
LEFT JOIN preceptors p ON p.id = a.preceptor_id
WHERE a.status = 'active'
  AND (p.id IS NULL OR p.is_active IS DISTINCT FROM true)
ORDER BY a.role, a.student_id;

-- 5. STALE DENORMALIZED PRECEPTOR NAME OR EMAIL (expect ZERO rows).
--    students.matched_preceptor and students.preceptor_email are display copies of
--    the canonical preceptors row. The Phase 2B trigger keeps them current, but it
--    fires AFTER INSERT OR UPDATE OF preceptor_id ON students: it watches the LINK,
--    not the preceptor. Rename a preceptor, or correct their email, and the trigger
--    never runs, so every student linked to them keeps the old text indefinitely.
--    Retiring the free-text EDITOR (StudentSidePanel) did not change this, and
--    api/keith.js still writes matched_preceptor when it records a placement.
--
--    Display-only drift, so this is a data-quality signal rather than an
--    authorization one. It still matters: these are the values that reach
--    evaluation emails and the shift-log summary card.
SELECT s.id                  AS student_id,
       s.cohort_id,
       s.matched_preceptor   AS stored_name,
       p.full_name           AS canonical_name,
       s.preceptor_email     AS stored_email,
       p.email               AS canonical_email,
       (btrim(lower(coalesce(s.matched_preceptor, ''))) IS DISTINCT FROM btrim(lower(coalesce(p.full_name, '')))) AS name_stale,
       (btrim(lower(coalesce(s.preceptor_email, '')))   IS DISTINCT FROM btrim(lower(coalesce(p.email, ''))))     AS email_stale
FROM students s
JOIN preceptors p ON p.id = s.preceptor_id
WHERE s.preceptor_id IS NOT NULL
  AND (
        btrim(lower(coalesce(s.matched_preceptor, ''))) IS DISTINCT FROM btrim(lower(coalesce(p.full_name, '')))
    OR  btrim(lower(coalesce(s.preceptor_email, '')))   IS DISTINCT FROM btrim(lower(coalesce(p.email, '')))
  )
ORDER BY s.id;

-- 6. UNRESOLVED FREE-TEXT LINK: a name or email on file, no canonical preceptor
--    (informational; a non-zero count is a work queue, not a defect).
--    These students are invisible to checks 1 to 3 by construction: check 1 unions
--    students with a canonical primary and students with an active-primary row, and
--    a student with neither appears on neither side. Someone recorded a preceptor as
--    text and the link was never resolved to a preceptors row, so nothing downstream
--    that resolves by identity can see this preceptor at all.
--
--    Not auto-repairable: resolving a name to the right record is a human decision.
--    This is the same population 20260621000000_ppm1 flagged and the review queue
--    surfaces; it is asserted here so a manual SQL session cannot quietly grow it.
SELECT s.id                AS student_id,
       s.cohort_id,
       s.matched_preceptor AS unresolved_name,
       s.preceptor_email   AS unresolved_email
FROM students s
WHERE s.preceptor_id IS NULL
  AND (
        btrim(coalesce(s.matched_preceptor, '')) <> ''
    OR  btrim(coalesce(s.preceptor_email, ''))   <> ''
  )
ORDER BY s.id;

-- 7. ACTIVE ASSIGNMENT FILED UNDER THE WRONG COHORT (expect ZERO rows).
--    This one guards a documented ASSUMPTION rather than an observed defect. The
--    Phase 2B trigger states it outright: a student "is tied to one cohort and is
--    never re-cohorted, so students.cohort_id is fixed", and it writes the mirror to
--    NEW.cohort_id on that basis. Nothing enforces it, so a manual re-cohort would
--    leave the old row active under the old cohort AND have the trigger write a new
--    one, and checks 1 to 3 would not notice: they join on student_id and never
--    compare cohorts. Cheap to assert, and the assumption is load-bearing.
SELECT a.id        AS assignment_id,
       a.student_id,
       a.role,
       a.cohort_id AS row_cohort,
       s.cohort_id AS student_current_cohort
FROM student_preceptor_assignments a
JOIN students s ON s.id = a.student_id
WHERE a.status = 'active'
  AND a.cohort_id IS DISTINCT FROM s.cohort_id
ORDER BY a.student_id, a.role;
