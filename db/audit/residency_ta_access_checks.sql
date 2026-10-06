-- RESIDENCY-TA-1 checks for 20261108000000_residency_ta_access.sql. Read-only.

-- PRE 1: the constraint as it stands, and the Skill's roles. Expect the reflection types to be
-- the last ones listed, and allowed_roles without talent_acquisition.
SELECT
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%reflection_stopped%' AS reflection_types_present,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%resume_scored%' AS new_types_present,
  (SELECT allowed_roles FROM public.keith_skills WHERE slug = 'review-resume') AS review_resume_roles;

-- POST 1: both should now be true, and the roles include talent_acquisition.
SELECT
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%resume_scored%' AS new_types_present,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check') LIKE '%reflection_stopped%' AS earlier_types_kept,
  (SELECT 'talent_acquisition' = ANY (allowed_roles) FROM public.keith_skills WHERE slug = 'review-resume') AS ta_can_score;
