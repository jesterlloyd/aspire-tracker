-- TRANSITION-PORTAL-1 checks for 20261120000000_transition_deadline_audit.sql. Read-only.

-- PRE 1: the audit CHECK is as 20261116000000 left it.
-- Expect: alumnus_types_present true, deadline_type_present false.
SELECT
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%alumnus_invited%' AS alumnus_types_present,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%form_deadline_extended%' AS deadline_type_present;

-- PRE 2: every event type already written is one the new CHECK keeps. Expect: zero rows.
SELECT event_type, count(*) FROM public.ngrp_audit_events
WHERE event_type NOT IN (
  'cycle_created','cycle_updated','cycle_activated','source_cohorts_changed','units_changed',
  'form_sent','form_opened','form_submitted','form_revised','token_revoked','token_resent',
  'eligibility_calculated','eligibility_overridden','application_confirmed','application_withdrawn',
  'unit_assigned','unit_assignment_cleared','interview_recorded','offer_extended','offer_accepted',
  'hire_recorded','not_proceeding_recorded','application_reinstated','unit_preferences_set',
  'offer_declined','not_selected','reflection_started','reflection_sent','reflection_opened',
  'reflection_submitted','reflection_stopped','support_logged','support_voided','followup_flagged',
  'followup_unflagged','document_uploaded','resume_scored','packet_downloaded',
  'interview_rubric_completed','interview_rubric_reopened','interview_times_opened',
  'interview_times_removed','interview_slot_blocked','interview_slot_unblocked',
  'interview_booked','interview_booking_cancelled',
  'alumnus_added','alumnus_removed','alumnus_invited')
GROUP BY event_type;

-- POST 1: the new type is accepted and nothing was dropped.
-- Expect: deadline_type_present true, alumnus_types_present true.
SELECT
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%form_deadline_extended%' AS deadline_type_present,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%alumnus_invited%' AS alumnus_types_present;
