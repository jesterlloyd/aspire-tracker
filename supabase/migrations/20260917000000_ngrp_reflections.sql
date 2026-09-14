-- ============================================================================
-- RESIDENCY-REFLECTION-1: the bi-weekly Clinical Orientation Progress and
-- Reflection Tool, sent to residents by secure link
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester). Claude Code has applied NOTHING. ***
--
-- Owner decisions, 2026-09-13. The paper NGRP Bi-Weekly Clinical Orientation
-- Progress and Reflection Tool (RV/JG/CW 07.28.25) becomes a form residents
-- fill in from a personal link, with no login (they lose the student one at
-- graduation). Bi-weekly, five periods, ten weeks, started by a button on
-- Residency > Support > During residency. Period 1 is sent at once; each later
-- period is sent the Friday night before it opens and is due the Sunday that
-- closes it. This REPLACES the weekly email check-in.
--
-- The preceptor's comments and signature are deferred; this is the resident's
-- side. Sharing with mentors and preceptors is deferred too.
--
-- WHAT THIS FILE DOES
--   1. ngrp_reflection_runs: one per resident, holding the schedule's shape
--      (period count and length, the start day) and whether it is active,
--      completed, or stopped.
--   2. ngrp_reflection_periods: one per run per period, with the materialized
--      opens/due/send dates, the lifecycle, and the one autosave draft.
--   3. ngrp_reflection_tokens: the secure links, hash only, one per send.
--      Same posture as ngrp_transition_tokens: pending until the provider
--      accepts the email, then active; failed or revoked otherwise.
--   4. ngrp_reflection_submissions: the immutable answer, one per period.
--      service_role may INSERT and SELECT; nothing may UPDATE or DELETE it.
--   5. The audit CHECK learns five event types, carrying every earlier value.
--
-- Additive and transactional. No existing table, policy, view or function is
-- changed. Safe in either deploy order: the Support tab shows Start only once
-- these tables exist, and the public page answers 410 to any link before then.
--
-- PREFLIGHT / POSTFLIGHT: db/audit/ngrp_reflections_checks.sql

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.ngrp_candidates') IS NULL OR to_regclass('public.ngrp_cycles') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: the NGRP foundation tables are missing';
  END IF;
END
$pre$;

-- ############################################################################
-- 1. Runs
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.ngrp_reflection_runs (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One run per resident. Starting again is refused, not duplicated.
  candidate_id           uuid        NOT NULL UNIQUE REFERENCES public.ngrp_candidates(id) ON DELETE CASCADE,
  cycle_id               uuid        NOT NULL REFERENCES public.ngrp_cycles(id) ON DELETE RESTRICT,
  student_id             uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  -- The Pacific calendar day the team pressed Start; every date derives from it.
  started_on             date        NOT NULL,
  started_at             timestamptz NOT NULL DEFAULT now(),
  started_by_profile_id  uuid        NOT NULL,
  period_count           integer     NOT NULL CHECK (period_count BETWEEN 1 AND 12),
  period_days            integer     NOT NULL CHECK (period_days BETWEEN 7 AND 28),
  status                 text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'stopped')),
  stopped_at             timestamptz,
  stopped_by_profile_id  uuid,
  CONSTRAINT chk_ngrp_reflection_run_stop CHECK ((status = 'stopped') = (stopped_at IS NOT NULL))
);
COMMENT ON TABLE public.ngrp_reflection_runs IS
  'RESIDENCY-REFLECTION-1: one resident''s bi-weekly reflection schedule, started by the ASPIRE team. Server-only.';

-- ############################################################################
-- 2. Periods
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.ngrp_reflection_periods (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                 uuid        NOT NULL REFERENCES public.ngrp_reflection_runs(id) ON DELETE CASCADE,
  candidate_id           uuid        NOT NULL REFERENCES public.ngrp_candidates(id) ON DELETE CASCADE,
  student_id             uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  period_number          integer     NOT NULL CHECK (period_number >= 1),
  opens_on               date        NOT NULL,
  due_on                 date        NOT NULL,
  -- The day the email goes out: the start day for period 1, the Friday before
  -- opens_on for the rest. The cron matches on this and nothing else.
  send_on                date        NOT NULL,
  status                 text        NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending', 'sent', 'opened', 'in_progress', 'submitted')),
  sent_at                timestamptz,
  opened_at              timestamptz,
  last_saved_at          timestamptz,
  submitted_at           timestamptz,
  -- The one autosave draft. Cleared on submission; the answer lives below.
  draft                  jsonb       CHECK (draft IS NULL OR jsonb_typeof(draft) = 'object'),
  CONSTRAINT uq_ngrp_reflection_period UNIQUE (run_id, period_number),
  CONSTRAINT chk_ngrp_reflection_period_dates CHECK (send_on <= opens_on AND opens_on <= due_on)
);
COMMENT ON TABLE public.ngrp_reflection_periods IS
  'RESIDENCY-REFLECTION-1: one two-week period of a run, with its materialized dates and autosave draft. Server-only.';

