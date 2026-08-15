-- =============================================================================
-- Multi-unit student placements: student_unit_assignments  (MULTI-UNIT-STUDENT-PLACEMENTS-1)
-- Migration: 20260816000000_student_unit_assignments
-- =============================================================================
--
-- WHY THIS EXISTS
-- students.matched_unit_id can name exactly one unit, so a student who rotates
-- in two or three units (sequentially or at the same time) cannot be represented
-- outside her shift logs. Summer 2026 student Emi Bayaraa rotated in PACU and
-- 6 NE; the app can only show one of them. A shift log proves a shift happened
-- in a unit - it is NOT proof ASPIRE approved that unit assignment - so the fix
-- must be an authoritative, dated, staff-attributed relationship, not an
-- inference.
--
-- THE MODEL, deliberately the exact analog of student_preceptor_assignments
-- (20260621000000), which already solved this shape for preceptors:
--
--   • One row per (student, unit, period). role 'primary'/'additional' with AT
--     MOST ONE ACTIVE PRIMARY per (student, cohort) - the partial unique index
--     is the backbone of backward compatibility, exactly reproducing today's
--     single matched_unit_id answer for every current reader.
--   • status drives liveness ('active'/'planned'/'ended'/'removed'); dates
--     DOCUMENT the schedule. Sequential = earlier row ended + later row active,
--     each with its own dates. Simultaneous = two active rows. No column and no
--     constraint caps the number of units - two, three, or more are just rows.
--   • UNIT IDENTITY IS CARRIED TWICE, ON PURPOSE. unit_id references the
--     per-cohort units row (matching matched_unit_id semantics), and unit_key
--     snapshots the canonical unit NAME - the SAME identity user_unit_scopes
--     uses for Unit Leader authorization (20260712000007 established name-as-
--     identity because units rows are per cohort). unit_id may go NULL if a
--     unit row is deleted (matching matched_unit_id ON DELETE SET NULL);
--     unit_key survives, so assignment HISTORY never loses its unit and a Unit
--     Leader roster can one day be derived without a join through a deletable
--     row.
--
-- WHAT THIS DOES NOT TOUCH. students.matched_unit_id keeps today's behavior and
-- remains the canonical single-unit projection until later phases move readers
-- over one at a time. matches keeps its role as the placement/capacity
-- mechanism (its rows are DELETED on unmatch, so it structurally cannot hold
-- history - which is why it was not repurposed). No UI, Shift Log, portal,
-- evaluation, certificate, email, or reporting behavior changes here. The
-- legacy anon_all policies on matches/units are NOT copied: this table follows
-- the modern posture (RLS on, Owner/Admin SELECT only, service-role writes).
--
-- BACKFILL: one active-primary row per student whose matched_unit_id is set -
-- a pure projection of the CURRENT canonical state. No dates are invented (both
-- date columns stay NULL), no actor is invented (assigned_by NULL), and no
-- multi-unit history is created for anyone. Emi gets exactly one row mirroring
-- her current matched_unit_id, like every other matched student; her real
-- PACU + 6 NE history is written ONLY after the Owner confirms primary unit and
-- dates. Idempotent: a second run inserts nothing.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute. *** APPLY MANUALLY
-- (Owner/Jester). Claude Code has applied NOTHING. *** Run the verification
-- block below, THEN authorize the downstream integration phases.
-- =============================================================================

BEGIN;

