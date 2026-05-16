-- cleanup_duplicate_shifts.sql
-- Removes duplicate shift log entries keeping only the oldest (first submitted) per
-- (student_id, shift_date, total_hours, unit_name) group.
-- Run in Supabase SQL Editor after verifying the preview query below.

-- PREVIEW FIRST: See which rows will be deleted
select id, student_id, shift_date, total_hours, unit_name, submitted_at,
       row_number() over (
         partition by student_id, shift_date, total_hours, unit_name
         order by submitted_at asc, created_at asc
       ) as rn
from student_shift_logs
order by student_id, shift_date, submitted_at;

-- DELETE duplicates (keep the oldest per group)
delete from student_shift_logs
where id in (
  select id from (
    select id,
           row_number() over (
             partition by student_id, shift_date, total_hours, unit_name
             order by submitted_at asc, created_at asc
           ) as rn
    from student_shift_logs
  ) ranked
  where rn > 1
);

-- Verify no duplicates remain
select student_id, shift_date, total_hours, unit_name, count(*) as cnt
from student_shift_logs
group by student_id, shift_date, total_hours, unit_name
having count(*) > 1;
-- This query should return 0 rows if cleanup was successful.