CREATE INDEX IF NOT EXISTS idx_ngrp_reflection_periods_due
  ON public.ngrp_reflection_periods (send_on, due_on) WHERE sent_at IS NULL;

-- ############################################################################
-- 3. Tokens (hash only; the raw token is never stored)
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.ngrp_reflection_tokens (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id              uuid        NOT NULL REFERENCES public.ngrp_reflection_periods(id) ON DELETE RESTRICT,
  token_hash             text        NOT NULL UNIQUE CHECK (btrim(token_hash) <> ''),
  token_hash_prefix      text        NOT NULL CHECK (length(token_hash_prefix) BETWEEN 4 AND 16),
  status                 text        NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending', 'active', 'revoked', 'failed')),
  failed_reason          text,
  provider_email_id      text,
  provider_accepted_at   timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by_profile_id  uuid,
  first_used_at          timestamptz,
  revoked_at             timestamptz,
  CONSTRAINT chk_ngrp_reflection_token_revoked CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
COMMENT ON TABLE public.ngrp_reflection_tokens IS
  'RESIDENCY-REFLECTION-1: secure reflection links, HMAC hash only. Only an active token resolves. Server-only.';

CREATE INDEX IF NOT EXISTS idx_ngrp_reflection_tokens_period
  ON public.ngrp_reflection_tokens (period_id, status);

-- ############################################################################
-- 4. Submissions (immutable)
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.ngrp_reflection_submissions (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id              uuid        NOT NULL UNIQUE REFERENCES public.ngrp_reflection_periods(id) ON DELETE RESTRICT,
  candidate_id           uuid        NOT NULL REFERENCES public.ngrp_candidates(id) ON DELETE RESTRICT,
  student_id             uuid        NOT NULL REFERENCES public.students(id) ON DELETE RESTRICT,
  payload                jsonb       NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  submitted_at           timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ngrp_reflection_submissions IS
  'RESIDENCY-REFLECTION-1: the resident''s submitted reflection for one period. Insert-only: no role may update or delete it.';

-- ############################################################################
-- 5. Server-only privileges
-- ############################################################################
ALTER TABLE public.ngrp_reflection_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_reflection_periods     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_reflection_tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_reflection_submissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.ngrp_reflection_runs        FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.ngrp_reflection_periods     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.ngrp_reflection_tokens      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.ngrp_reflection_submissions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ngrp_reflection_runs        TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ngrp_reflection_periods     TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ngrp_reflection_tokens      TO service_role;
GRANT SELECT, INSERT         ON TABLE public.ngrp_reflection_submissions TO service_role;

-- ############################################################################
-- 6. Audit vocabulary (widened, never narrowed)
-- ############################################################################
ALTER TABLE public.ngrp_audit_events
  DROP CONSTRAINT IF EXISTS ngrp_audit_events_event_type_check;
ALTER TABLE public.ngrp_audit_events
  ADD CONSTRAINT ngrp_audit_events_event_type_check
    CHECK (event_type IN (
      'cycle_created','cycle_updated','cycle_activated',
      'source_cohorts_changed','units_changed',
      'form_sent','form_opened','form_submitted','form_revised',
      'token_revoked','token_resent',
      'eligibility_calculated','eligibility_overridden',
      'application_confirmed','application_withdrawn',
      'unit_assigned','unit_assignment_cleared',
      'interview_recorded','offer_extended','offer_accepted','hire_recorded',
      'not_proceeding_recorded','application_reinstated',
      'unit_preferences_set','offer_declined','not_selected',
      -- RESIDENCY-REFLECTION-1
      'reflection_started','reflection_sent','reflection_opened',
      'reflection_submitted','reflection_stopped'));

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── ROLLBACK (only while every table is still empty) ─────────────────────────
-- BEGIN;
--   DROP TABLE IF EXISTS public.ngrp_reflection_submissions;
--   DROP TABLE IF EXISTS public.ngrp_reflection_tokens;
--   DROP TABLE IF EXISTS public.ngrp_reflection_periods;
--   DROP TABLE IF EXISTS public.ngrp_reflection_runs;
--   NOTIFY pgrst, 'reload schema';
-- COMMIT;
