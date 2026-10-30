-- ADD-ALUMNUS-1 checks for 20261116000000_ngrp_added_alumni.sql. Read-only.

-- PRE 1: the table does not exist yet, and the audit CHECK is as 20261111000000 left it.
-- Expect: table_exists false, interview_types_present true, alumnus_types_present false.
SELECT
  to_regclass('public.ngrp_cycle_added_alumni') IS NOT NULL AS table_exists,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%interview_booking_cancelled%' AS interview_types_present,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%alumnus_added%' AS alumnus_types_present;

-- PRE 2: every event type already written is one the new CHECK keeps (it would refuse to
-- rebuild otherwise). Expect: zero rows.
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
  'interview_booked','interview_booking_cancelled')
GROUP BY event_type;

-- POST 1: the table exists, empty, with row level security on.
-- Expect: table_exists true, rows 0, rls_on true.
SELECT
  to_regclass('public.ngrp_cycle_added_alumni') IS NOT NULL AS table_exists,
  (SELECT count(*) FROM public.ngrp_cycle_added_alumni) AS rows,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ngrp_cycle_added_alumni'::regclass) AS rls_on;

-- POST 2: only the service role may touch it. Expect one row: service_role with SELECT, INSERT, UPDATE.
SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'ngrp_cycle_added_alumni'
GROUP BY grantee;

-- POST 3: the live-membership index is in place. Expect: 1.
SELECT count(*) AS live_unique_index
FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_ngrp_added_alumni_live';

-- POST 4: the three new audit types are accepted and the earliest and latest old ones kept.
-- Expect: all true.
SELECT
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%alumnus_added%'
    AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%alumnus_removed%'
    AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%alumnus_invited%' AS new_types_present,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%cycle_created%' AS earliest_kept,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%interview_booking_cancelled%' AS latest_kept;
