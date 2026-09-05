-- EVENT-AUDIENCE-2: preflight and verification for
-- supabase/migrations/20260908000000_aspire_event_audiences.sql
-- Run one section at a time in the SQL editor. Read-only except where marked.

-- ── 1. Preflight (BEFORE applying): what 'all' events exist, since they become {student} ──
select count(*) filter (where audience = 'all')      as will_backfill_to_student,
       count(*) filter (where audience = 'internal') as internal_only,
       count(*)                                       as total
  from public.aspire_events;

-- ── 1b. Preflight: the whole breakdown by legacy value ──
--    Preflight 1 on 2026-09-04 returned 1 'all' / 11 'internal' / 15 total, so three rows carry
--    another value ('cohort' or 'school'). Those were never delivered anywhere (AUDIENCE-1
--    matched 'all' exactly), so they stay internal-only: the backfill leaves them at '{}'.
select audience, status, count(*) as n
  from public.aspire_events
 group by audience, status
 order by audience, status;

-- ── 2. Verification (AFTER applying): column, constraint, index ──
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'aspire_events' and column_name = 'audiences')            as column_present,
  exists (select 1 from pg_constraint where conname = 'aspire_events_audiences_check')                              as check_present,
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'aspire_events_audiences_gin')      as index_present;

-- ── 3. Verification: the backfill did exactly the one thing it claims ──
--    Every former 'all' event is now {student}; no 'internal' event gained an audience;
--    nothing carries a value outside the allowed set (the CHECK would refuse it anyway).
select
  count(*) filter (where audience = 'all'      and audiences <> array['student']::text[]) as all_not_student_should_be_0,
  count(*) filter (where audience = 'internal' and audiences <> '{}'::text[])            as internal_with_audience_should_be_0,
  count(*) filter (where not (audiences <@ array['student','unit_leader','academic_partner','nursing_academic']::text[])) as outside_set_should_be_0
  from public.aspire_events;

-- ── 4. Verification: the derived legacy column stays coherent after the app writes the array ──
--    (run again a day after release; both counts should be 0). Legacy 'cohort'/'school' rows are
--    excluded: the app rewrites them to 'internal' or 'all' only when someone next saves them.
select
  count(*) filter (where cardinality(audiences) > 0 and audience <> 'all')      as set_but_legacy_not_all_should_be_0,
  count(*) filter (where cardinality(audiences) = 0 and audience = 'all')       as empty_but_legacy_all_should_be_0
  from public.aspire_events;
