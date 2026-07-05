-- =============================================================================
-- Student↔Preceptor assignment model: student_preceptor_assignments  (PRECEPTOR-MODEL-1-pre)
-- Migration: 20260621000000_ppm1_pre_student_preceptor_assignments
-- =============================================================================
--
-- FOUNDATION ONLY. Creates ONE new table that models the student↔preceptor relationship as a
-- join table (so secondary/coverage preceptors become possible LATER), DB-enforces "at most one
-- ACTIVE PRIMARY per student/cohort", and IDEMPOTENTLY backfills every student's CURRENT primary
-- preceptor (students.preceptor_id) as an active-primary row.
--
-- ZERO app/behavior/survey/routing/response change. NOTHING reads this table yet. The existing
-- canonical field students.preceptor_id (UUID FK -> preceptors.id) STILL drives every preceptor
-- resolution site (survey routing, evaluation relationship, displays, digests, dedup). This table
-- is a strangler-pattern foundation read by no code in Phase 1.
--
-- CANONICAL IDENTITY (discovery D.1): a student's preceptor is students.preceptor_id, a UUID FK to
-- preceptors.id (resolvePreceptor() in src/lib/preceptor.js; the same identity survey routing /
-- evaluated_target canonicalization uses). matched_preceptor / preceptor_email are FREE-TEXT
-- FALLBACK only (absence of a normalized link), NOT a competing identity. preceptor_id is therefore
-- the durable identity that survey RESPONSES will eventually snapshot (LOCKED PRINCIPLE, same as
-- SR-2 evaluated_target) - Phase 1 does NOT touch responses; the table is just kept compatible.
--
-- LIVENESS: status is the AUTHORITATIVE liveness flag ('active' | 'ended' | 'removed'). start_date/
-- end_date are DESCRIPTIVE only - NO liveness is ever derived from date math (avoids status-vs-date
-- drift). 'removed' is a soft-delete; assignment rows are never hard-deleted by app logic (none in
-- Phase 1). Backfill writes ONLY active-primary rows - zero secondary/coverage rows.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute. Claude Code applies NOTHING - the
-- Owner applies this manually, runs the VERIFICATION block below (ESPECIALLY the zero-mismatch
-- EQUIVALENCE query, the IDEMPOTENCY re-run, and the INVARIANT rejection test), confirms, THEN
-- authorizes commit of this file.
-- Idempotent: CREATE TABLE/INDEX use IF NOT EXISTS; DROP POLICY IF EXISTS before CREATE; the
-- backfill inserts only where no active-primary already exists (a second run is a clean no-op).
-- =============================================================================

-- ── 1. Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS student_preceptor_assignments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Subject student. Child row - removed with the student.
  student_id    uuid        NOT NULL REFERENCES students(id)   ON DELETE CASCADE,

  -- CANONICAL preceptor identity (D.1): preceptors.id - the SAME identity survey/routing uses and
  -- that responses will later snapshot. NOT NULL (a relationship always names a preceptor).
  -- ON DELETE RESTRICT: assignment HISTORY is preserved. A preceptor that has ANY assignment row
  -- cannot be hard-deleted - the delete is blocked at the DB, never silently cascaded. Removing a
  -- preceptor is a later status/inactivation concern (status='ended'/'removed' on their assignments),
  -- not a delete of history. NOTE the asymmetry with student_id/cohort_id (CASCADE): a preceptor is a
  -- SHARED entity referenced across many students, so its deletion must not wipe distributed history;
  -- a student/cohort owns its own assignment rows.
  preceptor_id  uuid        NOT NULL REFERENCES preceptors(id) ON DELETE RESTRICT,

  -- The student's cohort (students.cohort_id is NOT NULL program-wide). Scopes the invariant.
  cohort_id     uuid        NOT NULL REFERENCES cohorts(id)    ON DELETE CASCADE,

  role          text        NOT NULL DEFAULT 'primary',
  status        text        NOT NULL DEFAULT 'active',

  -- DESCRIPTIVE ONLY - liveness comes from status, never from these dates.
  start_date    date,
  end_date      date,

  notes         text,

  -- Actor/audit column mirrors the app convention (user_profiles(id) domain), nullable with
  -- ON DELETE SET NULL. Left NULL and OMITTED by the backfill (a data migration has no human actor;
  -- no actor is invented). Later server-side assignment writers set it.
  assigned_by   uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_spa_role   CHECK (role   IN ('primary', 'secondary', 'coverage')),
  CONSTRAINT chk_spa_status CHECK (status IN ('active', 'ended', 'removed'))
);


