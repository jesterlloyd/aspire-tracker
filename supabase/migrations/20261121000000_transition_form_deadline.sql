-- 20261121000000_transition_form_deadline.sql
--
-- TRANSITION-DEADLINE-1 (Owner, 2026-11-02): "the transition form is NOT an application."
-- The Transition Form's close date used to fall back to the residency cohort's APPLICATION
-- deadline, which is a different date for a different thing. The cohort now carries its own
-- Transition Form deadline, and the two transactions that enforce the close read it instead.
--
-- The app stamps every assignment's deadline_at at send time (the date chosen on the send
-- panel, else this cohort date), so changing the cohort date later moves only forms sent
-- after the change. A form that closes stays closed unless staff extend that one alumnus
-- (Extend Deadline, which writes deadline_at).
--
-- Order: apply this BEFORE deploying the commit that reads the column.
-- Checks: db/audit/transition_form_deadline_checks.sql (PRE 1, PRE 2, POST 1, POST 2).

ALTER TABLE public.ngrp_cycles
  ADD COLUMN IF NOT EXISTS transition_form_deadline date;

COMMENT ON COLUMN public.ngrp_cycles.transition_form_deadline IS
  'Last day (Pacific) an alumnus can submit or revise the Transition Form, for sends that do not choose their own date. Not the application deadline.';

-- The COMPLETE submission in one transaction. The assignment row lock makes
-- the revision number serial under concurrency (two simultaneous submits get
-- 1 and 2, never 1 and 1 - the unique constraint is the backstop), and the
-- effective deadline is re-enforced HERE, inside the transaction, so a
-- request that passed the API check cannot commit after closure.
CREATE OR REPLACE FUNCTION public.ngrp_submit_revision_tx(
  p_assignment_id uuid, p_payload jsonb, p_interest text,
  p_result text, p_reasons jsonb, p_requirements jsonb
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  a public.ngrp_transition_assignments;
  cand public.ngrp_candidates;
  cyc public.ngrp_cycles;
  v_close timestamptz;
  v_next integer;
  v_now timestamptz := now();
  v_rev_id uuid;
BEGIN
  SELECT * INTO a FROM public.ngrp_transition_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND OR a.revoked_at IS NOT NULL OR a.status = 'pending' THEN
    RAISE EXCEPTION 'NGRP_GONE';
  END IF;
  SELECT * INTO cand FROM public.ngrp_candidates WHERE id = a.candidate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NGRP_GONE'; END IF;
  SELECT * INTO cyc FROM public.ngrp_cycles WHERE id = cand.cycle_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NGRP_GONE'; END IF;

  v_close := COALESCE(a.deadline_at,
    CASE WHEN cyc.transition_form_deadline IS NOT NULL
         THEN public.ngrp_pacific_deadline(cyc.transition_form_deadline) END);
  IF v_close IS NOT NULL AND v_now > v_close THEN RAISE EXCEPTION 'NGRP_CLOSED'; END IF;

  v_next := COALESCE(a.revision_count, 0) + 1;
  INSERT INTO public.ngrp_transition_revisions (assignment_id, revision_number, payload, submitted_at)
  VALUES (p_assignment_id, v_next, p_payload, v_now)
  RETURNING id INTO v_rev_id;

  IF v_next = 1 THEN
    UPDATE public.ngrp_transition_assignments
       SET status = 'submitted', submitted_at = v_now, revision_count = v_next, last_saved_at = v_now
     WHERE id = p_assignment_id;
  ELSE
    UPDATE public.ngrp_transition_assignments
       SET status = 'revised', revised_at = v_now, revision_count = v_next, last_saved_at = v_now
     WHERE id = p_assignment_id;
  END IF;

  IF p_interest IN ('interested', 'undecided', 'not_interested') THEN
    UPDATE public.ngrp_candidates SET interest = p_interest WHERE id = cand.id;
  END IF;

  PERFORM public.ngrp_set_candidate_eligibility_tx(cand.id, p_result, p_reasons, p_requirements, v_rev_id);

  DELETE FROM public.ngrp_transition_drafts WHERE assignment_id = p_assignment_id;

  INSERT INTO public.ngrp_audit_events
    (event_type, cycle_id, candidate_id, assignment_id, student_id, actor_kind, metadata)
  VALUES
    (CASE WHEN v_next = 1 THEN 'form_submitted' ELSE 'form_revised' END,
     cyc.id, cand.id, p_assignment_id, cand.student_id, 'alumnus',
     jsonb_build_object('revision_number', v_next, 'result', p_result));

  RETURN jsonb_build_object('revision_number', v_next, 'submitted_at', v_now);
END $$;

-- Atomic autosave: draft upsert + assignment lifecycle in one transaction,
-- with the deadline re-enforced inside it. A caller may only report saved
-- when EVERYTHING here committed.
CREATE OR REPLACE FUNCTION public.ngrp_save_draft_tx(p_assignment_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  a public.ngrp_transition_assignments;
  cyc public.ngrp_cycles;
  v_close timestamptz;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO a FROM public.ngrp_transition_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND OR a.revoked_at IS NOT NULL OR a.status = 'pending' THEN
    RAISE EXCEPTION 'NGRP_GONE';
  END IF;
  SELECT c.* INTO cyc
    FROM public.ngrp_cycles c
    JOIN public.ngrp_candidates cd ON cd.cycle_id = c.id
   WHERE cd.id = a.candidate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NGRP_GONE'; END IF;

  v_close := COALESCE(a.deadline_at,
    CASE WHEN cyc.transition_form_deadline IS NOT NULL
         THEN public.ngrp_pacific_deadline(cyc.transition_form_deadline) END);
  IF v_close IS NOT NULL AND v_now > v_close THEN RAISE EXCEPTION 'NGRP_CLOSED'; END IF;

  INSERT INTO public.ngrp_transition_drafts (assignment_id, payload, saved_at)
  VALUES (p_assignment_id, p_payload, v_now)
  ON CONFLICT (assignment_id) DO UPDATE SET payload = excluded.payload, saved_at = excluded.saved_at;

  IF a.status IN ('sent', 'opened') THEN
    UPDATE public.ngrp_transition_assignments
       SET status = 'in_progress', opened_at = COALESCE(a.opened_at, v_now), last_saved_at = v_now
     WHERE id = p_assignment_id;
  ELSE
    UPDATE public.ngrp_transition_assignments
       SET last_saved_at = v_now
     WHERE id = p_assignment_id;
  END IF;

  RETURN jsonb_build_object('saved_at', v_now);
END $$;

-- CREATE OR REPLACE keeps the existing grants (service_role only); restated for clarity.
REVOKE ALL ON FUNCTION public.ngrp_submit_revision_tx(uuid, jsonb, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ngrp_save_draft_tx(uuid, jsonb)                                FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ngrp_submit_revision_tx(uuid, jsonb, text, text, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.ngrp_save_draft_tx(uuid, jsonb)                                TO service_role;
