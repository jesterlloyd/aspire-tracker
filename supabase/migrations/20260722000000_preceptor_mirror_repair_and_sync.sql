-- ============================================================================
-- PHASE 2B: preceptor mirror repair + writer-agnostic sync (PROPOSED, NOT APPLIED)
-- ============================================================================
-- *** GATED. APPLY MANUALLY (Owner/Jester) in the Supabase SQL editor, in ONE      ***
-- *** transaction, ONLY AFTER running the BEFORE block of                          ***
-- *** db/audit/preceptor_mirror_repair_preflight_and_verification.sql and          ***
-- *** confirming the counts match the accepted Phase 2A findings (6a=4, 7a=4, all  ***
-- *** other categories 0). Run the AFTER block immediately after COMMIT.           ***
--
-- WHAT THIS DOES
--   1. A one-time, COLUMN-PRECISE DATA REPAIR of the only defects Phase 2A found:
--      4 students whose students.matched_preceptor is blank (their students.preceptor_email
--      is ALREADY correct) and 4 students whose current-cohort matches.preceptor_id is null.
--      The canonical students.preceptor_id and the active-primary
--      student_preceptor_assignments rows are ALREADY correct (Phase 2A categories
--      1/2/3a/8a = 0), so this repair writes NO student_preceptor_assignments rows. Each
--      mirror column is audited and updated ONLY when that specific column differs, so an
--      already-canonical value (e.g. preceptor_email) is never touched or audited.
--   2. A PREVENTION trigger that keeps the same mirror in step whenever the canonical
--      students.preceptor_id changes, from ANY writer.
--
-- MATCHES CARDINALITY: matches has no unique constraint on (student_id, cohort_id), and the
--   staff writer (PreceptorAssignmentModal) updates a SINGLE match row per student
--   (student_id filter, LIMIT 1, no ordering). To avoid overwriting one of several rows, the
--   repair and the trigger update the current-cohort match FK ONLY when the student has
--   EXACTLY ONE match row in that cohort. Students with more than one are surfaced by the
--   cardinality query in the companion audit file and left for a data decision.
--
-- CANONICAL RULE (unchanged): students.preceptor_id (in students.cohort_id) is THE
--   primary-preceptor identity. Every mirror is derived FROM it. Liveness is status
--   only; rows are soft-ended, never deleted.
--
-- STUDENT-COHORT MODEL (locked): a student is permanently tied to one cohort and is never
--   re-cohorted (they graduate after completing it). Preceptors are NOT tied to a cohort
--   and may precept across cohorts. The trigger therefore fires ONLY on preceptor_id and
--   never watches or responds to students.cohort_id; every assignment write is scoped to
--   the student's fixed cohort, and existing historical rows are left untouched.
--
-- WHAT IT DOES NOT DO
--   - It does not respond to a students.cohort_id change (there is no such thing) and adds
--     no logic that ends or recreates assignments because cohort_id changed.
--   - It does not touch correct active-primary rows, secondary/coverage rows, or ended/
--     removed history (except a direct same-preceptor conflict, see the trigger).
--   - It does not touch matches.preceptor_assigned. That free-text column is NOT a
--     maintained mirror of the canonical preceptor: the assignment writer
--     (PreceptorAssignmentModal) writes matches.preceptor_id only, never
--     preceptor_assigned, and docs/PRECEPTOR_ARCHITECTURE.md lists it as a free-text
--     fallback that "must not be cleared". Aligning it is therefore not canonical behavior.
--   - It does not touch evaluation routing, the preceptors directory, or any RLS policy.
--   - It widens NO permission: who may change students.preceptor_id is unchanged (the
--     existing is_staff() policy on students). The trigger only MIRRORS an already
--     authorized change into the service-managed tables.
--
-- ROLLBACK: see the audit table below and the rollback block in the companion audit file.
-- ============================================================================

BEGIN;

