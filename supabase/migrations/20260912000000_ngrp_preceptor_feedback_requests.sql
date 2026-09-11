-- ============================================================================
-- RESIDENCY PORTAL: preceptor feedback requests
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester). Claude Code has applied NOTHING. ***
--
-- Owner decision, 2026-09-10: preceptor feedback is not released to Talent
-- Acquisition wholesale, because not every preceptor submits one. The
-- Residency Portal shows only that feedback exists. A Talent Acquisition user
-- asks to view it; the Owner approves in the app; it then becomes visible to
-- THAT person for THAT one applicant, and every opening is recorded.
--
-- Additive and transactional. It rewrites no data and changes no existing
-- table, policy, view, or function.
--
-- WHAT THIS FILE DOES
--   1. Creates ngrp_preceptor_feedback_requests: one row per request, with
--      the Owner's decision on it. At most one OPEN (pending or approved)
--      request per requester and applicant.
--   2. Creates ngrp_preceptor_feedback_access_events: the append-only record
--      of who asked, who decided, and who viewed, and when. It has no foreign
--      keys on purpose, so the record outlives the request it describes.
--   3. Indexes evaluation_responses (form_type, student_id) for the roster's
--      "feedback on file" lookup.
--   4. Adds two SECURITY DEFINER functions, executable by service_role only:
--        ngrp_pf_request_tx  request + 'requested' event + staff notification
--        ngrp_pf_decide_tx   Owner-only approve / decline / withdraw, with an
--                            expected-state check under FOR UPDATE
--
-- WHAT THIS FILE DOES NOT DO
--   - It grants nothing to anon or authenticated. Both tables are server-only:
--     api/ngrp-preceptor-feedback.js reads and writes them as service_role
--     after its own checks (active Talent Acquisition grant, submitted
--     Transition Form, Owner capability for decisions).
--   - It does not touch evaluation_responses rows or their RLS. The endpoint
--     returns a shaped view that leaves out the preceptor's confidential
--     comments to the ASPIRE team, the attestation, and every identifier.
--
-- SAFE IN EITHER DEPLOY ORDER
--   The app treats a missing table or function as "not provisioned" and hides
--   the feature, so the code can ship before or after this file is applied.
--
-- ── PREFLIGHT (run and review BEFORE the transaction) ────────────────────────
--   See db/audit/ngrp_preceptor_feedback_requests_checks.sql, PRE 1 to PRE 4.

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.ngrp_candidates') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: public.ngrp_candidates is missing (apply the NGRP foundation first)';
  END IF;
  IF to_regclass('public.evaluation_responses') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: public.evaluation_responses is missing';
  END IF;
  IF to_regprocedure('public._emit_staff_notifications(text, text, uuid, text, text, uuid, uuid, text, text, text, text, text, boolean, text)') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: public._emit_staff_notifications is missing';
  END IF;
END
$pre$;

