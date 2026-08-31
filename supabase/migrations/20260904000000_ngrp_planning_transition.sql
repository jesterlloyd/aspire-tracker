-- ============================================================================
-- NGRP release 2: Planning units + Transition Form lifecycle + audit
-- (integrity correction pass: explicit service_role minimality, transactional
--  RPC functions, delivery-safe token state machine, durable send ledger)
-- ============================================================================
-- APPLY MANUALLY (Owner/Jester) in the Supabase SQL Editor, as ONE COMPLETE
-- BLOCK (single transaction). Run the PREFLIGHT section first, one statement
-- at a time; every check must come back as stated before applying.
--
-- Product source of truth: docs/product/NGRP_WORKSPACE_PRODUCT_PLAN.md
-- (sections 5-7, 10, 14, 15). Builds ON TOP of the applied foundation
-- (20260903000000) and its delete-privilege repair (20260903010000); neither
-- is edited or re-run, and none of the four existing NGRP tables is altered.
--
-- WHAT THIS ADDS (all additive; nothing existing is modified):
--   ngrp_cycle_units           - participating units per residency cohort:
--                                the ONLY source of Transition Form ranked
--                                preferences. Unit identity is unit_name
--                                text, matching how the app names units
--                                everywhere; no second unit directory.
--   ngrp_transition_assignments- ONE form assignment per candidate attempt
--                                (UNIQUE live candidate_id). Created as
--                                'pending' when a send begins; it becomes
--                                'sent' ONLY when the provider accepted the
--                                email (ngrp_activate_token_tx).
--   ngrp_transition_tokens     - keyed HASHES of the secure links, with a
--                                delivery-safe state machine:
--                                pending -> active | failed, active ->
--                                revoked. A resend PREPARES a pending
--                                replacement while the old link stays
--                                active; only provider acceptance activates
--                                the new token and revokes the old one, in
--                                one transaction. The public endpoint
--                                resolves ACTIVE tokens only.
--   ngrp_transition_drafts     - the single mutable autosave draft per
--                                assignment (ephemeral by design).
--   ngrp_transition_revisions  - IMMUTABLE submitted revisions, numbered per
--                                assignment. Nothing updates or deletes a
--                                revision (no such privilege exists).
--   ngrp_candidate_requirements- the explainable eligibility engine's
--                                per-rule rows - derived, recalculated data.
--   ngrp_transition_deliveries - DURABLE per-recipient send-attempt ledger,
--                                UNIQUE (batch_id, candidate_id): the
--                                idempotency source for retried batches
--                                (notification_log is a display ledger, not
--                                the idempotency authority). No DELETE.
--   ngrp_audit_events          - allowlisted NGRP workflow audit trail with
--                                safe minimal metadata. Deliberately NO
--                                foreign keys: audit outlives its subject.
--
--   Plus TEN server-only functions (EXECUTE for service_role ONLY) that give
--   every multi-table write a real database transaction with row locks:
--     ngrp_pacific_deadline            - date -> 11:59:59.999 PM
--                                        America/Los_Angeles (DST-aware);
--                                        the ONE effective-close rule.
--     ngrp_cycle_create_tx             - cycle + source mappings + audit
--     ngrp_cycle_set_active_tx         - atomic active switch + audit
--     ngrp_sources_set_tx              - atomic mapping replace + audit
--     ngrp_units_set_tx                - atomic unit replace + audit
--     ngrp_set_candidate_eligibility_tx- candidate result + requirement rows
--                                        replaced together (never touches
--                                        eligibility_effective)
--     ngrp_submit_revision_tx          - the COMPLETE submission (locked
--                                        assignment, serial revision number,
--                                        deadline enforced in-transaction,
--                                        lifecycle + interest + eligibility
--                                        + requirements + draft cleanup +
--                                        audit, all-or-nothing)
--     ngrp_save_draft_tx               - draft upsert + lifecycle, atomic,
--                                        deadline enforced in-transaction
--     ngrp_activate_token_tx           - post-acceptance activation: new
--                                        token active + old revoked +
--                                        pending assignment -> sent + audit
--     ngrp_fail_token_tx               - provider-failure cleanup: pending
--                                        token failed; a never-delivered
--                                        pending assignment revoked
--
-- SECURITY MODEL (tightened): RLS enabled on all eight tables with NO
-- policies; EVERY role's privileges revoked FIRST - including service_role,
-- because the NGRP outcomes incident proved that omitting a GRANT does not
-- guarantee privilege absence in this environment - then explicit MINIMAL
-- grants per table. No DELETE on assignments, tokens, or deliveries;
-- revisions and audit events keep neither UPDATE nor DELETE. Function
-- EXECUTE is revoked from PUBLIC/anon/authenticated and granted to
-- service_role only.
--
-- WHAT THIS DOES NOT DO:
--   - No existing table, row, policy, trigger, or function is modified.
--   - No data is backfilled or seeded; legacy ngrp_outcomes and
--     students.ngrp_* stay untouched and untrusted.
--   - No cron, no reminders, no HR access, no support/interview/retention
--     tables (later phases).
-- ============================================================================