-- ── 0. Identity-pair support indexes (additive; can never reject a row) ──────
-- Composite foreign keys below need matching unique indexes on the parents.
-- (id) is already each table's PRIMARY KEY, so (id, cohort_id) is trivially
-- unique: these indexes add integrity plumbing, not new restrictions, and no
-- existing insert/update/delete on students or units can start failing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_students_id_cohort ON public.students (id, cohort_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_units_id_cohort    ON public.units (id, cohort_id);

-- ── 1. Table ─────────────────────────────────────────────────────────────────
-- NOTE: the unit FK uses the column-qualified referential action
-- ON DELETE SET NULL (unit_id) - PostgreSQL 15+. Supabase runs PG15+.
CREATE TABLE IF NOT EXISTS public.student_unit_assignments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Subject student. Child row - removed with the student.
  student_id    uuid        NOT NULL,

  -- The student's cohort. Scopes the active-primary invariant and every roster
  -- question. INTEGRITY: the composite FK below pins this to the STUDENT'S OWN
  -- cohort - a cross-cohort assignment is unrepresentable, and because
  -- students.cohort_id is immutable in practice (a repeating student is a new
  -- row per cohort), the pair cannot drift.
  cohort_id     uuid        NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,

  -- The per-cohort units row. INTEGRITY: the composite FK below requires the
  -- referenced unit to belong to THIS SAME cohort, and on unit deletion nulls
  -- ONLY unit_id (PG15 column-qualified action) so history keeps its cohort.
  -- Deleting a unit that still has a LIVE assignment is BLOCKED, not silently
  -- absorbed: the SET NULL update violates chk_sua_live_requires_unit, so the
  -- DELETE fails until staff end or remove the assignment first. A live
  -- authorization can therefore never quietly degrade into historical text.
  unit_id       uuid,

  -- CANONICAL unit identity: the unit NAME, exactly as user_unit_scopes.unit_key
  -- carries it (20260720000000: "unit identity is the canonical unit NAME
  -- string... New tables therefore carry unit_key text"). Snapshotted at write
  -- time from units.unit_name so history is self-contained.
  unit_key      text        NOT NULL,

  -- 'primary' is the single unit every current one-unit reader projects;
  -- 'additional' is a concurrent or secondary unit. At most one ACTIVE primary
  -- per (student, cohort) - enforced below, not by convention.
  role          text        NOT NULL DEFAULT 'primary',

  -- Liveness comes from status (house rule shared with
  -- student_preceptor_assignments); the dates document the schedule.
  --   planned - approved for a future period, not yet rotating
  --   active  - currently assigned
  --   ended   - completed normally (history)
  --   removed - withdrawn/corrected (history)
  status        text        NOT NULL DEFAULT 'active',

  -- The assignment period as ASPIRE approved it. Nullable: the backfill and
  -- legacy single-unit students have no recorded dates, and nothing may invent
  -- them. Overlap between rows is ALLOWED by design (simultaneous units).
  start_date    date,
  end_date      date,

  notes         text,

  -- Actor attribution (user_profiles domain, matching the app convention).
  -- The backfill leaves these NULL - a data migration has no human actor.
  assigned_by   uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ended_by      uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ended_at      timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- INTEGRITY: the assignment's cohort is the STUDENT'S cohort - always.
  CONSTRAINT fk_sua_student_cohort FOREIGN KEY (student_id, cohort_id)
    REFERENCES public.students (id, cohort_id) ON DELETE CASCADE,
  -- INTEGRITY: a referenced unit belongs to the SAME cohort. On unit deletion
  -- only unit_id is nulled (PG15 column list); cohort_id stays. MATCH SIMPLE
  -- means rows with unit_id NULL (history after unit deletion) are exempt.
  CONSTRAINT fk_sua_unit_cohort FOREIGN KEY (unit_id, cohort_id)
    REFERENCES public.units (id, cohort_id) ON DELETE SET NULL (unit_id),

  CONSTRAINT chk_sua_role   CHECK (role   IN ('primary', 'additional')),
  CONSTRAINT chk_sua_status CHECK (status IN ('planned', 'active', 'ended', 'removed')),
  -- A LIVE assignment always names a real unit row. Together with the SET NULL
  -- action above, this is what BLOCKS deleting a unit that still has a live
  -- assignment: the nulling update violates this CHECK and the delete fails.
  CONSTRAINT chk_sua_live_requires_unit CHECK (
    status NOT IN ('planned', 'active') OR unit_id IS NOT NULL
  ),
  -- unit_key is a real canonical name, never padding or an empty string.
  CONSTRAINT chk_sua_unit_key_trimmed CHECK (unit_key = btrim(unit_key) AND char_length(unit_key) > 0),
  -- A dated period must be coherent. Single-sided periods are allowed (a known
  -- start with an open end is the normal shape of an active assignment).
  CONSTRAINT chk_sua_period CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  -- ended/removed rows carry when they ended; live rows never do. This is what
  -- keeps "why is this row not active" answerable from the row itself.
  CONSTRAINT chk_sua_ended_fields CHECK (
    (status IN ('ended', 'removed')) = (ended_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.student_unit_assignments IS
  'Authoritative, dated, staff-attributed student-to-unit assignments (MULTI-UNIT-STUDENT-PLACEMENTS-1). One row per (student, unit, period); sequential rotations are consecutive rows, simultaneous units are concurrent active rows, and nothing caps the count. At most one ACTIVE PRIMARY per (student, cohort) - the backward-compatible projection of students.matched_unit_id, which remains canonical until readers migrate. unit_key snapshots the canonical unit name (the user_unit_scopes identity) so history survives unit-row deletion. Assignments are never inferred from shift logs. RLS: Owner/Admin SELECT only; all writes are server-side service role.';

COMMENT ON COLUMN public.student_unit_assignments.unit_key IS
  'Canonical unit name, identical to units.unit_name and user_unit_scopes.unit_key at write time. The durable unit identity: survives deletion of the per-cohort units row that unit_id references.';
COMMENT ON COLUMN public.student_unit_assignments.role IS
  'primary = the single unit current one-unit readers see (at most one active per student+cohort); additional = a concurrent or secondary unit.';
COMMENT ON COLUMN public.student_unit_assignments.status IS
  'Liveness. planned/active are live; ended/removed are preserved history. Dates document the schedule but never decide liveness.';
COMMENT ON COLUMN public.student_unit_assignments.start_date IS
  'The period ASPIRE approved, entered by staff. NULL on backfilled rows: no date is ever invented.';

-- ── 2. Uniqueness + indexes ──────────────────────────────────────────────────

-- THE BACKBONE OF BACKWARD COMPATIBILITY: at most one ACTIVE PRIMARY unit per
-- (student, cohort), so "the student's unit" keeps exactly one answer for every
-- current reader. Ended/removed primaries and any number of additional units
-- are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sua_one_active_primary_per_student_cohort
  ON public.student_unit_assignments (student_id, cohort_id)
  WHERE role = 'primary' AND status = 'active';

-- PLANNED-PRIMARY CARDINALITY (locked rule): at most ONE active primary PLUS at
-- most ONE planned successor primary per (student, cohort). The repository has
-- no precedent for deeper planning (student_preceptor_assignments plans nothing
-- at all), and one successor is exactly what a sequential rotation needs: the
-- current unit plus the next one. A third primary only becomes representable
-- after the current one ends - which is the honest shape of the program.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sua_one_planned_primary_per_student_cohort
  ON public.student_unit_assignments (student_id, cohort_id)
  WHERE role = 'primary' AND status = 'planned';

-- A student holds at most one LIVE assignment per unit per cohort (re-rotating
-- through the same unit later is fine - the earlier row is ended first).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sua_one_live_row_per_student_unit
  ON public.student_unit_assignments (student_id, cohort_id, unit_key)
  WHERE status IN ('planned', 'active');

-- Forward ("this student's units"), reverse ("this unit's students" - the
-- future Unit Leader roster shape), and cohort lookups.
CREATE INDEX IF NOT EXISTS idx_sua_student ON public.student_unit_assignments (student_id);
CREATE INDEX IF NOT EXISTS idx_sua_unit_key_cohort ON public.student_unit_assignments (unit_key, cohort_id);
CREATE INDEX IF NOT EXISTS idx_sua_cohort ON public.student_unit_assignments (cohort_id);

-- ── 2b. Unit identity derivation (trigger; the one rule FKs cannot express) ──
-- When unit_id is present, unit_key MUST be that unit's canonical name. The
-- trigger DERIVES it when the caller omits it and REJECTS a mismatch when the
-- caller supplies one, so the two identities can never disagree at write time.
-- Rows whose unit_id is NULL (history after unit deletion) keep their frozen
-- unit_key untouched. SECURITY DEFINER so the lookup works regardless of the
-- caller's RLS view of units; search_path pinned per house convention.
CREATE OR REPLACE FUNCTION public.sua_enforce_unit_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_unit_name text;
BEGIN
  IF NEW.unit_id IS NOT NULL THEN
    SELECT u.unit_name INTO v_unit_name FROM public.units u WHERE u.id = NEW.unit_id;
    IF v_unit_name IS NULL OR btrim(v_unit_name) = '' THEN
      RAISE EXCEPTION 'student_unit_assignments: unit % has no usable unit_name', NEW.unit_id;
    END IF;
    IF NEW.unit_key IS NULL OR btrim(NEW.unit_key) = '' THEN
      NEW.unit_key := v_unit_name;
    ELSIF NEW.unit_key <> v_unit_name THEN
      RAISE EXCEPTION 'student_unit_assignments: unit_key "%" does not match unit % name "%"',
        NEW.unit_key, NEW.unit_id, v_unit_name;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sua_enforce_unit_identity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sua_enforce_unit_identity ON public.student_unit_assignments;
CREATE TRIGGER trg_sua_enforce_unit_identity
  BEFORE INSERT OR UPDATE OF unit_id, unit_key ON public.student_unit_assignments
  FOR EACH ROW EXECUTE FUNCTION public.sua_enforce_unit_identity();

-- ── 3. updated_at trigger (existing shared function) ─────────────────────────
DROP TRIGGER IF EXISTS set_updated_at_student_unit_assignments ON public.student_unit_assignments;
CREATE TRIGGER set_updated_at_student_unit_assignments
  BEFORE UPDATE ON public.student_unit_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 4. Row Level Security + privileges ───────────────────────────────────────
-- Modern posture, NOT the legacy anon_all of matches/units: RLS on, one
-- Owner/Admin SELECT policy, zero client write policies, no anon access.
-- Writes happen only through server-side service-role code in later phases.
ALTER TABLE public.student_unit_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.student_unit_assignments
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.student_unit_assignments TO authenticated;
-- No DELETE: history is ended or removed by status, never erased.
GRANT SELECT, INSERT, UPDATE ON public.student_unit_assignments TO service_role;

DROP POLICY IF EXISTS "student_unit_assignments_owner_admin_read" ON public.student_unit_assignments;
CREATE POLICY "student_unit_assignments_owner_admin_read"
  ON public.student_unit_assignments FOR SELECT
  TO authenticated
  USING (public.is_active_owner_or_admin());

-- ── 5. Idempotent backfill - current canonical state only ────────────────────
-- One active-primary row per student whose matched_unit_id is set: a pure
-- projection of today's single-unit truth. No dates, no actor, no multi-unit
-- history for anyone (Emi included - her PACU + 6 NE rows wait for the Owner's
-- confirmation of primary unit and dates). Skips students who already have an
-- active primary, so re-running is a no-op and the migration never fights a
-- later, richer record.
-- The join REQUIRES the unit to sit in the student's own cohort: a legacy row
-- whose matched_unit_id drifted to another cohort's unit (nothing ever enforced
-- this) is SKIPPED rather than aborting the migration on fk_sua_unit_cohort.
-- Verification probe (g) then reports exactly those students, so drift is
-- surfaced to the Owner instead of silently projected or silently fatal.
INSERT INTO public.student_unit_assignments
  (student_id, cohort_id, unit_id, unit_key, role, status)
SELECT s.id, s.cohort_id, s.matched_unit_id, u.unit_name, 'primary', 'active'
FROM public.students s
JOIN public.units u ON u.id = s.matched_unit_id AND u.cohort_id = s.cohort_id
WHERE s.matched_unit_id IS NOT NULL
  AND btrim(u.unit_name) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.student_unit_assignments a
    WHERE a.student_id = s.id
      AND a.cohort_id = s.cohort_id
      AND a.role = 'primary'
      AND a.status = 'active'
  );

-- ── 6. Reload schema cache ───────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;


-- =============================================================================
-- VERIFICATION (Owner runs after applying - not part of the migration)
-- =============================================================================
--
-- (a) table exists
--   SELECT to_regclass('public.student_unit_assignments');   -- expect: not null
--
-- (b) all 15 columns, in order
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'student_unit_assignments'
--    ORDER BY ordinal_position;
--   -- expect, in order: id, student_id, cohort_id, unit_id, unit_key, role,
--   --   status, start_date, end_date, notes, assigned_by, ended_by, ended_at,
--   --   created_at, updated_at
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'student_unit_assignments';  -- expect: 15
--
-- (c) constraints - 1 PK, 5 FKs (two composite: fk_sua_student_cohort,
--     fk_sua_unit_cohort with ON DELETE SET NULL (unit_id)), 6 CHECKs
--   SELECT conname, contype, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'public.student_unit_assignments'::regclass
--    ORDER BY contype, conname;
--   -- the 6 CHECKs: chk_sua_ended_fields, chk_sua_live_requires_unit,
--   --   chk_sua_period, chk_sua_role, chk_sua_status, chk_sua_unit_key_trimmed
--   SELECT count(*) FROM pg_constraint
--    WHERE conrelid = 'public.student_unit_assignments'::regclass
--      AND contype = 'c';                                     -- expect: 6
--   SELECT count(*) FROM pg_constraint
--    WHERE conrelid = 'public.student_unit_assignments'::regclass
--      AND contype = 'f';                                     -- expect: 5
--
-- (c2) the identity-pair support indexes exist on the parents
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND indexname IN ('uq_students_id_cohort','uq_units_id_cohort');
--   -- expect: both rows
--
-- (c3) the unit-identity trigger exists and is BEFORE INSERT/UPDATE
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.student_unit_assignments'::regclass AND NOT tgisinternal;
--   -- expect: trg_sua_enforce_unit_identity, set_updated_at_student_unit_assignments
--
-- (d) the THREE partial unique indexes + three lookup indexes
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename = 'student_unit_assignments'
--    ORDER BY indexname;
--   -- expect: uq_sua_one_active_primary_per_student_cohort (WHERE role='primary' AND status='active'),
--   --         uq_sua_one_planned_primary_per_student_cohort (WHERE role='primary' AND status='planned'),
--   --         uq_sua_one_live_row_per_student_unit (WHERE status IN ('planned','active')),
--   --         idx_sua_student, idx_sua_unit_key_cohort, idx_sua_cohort, + the PK
--
-- (e) RLS on, exactly one SELECT policy, no write policy
--   SELECT relrowsecurity FROM pg_class
--    WHERE oid = 'public.student_unit_assignments'::regclass;              -- expect: true
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'student_unit_assignments';
--   -- expect: student_unit_assignments_owner_admin_read, SELECT - and nothing else
--
-- (f) privileges: authenticated SELECT only; service_role SELECT/INSERT/UPDATE;
--     NOBODY may DELETE
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'student_unit_assignments'
--    ORDER BY grantee, privilege_type;
--   -- expect: authenticated -> SELECT; service_role -> SELECT, INSERT, UPDATE. No DELETE rows.
--
-- (g) THE BACKFILL IS AN EXACT PROJECTION of matched_unit_id - three probes,
--     all must return 0:
--   -- matched students missing their projection row. Expect 0; a nonzero
--   -- count is LEGACY CROSS-COHORT DRIFT (matched_unit_id pointing at another
--   -- cohort's unit) that the backfill deliberately skipped - list them with
--   -- the companion query and bring them to the Owner:
--   SELECT count(*) FROM students s
--    WHERE s.matched_unit_id IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM student_unit_assignments a
--                       WHERE a.student_id = s.id AND a.role = 'primary'
--                         AND a.status = 'active' AND a.unit_id = s.matched_unit_id);
--   SELECT s.id, s.first_name, s.last_name, s.cohort_id AS student_cohort,
--          u.cohort_id AS unit_cohort, u.unit_name
--     FROM students s JOIN units u ON u.id = s.matched_unit_id
--    WHERE u.cohort_id <> s.cohort_id;                       -- the drifted rows, if any
--   -- projection rows whose unit disagrees with matched_unit_id:
--   SELECT count(*) FROM student_unit_assignments a
--    JOIN students s ON s.id = a.student_id
--    WHERE a.role = 'primary' AND a.status = 'active'
--      AND a.unit_id IS DISTINCT FROM s.matched_unit_id;
--   -- rows invented for unmatched students:
--   SELECT count(*) FROM student_unit_assignments a
--    JOIN students s ON s.id = a.student_id
--    WHERE s.matched_unit_id IS NULL;
--
-- (h) no dates or actors were invented
--   SELECT count(*) FROM student_unit_assignments
--    WHERE start_date IS NOT NULL OR end_date IS NOT NULL
--       OR assigned_by IS NOT NULL OR ended_at IS NOT NULL;    -- expect: 0
--
-- (i) unit_key matches the referenced unit's name on every backfilled row
--   SELECT count(*) FROM student_unit_assignments a
--    JOIN units u ON u.id = a.unit_id
--    WHERE a.unit_key <> u.unit_name;                          -- expect: 0
--
-- (j) CONSTRAINT + INTEGRITY SMOKE TEST - run the companion file
--     db/audit/student_unit_assignments_smoke_test.sql
--     It is EXECUTABLE AS-IS (no placeholders): it creates its own synthetic
--     cohorts/units/student inside a transaction, proves two AND three
--     concurrent units insert cleanly, executes EVERY rejection in its own
--     exception block (an unexpected success raises SMOKE TEST FAILURE; the
--     expected constraint or trigger is confirmed by error class), proves that
--     deleting a SYNTHETIC unit with a live assignment is blocked and that
--     ending the assignment releases it with unit_key preserved - and then
--     ROLLS EVERYTHING BACK. No production row is read, targeted, or modified.
--     Expected output: 'ok: ...' notices ending in 'ALL SMOKE TESTS PASSED'.
--
-- =============================================================================
-- ROLLBACK (safe - the table is new and additive; nothing references it yet)
-- =============================================================================
--   DROP TRIGGER IF EXISTS trg_sua_enforce_unit_identity ON public.student_unit_assignments;
--   DROP TRIGGER IF EXISTS set_updated_at_student_unit_assignments ON public.student_unit_assignments;
--   DROP FUNCTION IF EXISTS public.sua_enforce_unit_identity();
--   DROP TABLE IF EXISTS public.student_unit_assignments;  -- drops its indexes/constraints/policy
--   -- The identity-pair support indexes are inert without the composite FKs,
--   -- but drop them too for a complete revert:
--   DROP INDEX IF EXISTS public.uq_students_id_cohort;
--   DROP INDEX IF EXISTS public.uq_units_id_cohort;
--   NOTIFY pgrst, 'reload schema';
-- =============================================================================
