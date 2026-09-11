-- ============================================================================
-- RESIDENCY PORTAL: Admins can decide preceptor feedback requests
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester). Claude Code has applied NOTHING. ***
--
-- Owner decision, 2026-09-11: Admins can approve (and decline or withdraw)
-- Talent Acquisition requests to view preceptor feedback, not only the Owner.
--
-- WHAT THIS FILE DOES
--   CREATE OR REPLACEs ngrp_pf_decide_tx (from 20260912000000). The body is
--   unchanged except the decider check, which now admits the SAME people the
--   request notification already goes to (_emit_staff_notifications): an
--   active profile with the Owner capability or the owner/admin role.
--   Signature, return shape, and EXECUTE grants are unchanged and re-stated.
--
-- WHAT THIS FILE DOES NOT DO
--   It changes no table, no grant on any table, and no other function.
--   Co-Leads, Interviewers, Viewers, and every portal role still cannot decide.
--
-- DEPLOY ORDER: either. Until this is applied, an Admin who presses Approve
--   gets "owner_required" back from the database and nothing changes.
--
-- PREFLIGHT / POSTFLIGHT: db/audit/ngrp_preceptor_feedback_admin_decide_checks.sql

BEGIN;

DO $pre$
BEGIN
  IF to_regprocedure('public.ngrp_pf_decide_tx(uuid, uuid, text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: ngrp_pf_decide_tx is missing (apply 20260912000000 first)';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.ngrp_pf_decide_tx(
  p_request_id       uuid,
  p_actor_profile_id uuid,
  p_decision         text,
  p_expected_status  text,
  p_note             text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_req  public.ngrp_preceptor_feedback_requests%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  -- The Owner or an Admin decides: the same rule as the notification fan-out.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
     WHERE id = p_actor_profile_id
       AND (is_owner IS TRUE OR role IN ('owner', 'admin'))
       AND COALESCE(is_active, true) = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'owner_required');
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'declined', 'revoked') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_decision');
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'note_too_long');
  END IF;

  SELECT * INTO v_req FROM public.ngrp_preceptor_feedback_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'request_not_found');
  END IF;
  IF v_req.status IS DISTINCT FROM p_expected_status THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'state_conflict', 'status', v_req.status);
  END IF;
  IF NOT ((v_req.status = 'pending'  AND p_decision IN ('approved', 'declined'))
       OR (v_req.status = 'approved' AND p_decision = 'revoked')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_transition', 'status', v_req.status);
  END IF;

  UPDATE public.ngrp_preceptor_feedback_requests
     SET status = p_decision,
         decided_by_profile_id = p_actor_profile_id,
         decided_at = now(),
         decision_note = v_note,
         updated_at = now()
   WHERE id = p_request_id;

  INSERT INTO public.ngrp_preceptor_feedback_access_events
    (request_id, candidate_id, student_id, actor_profile_id, event_type)
  VALUES (v_req.id, v_req.candidate_id, v_req.student_id, p_actor_profile_id, p_decision);

  RETURN jsonb_build_object('ok', true, 'request_id', v_req.id, 'status', p_decision);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ngrp_pf_decide_tx(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ngrp_pf_decide_tx(uuid, uuid, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── ROLLBACK: re-apply the ngrp_pf_decide_tx block from 20260912000000
--    (Owner-only check: is_owner IS TRUE AND COALESCE(is_active, true) = true).