-- ── PREFLIGHT (read-only; run BEFORE the transaction below) ─────────────────
-- P1. The foundation is applied (expect 4):
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema='public'
--      AND table_name IN ('ngrp_cycles','ngrp_cycle_source_cohorts',
--                         'ngrp_candidates','ngrp_residency_outcomes');
-- P2. The shared touch function exists (expect 1):
--   SELECT count(*) FROM pg_proc WHERE proname = 'ngrp_touch_updated_at';
-- P3. None of the eight new tables exists yet (expect 0):
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema='public'
--      AND table_name IN ('ngrp_cycle_units','ngrp_transition_assignments',
--                         'ngrp_transition_tokens','ngrp_transition_drafts',
--                         'ngrp_transition_revisions','ngrp_candidate_requirements',
--                         'ngrp_transition_deliveries','ngrp_audit_events');
-- P4. The outcomes delete-revoke still holds (expect f):
--   SELECT has_table_privilege('service_role','public.ngrp_residency_outcomes','DELETE');
-- P5. None of the ten new functions exists yet (expect 0):
--   SELECT count(*) FROM pg_proc
--    WHERE proname IN ('ngrp_pacific_deadline','ngrp_cycle_create_tx',
--                      'ngrp_cycle_set_active_tx','ngrp_sources_set_tx',
--                      'ngrp_units_set_tx','ngrp_set_candidate_eligibility_tx',
--                      'ngrp_submit_revision_tx','ngrp_save_draft_tx',
--                      'ngrp_activate_token_tx','ngrp_fail_token_tx');

BEGIN;

