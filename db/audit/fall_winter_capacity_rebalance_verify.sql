-- CAPACITY-REBALANCE-1 verification. READ-ONLY. Run AFTER
-- supabase/migrations/20260910000000_fall_winter_capacity_rebalance.sql.
-- Run one numbered section at a time; each returns rows. (The copies at the bottom of the
-- apply script are commented out, so running them there returns nothing.)

-- ── V1. The Snapshot numbers, plus proof the script committed ────────────────────
-- Expect: Fall 2026   14 hosting units, 19 total, 19 filled, 0 open
--         Winter 2027 10 hosting units, 14 total, 0 filled, 14 open
--         backup_rows about 42 (19 units + 19 responses + the deactivated targets).
-- If this errors with "relation ops_backup.capacity_rebalance_20260910 does not exist",
-- the apply script did not commit.
select c.name,
       count(*) filter (where u.is_participating)                          as hosting_units,
       coalesce(sum(u.total_slots) filter (where u.is_participating), 0)   as total_slots,
       (select count(*) from students s
         where s.cohort_id = c.id and s.matched_unit_id is not null)        as slots_filled,
       coalesce(sum(u.total_slots) filter (where u.is_participating), 0)
         - (select count(*) from students s
             where s.cohort_id = c.id and s.matched_unit_id is not null)    as open_slots,
       (select count(*) from ops_backup.capacity_rebalance_20260910)        as backup_rows
  from cohorts c
  join units u on u.cohort_id = c.id
 where c.id in ('eedd91ec-ad6f-4df8-aa20-5c06b2889011', '52933615-cf6e-441f-ac68-130bdb6a0491')
 group by c.id, c.name
 order by c.name;

-- ── V2. Unit by unit, both cohorts: slots, placements and the response offer agree ─
select c.name as cohort, u.unit_name, u.is_participating, u.total_slots, u.slots_remaining,
       (select count(*) from students s where s.matched_unit_id = u.id) as placed,
       r.response_status, r.slots_offered
  from units u
  join cohorts c on c.id = u.cohort_id
  left join unit_cohort_responses r on r.unit_id = u.id
 where u.cohort_id in ('eedd91ec-ad6f-4df8-aa20-5c06b2889011', '52933615-cf6e-441f-ac68-130bdb6a0491')
 order by c.name, u.is_participating desc, u.unit_name;

-- ── V3. The Fall outreach targets it deactivated, with their logged events ────────
select t.unit_name, t.is_active, t.removed_at, e.action, e.occurred_at
  from cohort_unit_response_targets t
  left join cohort_unit_response_target_events e on e.target_id = t.id and e.action = 'deactivated'
 where t.id in (select (row_data->>'id')::uuid from ops_backup.capacity_rebalance_20260910
                 where source_table = 'cohort_unit_response_targets');

-- ── V4. What the backup holds (expect units 19; responses 14 delete + 5 update; targets) ─
select source_table, action, count(*)
  from ops_backup.capacity_rebalance_20260910
 group by 1, 2
 order by 1, 2;
