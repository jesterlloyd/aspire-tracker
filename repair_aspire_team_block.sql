-- Repair orphaned interview_availability_blocks whose interviewer_name = 'ASPIRE Team'
-- Run the diagnostic query first, then the repair, then the verification.
-- Tell Jester to run this after deploying the application code changes.

-- ── Step 1: Diagnostic - see the scope ───────────────────────────────────────
select
  b.id,
  b.block_date,
  b.start_time,
  b.end_time,
  b.interviewer_name,
  b.created_by_user_id,
  up.full_name as creator_name
from interview_availability_blocks b
left join user_profiles up on up.id = b.created_by_user_id
where b.interviewer_name = 'ASPIRE Team' or b.interviewer_name is null
order by b.block_date, b.start_time;

-- ── Step 2: Auto-repair blocks - set interviewer_name from the creator ────────
-- (Only runs where created_by_user_id is known; leaves null-creator rows alone)
update interview_availability_blocks
set interviewer_name = (
  select full_name
  from user_profiles
  where id = interview_availability_blocks.created_by_user_id
)
where (interviewer_name = 'ASPIRE Team' or interviewer_name is null)
  and created_by_user_id is not null;

-- ── Step 3: Propagate corrected name to the matching slots ───────────────────
update interview_slots
set interviewer_name = (
  select interviewer_name
  from interview_availability_blocks
  where id = interview_slots.block_id
)
where interviewer_name = 'ASPIRE Team'
   or interviewer_name is null;

-- ── Step 4: Verify - should return zero rows ─────────────────────────────────
select id, block_date, start_time, interviewer_name
from interview_availability_blocks
where lower(interviewer_name) like '%aspire%'
   or interviewer_name is null;