-- ── 2. Invariant + supporting indexes ───────────────────────────────────────────
-- THE BACKBONE OF BACKWARD COMPATIBILITY: at most ONE active primary per (student, cohort), so
-- every "the student's preceptor" reader has an unambiguous answer - exactly reproducing today's
-- single students.preceptor_id. Only role='primary' AND status='active' rows are indexed; any number
-- of ended/removed primaries and (later) secondary/coverage rows are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_spa_one_active_primary_per_student_cohort
  ON student_preceptor_assignments (student_id, cohort_id)
  WHERE role = 'primary' AND status = 'active';

-- Forward lookup ("this student's assignments") and reverse lookup ("this preceptor's students").
CREATE INDEX IF NOT EXISTS idx_spa_student   ON student_preceptor_assignments (student_id);
CREATE INDEX IF NOT EXISTS idx_spa_preceptor ON student_preceptor_assignments (preceptor_id);
CREATE INDEX IF NOT EXISTS idx_spa_cohort    ON student_preceptor_assignments (cohort_id);


-- ── 3. Row Level Security ───────────────────────────────────────────────────────
-- RLS ENABLED. One Owner/Admin SELECT policy (mirrors catalog_resources). NO client write policy -
-- later assignment writes go through the service role / server endpoints (which bypass RLS). None
-- in Phase 1.

ALTER TABLE student_preceptor_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_preceptor_assignments_owner_admin_read" ON student_preceptor_assignments;
CREATE POLICY "student_preceptor_assignments_owner_admin_read"
  ON student_preceptor_assignments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );


-- ── 4. Idempotent backfill - active-primary only ────────────────────────────────
-- Writes ONE active-primary row per student whose CURRENT canonical primary (students.preceptor_id)
-- is set, using the student's own cohort_id. start_date/end_date/notes/assigned_by are left NULL
-- (no data invented). Safely repeatable: inserts ONLY where no active-primary row already exists for
-- that (student_id, cohort_id), so a second run inserts ZERO rows and never trips the partial unique
-- index. Students with preceptor_id IS NULL (free-text-only or none) get NO row - equivalent to
-- their current "no canonical primary". Equivalence is forced for EVERY student (see verification).
INSERT INTO student_preceptor_assignments (student_id, preceptor_id, cohort_id, role, status)
SELECT s.id, s.preceptor_id, s.cohort_id, 'primary', 'active'
FROM students s
WHERE s.preceptor_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM student_preceptor_assignments spa
    WHERE spa.student_id = s.id
      AND spa.cohort_id  = s.cohort_id
      AND spa.role       = 'primary'
      AND spa.status     = 'active'
  );


