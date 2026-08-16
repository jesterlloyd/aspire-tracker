-- =============================================================================
-- Primary-preceptor projection: carry the SHIFT, the match fields, and later
-- edits to the canonical preceptor record
-- Migration: 20260820000000_preceptor_shift_projection
-- =============================================================================
--
-- WHY THIS EXISTS
-- students.preceptor_id is the authoritative primary-preceptor identity and
-- 20260722000000's trigger already mirrors the preceptor's NAME and EMAIL onto
-- the student. Three gaps remain, and together they are why staff still retype
-- placement details:
--
--   1. THE SHIFT IS NEVER PROJECTED. sync_primary_preceptor_mirror() reads only
--      full_name and email; preceptors.shift_type is never copied, so
--      students.shift_assigned stays whatever a human last typed - or blank.
--   2. THE MATCH COMPATIBILITY FIELDS ARE NEVER PROJECTED. The trigger aligns
--      matches.preceptor_id but not matches.preceptor_assigned /
--      matches.shift_assigned, which are what the Placement Board CSV export
--      and the unit-leader emails actually read.
--   3. A LATER EDIT TO THE PRECEPTOR RECORD DOES NOT REACH LINKED STUDENTS.
--      The trigger fires on UPDATE OF preceptor_id only, so renaming a
--      preceptor, correcting their email, or changing their shift leaves every
--      already-linked student showing the old values indefinitely.
--
-- THE MODEL - ONE PROJECTION, TWO TRIGGERS, NO NEW ASSIGNMENT PATH
-- The assignment RPCs are untouched: assign_primary_preceptor() still writes
-- ONLY students.preceptor_id, and clear_primary_preceptor() still nulls it.
-- All projection stays where it already lives - in triggers - so every existing
-- caller (the staff modal, the manage endpoint, the unit-leader endpoint)
-- inherits the new behavior with no client change and no second write path.
--
--   • public.preceptor_projected_shift(text) - the ONE shift rule. The
--     canonical set is exactly preceptors.shift_type's CHECK domain
--     (Day|Night|Mid|Variable); anything NULL, blank, or outside it projects to
--     '' (blank). A shift is NEVER inferred from the unit, from the student's
--     availability preference, or from a previous value.
--   • sync_primary_preceptor_mirror() - extended to also set
--     students.shift_assigned and, under the EXISTING single-match safety rule,
--     matches.preceptor_assigned / matches.shift_assigned.
--   • sync_students_from_preceptor_record() - NEW trigger on preceptors,
--     AFTER UPDATE OF full_name, email, shift_type. Re-projects to every
--     student whose preceptor_id is this preceptor. This is the "students
--     follow the preceptor" behavior: the linked record is the source of truth,
--     so a correction to it corrects everyone linked. Its match projection
--     joins THROUGH the student and requires students.preceptor_id = NEW.id,
--     so a stale matches.preceptor_id can never let an edit to the wrong
--     preceptor overwrite a match.
--
-- WHAT IS DELIBERATELY PRESERVED
--   • The single-match safety rule, verbatim: matches is only projected when
--     the student has EXACTLY ONE match row in that cohort. Multiple-match
--     students are left alone and keep raising the existing anomaly event.
--   • Secondary/coverage assignments cannot reach this projection: both
--     triggers key off students.preceptor_id (the PRIMARY), and
--     set_secondary_coverage_preceptor() never touches it.
--   • Authorization, idempotency ledger, audit events, notifications, the
--     preceptor_id guard trigger, multi-unit assignments, and unmatch behavior
--     are untouched.
--   • Soft-ended history rows are never deleted.
--
-- A NOTE ON THE MANUAL SHIFT CONTROL. Student Profiles has a Shift dropdown
-- that writes students.shift_assigned directly. It keeps working, but a
-- preceptor (re)assignment - or an edit to the linked preceptor's shift - now
-- overwrites it, because the requested behavior is that the student follows the
-- preceptor's shift. There is no per-student override flag today and this
-- migration does not invent one.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute. *** APPLY MANUALLY
-- (Owner/Jester). Claude Code has applied NOTHING. *** Run the one-row
-- verification query below, THEN the executable smoke test named there.
-- =============================================================================

