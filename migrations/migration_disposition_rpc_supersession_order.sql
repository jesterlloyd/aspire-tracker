-- Phase 2B.2g: Fix supersession ordering in record_student_disposition RPC
--
-- BUG: The original RPC inserted the new disposition with is_active=TRUE BEFORE
-- marking the existing active disposition as is_active=FALSE. The partial unique
-- index uq_student_active_disposition rejected this because two rows would
-- momentarily be active for the same student/cohort.
--
-- FIX: Reorder operations to deactivate first, insert second, back-fill
-- superseded_by_id third. This satisfies both the partial unique index and the
-- foreign key constraint on superseded_by_id.
--
-- This is a function-only change. Schema, indexes, RLS, and other tables are
-- untouched. The function signature is preserved exactly.

CREATE OR REPLACE FUNCTION public.record_student_disposition(
  p_student_id uuid,
  p_cohort_id uuid,
  p_disposition_type text,
  p_stage_at_disposition text,
  p_decision_origin text,
  p_reason_category text,
  p_decided_by_name text DEFAULT ''::text,
  p_effective_date date DEFAULT NULL::date,
  p_followup_types text[] DEFAULT ARRAY[]::text[],
  p_private_note text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_actor_id      UUID := auth.uid();
  v_actor_name    TEXT := '';
  v_actor_role    TEXT := '';
  v_existing_id   UUID;
  v_new_id        UUID;
  v_followup_type TEXT;
  v_event_type    TEXT;
BEGIN
  -- Authorization: caller must be owner or admin
  SELECT up.full_name, up.role
    INTO v_actor_name, v_actor_role
  FROM user_profiles up
  WHERE up.auth_user_id = v_actor_id;

  IF v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Insufficient permissions: only Owner or Admin may record dispositions';
  END IF;

  -- Find existing active disposition for this student/cohort (if any)
  SELECT id INTO v_existing_id
  FROM student_dispositions
  WHERE student_id = p_student_id
    AND cohort_id  = p_cohort_id
    AND is_active  = TRUE;

  -- STEP 1 (Phase 2B.2g fix): Deactivate the previous active disposition FIRST.
  -- This satisfies the partial unique index uq_student_active_disposition before
  -- the new INSERT. superseded_by_id is back-filled after the new row exists.
  IF v_existing_id IS NOT NULL THEN
    UPDATE student_dispositions
       SET is_active  = FALSE,
           updated_at = NOW()
     WHERE id = v_existing_id;
  END IF;

  -- STEP 2: Insert the new active disposition.
  -- supersedes_id references v_existing_id (which already exists, FK satisfied).
  INSERT INTO student_dispositions (
    student_id,            cohort_id,
    disposition_type,      stage_at_disposition,   decision_origin,
    reason_category,       decided_by_name,        effective_date,
    recorded_by_user_id,   recorded_by_name,
    is_active,             supersedes_id
  ) VALUES (
    p_student_id,          p_cohort_id,
    p_disposition_type,    p_stage_at_disposition, p_decision_origin,
    p_reason_category,     p_decided_by_name,      COALESCE(p_effective_date, CURRENT_DATE),
    v_actor_id,            v_actor_name,
    TRUE,                  v_existing_id
  )
  RETURNING id INTO v_new_id;

  -- STEP 3 (Phase 2B.2g fix): Back-fill superseded_by_id on the previous row
  -- now that v_new_id exists. This completes the bidirectional supersession link.
  IF v_existing_id IS NOT NULL THEN
    UPDATE student_dispositions
       SET superseded_by_id = v_new_id
     WHERE id = v_existing_id;
  END IF;

  -- Update the student's ASPIRE status
  UPDATE students
     SET status     = 'Not Proceeding',
         updated_at = NOW()
   WHERE id = p_student_id;

  -- Insert requested follow-up tasks
  IF array_length(p_followup_types, 1) > 0 THEN
    FOREACH v_followup_type IN ARRAY p_followup_types LOOP
      INSERT INTO student_disposition_followups (
        disposition_id, student_id, cohort_id, followup_type, status
      ) VALUES (
        v_new_id, p_student_id, p_cohort_id, v_followup_type, 'pending'
      );
    END LOOP;
  END IF;

  -- Store private note (if provided)
  IF p_private_note IS NOT NULL AND length(trim(p_private_note)) > 0 THEN
    INSERT INTO student_disposition_private_notes (
      disposition_id, internal_note, created_by_user_id, created_by_name
    ) VALUES (
      v_new_id, p_private_note, v_actor_id, v_actor_name
    );
  END IF;

  -- Log program event (event_type is free-form TEXT per existing app convention)
  v_event_type := 'disposition_' || p_disposition_type;
  INSERT INTO program_events (
    student_id, cohort_id, event_type, event_date, notes, created_by
  ) VALUES (
    p_student_id, p_cohort_id, v_event_type, CURRENT_DATE,
    'Disposition recorded: ' || p_disposition_type || ' (' || p_reason_category || ')',
    v_actor_name
  );

  RETURN v_new_id;
END;
$function$;
