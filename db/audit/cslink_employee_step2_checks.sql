-- CSLINK-SERVICENOW-1: read-only checks for the release. Nothing here writes.
-- Run one section at a time in the Supabase SQL editor.
--
-- The change: getCsLinkStatus (src/lib/utils.js) no longer treats cs_cedars_status = 'employee'
-- as Account Active on its own. Account Active now comes only from the Step 3 tick
-- (cs_stage1_complete). Employees auto-completed before this release carry that tick, so they
-- are unaffected. The rows below are the only ones whose displayed CS-Link status changes:
-- employee rows that the old shortcut alone was holding at Account Active.

-- 1. How many, by cohort. Expect 0 if every employee row went through the old auto-complete.
select c.name as cohort, count(*) as status_changes
from students s
join cohorts c on c.id = s.cohort_id
where s.cs_cedars_status = 'employee'
  and coalesce(s.cs_link_complete, false) = false
  and coalesce(s.cs_link_requested, false) = false
  and coalesce(s.cs_stage1_complete, false) = false
group by c.name
order by c.name;

-- 2. The rows themselves, with the status they will show after release (ids only).
select s.id, s.cohort_id, s.status as aspire_status, s.cs_stage1_action, s.cs_stage1_submitted,
       case when coalesce(s.cs_stage1_submitted, false) then 'Account Pending'
            else 'CS-Link Not Started' end as cslink_status_after
from students s
where s.cs_cedars_status = 'employee'
  and coalesce(s.cs_link_complete, false) = false
  and coalesce(s.cs_link_requested, false) = false
  and coalesce(s.cs_stage1_complete, false) = false
order by s.cohort_id, s.id;

-- 3. Context: every employee row by its CS-Link flags.
select s.cs_stage1_action, s.cs_stage1_submitted, s.cs_stage1_complete,
       s.cs_link_requested, s.cs_link_complete, count(*) as students
from students s
where s.cs_cedars_status = 'employee'
group by 1, 2, 3, 4, 5
order by students desc;