-- ############################################################################
-- 0. Rollback audit table. Captures the prior value of every row this repair will
--    change, under a fixed batch id, so the one-time repair is exactly reversible.
--    No RLS policy is added; RLS is enabled with no policy so the table is reachable
--    only by the service role (never by anon/authenticated via the API).
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.preceptor_mirror_repair_audit (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch       text        NOT NULL,
  entity      text        NOT NULL,   -- 'students' | 'matches'
  ref_id      uuid        NOT NULL,   -- student_id or match_id
  col         text        NOT NULL,   -- column captured
  old_value   text,                   -- prior value, text-cast (NULL preserved)
  captured_at timestamptz NOT NULL DEFAULT now(),
  -- Exactly one snapshot per repaired column, so re-running the snapshot is a no-op and the
  -- rollback join (ref_id, col) can never match more than one row.
  CONSTRAINT uq_pmra_batch_entity_ref_col UNIQUE (batch, entity, ref_id, col)
);
ALTER TABLE public.preceptor_mirror_repair_audit ENABLE ROW LEVEL SECURITY;

-- COLUMN-PRECISE, CONFLICT-SAFE snapshots: each mirror column is captured ONLY when that
-- specific column differs from canonical (an already-correct value is never audited), and
-- ON CONFLICT DO NOTHING makes the snapshot safely repeatable.

-- students.matched_preceptor (only when it differs).
INSERT INTO public.preceptor_mirror_repair_audit (batch, entity, ref_id, col, old_value)
SELECT 'phase2b-preceptor-mirror', 'students', s.id, 'matched_preceptor', s.matched_preceptor
FROM public.students s
JOIN public.preceptors p ON p.id = s.preceptor_id
WHERE s.preceptor_id IS NOT NULL
  AND btrim(lower(coalesce(s.matched_preceptor,''))) IS DISTINCT FROM btrim(lower(coalesce(p.full_name,'')))
ON CONFLICT (batch, entity, ref_id, col) DO NOTHING;

-- students.preceptor_email (only when it differs; for the accepted data this captures ZERO rows).
INSERT INTO public.preceptor_mirror_repair_audit (batch, entity, ref_id, col, old_value)
SELECT 'phase2b-preceptor-mirror', 'students', s.id, 'preceptor_email', s.preceptor_email
FROM public.students s
JOIN public.preceptors p ON p.id = s.preceptor_id
WHERE s.preceptor_id IS NOT NULL
  AND btrim(lower(coalesce(s.preceptor_email,''))) IS DISTINCT FROM btrim(lower(coalesce(p.email,'')))
ON CONFLICT (batch, entity, ref_id, col) DO NOTHING;

