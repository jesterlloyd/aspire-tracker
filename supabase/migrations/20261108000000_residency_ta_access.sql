-- 20261108000000_residency_ta_access.sql
-- RESIDENCY-TA-1 (Owner, 2026-10-05): Talent Acquisition works in Residency as the ASPIRE team
-- does (logs support and attendance, flags, uploads documents, scores résumés), and Settings >
-- Residency Activity shows who did what.
--
-- 1. ngrp_audit_events accepts six new event types: support_logged, support_voided,
--    followup_flagged, followup_unflagged, document_uploaded, resume_scored. The CHECK is
--    rebuilt with every earlier type kept (the list 20260917000000 left) plus these.
--    lib/server/ngrpAudit.js lists the same set; an event has to pass both.
-- 2. Keith's review-resume Skill admits 'talent_acquisition', the role api/student-documents.js
--    gives a Residency Portal account after proving its grant, scoped to ALUMNI only by
--    lib/server/keith/skillAuthorization.js. The draft step (Warmer, Shorter, Regenerate) runs
--    under the same row. Added only if absent; nothing else about the Skill changes.
--
-- NOT CHANGED. No table, column, policy or grant. Every write is the service role's.
-- EITHER DEPLOY ORDER. Before this runs the app still works: a new event's insert is refused
-- and logged to the console (the action itself succeeds), and Talent Acquisition sees
-- "Keith is not available" instead of Score now.
-- CHECKS: db/audit/residency_ta_access_checks.sql (PRE 1, POST 1-2).

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
      'interview_recorded','offer_extended','offer_accepted','hire_recorded',
      'not_proceeding_recorded','application_reinstated',
      'unit_preferences_set','offer_declined','not_selected',
      'reflection_started','reflection_sent','reflection_opened',
      'reflection_submitted','reflection_stopped',
      -- RESIDENCY-TA-1
      'support_logged','support_voided','followup_flagged','followup_unflagged',
      'document_uploaded','resume_scored'));

UPDATE public.keith_skills
   SET allowed_roles = array_append(allowed_roles, 'talent_acquisition')
 WHERE slug = 'review-resume'
   AND NOT ('talent_acquisition' = ANY (allowed_roles));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   UPDATE public.keith_skills SET allowed_roles = array_remove(allowed_roles, 'talent_acquisition') WHERE slug = 'review-resume';
--   (and restore the CHECK from 20260917000000 after deleting any rows of the six new types)