-- ── 5. Reload schema cache ──────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- VERIFICATION (Owner runs after applying - NOT part of the migration)
-- =============================================================================
--   -- 1. Table exists:
--   SELECT to_regclass('public.student_preceptor_assignments');                       -- not null
--
--   -- 2. Columns/types:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='student_preceptor_assignments'
--   ORDER BY ordinal_position;
--   -- expect: id uuid NO · student_id uuid NO · preceptor_id uuid NO · cohort_id uuid NO
--   --         · role text NO · status text NO · start_date date YES · end_date date YES
--   --         · notes text YES · assigned_by uuid YES · created_at timestamptz NO · updated_at timestamptz NO
--
--   -- 3. RLS enabled:
--   SELECT relrowsecurity FROM pg_class WHERE oid='public.student_preceptor_assignments'::regclass;  -- true
--
--   -- 4. Read policy present; NO write policy:
--   SELECT polname, cmd FROM pg_policies
--   WHERE schemaname='public' AND tablename='student_preceptor_assignments';
--   -- expect exactly ONE row: student_preceptor_assignments_owner_admin_read | SELECT  (no INSERT/UPDATE/DELETE)
--
--   -- 5. Indexes incl. the PARTIAL UNIQUE index:
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE schemaname='public' AND tablename='student_preceptor_assignments' ORDER BY indexname;
--   -- expect: student_preceptor_assignments_pkey, idx_spa_student, idx_spa_preceptor, idx_spa_cohort,
--   --         uq_spa_one_active_primary_per_student_cohort (indexdef must include
--   --         "WHERE ((role = 'primary'::text) AND (status = 'active'::text))")
--
--   -- 6. Backfill count == students with a current primary (none lost, none duplicated):
--   SELECT
--     (SELECT count(*) FROM students WHERE preceptor_id IS NOT NULL)                          AS students_with_primary,
--     (SELECT count(*) FROM student_preceptor_assignments WHERE role='primary' AND status='active') AS active_primary_rows;
--   -- expect both numbers EQUAL.
--
--   -- 7. EQUIVALENCE - THE GATE. For EVERY student, the new active-primary lookup must equal
--   --    today's students.preceptor_id. MUST RETURN ZERO ROWS.
--   SELECT s.id AS student_id, s.cohort_id,
--          s.preceptor_id      AS current_preceptor_id,
--          spa.preceptor_id    AS new_active_primary
--   FROM students s
--   LEFT JOIN student_preceptor_assignments spa
--     ON spa.student_id = s.id
--    AND spa.cohort_id  = s.cohort_id
--    AND spa.role       = 'primary'
--    AND spa.status     = 'active'
--   WHERE s.preceptor_id IS DISTINCT FROM spa.preceptor_id;
--   -- GATE: 0 rows. ANY row = a mismatch -> DO NOT COMMIT; report.
--
--   -- 8. Zero secondary/coverage rows created by the backfill:
--   SELECT count(*) FROM student_preceptor_assignments WHERE role IN ('secondary','coverage');  -- expect 0
--
--   -- 9. IDEMPOTENCY - re-run the BACKFILL (section 4) a SECOND time. It must report "INSERT 0 0"
--   --    (zero new rows) and raise NO error. Re-confirm the count from check 6 is UNCHANGED.
--
--   -- 10. INVARIANT REJECTION - a SECOND active primary for an existing (student, cohort) must be
--   --     rejected by the partial unique index. Run inside a transaction and ROLL BACK:
--   BEGIN;
--     INSERT INTO student_preceptor_assignments (student_id, preceptor_id, cohort_id, role, status)
--     SELECT student_id, preceptor_id, cohort_id, 'primary', 'active'
--     FROM student_preceptor_assignments
--     WHERE role='primary' AND status='active'
--     LIMIT 1;
--   ROLLBACK;
--   -- EXPECT: ERROR  duplicate key value violates unique constraint
--   --         "uq_spa_one_active_primary_per_student_cohort".  (ROLLBACK discards the test.)
-- =============================================================================
-- PRE-APPLY DISCOVERY (Owner may run BEFORE applying to confirm clean data; report any nonzero):
--   -- a. Free-text-only students (have a name but NO canonical link) - these get NO backfill row,
--   --    equivalent to today's "no canonical primary". Informational count only:
--   SELECT count(*) FROM students
--   WHERE preceptor_id IS NULL AND coalesce(trim(matched_preceptor),'') <> '';
--   -- b. Any students.preceptor_id NOT pointing to a real preceptor (should be 0 - FK-enforced):
--   SELECT count(*) FROM students s
--   LEFT JOIN preceptors p ON p.id = s.preceptor_id
--   WHERE s.preceptor_id IS NOT NULL AND p.id IS NULL;            -- expect 0
--   -- c. Any student with a preceptor_id but NULL cohort_id (should be 0 - cohort_id is NOT NULL):
--   SELECT count(*) FROM students WHERE preceptor_id IS NOT NULL AND cohort_id IS NULL;  -- expect 0
-- =============================================================================
-- ROLLBACK (fully additive/reversible; nothing else affected - the existing students.preceptor_id
-- field and ALL preceptor workflows are untouched throughout; the backfill created only new rows in
-- this new table):
--   DROP INDEX IF EXISTS uq_spa_one_active_primary_per_student_cohort;
--   DROP INDEX IF EXISTS idx_spa_cohort;
--   DROP INDEX IF EXISTS idx_spa_preceptor;
--   DROP INDEX IF EXISTS idx_spa_student;
--   DROP POLICY IF EXISTS "student_preceptor_assignments_owner_admin_read" ON student_preceptor_assignments;
--   DROP TABLE IF EXISTS student_preceptor_assignments;
--   NOTIFY pgrst, 'reload schema';
-- =============================================================================