-- matches.preceptor_id (current-cohort, only the student's SINGLE current-cohort match row).
INSERT INTO public.preceptor_mirror_repair_audit (batch, entity, ref_id, col, old_value)
SELECT 'phase2b-preceptor-mirror', 'matches', m.id, 'preceptor_id', m.preceptor_id::text
FROM public.matches m
JOIN public.students s ON s.id = m.student_id AND s.cohort_id = m.cohort_id
WHERE s.preceptor_id IS NOT NULL
  AND m.preceptor_id IS DISTINCT FROM s.preceptor_id
  AND (SELECT count(*) FROM public.matches m2
       WHERE m2.student_id = s.id AND m2.cohort_id = s.cohort_id) = 1
ON CONFLICT (batch, entity, ref_id, col) DO NOTHING;


-- ############################################################################
-- 1. One-time repair (data-driven; no student ids are hardcoded).
-- ############################################################################

-- 1a. Align students.matched_preceptor, ONLY where it differs from canonical.
UPDATE public.students s
   SET matched_preceptor = p.full_name
FROM public.preceptors p
WHERE s.preceptor_id = p.id
  AND s.preceptor_id IS NOT NULL
  AND btrim(lower(coalesce(s.matched_preceptor,''))) IS DISTINCT FROM btrim(lower(coalesce(p.full_name,'')));

-- 1b. Align students.preceptor_email, ONLY where it differs from canonical. Independent of
--     1a, so an already-correct email is never rewritten (for the accepted data this changes
--     ZERO rows).
UPDATE public.students s
   SET preceptor_email = p.email
FROM public.preceptors p
WHERE s.preceptor_id = p.id
  AND s.preceptor_id IS NOT NULL
  AND btrim(lower(coalesce(s.preceptor_email,''))) IS DISTINCT FROM btrim(lower(coalesce(p.email,'')));

-- 1c. Align the student's current-cohort match FK to the canonical primary, ONLY when the
--     student has EXACTLY ONE match row in that cohort, so no historical or duplicate match
--     row is ever overwritten. Students with more than one current-cohort match row are left
--     for a data decision (see the cardinality query in the companion audit file). Matches in
--     other cohorts are untouched.
UPDATE public.matches m
   SET preceptor_id = s.preceptor_id
FROM public.students s
WHERE m.student_id = s.id
  AND m.cohort_id  = s.cohort_id
  AND s.preceptor_id IS NOT NULL
  AND m.preceptor_id IS DISTINCT FROM s.preceptor_id
  AND (SELECT count(*) FROM public.matches m2
       WHERE m2.student_id = s.id AND m2.cohort_id = s.cohort_id) = 1;


-- ############################################################################
-- 2. Prevention: keep the mirror in step on any future canonical change.
--
-- SECURITY DEFINER so the mirror is maintained even when the change comes from the
-- client staff path (an authenticated staff user has no write policy on
-- student_preceptor_assignments; the definer, owned by the migration runner, writes it).
-- This does NOT let anyone change students.preceptor_id who could not already: the
-- students write policy (is_staff()) is unchanged, and this function only mirrors an
-- authorized change. Fixed search_path; execution revoked from PUBLIC.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.sync_primary_preceptor_mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_full_name text;
  v_email     text;
BEGIN
  -- Fire only on a real change of the canonical Primary identity. A student is permanently
  -- tied to one cohort and is never re-cohorted, so students.cohort_id is fixed and this
  -- function neither watches for nor responds to a cohort change: it always scopes every
  -- assignment write to the student's fixed cohort (NEW.cohort_id).
  IF TG_OP = 'UPDATE' AND NEW.preceptor_id IS NOT DISTINCT FROM OLD.preceptor_id THEN
    RETURN NULL;  -- preceptor_id did not change; the triggering row is already locked
  END IF;
  IF TG_OP = 'INSERT' AND NEW.preceptor_id IS NULL THEN
    RETURN NULL;  -- new student with no Primary; nothing to mirror
  END IF;

  IF NEW.preceptor_id IS NOT NULL THEN
    -- New/changed Primary for the student's cohort.

    -- End any active primary for the cohort that is not this preceptor.
    UPDATE public.student_preceptor_assignments
       SET status = 'ended', end_date = COALESCE(end_date, current_date), updated_at = now()
     WHERE student_id = NEW.id
       AND cohort_id  = NEW.cohort_id
       AND role       = 'primary'
       AND status     = 'active'
       AND preceptor_id IS DISTINCT FROM NEW.preceptor_id;

    -- Same-preceptor conflict: the ppm3 relationship index forbids the new preceptor
    -- being active in two roles for this (student, cohort). End its active secondary/
    -- coverage row (the ONLY case a secondary/coverage row is ever touched) so the
    -- primary insert below can succeed.
    UPDATE public.student_preceptor_assignments
       SET status = 'ended', end_date = COALESCE(end_date, current_date), updated_at = now()
     WHERE student_id  = NEW.id
       AND cohort_id   = NEW.cohort_id
       AND preceptor_id = NEW.preceptor_id
       AND role IN ('secondary', 'coverage')
       AND status = 'active';

    -- Ensure exactly one active primary for the current cohort (idempotent).
    INSERT INTO public.student_preceptor_assignments (student_id, preceptor_id, cohort_id, role, status)
    SELECT NEW.id, NEW.preceptor_id, NEW.cohort_id, 'primary', 'active'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.student_preceptor_assignments
      WHERE student_id = NEW.id AND cohort_id = NEW.cohort_id
        AND role = 'primary' AND status = 'active'
    );

    -- Align the students display mirror from the canonical preceptor record.
    SELECT full_name, email INTO v_full_name, v_email
      FROM public.preceptors WHERE id = NEW.preceptor_id;

    UPDATE public.students
       SET matched_preceptor = COALESCE(v_full_name, ''),
           preceptor_email   = COALESCE(v_email, '')
     WHERE id = NEW.id
       AND ( matched_preceptor IS DISTINCT FROM COALESCE(v_full_name, '')
          OR preceptor_email   IS DISTINCT FROM COALESCE(v_email, '') );

    -- Align the current-cohort match FK, ONLY when the student has exactly one match row in
    -- that cohort (never overwrite one of several rows). Mirrors the staff writer, which
    -- updates a single match row per student. Matches in other cohorts are untouched.
    UPDATE public.matches
       SET preceptor_id = NEW.preceptor_id
     WHERE student_id = NEW.id
       AND cohort_id  = NEW.cohort_id
       AND preceptor_id IS DISTINCT FROM NEW.preceptor_id
       AND (SELECT count(*) FROM public.matches m2
            WHERE m2.student_id = NEW.id AND m2.cohort_id = NEW.cohort_id) = 1;

  ELSE
    -- Primary CLEARED for the current cohort.
    UPDATE public.student_preceptor_assignments
       SET status = 'ended', end_date = COALESCE(end_date, current_date), updated_at = now()
     WHERE student_id = NEW.id
       AND cohort_id  = NEW.cohort_id
       AND role       = 'primary'
       AND status     = 'active';

    UPDATE public.students
       SET matched_preceptor = '', preceptor_email = ''
     WHERE id = NEW.id
       AND (coalesce(matched_preceptor,'') <> '' OR coalesce(preceptor_email,'') <> '');

    UPDATE public.matches
       SET preceptor_id = NULL
     WHERE student_id = NEW.id
       AND cohort_id  = NEW.cohort_id
       AND preceptor_id IS NOT NULL
       AND (SELECT count(*) FROM public.matches m2
            WHERE m2.student_id = NEW.id AND m2.cohort_id = NEW.cohort_id) = 1;
  END IF;

  RETURN NULL;  -- AFTER trigger: return value is ignored
