-- =============================================================================
-- Multi-unit placements phase 2: bidirectional sync + atomic primary change
-- Migration: 20260817000000_student_unit_assignment_sync
-- =============================================================================
--
-- WHY THIS EXISTS
-- 20260816000000 made student_unit_assignments the authoritative multi-unit
-- record, with students.matched_unit_id as the backward-compatible single-unit
-- projection. Two writers now exist for "the student's primary unit":
--
--   • the CLASSIC matching flow (src/App.jsx createMatch/unmatch/deleteUnit)
--     writes students.matched_unit_id directly from the browser;
--   • the NEW assignment management writes student_unit_assignments rows
--     through server endpoints.
--
-- Without database-side synchronization those two drift apart on the very first
-- classic match after the foundation, and "atomically" is not something two
-- PostgREST calls can promise. So the sync lives here, in triggers, where both
-- directions are transactional by construction:
--
--   • students.matched_unit_id changes  ->  the active-primary assignment row
--     is ended/promoted/inserted to mirror it (covers every classic flow with
--     zero client changes);
--   • assignment rows change            ->  students.matched_unit_id is
--     recomputed from the current active primary (covers the new management
--     surface, including "end primary" -> NULL projection).
--
-- Recursion is impossible: each trigger no-ops beyond depth 1
-- (pg_trigger_depth), and both converge on IS DISTINCT FROM checks anyway.
--
-- set_primary_unit_assignment() is the ATOMIC primary change the management UI
-- calls: end (or keep) the old primary, promote-or-insert the new one, and let
-- the trigger project matched_unit_id - one transaction, service-role only.
--
-- sua_sync_ready() exists so the management endpoint can PROBE whether this
-- migration is applied and fail closed with 'migration_required' instead of
-- performing writes whose sync half would silently not happen.
--
-- SCOPE. Additive: two trigger functions + triggers, two RPCs. No table
-- changes, no RLS changes, no client grants. The classic matching flow's
-- behavior is unchanged from the user's point of view - its writes simply gain
-- a mirrored assignment row in the same transaction.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute. *** APPLY MANUALLY
-- (Owner/Jester). Claude Code has applied NOTHING. *** Run the verification
-- block below, THEN enable the management UI's primary operations.
-- =============================================================================

BEGIN;

-- ── 1. students.matched_unit_id -> assignment rows ───────────────────────────
CREATE OR REPLACE FUNCTION public.sync_assignments_from_matched_unit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_live_row_id uuid;
BEGIN
  -- Depth guard: when the assignment-side trigger updated students, the
  -- assignment rows are already correct; re-deriving them would be circular.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- CROSS-COHORT REJECTION, BEFORE ANY MUTATION. A matched_unit_id pointing at
  -- another cohort's unit is a corrupt write, and absorbing it in any form -
  -- ending the old primary, inserting nothing, or projecting half a state -
  -- would leave matched_unit_id and the assignment rows telling different
  -- stories. Raising here aborts the ENTIRE transaction that carried the
  -- classic match, so students.matched_unit_id and every assignment row stay
  -- exactly as they were and the staff client surfaces a hard error instead of
  -- silent drift. (The foundation backfill's skip-and-surface stance covered
  -- PRE-EXISTING drift; a NEW write is rejected outright.)
  IF NEW.matched_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.units u
    WHERE u.id = NEW.matched_unit_id AND u.cohort_id = NEW.cohort_id
  ) THEN
    RAISE EXCEPTION 'students.matched_unit_id %: unit does not belong to cohort % - cross-cohort match rejected',
      NEW.matched_unit_id, NEW.cohort_id;
  END IF;

  -- End the current active primary when it no longer matches. ended_by stays
  -- NULL: the classic browser flow carries no server-verified actor, and
  -- inventing one would be worse than none.
  UPDATE public.student_unit_assignments
     SET status = 'ended', ended_at = now(), updated_at = now()
   WHERE student_id = NEW.id
     AND cohort_id = NEW.cohort_id
     AND role = 'primary'
     AND status = 'active'
     AND (NEW.matched_unit_id IS NULL OR unit_id IS DISTINCT FROM NEW.matched_unit_id);

  IF NEW.matched_unit_id IS NOT NULL THEN
    -- Already mirrored? Done.
    IF EXISTS (
      SELECT 1 FROM public.student_unit_assignments
      WHERE student_id = NEW.id AND cohort_id = NEW.cohort_id
        AND role = 'primary' AND status = 'active'
        AND unit_id = NEW.matched_unit_id
    ) THEN
      RETURN NEW;
    END IF;

    -- A live row for this unit already exists (a planned successor or an
    -- additional unit): PROMOTE it rather than violating the one-live-row-
    -- per-unit invariant with a duplicate insert.
    SELECT id INTO v_live_row_id
    FROM public.student_unit_assignments
    WHERE student_id = NEW.id AND cohort_id = NEW.cohort_id
      AND unit_id = NEW.matched_unit_id
      AND status IN ('planned', 'active')
    LIMIT 1;

    IF v_live_row_id IS NOT NULL THEN
      UPDATE public.student_unit_assignments
         SET role = 'primary', status = 'active', updated_at = now()
       WHERE id = v_live_row_id;
    ELSE
      -- Fresh active primary, unit_key derived by the foundation trigger. The
      -- unit's cohort was already validated above, so this is a plain insert -
      -- if it cannot land, the transaction fails loudly rather than drifting.
      INSERT INTO public.student_unit_assignments
        (student_id, cohort_id, unit_id, role, status, notes)
      VALUES (NEW.id, NEW.cohort_id, NEW.matched_unit_id, 'primary', 'active',
              'synced from matched_unit_id');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_assignments_from_matched_unit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_assignments_from_matched_unit ON public.students;
