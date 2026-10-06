-- NGRP-INTERVIEWS-1 checks for 20261111000000_ngrp_interviews.sql. Read-only.

-- PRE 1: nothing there yet. Expect rubrics_table false, blocks_table false, slots_table false,
-- packet_type_present true (20261109000000 applied), interview_types_present false.
SELECT
  to_regclass('public.ngrp_interview_rubrics') IS NOT NULL AS rubrics_table,
  to_regclass('public.ngrp_interview_blocks')  IS NOT NULL AS blocks_table,
  to_regclass('public.ngrp_interview_slots')   IS NOT NULL AS slots_table,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%packet_downloaded%' AS packet_type_present,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%interview_booked%' AS interview_types_present;

-- POST 1: the three tables exist, the CHECK has the new and the old types, and the browser roles
-- hold nothing on them. Expect true, true, true, true, true, false, false.
SELECT
  to_regclass('public.ngrp_interview_rubrics') IS NOT NULL AS rubrics_table,
  to_regclass('public.ngrp_interview_blocks')  IS NOT NULL AS blocks_table,
  to_regclass('public.ngrp_interview_slots')   IS NOT NULL AS slots_table,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%interview_booked%' AS interview_types_present,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%cycle_created%' AS earliest_types_kept,
  has_table_privilege('authenticated', 'public.ngrp_interview_rubrics', 'SELECT') AS authenticated_can_read_rubrics,
  has_table_privilege('anon', 'public.ngrp_interview_slots', 'SELECT') AS anon_can_read_slots;

-- POST 2: the guards are in place. Expect 3 rows: the unique rubric constraint, the complete
-- check and the one-booking index.
SELECT conname AS guard FROM pg_constraint
 WHERE conname IN ('uq_ngrp_interview_rubric_interviewer', 'chk_ngrp_interview_rubric_complete')
UNION ALL
SELECT indexname FROM pg_indexes WHERE indexname = 'uq_ngrp_interview_slot_one_booking';
