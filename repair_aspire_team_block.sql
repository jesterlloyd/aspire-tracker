-- Repair orphaned availability blocks whose interviewer_name is 'ASPIRE Team'
-- or NULL (meaning the interviewer was never properly attributed).
--
-- BEFORE RUNNING:
--   1. Query the blocks to identify which ones need repair:
--        select id, block_date, start_time, end_time, interviewer_name, created_by_user_id
--        from interview_availability_blocks
--        where interviewer_name = 'ASPIRE Team' or interviewer_name is null
--        order by block_date;
--
--   2. For each block, identify the real interviewer (check created_by_user_id
--      against user_profiles, or cross-reference calendar records).
--
--   3. Replace ACTUAL_INTERVIEWER_NAME below with the correct full_name string,
--      and BLOCK_ID with the specific block ID if you need per-block precision.
--
-- Option A: Repair all "ASPIRE Team" blocks in bulk (use only if all belong to one person)
-- UPDATE interview_availability_blocks
-- SET interviewer_name = 'ACTUAL_INTERVIEWER_NAME'
-- WHERE interviewer_name = 'ASPIRE Team';
--
-- UPDATE interview_slots
-- SET interviewer_name = 'ACTUAL_INTERVIEWER_NAME'
-- WHERE interviewer_name = 'ASPIRE Team';
--
-- Option B: Repair a specific block (safest)
-- UPDATE interview_availability_blocks
-- SET interviewer_name = 'ACTUAL_INTERVIEWER_NAME'
-- WHERE id = 'BLOCK_ID';
--
-- UPDATE interview_slots
-- SET interviewer_name = 'ACTUAL_INTERVIEWER_NAME'
-- WHERE block_id = 'BLOCK_ID';

-- Diagnostic query (run this first to see the scope):
select
  b.id,
  b.block_date,
  b.start_time,
  b.end_time,
  b.interviewer_name,
  b.created_by_user_id,
  up.full_name as creator_name,
  count(s.id) as slot_count
from interview_availability_blocks b
left join user_profiles up on up.id = b.created_by_user_id
left join interview_slots s on s.block_id = b.id
where b.interviewer_name = 'ASPIRE Team' or b.interviewer_name is null
group by b.id, b.block_date, b.start_time, b.end_time, b.interviewer_name, b.created_by_user_id, up.full_name
order by b.block_date;
