-- 20261120000000_transition_deadline_audit.sql
-- TRANSITION-PORTAL-1 (Owner, 2026-11-02): the binder's Transition Form section gains
-- "Extend deadline", which sets one alumnus's own close date (ngrp_form_assignments.deadline_at,
-- an existing column). Settings > Residency Activity records each change as
-- form_deadline_extended, with the new date in metadata.close_date.
--
-- 1. ngrp_audit_events accepts form_deadline_extended. The CHECK is rebuilt with every type the
--    live constraint holds (the list 20261116000000 left) plus this one.
--    lib/server/ngrpAudit.js lists the same set; an event has to pass both.
--
-- NOT CHANGED. No table, column, policy or grant. The deadline write itself needs nothing new.
-- EITHER DEPLOY ORDER. Before this runs, Extend deadline still saves the date; only the audit
-- line is refused, and the audit writer never fails the action for it.
-- CHECKS: db/audit/transition_deadline_audit_checks.sql (PRE 1-2, POST 1).

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
      'support_logged','support_voided','followup_flagged','followup_unflagged',
      'document_uploaded','resume_scored',
      'packet_downloaded',
      'interview_rubric_completed','interview_rubric_reopened',
      'interview_times_opened','interview_times_removed',
      'interview_slot_blocked','interview_slot_unblocked',
      'interview_booked','interview_booking_cancelled',
      'alumnus_added','alumnus_removed','alumnus_invited',
      -- TRANSITION-PORTAL-1
      'form_deadline_extended'));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   DELETE FROM public.ngrp_audit_events WHERE event_type = 'form_deadline_extended';
--   then restore the CHECK from 20261116000000.
