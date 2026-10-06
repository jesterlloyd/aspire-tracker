-- APPLICANT-PACKET-1 checks for 20261109000000_applicant_packet_audit.sql. Read-only.

-- PRE 1: the constraint as 20261108000000 left it. Expect resume_scored true, packet false.
SELECT
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%resume_scored%' AS ta_types_present,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%packet_downloaded%' AS packet_type_present;

-- POST 1: both true, and the earliest types are still there.
SELECT
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%packet_downloaded%' AS packet_type_present,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%resume_scored%' AS ta_types_kept,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%cycle_created%' AS earliest_types_kept;