BEGIN;

-- ── 1. The one shift rule ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.preceptor_projected_shift(p_shift_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_shift_type IS NULL THEN ''
    WHEN btrim(p_shift_type) IN ('Day', 'Night', 'Mid', 'Variable') THEN btrim(p_shift_type)
    ELSE ''
  END;
$$;

REVOKE ALL ON FUNCTION public.preceptor_projected_shift(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preceptor_projected_shift(text) TO service_role;

-- ── 2. Extend the existing student-side mirror ───────────────────────────────
-- Identical to 20260722000000's function except: it now also reads shift_type,
-- writes students.shift_assigned, and projects the two match compatibility
-- columns under the SAME single-match rule already used for matches.preceptor_id.
CREATE OR REPLACE FUNCTION public.sync_primary_preceptor_mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_full_name text;
  v_email     text;
  v_shift     text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.preceptor_id IS NOT DISTINCT FROM OLD.preceptor_id THEN
    RETURN NULL;  -- preceptor_id did not change; the triggering row is already locked
  END IF;
  IF TG_OP = 'INSERT' AND NEW.preceptor_id IS NULL THEN
    RETURN NULL;  -- new student with no Primary; nothing to mirror
  END IF;

  IF NEW.preceptor_id IS NOT NULL THEN
    -- End any active primary for the cohort that is not this preceptor.
    UPDATE public.student_preceptor_assignments
       SET status = 'ended', end_date = COALESCE(end_date, current_date), updated_at = now()
     WHERE student_id = NEW.id
       AND cohort_id  = NEW.cohort_id
       AND role       = 'primary'
       AND status     = 'active'
       AND preceptor_id IS DISTINCT FROM NEW.preceptor_id;

    -- Same-preceptor conflict: end its active secondary/coverage row so the
    -- one-active-relationship index cannot be violated by the promotion.
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

    -- Align the students display mirror from the canonical preceptor record,
    -- NOW INCLUDING THE SHIFT.
    SELECT full_name, email, public.preceptor_projected_shift(shift_type)
      INTO v_full_name, v_email, v_shift
      FROM public.preceptors WHERE id = NEW.preceptor_id;

    UPDATE public.students
       SET matched_preceptor = COALESCE(v_full_name, ''),
           preceptor_email   = COALESCE(v_email, ''),
           shift_assigned    = COALESCE(v_shift, '')
     WHERE id = NEW.id
       AND ( matched_preceptor IS DISTINCT FROM COALESCE(v_full_name, '')
          OR preceptor_email   IS DISTINCT FROM COALESCE(v_email, '')
          OR shift_assigned    IS DISTINCT FROM COALESCE(v_shift, '') );

    -- Align the current-cohort match row, ONLY when the student has exactly one
    -- match row in that cohort (the pre-existing safety rule, unchanged).
    UPDATE public.matches
       SET preceptor_id       = NEW.preceptor_id,
           preceptor_assigned = COALESCE(v_full_name, ''),
           shift_assigned     = COALESCE(v_shift, '')
     WHERE student_id = NEW.id
       AND cohort_id  = NEW.cohort_id
       AND ( preceptor_id       IS DISTINCT FROM NEW.preceptor_id
          OR preceptor_assigned IS DISTINCT FROM COALESCE(v_full_name, '')
          OR shift_assigned     IS DISTINCT FROM COALESCE(v_shift, '') )
       AND (SELECT count(*) FROM public.matches m2
            WHERE m2.student_id = NEW.id AND m2.cohort_id = NEW.cohort_id) = 1;

  ELSE
    -- Primary CLEARED for the current cohort: nothing of the previous
    -- preceptor may survive - not the name, not the email, not the shift.
    UPDATE public.student_preceptor_assignments
       SET status = 'ended', end_date = COALESCE(end_date, current_date), updated_at = now()
     WHERE student_id = NEW.id
       AND cohort_id  = NEW.cohort_id
       AND role       = 'primary'
       AND status     = 'active';

    UPDATE public.students
       SET matched_preceptor = '', preceptor_email = '', shift_assigned = ''
     WHERE id = NEW.id
       AND ( coalesce(matched_preceptor, '') <> ''
          OR coalesce(preceptor_email, '')   <> ''
          OR coalesce(shift_assigned, '')    <> '' );

    UPDATE public.matches
       SET preceptor_id       = NULL,
           preceptor_assigned = '',
           shift_assigned     = ''
     WHERE student_id = NEW.id
       AND cohort_id  = NEW.cohort_id
       AND ( preceptor_id IS NOT NULL
          OR coalesce(preceptor_assigned, '') <> ''
          OR coalesce(shift_assigned, '')     <> '' )
       AND (SELECT count(*) FROM public.matches m2
            WHERE m2.student_id = NEW.id AND m2.cohort_id = NEW.cohort_id) = 1;
  END IF;

  RETURN NULL;  -- AFTER trigger: return value is ignored
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_primary_preceptor_mirror() FROM PUBLIC, anon, authenticated;

-- The trigger itself is UNCHANGED and is NOT recreated here: 20260722000000
-- already installed trg_sync_primary_preceptor_mirror AFTER INSERT OR UPDATE OF
-- preceptor_id ON students, and 20260803000000 asserts it exists and is
-- enabled. CREATE OR REPLACE FUNCTION above swaps the body in place.

-- ── 3. NEW: linked students follow later edits to the preceptor record ───────
-- Fires only when a projected field actually changes. Re-projects to every
-- student whose PRIMARY is this preceptor. Secondary/coverage links are not
-- affected: students.preceptor_id names the primary only.
CREATE OR REPLACE FUNCTION public.sync_students_from_preceptor_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_name  text := COALESCE(NEW.full_name, '');
  v_email text := COALESCE(NEW.email, '');
  v_shift text := public.preceptor_projected_shift(NEW.shift_type);
BEGIN
  IF NEW.full_name  IS NOT DISTINCT FROM OLD.full_name
     AND NEW.email  IS NOT DISTINCT FROM OLD.email
     AND NEW.shift_type IS NOT DISTINCT FROM OLD.shift_type THEN
    RETURN NULL;  -- nothing projected changed
  END IF;

  UPDATE public.students s
     SET matched_preceptor = v_name,
         preceptor_email   = v_email,
         shift_assigned    = v_shift
   WHERE s.preceptor_id = NEW.id
     AND ( s.matched_preceptor IS DISTINCT FROM v_name
        OR s.preceptor_email   IS DISTINCT FROM v_email
        OR s.shift_assigned    IS DISTINCT FROM v_shift );

  -- The match projection follows the CANONICAL STUDENT ASSIGNMENT, never the
  -- match's own preceptor_id. Keying off m.preceptor_id would let a STALE match
  -- FK decide: editing the stale preceptor would rewrite a match belonging to a
  -- student who is canonically linked to somebody else. Joining through the
  -- student makes students.preceptor_id the authority here exactly as it is
  -- everywhere else, with the same cohort and single-match safeguards.
  UPDATE public.matches m
     SET preceptor_id       = NEW.id,
         preceptor_assigned = v_name,
         shift_assigned     = v_shift
    FROM public.students s
   WHERE s.id = m.student_id
     AND s.cohort_id = m.cohort_id
     AND s.preceptor_id = NEW.id
     AND ( m.preceptor_id       IS DISTINCT FROM NEW.id
        OR m.preceptor_assigned IS DISTINCT FROM v_name
        OR m.shift_assigned     IS DISTINCT FROM v_shift )
     AND (SELECT count(*) FROM public.matches m2
          WHERE m2.student_id = m.student_id AND m2.cohort_id = m.cohort_id) = 1;

  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sync_students_from_preceptor_record() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_students_from_preceptor_record ON public.preceptors;
CREATE TRIGGER trg_sync_students_from_preceptor_record
  AFTER UPDATE OF full_name, email, shift_type ON public.preceptors
  FOR EACH ROW EXECUTE FUNCTION public.sync_students_from_preceptor_record();

-- ── 4. One-time deterministic backfill, fully audited ────────────────────────
CREATE TABLE IF NOT EXISTS public.preceptor_projection_backfill_audit (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch                text NOT NULL,
  scope                text NOT NULL CHECK (scope IN ('student', 'match')),
  student_id           uuid NOT NULL,
  match_id             uuid,
  preceptor_id         uuid,
  old_matched_preceptor text,
  new_matched_preceptor text,
  old_preceptor_email   text,
  new_preceptor_email   text,
  old_shift_assigned    text,
  new_shift_assigned    text,
  -- The match FK is repaired too, so its previous value must stay reviewable.
  old_match_preceptor_id uuid,
  new_match_preceptor_id uuid,
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.preceptor_projection_backfill_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.preceptor_projection_backfill_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.preceptor_projection_backfill_audit TO authenticated;
GRANT SELECT, INSERT ON public.preceptor_projection_backfill_audit TO service_role;

DROP POLICY IF EXISTS "ppba_owner_admin_read" ON public.preceptor_projection_backfill_audit;
CREATE POLICY "ppba_owner_admin_read" ON public.preceptor_projection_backfill_audit
  FOR SELECT TO authenticated USING (public.is_active_owner_or_admin());

DO $seq$
DECLARE
  v_seq text := pg_get_serial_sequence('public.preceptor_projection_backfill_audit', 'id');
BEGIN
  IF v_seq IS NULL THEN
    RAISE EXCEPTION 'identity sequence for preceptor_projection_backfill_audit.id not found';
  END IF;
  EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', v_seq);
  EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', v_seq);
END;
$seq$;

-- Students: every linked student is made to equal its preceptor record exactly.
-- Deterministic (derived only from the linked row) and audited before-and-after.
WITH target AS (
  SELECT s.id AS student_id,
         s.preceptor_id,
         s.matched_preceptor AS old_name,
         s.preceptor_email   AS old_email,
         s.shift_assigned    AS old_shift,
         COALESCE(p.full_name, '')                        AS new_name,
         COALESCE(p.email, '')                            AS new_email,
         public.preceptor_projected_shift(p.shift_type)   AS new_shift
  FROM public.students s
  JOIN public.preceptors p ON p.id = s.preceptor_id
  WHERE s.preceptor_id IS NOT NULL
), drifted AS (
  SELECT * FROM target
  WHERE old_name  IS DISTINCT FROM new_name
     OR old_email IS DISTINCT FROM new_email
     OR old_shift IS DISTINCT FROM new_shift
), logged AS (
  INSERT INTO public.preceptor_projection_backfill_audit
    (batch, scope, student_id, preceptor_id,
     old_matched_preceptor, new_matched_preceptor,
     old_preceptor_email, new_preceptor_email,
     old_shift_assigned, new_shift_assigned)
  SELECT 'preceptor-projection-20260820', 'student', student_id, preceptor_id,
         old_name, new_name, old_email, new_email, old_shift, new_shift
  FROM drifted
  RETURNING student_id
)
UPDATE public.students s
   SET matched_preceptor = d.new_name,
       preceptor_email   = d.new_email,
       shift_assigned    = d.new_shift
  FROM drifted d
 WHERE s.id = d.student_id;

-- Matches: only single-match students in the same cohort, same rule as the trigger.
-- All THREE projected match fields are repaired, including the FK - the drift
-- audit measures preceptor_id drift, so the backfill must actually fix it.
WITH target AS (
  SELECT m.id AS match_id, m.student_id, m.cohort_id,
         m.preceptor_id       AS old_match_preceptor_id,
         m.preceptor_assigned AS old_name,
         m.shift_assigned     AS old_shift,
         s.preceptor_id       AS new_match_preceptor_id,
         COALESCE(p.full_name, '')                      AS new_name,
         public.preceptor_projected_shift(p.shift_type) AS new_shift
  FROM public.matches m
  JOIN public.students s   ON s.id = m.student_id AND s.cohort_id = m.cohort_id
  JOIN public.preceptors p ON p.id = s.preceptor_id
  WHERE s.preceptor_id IS NOT NULL
    AND (SELECT count(*) FROM public.matches m2
         WHERE m2.student_id = m.student_id AND m2.cohort_id = m.cohort_id) = 1
), drifted AS (
  SELECT * FROM target
  WHERE old_match_preceptor_id IS DISTINCT FROM new_match_preceptor_id
     OR old_name  IS DISTINCT FROM new_name
     OR old_shift IS DISTINCT FROM new_shift
), logged AS (
  INSERT INTO public.preceptor_projection_backfill_audit
    (batch, scope, student_id, match_id, preceptor_id,
     old_matched_preceptor, new_matched_preceptor,
     old_shift_assigned, new_shift_assigned,
     old_match_preceptor_id, new_match_preceptor_id)
  SELECT 'preceptor-projection-20260820', 'match', student_id, match_id, new_match_preceptor_id,
         old_name, new_name, old_shift, new_shift,
         old_match_preceptor_id, new_match_preceptor_id
  FROM drifted
  RETURNING match_id
)
UPDATE public.matches m
   SET preceptor_id       = d.new_match_preceptor_id,
       preceptor_assigned = d.new_name,
       shift_assigned     = d.new_shift
  FROM drifted d
 WHERE m.id = d.match_id;

NOTIFY pgrst, 'reload schema';

COMMIT;


-- =============================================================================
-- VERIFICATION (Owner runs after applying - not part of the migration)
-- =============================================================================
-- ONE row, every column TRUE when the migration landed correctly.
--
-- SELECT
--   (SELECT count(*) = 2 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public'
--       AND p.proname IN ('preceptor_projected_shift', 'sync_students_from_preceptor_record'))
--                                                                    AS new_functions_exist,
--   (SELECT count(*) = 1 FROM pg_trigger
--     WHERE tgname = 'trg_sync_students_from_preceptor_record'
--       AND tgrelid = 'public.preceptors'::regclass AND NOT tgisinternal AND tgenabled = 'O')
--                                                                    AS preceptor_trigger_enabled,
--   (SELECT count(*) = 1 FROM pg_trigger
--     WHERE tgname = 'trg_sync_primary_preceptor_mirror'
--       AND tgrelid = 'public.students'::regclass AND NOT tgisinternal AND tgenabled = 'O')
--                                                                    AS student_trigger_still_enabled,
--   (SELECT prosrc LIKE '%shift_assigned%' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public' AND p.proname = 'sync_primary_preceptor_mirror')
--                                                                    AS mirror_projects_shift,
--   public.preceptor_projected_shift('Day')      = 'Day'
--   AND public.preceptor_projected_shift('Night')    = 'Night'
--   AND public.preceptor_projected_shift('Mid')      = 'Mid'
--   AND public.preceptor_projected_shift('Variable') = 'Variable'
--   AND public.preceptor_projected_shift(NULL)       = ''
--   AND public.preceptor_projected_shift('')         = ''
--   AND public.preceptor_projected_shift('Evenings') = ''             AS shift_rule_correct,
--   -- ZERO drift remains between any linked student and their preceptor record
--   (SELECT count(*) = 0 FROM public.students s JOIN public.preceptors p ON p.id = s.preceptor_id
--     WHERE s.preceptor_id IS NOT NULL
--       AND ( s.matched_preceptor IS DISTINCT FROM COALESCE(p.full_name, '')
--          OR s.preceptor_email   IS DISTINCT FROM COALESCE(p.email, '')
--          OR s.shift_assigned    IS DISTINCT FROM public.preceptor_projected_shift(p.shift_type) ))
--                                                                    AS zero_student_drift,
--   -- ...and for every single-match current-cohort match row
--   (SELECT count(*) = 0 FROM public.matches m
--      JOIN public.students s   ON s.id = m.student_id AND s.cohort_id = m.cohort_id
--      JOIN public.preceptors p ON p.id = s.preceptor_id
--    WHERE s.preceptor_id IS NOT NULL
--      AND (SELECT count(*) FROM public.matches m2
--           WHERE m2.student_id = m.student_id AND m2.cohort_id = m.cohort_id) = 1
--      AND ( m.preceptor_id       IS DISTINCT FROM s.preceptor_id
--         OR m.preceptor_assigned IS DISTINCT FROM COALESCE(p.full_name, '')
--         OR m.shift_assigned     IS DISTINCT FROM public.preceptor_projected_shift(p.shift_type) ))
--                                                                    AS zero_match_drift,
--   -- The audit table is present with every immutable before/after field and
--   -- the right access posture. This is deterministic even when production has
--   -- ZERO drift and therefore zero backfill rows (a row count would not be).
--   (SELECT count(*) = 10 FROM information_schema.columns
--     WHERE table_schema = 'public' AND table_name = 'preceptor_projection_backfill_audit'
--       AND column_name IN ('student_id','match_id','preceptor_id',
--                           'old_matched_preceptor','new_matched_preceptor',
--                           'old_preceptor_email','new_preceptor_email',
--                           'old_shift_assigned','new_shift_assigned',
--                           'old_match_preceptor_id'))                AS audit_fields_present,
--   (SELECT count(*) = 1 FROM information_schema.columns
--     WHERE table_schema = 'public' AND table_name = 'preceptor_projection_backfill_audit'
--       AND column_name = 'new_match_preceptor_id')                   AS audit_records_new_match_fk,
--   has_table_privilege('service_role','public.preceptor_projection_backfill_audit','INSERT')
--   AND NOT has_table_privilege('service_role','public.preceptor_projection_backfill_audit','UPDATE')
--   AND NOT has_table_privilege('service_role','public.preceptor_projection_backfill_audit','DELETE')
--   AND NOT has_table_privilege('authenticated','public.preceptor_projection_backfill_audit','INSERT')
--                                                                    AS audit_append_only,
--   (SELECT count(*) = 1 FROM pg_policy
--     WHERE polrelid = 'public.preceptor_projection_backfill_audit'::regclass
--       AND polcmd = 'r')                                             AS audit_owner_admin_read_only,
--   NOT has_function_privilege('authenticated', 'public.preceptor_projected_shift(text)', 'EXECUTE')
--                                                                    AS shift_fn_service_only;
-- -- expect: a single row, every column t
--
-- To review exactly what the backfill changed:
--   SELECT scope, count(*) FROM public.preceptor_projection_backfill_audit
--    WHERE batch = 'preceptor-projection-20260820' GROUP BY scope;
--
-- SMOKE TEST - run the companion executable file
--   db/audit/preceptor_projection_smoke_test.sql
--   Synthetic, transaction-wrapped, rolled back. Proves Day/Night/Mid/Variable/
--   blank projection, initial assignment, replacement, canonical preceptor edit,
--   clearing, the single-match rule, multi-match non-interference, and that
--   secondary/coverage never touch the primary projection.
--
-- =============================================================================
-- ROLLBACK (safe - restores the 20260722000000 function body and removes the
-- new objects; the backfilled DATA is intentionally left in place, since it
-- equals the canonical preceptor records. The audit table records every change
-- if a manual revert is ever wanted.)
-- =============================================================================
--   DROP TRIGGER IF EXISTS trg_sync_students_from_preceptor_record ON public.preceptors;
--   DROP FUNCTION IF EXISTS public.sync_students_from_preceptor_record();
--   -- Re-run the function body from 20260722000000_preceptor_mirror_repair_and_sync.sql
--   -- (section "3. PREVENTION") to restore name+email-only mirroring.
--   DROP FUNCTION IF EXISTS public.preceptor_projected_shift(text);
--   -- DROP TABLE IF EXISTS public.preceptor_projection_backfill_audit;  -- only if the audit is no longer wanted
--   NOTIFY pgrst, 'reload schema';
-- =============================================================================