END;
$fn$;

COMMENT ON FUNCTION public.sync_primary_preceptor_mirror() IS
  'Phase 2B: mirrors the canonical students.preceptor_id into the active-primary '
  'student_preceptor_assignments row (scoped to the student fixed cohort), the students '
  'display fields, and the current-cohort matches.preceptor_id (only when the student has '
  'exactly one match row in that cohort). Writer-agnostic and idempotent. Does not respond '
  'to cohort changes (students are single-cohort), and does not touch matches.preceptor_assigned, '
  'secondary/coverage rows (except a same-preceptor conflict), or history.';

-- The self-UPDATE of students.matched_preceptor / preceptor_email inside the function does
-- NOT re-enter this trigger: it fires only on INSERT or on UPDATE OF preceptor_id, and the
-- self-UPDATE sets neither. No recursion is possible.
DROP TRIGGER IF EXISTS trg_sync_primary_preceptor_mirror ON public.students;
CREATE TRIGGER trg_sync_primary_preceptor_mirror
  AFTER INSERT OR UPDATE OF preceptor_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.sync_primary_preceptor_mirror();

-- No caller ever executes this function directly; it runs only via the trigger.
REVOKE ALL ON FUNCTION public.sync_primary_preceptor_mirror() FROM PUBLIC;

COMMIT;
