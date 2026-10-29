-- UNIT-RENAME-POSTPARTUM-1 (Owner, 2026-10-29): read-only PRE and POST for
-- db/maintenance/rename_3_north_postpartum_20261029.sql. Run before (expect the 3 North
-- counts below, Postpartum 0) and after (expect the reverse). History tables
-- (notification_log, cohort_unit_response_target_events) are deliberately not renamed.
select 'units' as tbl,
  count(*) filter (where unit_name = '3 North') as three_north,
  count(*) filter (where unit_name = 'Postpartum') as postpartum from public.units
union all select 'ngrp_cycle_units',
  count(*) filter (where unit_name = '3 North'), count(*) filter (where unit_name = 'Postpartum') from public.ngrp_cycle_units
union all select 'unit_cohort_responses',
  count(*) filter (where unit_name = '3 North'), count(*) filter (where unit_name = 'Postpartum') from public.unit_cohort_responses
union all select 'cohort_unit_response_targets',
  count(*) filter (where unit_name = '3 North' or unit_key = '3 North'), count(*) filter (where unit_name = 'Postpartum' and unit_key = 'Postpartum') from public.cohort_unit_response_targets
union all select 'contacts',
  count(*) filter (where unit_name = '3 North' or '3 North' = any(coalesce(related_units, '{}'))),
  count(*) filter (where unit_name = 'Postpartum' or 'Postpartum' = any(coalesce(related_units, '{}'))) from public.contacts;
