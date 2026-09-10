-- CAPACITY-REBALANCE-1 discovery. READ-ONLY: nothing here writes.
-- Run ONE numbered section at a time in the Supabase SQL editor and paste each result back.
-- These results pin the exact unit-by-unit numbers into the apply script, which then refuses to
-- run if anything has moved in between.
--
-- The Owner's decision (2026-09-10): Fall 2026 placement is final (19 placed, 2 exited). Each
-- Fall unit keeps only the slots it used; units that hosted nobody leave Fall; every unused Fall
-- slot becomes that unit's Winter 2027 offer, replacing the 2026-08-29 carry-over, which was
-- taken when Fall had only 9 students placed.
--
-- Fall 2026   eedd91ec-ad6f-4df8-aa20-5c06b2889011
-- Winter 2027 52933615-cf6e-441f-ac68-130bdb6a0491

-- ── D1. The two cohorts ────────────────────────────────────────────────────────
select c.id, c.name, to_jsonb(c)->>'status' as status,
       to_jsonb(c)->>'accepting_submissions' as accepting_submissions
  from cohorts c
 where c.id in ('eedd91ec-ad6f-4df8-aa20-5c06b2889011', '52933615-cf6e-441f-ac68-130bdb6a0491')
 order by c.name;

-- ── D2. Fall 2026 students by status (expect 19 placed; the 2 exited without a unit) ─
select status, count(*) as students, count(matched_unit_id) as with_matched_unit
  from students
 where cohort_id = 'eedd91ec-ad6f-4df8-aa20-5c06b2889011'
 group by status
 order by status;

-- ── D3. Fall 2026 unit ledger: what each unit offered and what it used ───────────
select u.id, u.unit_name, u.is_participating, u.total_slots, u.slots_remaining,
       (select count(*) from students s where s.matched_unit_id = u.id) as matched_students,
       (select count(*) from students s where s.matched_unit_id = u.id
           and s.status in ('Not Proceeding', 'Declined')) as matched_but_exited,
       (select count(*) from student_unit_assignments a where a.unit_id = u.id
           and a.status in ('planned', 'active')) as live_assignments,
       (select count(*) from student_unit_assignments a where a.unit_id = u.id) as all_assignments,
       (select count(*) from cohort_unit_response_targets t where t.unit_id = u.id) as outreach_targets,
       (select count(*) from unit_cohort_responses r where r.unit_id = u.id) as response_rows,
       (select string_agg(r.response_status || ':' || coalesce(r.slots_offered::text, '-'), ', ')
          from unit_cohort_responses r where r.unit_id = u.id) as responses
  from units u
 where u.cohort_id = 'eedd91ec-ad6f-4df8-aa20-5c06b2889011'
 order by u.is_participating desc, u.unit_name;

-- ── D4. Winter 2027 unit ledger as it stands (the 2026-08-29 carry-over) ─────────
select u.id, u.unit_name, u.is_participating, u.total_slots, u.slots_remaining,
       to_jsonb(u)->>'created_at' as created_at, to_jsonb(u)->>'updated_at' as updated_at,
       (select count(*) from students s where s.matched_unit_id = u.id) as matched_students,
       (select count(*) from student_unit_assignments a where a.unit_id = u.id) as assignments,
       (select count(*) from cohort_unit_response_targets t where t.unit_id = u.id) as outreach_targets,
       (select count(*) from unit_cohort_responses r where r.unit_id = u.id) as response_rows,
       (select string_agg(r.response_status || ':' || coalesce(r.slots_offered::text, '-')
                          || ' @' || coalesce(to_jsonb(r)->>'last_updated_at', '?'), ', ')
          from unit_cohort_responses r where r.unit_id = u.id) as responses
  from units u
 where u.cohort_id = '52933615-cf6e-441f-ac68-130bdb6a0491'
 order by u.unit_name;

