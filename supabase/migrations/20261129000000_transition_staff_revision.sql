-- 20261129000000_transition_staff_revision.sql
--
-- TRANSITION-STAFF-REVISION-1 (Owner, 2026-11-05). An alumnus's answer changes (Allison
-- Rabanales scheduled her NCLEX after submitting "No") and they ask the ASPIRE team to change
-- it. A Sheet correction (SHEET-CORRECT-1) changes the Sheet only, so eligibility, Fit and the
-- binder kept the old answer. This lets the Owner or an Admin save a NEW REVISION for the
-- alumnus, exactly as if the alumnus had revised it, recorded as entered by staff.
--
-- What it adds:
--   1. Two nullable columns on ngrp_transition_revisions: entered_by_profile_id (who typed it;
--      NULL means the alumnus did) and entered_reason (why, required by the app).
--   2. ngrp_staff_revision_tx: the alumnus's submit transaction without the deadline check
--      (staff may correct after the window closes), stamping who and why, and auditing
--      'form_revised' with actor_kind 'staff' and the staff profile, so no CHECK change.
--      The earlier revisions are untouched: revision_number goes up by one.
--      An alumnus's open draft is NOT deleted: it is theirs, and it is still theirs to submit.
--
-- Server-only (service_role), like ngrp_submit_revision_tx. Checks:
--   db/audit/transition_staff_revision_checks.sql

BEGIN;

ALTER TABLE public.ngrp_transition_revisions
  ADD COLUMN IF NOT EXISTS entered_by_profile_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entered_reason text CHECK (entered_reason IS NULL OR length(entered_reason) <= 500);

CREATE OR REPLACE FUNCTION public.ngrp_staff_revision_tx(
  p_assignment_id uuid, p_payload jsonb, p_interest text,
  p_result text, p_reasons jsonb, p_requirements jsonb,
  p_actor_profile_id uuid, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  a public.ngrp_transition_assignments;
  cand public.ngrp_candidates;
  v_next integer;
  v_now timestamptz := now();
  v_rev_id uuid;
BEGIN
  IF p_actor_profile_id IS NULL OR coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'NGRP_STAFF_REASON';
  END IF;
  SELECT * INTO a FROM public.ngrp_transition_assignments WHERE id = p_assignment_id FOR UPDATE;
  -- Staff correct a form the alumnus has SUBMITTED; they never submit one for them.
  IF NOT FOUND OR a.revoked_at IS NOT NULL OR COALESCE(a.revision_count, 0) < 1 THEN
    RAISE EXCEPTION 'NGRP_GONE';
  END IF;
  SELECT * INTO cand FROM public.ngrp_candidates WHERE id = a.candidate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NGRP_GONE'; END IF;

  v_next := a.revision_count + 1;
  INSERT INTO public.ngrp_transition_revisions
    (assignment_id, revision_number, payload, submitted_at, entered_by_profile_id, entered_reason)
  VALUES (p_assignment_id, v_next, p_payload, v_now, p_actor_profile_id, left(btrim(p_reason), 500))
  RETURNING id INTO v_rev_id;

  UPDATE public.ngrp_transition_assignments
     SET status = 'revised', revised_at = v_now, revision_count = v_next
   WHERE id = p_assignment_id;

  IF p_interest IN ('interested', 'undecided', 'not_interested') THEN
    UPDATE public.ngrp_candidates SET interest = p_interest WHERE id = cand.id;
  END IF;

  PERFORM public.ngrp_set_candidate_eligibility_tx(cand.id, p_result, p_reasons, p_requirements, v_rev_id);

  INSERT INTO public.ngrp_audit_events
    (event_type, cycle_id, candidate_id, assignment_id, student_id, actor_kind, actor_profile_id, metadata)
  VALUES
    ('form_revised', cand.cycle_id, cand.id, p_assignment_id, cand.student_id, 'staff', p_actor_profile_id,
     jsonb_build_object('revision_number', v_next, 'result', p_result, 'entered_by_staff', true));

  RETURN jsonb_build_object('revision_number', v_next, 'submitted_at', v_now);
END $$;

REVOKE ALL ON FUNCTION public.ngrp_staff_revision_tx(uuid, jsonb, text, text, jsonb, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ngrp_staff_revision_tx(uuid, jsonb, text, text, jsonb, jsonb, uuid, text) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (only while no staff revision exists):
--   DROP FUNCTION public.ngrp_staff_revision_tx(uuid, jsonb, text, text, jsonb, jsonb, uuid, text);
--   ALTER TABLE public.ngrp_transition_revisions
--     DROP COLUMN IF EXISTS entered_by_profile_id, DROP COLUMN IF EXISTS entered_reason;