-- ############################################################################
-- 1. Requests
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.ngrp_preceptor_feedback_requests (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          uuid        NOT NULL REFERENCES public.ngrp_candidates(id) ON DELETE CASCADE,
  student_id            uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  -- A request belongs to the person who made it; removing their profile
  -- removes their access with it. The access events keep the history.
  requester_profile_id  uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  request_note          text        CHECK (request_note IS NULL OR (btrim(request_note) <> '' AND char_length(request_note) <= 500)),
  status                text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'approved', 'declined', 'revoked')),
  -- No foreign key: the decider of record is kept even if that profile is
  -- later removed.
  decided_by_profile_id uuid,
  decided_at            timestamptz,
  decision_note         text        CHECK (decision_note IS NULL OR (btrim(decision_note) <> '' AND char_length(decision_note) <= 500)),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ngrp_pf_request_decision CHECK (
    (status = 'pending'  AND decided_by_profile_id IS NULL     AND decided_at IS NULL) OR
    (status <> 'pending' AND decided_by_profile_id IS NOT NULL AND decided_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.ngrp_preceptor_feedback_requests IS
  'RESIDENCY-PORTAL-2b: a Talent Acquisition request to view one applicant''s preceptor feedback, and the Owner''s decision on it. Server-only.';

-- One OPEN request per requester and applicant. A declined or withdrawn
-- request can be followed by a new one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ngrp_pf_requests_open
  ON public.ngrp_preceptor_feedback_requests (requester_profile_id, candidate_id)
  WHERE status IN ('pending', 'approved');

CREATE INDEX IF NOT EXISTS idx_ngrp_pf_requests_candidate
  ON public.ngrp_preceptor_feedback_requests (candidate_id, requested_at DESC);

-- ############################################################################
-- 2. Access events (append-only)
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.ngrp_preceptor_feedback_access_events (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid        NOT NULL,
  candidate_id     uuid        NOT NULL,
  student_id       uuid        NOT NULL,
  actor_profile_id uuid        NOT NULL,
  event_type       text        NOT NULL
                               CHECK (event_type IN ('requested', 'approved', 'declined', 'revoked', 'viewed')),
  -- For 'viewed': how many submissions were shown.
  response_count   integer     CHECK (response_count IS NULL OR response_count >= 0),
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ngrp_preceptor_feedback_access_events IS
  'RESIDENCY-PORTAL-2b: who requested, decided, and viewed preceptor feedback, and when. Append-only (no UPDATE or DELETE grant). No foreign keys, so the record outlives the request.';

CREATE INDEX IF NOT EXISTS idx_ngrp_pf_events_request
  ON public.ngrp_preceptor_feedback_access_events (request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ngrp_pf_events_candidate
  ON public.ngrp_preceptor_feedback_access_events (candidate_id, created_at DESC);

-- ############################################################################
-- 3. Server-only privileges
-- ############################################################################
ALTER TABLE public.ngrp_preceptor_feedback_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_preceptor_feedback_access_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.ngrp_preceptor_feedback_requests FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ngrp_preceptor_feedback_requests TO service_role;

REVOKE ALL PRIVILEGES ON TABLE public.ngrp_preceptor_feedback_access_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.ngrp_preceptor_feedback_access_events TO service_role;

-- ############################################################################
-- 4. The roster's "feedback on file" lookup
-- ############################################################################
CREATE INDEX IF NOT EXISTS idx_evaluation_responses_form_type_student
  ON public.evaluation_responses (form_type, student_id);

-- ############################################################################
-- 5. ngrp_pf_request_tx: record a request, its event, and the Owner/Admin
--    notification in one transaction. Idempotent: an existing open request
--    for the same requester and applicant is returned as it is.
--    The API checks the caller (active Talent Acquisition grant), the
--    applicant (submitted Transition Form), and that feedback exists before
--    calling this.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.ngrp_pf_request_tx(
  p_candidate_id         uuid,
  p_requester_profile_id uuid,
  p_note                 text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_student uuid;
  v_note    text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_id      uuid;
  v_status  text;
BEGIN
  SELECT student_id INTO v_student FROM public.ngrp_candidates WHERE id = p_candidate_id;
  IF v_student IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'candidate_not_found');
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'note_too_long');
  END IF;

  SELECT id, status INTO v_id, v_status
    FROM public.ngrp_preceptor_feedback_requests
   WHERE requester_profile_id = p_requester_profile_id
     AND candidate_id = p_candidate_id
     AND status IN ('pending', 'approved')
   FOR UPDATE;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'created', false, 'request_id', v_id, 'status', v_status);
  END IF;

  BEGIN
    INSERT INTO public.ngrp_preceptor_feedback_requests (candidate_id, student_id, requester_profile_id, request_note)
    VALUES (p_candidate_id, v_student, p_requester_profile_id, v_note)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent request won the race; return it.
    SELECT id, status INTO v_id, v_status
      FROM public.ngrp_preceptor_feedback_requests
     WHERE requester_profile_id = p_requester_profile_id
       AND candidate_id = p_candidate_id
       AND status IN ('pending', 'approved');
    RETURN jsonb_build_object('ok', true, 'created', false, 'request_id', v_id, 'status', v_status);
  END;

  INSERT INTO public.ngrp_preceptor_feedback_access_events
    (request_id, candidate_id, student_id, actor_profile_id, event_type)
  VALUES (v_id, p_candidate_id, v_student, p_requester_profile_id, 'requested');

  PERFORM public._emit_staff_notifications(
    'ngrp_pf_request:' || v_id::text,
    'ngrp_preceptor_feedback_requested',
    p_requester_profile_id,
    'talent_acquisition',
    'Preceptor feedback requested',
    v_student, NULL, NULL, NULL, NULL, NULL,
    v_note,
    false,
    '/ngrp/profiles?candidate=' || p_candidate_id::text
  );

  RETURN jsonb_build_object('ok', true, 'created', true, 'request_id', v_id, 'status', 'pending');
END;
$fn$;
REVOKE ALL ON FUNCTION public.ngrp_pf_request_tx(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ngrp_pf_request_tx(uuid, uuid, text) TO service_role;

-- ############################################################################
-- 6. ngrp_pf_decide_tx: the Owner approves, declines, or withdraws. The Owner
--    rule is checked HERE as well as in the API, so it holds for any caller.
--    pending -> approved | declined;  approved -> revoked.
-- ############################################################################
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
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
     WHERE id = p_actor_profile_id AND is_owner IS TRUE AND COALESCE(is_active, true) = true
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

-- ── ROLLBACK (only if nothing depends on the records yet) ────────────────────
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.ngrp_pf_decide_tx(uuid, uuid, text, text, text);
--   DROP FUNCTION IF EXISTS public.ngrp_pf_request_tx(uuid, uuid, text);
--   DROP INDEX IF EXISTS public.idx_evaluation_responses_form_type_student;
--   DROP TABLE IF EXISTS public.ngrp_preceptor_feedback_access_events;
--   DROP TABLE IF EXISTS public.ngrp_preceptor_feedback_requests;
--   NOTIFY pgrst, 'reload schema';
-- COMMIT;