CREATE TRIGGER trg_sync_assignments_from_matched_unit
  AFTER UPDATE OF matched_unit_id ON public.students
  FOR EACH ROW
  WHEN (OLD.matched_unit_id IS DISTINCT FROM NEW.matched_unit_id)
  EXECUTE FUNCTION public.sync_assignments_from_matched_unit();

-- ── 2. assignment rows -> students.matched_unit_id ───────────────────────────
CREATE OR REPLACE FUNCTION public.sync_matched_unit_from_assignments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_primary_unit uuid;
BEGIN
  -- Depth guard: when the students-side trigger wrote these rows, students is
  -- already the source of the change.
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  SELECT unit_id INTO v_primary_unit
  FROM public.student_unit_assignments
  WHERE student_id = NEW.student_id AND cohort_id = NEW.cohort_id
    AND role = 'primary' AND status = 'active'
  LIMIT 1;

  UPDATE public.students
     SET matched_unit_id = v_primary_unit
   WHERE id = NEW.student_id
     AND matched_unit_id IS DISTINCT FROM v_primary_unit;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_matched_unit_from_assignments() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_matched_unit_from_assignments ON public.student_unit_assignments;
CREATE TRIGGER trg_sync_matched_unit_from_assignments
  AFTER INSERT OR UPDATE ON public.student_unit_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_matched_unit_from_assignments();

-- ── 3. Atomic primary change (service-role only) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.set_primary_unit_assignment(
  p_student_id       uuid,
  p_unit_id          uuid,
  p_actor_profile_id uuid,
  p_start_date       date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_cohort   uuid;
  v_current  uuid;
  v_live_id  uuid;
BEGIN
  SELECT cohort_id INTO v_cohort FROM public.students WHERE id = p_student_id;
  IF v_cohort IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'student_not_found');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.units u WHERE u.id = p_unit_id AND u.cohort_id = v_cohort) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unit_not_in_student_cohort');
  END IF;

  SELECT unit_id INTO v_current
  FROM public.student_unit_assignments
  WHERE student_id = p_student_id AND cohort_id = v_cohort
    AND role = 'primary' AND status = 'active'
  LIMIT 1;

  IF v_current = p_unit_id THEN
    RETURN jsonb_build_object('ok', true, 'no_change', true);
  END IF;

  -- End the outgoing primary WITH the actor - this path knows who acted.
  UPDATE public.student_unit_assignments
     SET status = 'ended', ended_at = now(), ended_by = p_actor_profile_id, updated_at = now()
   WHERE student_id = p_student_id AND cohort_id = v_cohort
     AND role = 'primary' AND status = 'active';

  -- Promote a live row for the target unit if one exists; otherwise insert.
  SELECT id INTO v_live_id
  FROM public.student_unit_assignments
  WHERE student_id = p_student_id AND cohort_id = v_cohort
    AND unit_id = p_unit_id AND status IN ('planned', 'active')
  LIMIT 1;

  IF v_live_id IS NOT NULL THEN
    UPDATE public.student_unit_assignments
       SET role = 'primary', status = 'active',
           start_date = COALESCE(p_start_date, start_date),
           updated_at = now()
     WHERE id = v_live_id;
  ELSE
    INSERT INTO public.student_unit_assignments
      (student_id, cohort_id, unit_id, role, status, start_date, assigned_by)
    VALUES (p_student_id, v_cohort, p_unit_id, 'primary', 'active', p_start_date, p_actor_profile_id);
  END IF;

  -- The assignment-side trigger has already projected matched_unit_id inside
  -- this same transaction; report the result for the caller's audit trail.
  RETURN jsonb_build_object('ok', true, 'previous_unit_id', v_current, 'new_unit_id', p_unit_id);
