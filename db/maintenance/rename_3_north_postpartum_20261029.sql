-- UNIT-RENAME-POSTPARTUM-1 (Owner, 2026-10-29): "change 3 North to Postpartum (everywhere)".
-- Unit names are stored as text, so the live rows are renamed with the catalog
-- (src/lib/unitCatalog.js). Owner-gated; PRE/POST in db/audit/rename_3_north_postpartum_checks.sql.
-- Not renamed, on purpose: notification_log (sent mail) and
-- cohort_unit_response_target_events (append-only history) keep what was true then.
-- cohort_unit_response_targets.unit_key_canon is GENERATED and follows unit_key.
begin;
update public.units                        set unit_name = 'Postpartum' where unit_name = '3 North';
update public.ngrp_cycle_units             set unit_name = 'Postpartum' where unit_name = '3 North';
update public.unit_cohort_responses        set unit_name = 'Postpartum' where unit_name = '3 North';
update public.cohort_unit_response_targets set unit_name = 'Postpartum' where unit_name = '3 North';
update public.cohort_unit_response_targets set unit_key  = 'Postpartum' where unit_key  = '3 North';
update public.contacts                     set unit_name = 'Postpartum' where unit_name = '3 North';
update public.contacts set related_units = array_replace(related_units, '3 North', 'Postpartum')
 where '3 North' = any(related_units);
commit;
