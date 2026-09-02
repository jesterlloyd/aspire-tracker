-- NGRP-INTERVIEW-HIRE-1: audit event types for the interview and hire record.
--
-- Product source of truth: docs/product/NGRP_WORKSPACE_PRODUCT_PLAN.md.
-- Builds on the applied foundation (20260903000000), its delete-privilege
-- repair (20260903010000), the planning/transition migration (20260904000000),
-- the cycle-status canon (20260905000000) and the assignment/interview columns
-- (20260906000000). None of those is edited or re-run.
--
-- NO NEW COLUMNS. Everything this phase writes already has a home:
--   interview_status / interview_at / interview_recorded_by_profile_id /
--   interview_recorded_at   landed on ngrp_candidates in 20260906000000.
--   offer_extended_at / offer_accepted_at / hired_at / hired_unit /
--   residency_start_date    have been on ngrp_residency_outcomes since the
--                           foundation, read for the prior-hire exclusion but
--                           never yet written.
--
-- WHAT IS ACTUALLY MISSING is permission to SAY that those writes happened.
-- recordNgrpAudit is gated twice, by a JS allowlist and by this CHECK, and an
-- event type must pass BOTH. Adding the four types to the allowlist alone would
-- let the endpoint report success while Postgres silently refused the audit row
-- - which is exactly the failure the assignment phase caught late.
--
-- Widened, never narrowed: every value the previous CHECK allowed is carried
-- through unchanged.

BEGIN;

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
      -- NGRP-INTERVIEW-HIRE-1
      'interview_recorded','offer_extended','offer_accepted','hire_recorded'));

COMMIT;

-- ── Verification (run separately; must return ONE row, every column true) ───
--
--   SELECT
--     pg_get_constraintdef(oid) LIKE '%interview_recorded%' AS has_interview_recorded,
--     pg_get_constraintdef(oid) LIKE '%offer_extended%'     AS has_offer_extended,
--     pg_get_constraintdef(oid) LIKE '%offer_accepted%'     AS has_offer_accepted,
--     pg_get_constraintdef(oid) LIKE '%hire_recorded%'      AS has_hire_recorded,
--     pg_get_constraintdef(oid) LIKE '%unit_assigned%'      AS previous_events_kept
--     FROM pg_constraint
--    WHERE conname = 'ngrp_audit_events_event_type_check';
--
-- No rows means the constraint is not there under that name, which is itself
-- the finding: the widening did not land and every audit insert for these
-- events would be refused.