END;
$$;

REVOKE ALL ON FUNCTION public.set_primary_unit_assignment(uuid, uuid, uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_primary_unit_assignment(uuid, uuid, uuid, date)
  TO service_role;

-- ── 4. Readiness probe for the management endpoint ───────────────────────────
-- The endpoint calls this before ANY write: a missing function (PGRST202) means
-- this migration is not applied, and the endpoint refuses with
-- 'migration_required' rather than writing rows whose matched_unit_id sync
-- would silently not happen.
CREATE OR REPLACE FUNCTION public.sua_sync_ready()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sync_matched_unit_from_assignments'
      AND tgrelid = 'public.student_unit_assignments'::regclass
      AND NOT tgisinternal
  ) AND EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_sync_assignments_from_matched_unit'
      AND tgrelid = 'public.students'::regclass
      AND NOT tgisinternal
  );
$$;

REVOKE ALL ON FUNCTION public.sua_sync_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sua_sync_ready() TO service_role;

COMMIT;


-- =============================================================================
-- VERIFICATION (Owner runs after applying - not part of the migration)
-- =============================================================================
--
-- (a) both triggers + both RPCs exist
--   SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
--     ('trg_sync_assignments_from_matched_unit', 'trg_sync_matched_unit_from_assignments');
--   -- expect: both rows
--   SELECT proname FROM pg_proc WHERE proname IN
--     ('sync_assignments_from_matched_unit', 'sync_matched_unit_from_assignments',
--      'set_primary_unit_assignment', 'sua_sync_ready');
--   -- expect: 4 rows
--   SELECT public.sua_sync_ready();                          -- expect: true
--
-- (b) function privileges: service-role only for the RPCs
--   SELECT has_function_privilege('anon', 'public.set_primary_unit_assignment(uuid,uuid,uuid,date)', 'EXECUTE');          -- false
--   SELECT has_function_privilege('authenticated', 'public.set_primary_unit_assignment(uuid,uuid,uuid,date)', 'EXECUTE'); -- false
--   SELECT has_function_privilege('service_role', 'public.set_primary_unit_assignment(uuid,uuid,uuid,date)', 'EXECUTE');  -- true
--
-- (c) SYNC SMOKE TEST - run the companion executable file
--     db/audit/student_unit_assignment_sync_smoke_test.sql
--     Placeholder-free and synthetic: it creates its own cohorts/units/student
--     inside a transaction, proves BOTH sync directions, the classic rematch
--     and unmatch flows, the atomic RPC primary change, that a CROSS-COHORT
--     classic match is REJECTED with the prior state fully preserved, and that
--     ending the primary projects matched_unit_id to NULL - then rolls
--     everything back and leaves nothing. Expected output: 'ok: ...' notices
--     ending in 'ALL SYNC SMOKE TESTS PASSED'.
--
-- =============================================================================
-- ROLLBACK (safe - removes only what this migration added)
-- =============================================================================
--   DROP TRIGGER IF EXISTS trg_sync_assignments_from_matched_unit ON public.students;
--   DROP TRIGGER IF EXISTS trg_sync_matched_unit_from_assignments ON public.student_unit_assignments;
--   DROP FUNCTION IF EXISTS public.sync_assignments_from_matched_unit();
--   DROP FUNCTION IF EXISTS public.sync_matched_unit_from_assignments();
--   DROP FUNCTION IF EXISTS public.set_primary_unit_assignment(uuid, uuid, uuid, date);
--   DROP FUNCTION IF EXISTS public.sua_sync_ready();
-- =============================================================================
