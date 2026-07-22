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
--   1. A one-time DATA REPAIR of the only defects Phase 2A found: denormalized mirror
--      drift on 4 students (matched_preceptor / preceptor_email blank) and 4
--      current-cohort matches.preceptor_id nulls. The canonical students.preceptor_id
--      and the active-primary student_preceptor_assignments rows are ALREADY correct
--      (Phase 2A categories 1/2/3a/8a = 0), so this repair writes NO
--      student_preceptor_assignments rows.
--   2. A PREVENTION trigger that keeps the same mirror in step whenever the canonical
--      students.preceptor_id (or students.cohort_id) changes, from ANY writer.
--
-- CANONICAL RULE (unchanged): students.preceptor_id (in students.cohort_id) is THE
--   primary-preceptor identity. Every mirror is derived FROM it. Liveness is status
--   only; rows are soft-ended, never deleted.
--
-- WHAT IT DOES NOT DO
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
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.preceptor_mirror_repair_audit ENABLE ROW LEVEL SECURITY;

-- Snapshot the students display-mirror rows that will change (batch: phase2b-preceptor-mirror).
INSERT INTO public.preceptor_mirror_repair_audit (batch, entity, ref_id, col, old_value)
SELECT 'phase2b-preceptor-mirror', 'students', s.id, 'matched_preceptor', s.matched_preceptor
FROM public.students s
JOIN public.preceptors p ON p.id = s.preceptor_id
WHERE s.preceptor_id IS NOT NULL
  AND ( btrim(lower(coalesce(s.matched_preceptor,''))) IS DISTINCT FROM btrim(lower(coalesce(p.full_name,'')))
     OR btrim(lower(coalesce(s.preceptor_email,'')))   IS DISTINCT FROM btrim(lower(coalesce(p.email,''))) )
UNION ALL
SELECT 'phase2b-preceptor-mirror', 'students', s.id, 'preceptor_email', s.preceptor_email
FROM public.students s
JOIN public.preceptors p ON p.id = s.preceptor_id
WHERE s.preceptor_id IS NOT NULL
  AND ( btrim(lower(coalesce(s.matched_preceptor,''))) IS DISTINCT FROM btrim(lower(coalesce(p.full_name,'')))
     OR btrim(lower(coalesce(s.preceptor_email,'')))   IS DISTINCT FROM btrim(lower(coalesce(p.email,''))) );

-- Snapshot the current-cohort match rows that will change.
INSERT INTO public.preceptor_mirror_repair_audit (batch, entity, ref_id, col, old_value)
SELECT 'phase2b-preceptor-mirror', 'matches', m.id, 'preceptor_id', m.preceptor_id::text
FROM public.matches m
JOIN public.students s ON s.id = m.student_id AND s.cohort_id = m.cohort_id
WHERE s.preceptor_id IS NOT NULL
  AND m.preceptor_id IS DISTINCT FROM s.preceptor_id;


-- ############################################################################
-- 1. One-time repair (data-driven; no student ids are hardcoded).
-- ############################################################################

-- 1a. Align the students display mirror to the canonical preceptor record.
UPDATE public.students s
   SET matched_preceptor = p.full_name,
       preceptor_email   = p.email
FROM public.preceptors p
WHERE s.preceptor_id = p.id
  AND s.preceptor_id IS NOT NULL
  AND ( btrim(lower(coalesce(s.matched_preceptor,''))) IS DISTINCT FROM btrim(lower(coalesce(p.full_name,'')))
     OR btrim(lower(coalesce(s.preceptor_email,'')))   IS DISTINCT FROM btrim(lower(coalesce(p.email,''))) );

-- 1b. Align the current-cohort match mirror to the canonical primary. Historical matches
--     in other cohorts are left untouched (they may legitimately hold an old preceptor).
UPDATE public.matches m
   SET preceptor_id = s.preceptor_id
FROM public.students s
WHERE m.student_id = s.id
  AND m.cohort_id  = s.cohort_id
  AND s.preceptor_id IS NOT NULL
  AND m.preceptor_id IS DISTINCT FROM s.preceptor_id;


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
  v_preceptor_changed boolean;
  v_cohort_changed    boolean;
  v_full_name         text;
  v_email             text;
BEGIN
  v_preceptor_changed :=
       (TG_OP = 'INSERT' AND NEW.preceptor_id IS NOT NULL)
    OR (TG_OP = 'UPDATE' AND NEW.preceptor_id IS DISTINCT FROM OLD.preceptor_id);
  v_cohort_changed :=
       (TG_OP = 'UPDATE' AND NEW.cohort_id IS DISTINCT FROM OLD.cohort_id);

  IF NOT v_preceptor_changed AND NOT v_cohort_changed THEN
    RETURN NULL;  -- nothing canonical changed; the triggering row is already locked
  END IF;

  -- COHORT CHANGE: the student moved cohorts. End every active assignment tied to the
  -- OLD cohort (history preserved, soft end). Never delete. The current-cohort mirror is
  -- (re)built below from students.preceptor_id.
  IF v_cohort_changed THEN
    UPDATE public.student_preceptor_assignments
       SET status = 'ended', end_date = COALESCE(end_date, current_date), updated_at = now()
     WHERE student_id = NEW.id
       AND cohort_id  = OLD.cohort_id
       AND status     = 'active';
  END IF;

  IF NEW.preceptor_id IS NOT NULL THEN
    -- New/changed primary for the CURRENT cohort.

    -- End any active primary for the current cohort that is not this preceptor.
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

    -- Align the current-cohort match mirror (only when a current-cohort match row exists).
    UPDATE public.matches
       SET preceptor_id = NEW.preceptor_id
     WHERE student_id = NEW.id
       AND cohort_id  = NEW.cohort_id
       AND preceptor_id IS DISTINCT FROM NEW.preceptor_id;

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
       AND preceptor_id IS NOT NULL;
  END IF;

  RETURN NULL;  -- AFTER trigger: return value is ignored
END;
$fn$;

COMMENT ON FUNCTION public.sync_primary_preceptor_mirror() IS
  'Phase 2B: mirrors the canonical students.preceptor_id (and cohort_id) into the '
  'active-primary student_preceptor_assignments row, students display fields, and the '
  'current-cohort matches.preceptor_id. Writer-agnostic and idempotent. Does not touch '
  'matches.preceptor_assigned, secondary/coverage rows (except a same-preceptor conflict), '
  'or history.';

-- The self-UPDATE of students.matched_preceptor / preceptor_email inside the function does
-- NOT re-enter this trigger: it fires only on INSERT or on UPDATE OF preceptor_id/cohort_id,
-- and the self-UPDATE sets neither. No recursion is possible.
DROP TRIGGER IF EXISTS trg_sync_primary_preceptor_mirror ON public.students;
CREATE TRIGGER trg_sync_primary_preceptor_mirror
  AFTER INSERT OR UPDATE OF preceptor_id, cohort_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.sync_primary_preceptor_mirror();

-- No caller ever executes this function directly; it runs only via the trigger.
REVOKE ALL ON FUNCTION public.sync_primary_preceptor_mirror() FROM PUBLIC;

COMMIT;