-- ── D5. The rebalance, previewed unit by unit (no writes) ─────────────────────────
with fall as (
  select u.id as fall_id, u.unit_name, u.is_participating, u.total_slots,
         (select count(*) from students s where s.matched_unit_id = u.id) as used
    from units u where u.cohort_id = 'eedd91ec-ad6f-4df8-aa20-5c06b2889011'
), winter as (
  select u.id as winter_id, u.unit_name, u.total_slots as winter_now
    from units u where u.cohort_id = '52933615-cf6e-441f-ac68-130bdb6a0491'
), joined as (
  select coalesce(f.unit_name, w.unit_name) as unit_name,
         f.fall_id, f.is_participating as fall_hosting, f.total_slots as fall_offered, f.used as fall_used,
         case when coalesce(f.is_participating, false)
              then greatest(f.total_slots - f.used, 0) else 0 end as unused,
         w.winter_id, w.winter_now
    from fall f
    full join winter w on lower(btrim(w.unit_name)) = lower(btrim(f.unit_name))
)
select unit_name, fall_hosting, fall_offered, fall_used, unused as winter_target, winter_now,
       case when fall_id is null then 'fall: (no Fall row)'
            when not coalesce(fall_hosting, false) and fall_used > 0 then 'CHECK: matched to a non-hosting unit'
            when not coalesce(fall_hosting, false) then 'fall: unchanged (not hosting)'
            when fall_used = 0 then 'fall: remove unit'
            when fall_used > fall_offered then 'CHECK: used more than offered'
            when fall_used < fall_offered then 'fall: shrink ' || fall_offered || ' -> ' || fall_used
            else 'fall: unchanged (full)' end as fall_action,
       case when winter_id is null and unused > 0 then 'winter: add ' || unused
            when winter_id is not null and unused = 0 then 'winter: remove (was ' || winter_now || ')'
            when winter_id is not null and winter_now <> unused then 'winter: set ' || winter_now || ' -> ' || unused
            when winter_id is not null then 'winter: unchanged ' || winter_now
            else '' end as winter_action
  from joined
 order by unit_name;

-- ── D6. Totals before and after ──────────────────────────────────────────────────
with fall as (
  select u.is_participating, u.total_slots,
         (select count(*) from students s where s.matched_unit_id = u.id) as used
    from units u where u.cohort_id = 'eedd91ec-ad6f-4df8-aa20-5c06b2889011'
)
select
  (select count(*) from fall where is_participating)                                   as fall_hosting_units_now,
  (select coalesce(sum(total_slots), 0) from fall where is_participating)              as fall_slots_now,
  (select coalesce(sum(used), 0) from fall)                                            as fall_used,
  (select count(*) from fall where is_participating and used > 0)                      as fall_hosting_units_after,
  (select coalesce(sum(least(used, total_slots)), 0) from fall where is_participating) as fall_slots_after,
  (select coalesce(sum(greatest(total_slots - used, 0)), 0) from fall where is_participating) as winter_slots_after,
  (select count(*) from fall where is_participating and total_slots - used > 0)        as winter_units_after,
  (select count(*) from units where cohort_id = '52933615-cf6e-441f-ac68-130bdb6a0491') as winter_units_now,
  (select coalesce(sum(total_slots), 0) from units
    where cohort_id = '52933615-cf6e-441f-ac68-130bdb6a0491')                           as winter_slots_now;

-- ── D7. Winter students whose unit picks name a unit that would leave Winter ──────
with fall as (
  select u.unit_name, u.is_participating, u.total_slots,
         (select count(*) from students s where s.matched_unit_id = u.id) as used
    from units u where u.cohort_id = 'eedd91ec-ad6f-4df8-aa20-5c06b2889011'
), leaving as (
  select w.unit_name
    from units w
    left join fall f on lower(btrim(f.unit_name)) = lower(btrim(w.unit_name))
   where w.cohort_id = '52933615-cf6e-441f-ac68-130bdb6a0491'
     and (f.unit_name is null or not f.is_participating or f.total_slots - f.used <= 0)
)
select s.id, s.status, s.unit_preference_1, s.unit_preference_2, s.unit_preference_3,
       (select string_agg(l.unit_name, ', ') from leaving l
         where lower(btrim(l.unit_name)) in (lower(btrim(coalesce(s.unit_preference_1, ''))),
                                             lower(btrim(coalesce(s.unit_preference_2, ''))),
                                             lower(btrim(coalesce(s.unit_preference_3, ''))))) as picks_leaving_winter
  from students s
 where s.cohort_id = '52933615-cf6e-441f-ac68-130bdb6a0491'
 order by s.id;

-- ── D8. Every foreign key that references units (from the live catalogue) ─────────
select conrelid::regclass as referencing_table, conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where confrelid = 'public.units'::regclass and contype = 'f'
 order by 1, 2;

-- ── D9. matches rows on Fall and Winter units (errors harmlessly if there is no matches table) ─
select c.name as cohort, count(*) as match_rows,
       count(*) filter (where s.matched_unit_id is distinct from m.unit_id) as rows_disagreeing_with_student
  from matches m
  join units u on u.id = m.unit_id
  join cohorts c on c.id = u.cohort_id
  left join students s on s.id = m.student_id
 where u.cohort_id in ('eedd91ec-ad6f-4df8-aa20-5c06b2889011', '52933615-cf6e-441f-ac68-130bdb6a0491')
 group by c.name
 order by c.name;
