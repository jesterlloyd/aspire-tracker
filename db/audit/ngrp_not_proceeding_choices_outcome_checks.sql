-- Checks for supabase/migrations/20260916000000_ngrp_not_proceeding_choices_outcome.sql
-- Read-only. Run each numbered section on its own in the Supabase SQL editor.

-- ── PRE 1: the tables exist and none of the new columns do ───────────────────
-- Expect: candidates = true, outcomes = true, new_columns = 0
SELECT to_regclass('public.ngrp_candidates') IS NOT NULL         AS candidates,
       to_regclass('public.ngrp_residency_outcomes') IS NOT NULL AS outcomes,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public'
           AND ((table_name = 'ngrp_candidates'
                 AND column_name IN ('not_proceeding_reason','not_proceeding_note','not_proceeding_at',
                                     'not_proceeding_by_profile_id','staff_unit_preferences',
                                     'unit_preferences_set_by_profile_id','unit_preferences_set_at'))
             OR (table_name = 'ngrp_residency_outcomes'
                 AND column_name IN ('not_selected_at','offer_declined_at')))) AS new_columns;

-- ── PRE 2: the two constraints the migration REPLACES are really there ───────
-- Expect: two rows. The status check should list three values and NOT mention
-- not_proceeding; the state-times check should have three branches. If a row is
-- missing, the DROP would silently no-op and the ADD would be the only change.
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'public.ngrp_candidates'::regclass
   AND conname IN ('ngrp_candidates_application_status_check', 'ngrp_application_state_times')
 ORDER BY conname;

-- ── PRE 3: how many rows the one rewrite will touch ──────────────────────────
-- Expect: whatever is true. These 'withdrawn' candidates become
-- 'not_proceeding' with reason 'withdrew' and keep their original timestamp.
-- Anything other than 0 should match POST 4 exactly.
SELECT application_status, count(*) AS rows
  FROM public.ngrp_candidates
 GROUP BY application_status
 ORDER BY application_status;

-- ── POST 1: all nine columns exist, nullable ─────────────────────────────────
-- Expect: 9 rows, is_nullable = YES on every one
SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND ((table_name = 'ngrp_candidates'
         AND column_name IN ('not_proceeding_reason','not_proceeding_note','not_proceeding_at',
                             'not_proceeding_by_profile_id','staff_unit_preferences',
                             'unit_preferences_set_by_profile_id','unit_preferences_set_at'))
     OR (table_name = 'ngrp_residency_outcomes'
         AND column_name IN ('not_selected_at','offer_declined_at')))
 ORDER BY table_name, column_name;

-- ── POST 2: the candidate constraints are in force ───────────────────────────
-- Expect: 5 rows -
--   ngrp_application_state_times                  (four branches, one naming not_proceeding)
--   ngrp_candidates_application_status_canon      (four values incl. not_proceeding)
--   ngrp_not_proceeding_other_needs_note
--   ngrp_not_proceeding_requires_reason_time
--   ngrp_unit_prefs_require_actor_time
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'public.ngrp_candidates'::regclass
   AND conname IN ('ngrp_application_state_times',
                   'ngrp_candidates_application_status_canon',
                   'ngrp_not_proceeding_other_needs_note',
                   'ngrp_not_proceeding_requires_reason_time',
                   'ngrp_unit_prefs_require_actor_time')
 ORDER BY conname;

-- ── POST 3: exactly ONE status check survives, and it admits not_proceeding ──
-- Expect: status_checks = 1, admits_not_proceeding = true
-- (A second, narrower copy left behind would refuse every removal.)
SELECT count(*) AS status_checks,
       bool_or(pg_get_constraintdef(oid) LIKE '%not_proceeding%') AS admits_not_proceeding
  FROM pg_constraint
 WHERE conrelid = 'public.ngrp_candidates'::regclass
   AND pg_get_constraintdef(oid) LIKE '%application_status IN%';

-- ── POST 4: the rewrite landed, and nothing is left half-converted ───────────
-- Expect: withdrawn_left = 0; not_proceeding matches PRE 3's withdrawn count;
--         missing_reason = 0 and missing_time = 0
SELECT count(*) FILTER (WHERE application_status = 'withdrawn')      AS withdrawn_left,
       count(*) FILTER (WHERE application_status = 'not_proceeding') AS not_proceeding,
       count(*) FILTER (WHERE application_status = 'not_proceeding'
                          AND not_proceeding_reason IS NULL)         AS missing_reason,
       count(*) FILTER (WHERE application_status = 'not_proceeding'
                          AND not_proceeding_at IS NULL)             AS missing_time
  FROM public.ngrp_candidates;

-- ── POST 5: the outcome constraints are in force ─────────────────────────────
-- Expect: 2 rows (ngrp_outcomes_decline_requires_offer, ngrp_outcomes_one_final_result)
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'public.ngrp_residency_outcomes'::regclass
   AND conname IN ('ngrp_outcomes_decline_requires_offer', 'ngrp_outcomes_one_final_result')
 ORDER BY conname;

-- ── POST 6: the audit vocabulary kept everything and learned five ────────────
-- Expect: event_type_checks = 1, keeps_hire_events = true, learns_new = true
-- (Exactly one check, so no narrower copy survived the DROP; and it still
-- carries the NGRP-INTERVIEW-HIRE-1 values as well as this release's.)
SELECT count(*) AS event_type_checks,
       bool_or(pg_get_constraintdef(oid) LIKE '%hire_recorded%')          AS keeps_hire_events,
       bool_or(pg_get_constraintdef(oid) LIKE '%not_proceeding_recorded%'
               AND pg_get_constraintdef(oid) LIKE '%unit_preferences_set%'
               AND pg_get_constraintdef(oid) LIKE '%offer_declined%'
               AND pg_get_constraintdef(oid) LIKE '%not_selected%'
               AND pg_get_constraintdef(oid) LIKE '%application_reinstated%') AS learns_new
  FROM pg_constraint
 WHERE conrelid = 'public.ngrp_audit_events'::regclass
   AND pg_get_constraintdef(oid) LIKE '%event_type%';
