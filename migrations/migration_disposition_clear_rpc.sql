-- ============================================================
-- ASPIRE Intelligence — STUDENT-PROFILE-CANON-1E: Clear Disposition
-- ============================================================
--
-- Adds a SECURITY DEFINER RPC to CLEAR (inactivate) a student's active
-- disposition without hard-deleting it, and two small additive columns that
-- make a cleared row self-documenting and distinguishable from a superseded one.
--
-- Clearing semantics (see clear_student_disposition below):
--   * sets the active disposition's is_active = FALSE (drops out of
--     student_active_disposition view and the partial-unique active slot)
--   * records cleared_at + cleared_reason on the historical row
--   * logs a 'disposition_cleared' program_events audit entry
--   * DOES NOT hard-delete, DOES NOT change students.status,
--     interview_outcome, or ngrp_outcome
--
-- SAFETY:
--   Additive only. Does not alter existing columns/rows. The new columns are
--   nullable with NULL defaults. The student_active_disposition view is unchanged
--   (cleared rows have is_active = FALSE, so they already fall out of it).
--
-- DEPENDS ON:
--   migration_disposition_foundation.sql (student_dispositions, is_active,
--   record_student_disposition, program_events, user_profiles)
--
-- HOW TO RUN: Paste into Supabase SQL Editor and execute. Wrapped in BEGIN/COMMIT.
-- ============================================================

BEGIN;


-- ────────────────────────────────────────────────────────────────────────────
-- PART A: additive columns — cleared provenance on the historical row
-- ────────────────────────────────────────────────────────────────────────────
-- A cleared row is identified by cleared_at IS NOT NULL. This is distinct from a
-- SUPERSEDED row (superseded_by_id IS NOT NULL, set by record_student_disposition).

ALTER TABLE student_dispositions
  ADD COLUMN IF NOT EXISTS cleared_at     TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE student_dispositions
  ADD COLUMN IF NOT EXISTS cleared_reason TEXT        DEFAULT NULL;


-- ────────────────────────────────────────────────────────────────────────────
-- PART B: clear_student_disposition() — atomic SECURITY DEFINER function
-- ────────────────────────────────────────────────────────────────────────────
-- Clears (inactivates) the currently-active disposition(s) for a student. There
-- is normally exactly one (enforced by uq_student_active_disposition), but the
-- function loops defensively. Returns JSONB describing the outcome so the UI can
-- show a message and refresh; a no-op (no active disposition) is NOT an error.
--
-- Caller must have role = 'owner' or 'admin' in user_profiles (mirrors
-- record_student_disposition). auth.uid() is available inside SECURITY DEFINER.

CREATE OR REPLACE FUNCTION clear_student_disposition(
  p_student_id UUID,
  p_reason     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor_id   UUID := auth.uid();
  v_actor_name TEXT := '';
  v_actor_role TEXT := '';
  v_reason     TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_rec        RECORD;
  v_count      INT  := 0;
  v_first_type TEXT := NULL;
BEGIN
  -- Authorization: owner or admin only
  SELECT up.full_name, up.role
    INTO v_actor_name, v_actor_role
  FROM user_profiles up
  WHERE up.auth_user_id = v_actor_id;

  IF v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Insufficient permissions: only Owner or Admin may clear dispositions';
  END IF;

  -- Clear each currently-active disposition for this student (normally exactly one).
  FOR v_rec IN
    SELECT id, cohort_id, disposition_type
    FROM student_dispositions
    WHERE student_id = p_student_id
      AND is_active  = TRUE
  LOOP
    -- Inactivate without hard-deleting; preserve the historical row.
    -- NOTE: students.status / interview_outcome / ngrp_outcome are intentionally NOT touched.
    UPDATE student_dispositions
       SET is_active      = FALSE,
           cleared_at     = NOW(),
           cleared_reason = v_reason,
           updated_at     = NOW()
     WHERE id = v_rec.id;

    -- Audit (program_events; event_type is free-form TEXT per app convention).
    INSERT INTO program_events (
      student_id, cohort_id, event_type, event_date, notes, created_by
    ) VALUES (
      p_student_id, v_rec.cohort_id, 'disposition_cleared', CURRENT_DATE,
      'Disposition cleared. Previous disposition: ' || v_rec.disposition_type
        || '. Reason: ' || COALESCE(v_reason, 'none')
        || '. Student status was not changed.',
      v_actor_name
    );

    v_count := v_count + 1;
    IF v_first_type IS NULL THEN
      v_first_type := v_rec.disposition_type;
    END IF;
  END LOOP;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('cleared', false, 'reason', 'no_active_disposition');
  END IF;

  RETURN jsonb_build_object(
    'cleared', true,
    'count', v_count,
    'previous_disposition_type', v_first_type
  );
END;
$$;

-- Authorization enforced inside the function body.
GRANT EXECUTE ON FUNCTION clear_student_disposition TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- Reload PostgREST schema cache
-- ────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


COMMIT;
