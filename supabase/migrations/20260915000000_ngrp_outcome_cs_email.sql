-- ============================================================================
-- RESIDENCY: the resident's Cedars-Sinai email on the hire record
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester). Claude Code has applied NOTHING. ***
--
-- Owner decision, 2026-09-11: once an applicant is hired they are a
-- Cedars-Sinai employee with a Cedars-Sinai address, and that is where
-- residency correspondence goes (weekly check-ins first). Alumni lose their
-- school address after graduation, so it is never used for residency mail:
--   hired          -> Cedars-Sinai email, personal email as backup
--   still applying -> the preferred email from their Transition Form,
--                     personal email as backup
-- The rule itself lives in lib/server/ngrpResidencyRecipient.js.
--
-- Additive and transactional: one nullable column on the durable hire record.
-- It rewrites no data and changes no policy, view, or function.
--
-- The address is not required to record a hire, because the account often does
-- not exist on day one; until it is filled in, correspondence falls back to
-- the personal email.
--
-- SAFE IN EITHER DEPLOY ORDER: the roster reads the column when it exists and
-- falls back to the other hire fields when it does not.
--
-- PREFLIGHT / POSTFLIGHT: db/audit/ngrp_outcome_cs_email_checks.sql

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.ngrp_residency_outcomes') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: public.ngrp_residency_outcomes is missing';
  END IF;
END
$pre$;

ALTER TABLE public.ngrp_residency_outcomes
  ADD COLUMN IF NOT EXISTS cs_email text
    CHECK (cs_email IS NULL OR (btrim(cs_email) <> '' AND char_length(cs_email) <= 200 AND cs_email LIKE '%@%.%'));

COMMENT ON COLUMN public.ngrp_residency_outcomes.cs_email IS
  'RESIDENCY-SUPPORT-1: the resident''s Cedars-Sinai address, where residency correspondence goes once they are hired. Personal email is the backup; the school address is never used.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── ROLLBACK (drops the recorded addresses with it) ─────────────────────────
-- BEGIN;
--   ALTER TABLE public.ngrp_residency_outcomes DROP COLUMN IF EXISTS cs_email;
--   NOTIFY pgrst, 'reload schema';
-- COMMIT;
