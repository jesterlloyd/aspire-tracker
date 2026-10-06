-- 20261109000000_applicant_packet_audit.sql
-- APPLICANT-PACKET-1 (Owner, adoption phase 4): an applicant's binder has Download Packet, one
-- PDF of the summary, the submitted Transition Form and the application documents. It is built
-- in the browser from files the person could already open, so nothing is stored; the only
-- write is a line in Settings > Residency Activity saying who downloaded whose packet.
--
-- 1. ngrp_audit_events accepts one new event type, packet_downloaded. The CHECK is rebuilt with
--    every earlier type kept (the list 20261108000000 left) plus this one.
--    lib/server/ngrpAudit.js lists the same set; an event has to pass both.
--
-- NOT CHANGED. No table, column, policy or grant.
-- EITHER DEPLOY ORDER. Before this runs the packet still downloads; its log line is refused and
-- written to the console instead.
-- CHECKS: db/audit/applicant_packet_audit_checks.sql (PRE 1, POST 1).

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
      -- APPLICANT-PACKET-1
      'packet_downloaded'));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   DELETE FROM public.ngrp_audit_events WHERE event_type = 'packet_downloaded';
--   then restore the CHECK from 20261108000000.