-- ── Participating units per residency cohort ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ngrp_cycle_units (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id      uuid NOT NULL REFERENCES public.ngrp_cycles(id) ON DELETE CASCADE,
  unit_name     text NOT NULL CHECK (btrim(unit_name) <> ''),
  is_active     boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  capacity      integer CHECK (capacity IS NULL OR capacity > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ngrp_cycle_units_unique UNIQUE (cycle_id, unit_name)
);
CREATE INDEX IF NOT EXISTS ngrp_cycle_units_cycle_idx ON public.ngrp_cycle_units (cycle_id);

-- ── Transition Form assignments (one per candidate attempt) ─────────────────
-- RESTRICT on candidate_id: once a form has been sent, the attempt (and
-- through the candidate chain, the student row) cannot be silently deleted
-- out from under the form history.
-- SEND-TRUTH: an assignment is born 'pending' (sent_at NULL) and becomes
-- 'sent' only inside ngrp_activate_token_tx, i.e. only after the provider
-- ACCEPTED the email. A pending assignment never reads as Sent anywhere.
CREATE TABLE IF NOT EXISTS public.ngrp_transition_assignments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          uuid NOT NULL REFERENCES public.ngrp_candidates(id) ON DELETE RESTRICT,
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','sent','opened','in_progress','submitted','revised')),
  sent_at               timestamptz,
  sent_by_profile_id    uuid REFERENCES public.user_profiles(id),
  opened_at             timestamptz,
  last_saved_at         timestamptz,
  submitted_at          timestamptz,
  revised_at            timestamptz,
  revision_count        integer NOT NULL DEFAULT 0 CHECK (revision_count >= 0),
  -- Optional per-assignment close; the effective close falls back to
  -- ngrp_pacific_deadline(cycle.application_deadline), enforced INSIDE the
  -- transactional submit/save functions.
  deadline_at           timestamptz,
  -- Revocation is the honest rollback for a FAILED first delivery: no
  -- DELETE privilege exists, so a send whose email never went out revokes
  -- the pending assignment instead - the roster then correctly shows Not
  -- Sent again, and a fresh send may create a new live assignment.
  revoked_at            timestamptz,
  revoked_by_profile_id uuid REFERENCES public.user_profiles(id),
  revoked_reason        text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Lifecycle/timestamp coherence: a status can never claim progress its
  -- timestamps do not carry, and only 'pending' may lack sent_at.
  CONSTRAINT ngrp_assignment_state_times CHECK (
    (status = 'pending'     AND sent_at IS NULL)
    OR (status = 'sent'        AND sent_at IS NOT NULL)
    OR (status = 'opened'      AND sent_at IS NOT NULL AND opened_at IS NOT NULL)
    OR (status = 'in_progress' AND sent_at IS NOT NULL AND opened_at IS NOT NULL)
    OR (status = 'submitted'   AND sent_at IS NOT NULL AND submitted_at IS NOT NULL AND revision_count >= 1)
    OR (status = 'revised'     AND sent_at IS NOT NULL AND submitted_at IS NOT NULL AND revised_at IS NOT NULL AND revision_count >= 2)
  )
);
-- One LIVE assignment per candidate attempt (pending included): idempotent
-- sends find it, and a revoked (failed) one no longer blocks a fresh send.
CREATE UNIQUE INDEX IF NOT EXISTS ngrp_assignments_one_live
  ON public.ngrp_transition_assignments (candidate_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS ngrp_assignments_candidate_idx
  ON public.ngrp_transition_assignments (candidate_id);

-- ── Secure link tokens (hashes only; raw tokens are never stored) ───────────
-- State machine: 'pending' (prepared, NOT resolvable by the public endpoint)
-- -> 'active' (provider accepted; the ONE live link) or 'failed' (provider
-- rejected; never usable); 'active' -> 'revoked' (rotation or staff revoke).
-- A resend keeps the OLD token active until the replacement's email is
-- accepted; ngrp_activate_token_tx swaps them in one transaction.
CREATE TABLE IF NOT EXISTS public.ngrp_transition_tokens (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id         uuid NOT NULL REFERENCES public.ngrp_transition_assignments(id) ON DELETE RESTRICT,
  token_hash            text NOT NULL UNIQUE CHECK (btrim(token_hash) <> ''),
  -- Nonsecret support handle: the first eight characters of token_hash (a
  -- derivative of the HMAC digest, NOT the raw token - the evaluation-token
  -- rule), so support can identify WHICH link without ever seeing one.
  token_hash_prefix     text NOT NULL CHECK (length(token_hash_prefix) BETWEEN 4 AND 16),
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','active','revoked','failed')),
  failed_reason         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by_profile_id uuid REFERENCES public.user_profiles(id),
  first_used_at         timestamptz,
  revoked_at            timestamptz,
  revoked_by_profile_id uuid REFERENCES public.user_profiles(id),
  CONSTRAINT ngrp_token_status_coherence
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT ngrp_token_revocation_actor
    CHECK (revoked_at IS NULL OR revoked_by_profile_id IS NOT NULL)
);
-- At most ONE ACTIVE token per assignment - the database makes an overlap of
-- live links impossible, while an old active link and a new pending
-- replacement may briefly coexist during a delivery-safe resend.
CREATE UNIQUE INDEX IF NOT EXISTS ngrp_tokens_one_active
  ON public.ngrp_transition_tokens (assignment_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ngrp_tokens_assignment_idx ON public.ngrp_transition_tokens (assignment_id);

-- ── Autosave draft (single mutable row per assignment; ephemeral) ───────────
CREATE TABLE IF NOT EXISTS public.ngrp_transition_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL UNIQUE REFERENCES public.ngrp_transition_assignments(id) ON DELETE CASCADE,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  saved_at      timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Immutable submitted revisions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ngrp_transition_revisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   uuid NOT NULL REFERENCES public.ngrp_transition_assignments(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  payload         jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ngrp_revisions_numbered UNIQUE (assignment_id, revision_number)
);
CREATE INDEX IF NOT EXISTS ngrp_revisions_assignment_idx ON public.ngrp_transition_revisions (assignment_id);

-- ── Explainable per-rule eligibility results (derived; recalculable) ────────
CREATE TABLE IF NOT EXISTS public.ngrp_candidate_requirements (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id              uuid NOT NULL REFERENCES public.ngrp_candidates(id) ON DELETE CASCADE,
  code                      text NOT NULL
                              CHECK (code IN ('license','experience','gpa','completion_window','bls','acls','accreditation')),
  status                    text NOT NULL CHECK (status IN ('met','not_met','conditional','unknown')),
  label                     text NOT NULL CHECK (btrim(label) <> ''),
  detail                    text,
  deadline                  date,
  computed_from_revision_id uuid REFERENCES public.ngrp_transition_revisions(id),
  computed_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ngrp_candidate_requirements_unique UNIQUE (candidate_id, code)
);
CREATE INDEX IF NOT EXISTS ngrp_candidate_requirements_candidate_idx
  ON public.ngrp_candidate_requirements (candidate_id);

-- ── Durable per-recipient delivery attempts (the idempotency authority) ─────
-- One row per (batch, candidate). A retried batch request consults THIS
-- table - fail-closed - before mailing anyone: 'accepted' rows are skipped,
-- and the provider idempotency key (batch+candidate) backstops the window
-- between provider acceptance and the row update. No DELETE privilege: the
-- attempt history is durable.
CREATE TABLE IF NOT EXISTS public.ngrp_transition_deliveries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          uuid NOT NULL,
  cycle_id          uuid NOT NULL REFERENCES public.ngrp_cycles(id) ON DELETE RESTRICT,
  candidate_id      uuid NOT NULL REFERENCES public.ngrp_candidates(id) ON DELETE RESTRICT,
  student_id        uuid,
  status            text NOT NULL DEFAULT 'attempting'
                      CHECK (status IN ('attempting','accepted','failed')),
  token_hash_prefix text,
  provider_email_id text,
  failed_reason     text,
  attempted_at      timestamptz NOT NULL DEFAULT now(),
  accepted_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ngrp_deliveries_batch_candidate UNIQUE (batch_id, candidate_id),
  CONSTRAINT ngrp_deliveries_accepted_time CHECK (status <> 'accepted' OR accepted_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ngrp_deliveries_batch_idx ON public.ngrp_transition_deliveries (batch_id);

-- ── Allowlisted audit trail (no FKs by design: audit outlives its subject) ──
CREATE TABLE IF NOT EXISTS public.ngrp_audit_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type       text NOT NULL CHECK (event_type IN (
                     'cycle_created','cycle_updated','cycle_activated',
                     'source_cohorts_changed','units_changed',
                     'form_sent','form_opened','form_submitted','form_revised',
                     'token_revoked','token_resent',
                     'eligibility_calculated','eligibility_overridden',
                     'application_confirmed','application_withdrawn')),
  cycle_id         uuid,
  candidate_id     uuid,
  assignment_id    uuid,
  student_id       uuid,
  actor_profile_id uuid,
  actor_kind       text NOT NULL DEFAULT 'staff' CHECK (actor_kind IN ('staff','alumnus','system')),
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ngrp_audit_events_cycle_idx     ON public.ngrp_audit_events (cycle_id);
CREATE INDEX IF NOT EXISTS ngrp_audit_events_candidate_idx ON public.ngrp_audit_events (candidate_id);

-- ── updated_at maintenance (reuses the applied foundation function) ─────────
DROP TRIGGER IF EXISTS ngrp_cycle_units_touch ON public.ngrp_cycle_units;
CREATE TRIGGER ngrp_cycle_units_touch
  BEFORE UPDATE ON public.ngrp_cycle_units
  FOR EACH ROW EXECUTE FUNCTION public.ngrp_touch_updated_at();

DROP TRIGGER IF EXISTS ngrp_transition_assignments_touch ON public.ngrp_transition_assignments;
CREATE TRIGGER ngrp_transition_assignments_touch
  BEFORE UPDATE ON public.ngrp_transition_assignments
  FOR EACH ROW EXECUTE FUNCTION public.ngrp_touch_updated_at();

DROP TRIGGER IF EXISTS ngrp_transition_drafts_touch ON public.ngrp_transition_drafts;
CREATE TRIGGER ngrp_transition_drafts_touch
  BEFORE UPDATE ON public.ngrp_transition_drafts
  FOR EACH ROW EXECUTE FUNCTION public.ngrp_touch_updated_at();

DROP TRIGGER IF EXISTS ngrp_transition_deliveries_touch ON public.ngrp_transition_deliveries;
CREATE TRIGGER ngrp_transition_deliveries_touch
  BEFORE UPDATE ON public.ngrp_transition_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.ngrp_touch_updated_at();

-- ── Transactional server-only functions ─────────────────────────────────────
-- SECURITY INVOKER (the default): they run with the calling role's table
-- privileges, so the minimal service_role grants below remain the outer
-- bound of what any function can do. Every function body is one database
-- transaction; a failure at any statement rolls the whole call back.

-- The ONE effective-close rule: a configured closing date means 11:59:59.999
-- PM in America/Los_Angeles on that date, DST-aware (PST dates convert to
-- 07:59:59.999Z the next day; PDT dates to 06:59:59.999Z).
CREATE OR REPLACE FUNCTION public.ngrp_pacific_deadline(p_date date)
RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT (p_date + time '23:59:59.999') AT TIME ZONE 'America/Los_Angeles'
$$;

-- Cycle + source mappings + audit, atomically. Source cohort ids are
-- validated BEFORE the cycle row is created, so a bad mapping can never
-- leave an orphan cycle behind.
CREATE OR REPLACE FUNCTION public.ngrp_cycle_create_tx(
  p_cycle jsonb, p_source_cohort_ids uuid[], p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_cycle public.ngrp_cycles;
  v_source_count integer := COALESCE(array_length(p_source_cohort_ids, 1), 0);
BEGIN
  IF v_source_count > 0 THEN
    IF (SELECT count(*) FROM public.cohorts WHERE id = ANY (p_source_cohort_ids)) <> v_source_count THEN
      RAISE EXCEPTION 'NGRP_UNKNOWN_COHORT';
    END IF;
  END IF;

  INSERT INTO public.ngrp_cycles
    (name, status, application_open_date, application_deadline,
     interview_window_start, interview_window_end, licensure_deadline,
     residency_start_date, notes, qualification_rules, application_checklist,
     retention_benchmarks)
  VALUES
    (p_cycle->>'name',
     COALESCE(p_cycle->>'status', 'Planning'),
     (p_cycle->>'application_open_date')::date,
     (p_cycle->>'application_deadline')::date,
     (p_cycle->>'interview_window_start')::date,
     (p_cycle->>'interview_window_end')::date,
     (p_cycle->>'licensure_deadline')::date,
     (p_cycle->>'residency_start_date')::date,
     NULLIF(p_cycle->>'notes', ''),
     COALESCE(p_cycle->'qualification_rules', '{}'::jsonb),
     COALESCE(p_cycle->'application_checklist', '[]'::jsonb),
     COALESCE(p_cycle->'retention_benchmarks', '{}'::jsonb))
  RETURNING * INTO v_cycle;

  IF v_source_count > 0 THEN
    INSERT INTO public.ngrp_cycle_source_cohorts (cycle_id, cohort_id, created_by_profile_id)
    SELECT v_cycle.id, cid, p_actor FROM unnest(p_source_cohort_ids) AS cid;
  END IF;

  INSERT INTO public.ngrp_audit_events (event_type, cycle_id, actor_profile_id, metadata)
  VALUES ('cycle_created', v_cycle.id, p_actor,
          jsonb_build_object('cycle_name', v_cycle.name, 'status', v_cycle.status,
                             'source_cohort_count', v_source_count));
  IF v_source_count > 0 THEN
    INSERT INTO public.ngrp_audit_events (event_type, cycle_id, actor_profile_id, metadata)
    VALUES ('source_cohorts_changed', v_cycle.id, p_actor,
            jsonb_build_object('source_cohort_count', v_source_count));
  END IF;

  RETURN to_jsonb(v_cycle);
END $$;

-- Atomic active switch: the target is locked, every other cycle is cleared,
-- the target is set, and the audit event lands - all or nothing, so there is
-- never a moment with zero (or two) active cycles committed.
CREATE OR REPLACE FUNCTION public.ngrp_cycle_set_active_tx(p_cycle_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_cycle public.ngrp_cycles;
BEGIN
  SELECT * INTO v_cycle FROM public.ngrp_cycles WHERE id = p_cycle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NGRP_NOT_FOUND'; END IF;

  UPDATE public.ngrp_cycles SET is_active = false WHERE id <> p_cycle_id AND is_active;
  UPDATE public.ngrp_cycles SET is_active = true WHERE id = p_cycle_id
  RETURNING * INTO v_cycle;

  INSERT INTO public.ngrp_audit_events (event_type, cycle_id, actor_profile_id, metadata)
  VALUES ('cycle_activated', p_cycle_id, p_actor, jsonb_build_object('cycle_name', v_cycle.name));

  RETURN to_jsonb(v_cycle);
END $$;

-- Atomic source-mapping replacement: cycle locked, ids validated, delete +
-- insert + audit in one transaction - a failed insert restores the previous
-- mapping instead of leaving the cycle unmapped.
CREATE OR REPLACE FUNCTION public.ngrp_sources_set_tx(
  p_cycle_id uuid, p_cohort_ids uuid[], p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_count integer := COALESCE(array_length(p_cohort_ids, 1), 0);
BEGIN
  PERFORM 1 FROM public.ngrp_cycles WHERE id = p_cycle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NGRP_NOT_FOUND'; END IF;
  IF v_count > 0 THEN
    IF (SELECT count(*) FROM public.cohorts WHERE id = ANY (p_cohort_ids)) <> v_count THEN
      RAISE EXCEPTION 'NGRP_UNKNOWN_COHORT';
    END IF;
  END IF;

  DELETE FROM public.ngrp_cycle_source_cohorts WHERE cycle_id = p_cycle_id;
  IF v_count > 0 THEN
    INSERT INTO public.ngrp_cycle_source_cohorts (cycle_id, cohort_id, created_by_profile_id)
    SELECT p_cycle_id, cid, p_actor FROM unnest(p_cohort_ids) AS cid;
  END IF;

  INSERT INTO public.ngrp_audit_events (event_type, cycle_id, actor_profile_id, metadata)
  VALUES ('source_cohorts_changed', p_cycle_id, p_actor,
          jsonb_build_object('source_cohort_count', v_count));

  RETURN jsonb_build_object('count', v_count);
END $$;

-- Atomic participating-unit replacement, same shape as sources_set.
CREATE OR REPLACE FUNCTION public.ngrp_units_set_tx(
  p_cycle_id uuid, p_units jsonb, p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_count integer;
BEGIN
  PERFORM 1 FROM public.ngrp_cycles WHERE id = p_cycle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NGRP_NOT_FOUND'; END IF;

  DELETE FROM public.ngrp_cycle_units WHERE cycle_id = p_cycle_id;
  INSERT INTO public.ngrp_cycle_units (cycle_id, unit_name, is_active, display_order, capacity)
  SELECT p_cycle_id,
         u->>'unit_name',
         COALESCE((u->>'is_active')::boolean, true),
         (ord - 1)::integer,
         NULLIF(u->>'capacity', '')::integer
    FROM jsonb_array_elements(COALESCE(p_units, '[]'::jsonb)) WITH ORDINALITY AS t(u, ord);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.ngrp_audit_events (event_type, cycle_id, actor_profile_id, metadata)
  VALUES ('units_changed', p_cycle_id, p_actor, jsonb_build_object('unit_count', v_count));

  RETURN jsonb_build_object('count', v_count);
END $$;

-- Candidate eligibility write: the calculated result/reasons and the
-- per-code requirement rows always change TOGETHER. Deliberately never
-- touches eligibility_effective (the staff override lane).
CREATE OR REPLACE FUNCTION public.ngrp_set_candidate_eligibility_tx(
  p_candidate_id uuid, p_result text, p_reasons jsonb, p_requirements jsonb, p_revision_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_now timestamptz := now();
BEGIN
  UPDATE public.ngrp_candidates
     SET eligibility_calculated = p_result,
         eligibility_reasons = COALESCE(p_reasons, '[]'::jsonb)
   WHERE id = p_candidate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NGRP_NOT_FOUND'; END IF;

  DELETE FROM public.ngrp_candidate_requirements WHERE candidate_id = p_candidate_id;
  INSERT INTO public.ngrp_candidate_requirements
    (candidate_id, code, status, label, detail, deadline, computed_from_revision_id, computed_at)
  SELECT p_candidate_id, r->>'code', r->>'status', r->>'label',
         NULLIF(r->>'detail', ''), NULLIF(r->>'deadline', '')::date, p_revision_id, v_now
    FROM jsonb_array_elements(COALESCE(p_requirements, '[]'::jsonb)) AS r;

  RETURN jsonb_build_object('ok', true);
END $$;

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
    CASE WHEN cyc.application_deadline IS NOT NULL
         THEN public.ngrp_pacific_deadline(cyc.application_deadline) END);
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
    CASE WHEN cyc.application_deadline IS NOT NULL
         THEN public.ngrp_pacific_deadline(cyc.application_deadline) END);
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

-- Post-acceptance activation: ONLY after the provider accepted the email
-- does the prepared token become the live link. In one transaction: every
-- other pending/active token for the assignment is revoked, the new token
-- becomes active, a first send's pending assignment becomes 'sent', and the
-- form_sent / token_resent audit event lands.
CREATE OR REPLACE FUNCTION public.ngrp_activate_token_tx(p_token_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  tok public.ngrp_transition_tokens;
  a public.ngrp_transition_assignments;
  cand public.ngrp_candidates;
  v_now timestamptz := now();
  v_first boolean := false;
BEGIN
  SELECT * INTO tok FROM public.ngrp_transition_tokens WHERE id = p_token_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NGRP_NOT_FOUND'; END IF;
  SELECT * INTO a FROM public.ngrp_transition_assignments WHERE id = tok.assignment_id FOR UPDATE;
  IF NOT FOUND OR a.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'NGRP_GONE'; END IF;
  IF tok.status <> 'pending' THEN RAISE EXCEPTION 'NGRP_TOKEN_STATE'; END IF;

  UPDATE public.ngrp_transition_tokens
     SET status = 'revoked', revoked_at = v_now, revoked_by_profile_id = p_actor
   WHERE assignment_id = a.id AND id <> p_token_id AND status IN ('pending', 'active');

  UPDATE public.ngrp_transition_tokens SET status = 'active' WHERE id = p_token_id;

  IF a.status = 'pending' THEN
    v_first := true;
    UPDATE public.ngrp_transition_assignments
       SET status = 'sent', sent_at = v_now
     WHERE id = a.id;
  END IF;

  SELECT * INTO cand FROM public.ngrp_candidates WHERE id = a.candidate_id;
  INSERT INTO public.ngrp_audit_events
    (event_type, cycle_id, candidate_id, assignment_id, student_id, actor_profile_id, metadata)
  VALUES
    (CASE WHEN v_first THEN 'form_sent' ELSE 'token_resent' END,
     cand.cycle_id, cand.id, a.id, cand.student_id, p_actor,
     jsonb_build_object('token_hash_prefix', tok.token_hash_prefix));

  RETURN jsonb_build_object('activated', true, 'first_send', v_first);
END $$;

-- Provider-failure cleanup: the prepared token becomes 'failed' (never
-- usable), and a first send whose email never went out revokes its pending
-- assignment - while any OLD active token from a resend stays untouched, so
-- a failed resend never strands the alumnus without a working link.
CREATE OR REPLACE FUNCTION public.ngrp_fail_token_tx(p_token_id uuid, p_actor uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  tok public.ngrp_transition_tokens;
  a public.ngrp_transition_assignments;
  v_now timestamptz := now();
  v_asg_revoked boolean := false;
BEGIN
  SELECT * INTO tok FROM public.ngrp_transition_tokens WHERE id = p_token_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NGRP_NOT_FOUND'; END IF;
  SELECT * INTO a FROM public.ngrp_transition_assignments WHERE id = tok.assignment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NGRP_GONE'; END IF;

  IF tok.status = 'pending' THEN
    UPDATE public.ngrp_transition_tokens
       SET status = 'failed', failed_reason = left(COALESCE(p_reason, 'failed'), 200)
     WHERE id = p_token_id;
  END IF;

  IF a.revoked_at IS NULL AND a.status = 'pending' AND a.revision_count = 0
     AND NOT EXISTS (SELECT 1 FROM public.ngrp_transition_tokens
                      WHERE assignment_id = a.id AND status = 'active') THEN
    UPDATE public.ngrp_transition_assignments
       SET revoked_at = v_now, revoked_by_profile_id = p_actor,
           revoked_reason = left(COALESCE(p_reason, 'delivery_failed'), 200)
     WHERE id = a.id;
    v_asg_revoked := true;
  END IF;

  RETURN jsonb_build_object('failed', true, 'assignment_revoked', v_asg_revoked);
END $$;

-- ── Server-only privileges: RLS on, NO policies, explicit minimal grants ────
ALTER TABLE public.ngrp_cycle_units            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_transition_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_transition_tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_transition_drafts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_transition_revisions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_candidate_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_transition_deliveries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_audit_events           ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ngrp_cycle_units            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ngrp_transition_assignments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ngrp_transition_tokens      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ngrp_transition_drafts      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ngrp_transition_revisions   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ngrp_candidate_requirements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ngrp_transition_deliveries  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ngrp_audit_events           FROM PUBLIC, anon, authenticated;

-- The NGRP outcomes incident proved a missing GRANT does not guarantee a
-- missing privilege in this environment: service_role is revoked EXPLICITLY
-- first, so the grants below are the complete and only privilege surface.
REVOKE ALL ON public.ngrp_cycle_units            FROM service_role;
REVOKE ALL ON public.ngrp_transition_assignments FROM service_role;
REVOKE ALL ON public.ngrp_transition_tokens      FROM service_role;
REVOKE ALL ON public.ngrp_transition_drafts      FROM service_role;
REVOKE ALL ON public.ngrp_transition_revisions   FROM service_role;
REVOKE ALL ON public.ngrp_candidate_requirements FROM service_role;
REVOKE ALL ON public.ngrp_transition_deliveries  FROM service_role;
REVOKE ALL ON public.ngrp_audit_events           FROM service_role;

-- Minimal, per-table, and durable-record-safe: no DELETE on assignments,
-- tokens, or the delivery ledger; revisions/audit rows can only ever be
-- SELECTed and INSERTed.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ngrp_cycle_units            TO service_role;
GRANT SELECT, INSERT, UPDATE         ON public.ngrp_transition_assignments TO service_role;
GRANT SELECT, INSERT, UPDATE         ON public.ngrp_transition_tokens      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ngrp_transition_drafts      TO service_role;
GRANT SELECT, INSERT                 ON public.ngrp_transition_revisions   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ngrp_candidate_requirements TO service_role;
GRANT SELECT, INSERT, UPDATE         ON public.ngrp_transition_deliveries  TO service_role;
GRANT SELECT, INSERT                 ON public.ngrp_audit_events           TO service_role;

-- Function execution: revoked from every client role (CREATE FUNCTION grants
-- PUBLIC EXECUTE by default), granted to service_role only.
REVOKE ALL ON FUNCTION public.ngrp_pacific_deadline(date)                                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ngrp_cycle_create_tx(jsonb, uuid[], uuid)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ngrp_cycle_set_active_tx(uuid, uuid)                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ngrp_sources_set_tx(uuid, uuid[], uuid)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ngrp_units_set_tx(uuid, jsonb, uuid)                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ngrp_set_candidate_eligibility_tx(uuid, text, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ngrp_submit_revision_tx(uuid, jsonb, text, text, jsonb, jsonb)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ngrp_save_draft_tx(uuid, jsonb)                                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ngrp_activate_token_tx(uuid, uuid)                               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ngrp_fail_token_tx(uuid, uuid, text)                             FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ngrp_pacific_deadline(date)                                      TO service_role;
GRANT EXECUTE ON FUNCTION public.ngrp_cycle_create_tx(jsonb, uuid[], uuid)                        TO service_role;
GRANT EXECUTE ON FUNCTION public.ngrp_cycle_set_active_tx(uuid, uuid)                             TO service_role;
GRANT EXECUTE ON FUNCTION public.ngrp_sources_set_tx(uuid, uuid[], uuid)                          TO service_role;
GRANT EXECUTE ON FUNCTION public.ngrp_units_set_tx(uuid, jsonb, uuid)                             TO service_role;
GRANT EXECUTE ON FUNCTION public.ngrp_set_candidate_eligibility_tx(uuid, text, jsonb, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ngrp_submit_revision_tx(uuid, jsonb, text, text, jsonb, jsonb)   TO service_role;
GRANT EXECUTE ON FUNCTION public.ngrp_save_draft_tx(uuid, jsonb)                                  TO service_role;
GRANT EXECUTE ON FUNCTION public.ngrp_activate_token_tx(uuid, uuid)                               TO service_role;
GRANT EXECUTE ON FUNCTION public.ngrp_fail_token_tx(uuid, uuid, text)                             TO service_role;

COMMENT ON TABLE public.ngrp_cycle_units IS
  'Participating units per residency cohort - the only source of Transition '
  'Form ranked preferences. unit_name text mirrors app-wide unit naming; no '
  'second unit directory. Server-only.';
COMMENT ON TABLE public.ngrp_transition_assignments IS
  'One Transition Form assignment per candidate attempt. Born pending; '
  'becomes sent ONLY when the provider accepted the email '
  '(ngrp_activate_token_tx). Lifecycle: pending -> sent -> opened -> '
  'in_progress -> submitted -> revised, with DB-enforced timestamp '
  'coherence. Server-only; no DELETE.';
COMMENT ON TABLE public.ngrp_transition_tokens IS
  'Keyed hashes of secure form links plus a nonsecret support prefix. Raw '
  'tokens are never stored. State machine pending -> active|failed, active '
  '-> revoked; at most one ACTIVE token per assignment, and the public '
  'endpoint resolves active tokens only. Server-only; no DELETE.';
COMMENT ON TABLE public.ngrp_transition_drafts IS
  'The single mutable autosave draft per assignment. Ephemeral by design.';
COMMENT ON TABLE public.ngrp_transition_revisions IS
  'Immutable submitted Transition Form revisions, numbered per assignment. '
  'The highest number is the submission of record. No UPDATE or DELETE '
  'privilege exists for any role.';
COMMENT ON TABLE public.ngrp_candidate_requirements IS
  'Explainable per-rule eligibility results (code/status/detail/deadline), '
  'derived from the latest revision + cycle configuration; recalculated, '
  'never authored by hand.';
COMMENT ON TABLE public.ngrp_transition_deliveries IS
  'Durable per-recipient Transition Form send attempts, UNIQUE per '
  '(batch_id, candidate_id) - the idempotency authority for retried batches. '
  'Server-only; no DELETE.';
COMMENT ON TABLE public.ngrp_audit_events IS
  'Allowlisted NGRP workflow audit trail with minimal safe metadata. No '
  'foreign keys on purpose: audit rows outlive whatever they describe. '
  'Insert-only.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── VERIFICATION (run after COMMIT; expect the stated values) ───────────────
-- V1. Structure (one row). policy_count deliberately names the EXACT eight
--     release-2 tables (never LIKE 'ngrp_%': legacy NGRP policies exist in
--     production and would falsify a zero expectation):
-- SELECT
--   (SELECT count(*) FROM information_schema.tables
--     WHERE table_schema='public'
--       AND table_name IN ('ngrp_cycle_units','ngrp_transition_assignments',
--                          'ngrp_transition_tokens','ngrp_transition_drafts',
--                          'ngrp_transition_revisions','ngrp_candidate_requirements',
--                          'ngrp_transition_deliveries','ngrp_audit_events'))           AS tables_created,   -- 8
--   (SELECT bool_and(relrowsecurity) FROM pg_class
--     WHERE relname IN ('ngrp_cycle_units','ngrp_transition_assignments',
--                       'ngrp_transition_tokens','ngrp_transition_drafts',
--                       'ngrp_transition_revisions','ngrp_candidate_requirements',
--                       'ngrp_transition_deliveries','ngrp_audit_events'))              AS rls_enabled,      -- t
--   (SELECT count(*) FROM pg_policies
--     WHERE schemaname='public'
--       AND tablename IN ('ngrp_cycle_units','ngrp_transition_assignments',
--                         'ngrp_transition_tokens','ngrp_transition_drafts',
--                         'ngrp_transition_revisions','ngrp_candidate_requirements',
--                         'ngrp_transition_deliveries','ngrp_audit_events'))            AS policy_count,     -- 0
--   (SELECT count(*) FROM pg_trigger
--     WHERE tgname IN ('ngrp_cycle_units_touch','ngrp_transition_assignments_touch',
--                      'ngrp_transition_drafts_touch','ngrp_transition_deliveries_touch')) AS trigger_count,  -- 4
--   (SELECT count(*) FROM pg_proc
--     WHERE proname IN ('ngrp_pacific_deadline','ngrp_cycle_create_tx',
--                       'ngrp_cycle_set_active_tx','ngrp_sources_set_tx',
--                       'ngrp_units_set_tx','ngrp_set_candidate_eligibility_tx',
--                       'ngrp_submit_revision_tx','ngrp_save_draft_tx',
--                       'ngrp_activate_token_tx','ngrp_fail_token_tx'))                 AS functions_created, -- 10
--   (SELECT count(*) FROM public.ngrp_cycle_units)
--   + (SELECT count(*) FROM public.ngrp_transition_assignments)
--   + (SELECT count(*) FROM public.ngrp_transition_tokens)
--   + (SELECT count(*) FROM public.ngrp_transition_drafts)
--   + (SELECT count(*) FROM public.ngrp_transition_revisions)
--   + (SELECT count(*) FROM public.ngrp_candidate_requirements)
--   + (SELECT count(*) FROM public.ngrp_transition_deliveries)
--   + (SELECT count(*) FROM public.ngrp_audit_events)                                   AS total_rows;       -- 0
--
-- V2. ACTUAL table privileges (eight rows; anon/auth all f; service_role
--     columns exactly as commented):
-- SELECT t.table_name,
--   has_table_privilege('anon',          format('public.%I', t.table_name), 'SELECT') AS anon_select,   -- f
--   has_table_privilege('authenticated', format('public.%I', t.table_name), 'SELECT') AS auth_select,   -- f
--   has_table_privilege('service_role',  format('public.%I', t.table_name), 'SELECT') AS svc_select,    -- t
--   has_table_privilege('service_role',  format('public.%I', t.table_name), 'INSERT') AS svc_insert,    -- t
--   has_table_privilege('service_role',  format('public.%I', t.table_name), 'UPDATE') AS svc_update,    -- t except revisions/audit (f)
--   has_table_privilege('service_role',  format('public.%I', t.table_name), 'DELETE') AS svc_delete     -- t only for cycle_units/drafts/requirements
-- FROM (VALUES ('ngrp_cycle_units'),('ngrp_transition_assignments'),
--              ('ngrp_transition_tokens'),('ngrp_transition_drafts'),
--              ('ngrp_transition_revisions'),('ngrp_candidate_requirements'),
--              ('ngrp_transition_deliveries'),('ngrp_audit_events')) AS t(table_name);
--
-- V3. ACTUAL function privileges (ten rows; anon/auth f, service_role t):
-- SELECT p.proname,
--   has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec,  -- f
--   has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,  -- f
--   has_function_privilege('service_role',  p.oid, 'EXECUTE') AS svc_exec    -- t
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN ('ngrp_pacific_deadline','ngrp_cycle_create_tx',
--                     'ngrp_cycle_set_active_tx','ngrp_sources_set_tx',
--                     'ngrp_units_set_tx','ngrp_set_candidate_eligibility_tx',
--                     'ngrp_submit_revision_tx','ngrp_save_draft_tx',
--                     'ngrp_activate_token_tx','ngrp_fail_token_tx');
--
-- VERIFICATION MUST RETURN ROWS: if any SELECT returns no row or errors,
-- the migration did not apply as intended - stop and report.

-- ── ROLLBACK (last resort; NEVER destroys submitted form or audit data) ─────
-- Once ANY row exists in ngrp_transition_revisions or ngrp_audit_events,
-- prefer disabling the endpoints over dropping tables. If a structural
-- rollback is unavoidable, EXPORT ngrp_transition_revisions and
-- ngrp_audit_events (CSV from the SQL editor) FIRST, then:
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.ngrp_fail_token_tx(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.ngrp_activate_token_tx(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.ngrp_save_draft_tx(uuid, jsonb);
-- DROP FUNCTION IF EXISTS public.ngrp_submit_revision_tx(uuid, jsonb, text, text, jsonb, jsonb);
-- DROP FUNCTION IF EXISTS public.ngrp_set_candidate_eligibility_tx(uuid, text, jsonb, jsonb, uuid);
-- DROP FUNCTION IF EXISTS public.ngrp_units_set_tx(uuid, jsonb, uuid);
-- DROP FUNCTION IF EXISTS public.ngrp_sources_set_tx(uuid, uuid[], uuid);
-- DROP FUNCTION IF EXISTS public.ngrp_cycle_set_active_tx(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.ngrp_cycle_create_tx(jsonb, uuid[], uuid);
-- DROP FUNCTION IF EXISTS public.ngrp_pacific_deadline(date);
-- DROP TABLE IF EXISTS public.ngrp_candidate_requirements;
-- DROP TABLE IF EXISTS public.ngrp_transition_drafts;
-- DROP TABLE IF EXISTS public.ngrp_transition_deliveries;
-- DROP TABLE IF EXISTS public.ngrp_transition_revisions;   -- only after export
-- DROP TABLE IF EXISTS public.ngrp_transition_tokens;
-- DROP TABLE IF EXISTS public.ngrp_transition_assignments;
-- DROP TABLE IF EXISTS public.ngrp_cycle_units;
-- DROP TABLE IF EXISTS public.ngrp_audit_events;           -- only after export
-- COMMIT;
-- (The foundation tables, the shared touch function, and every legacy object
-- are untouched by both apply and rollback.)
