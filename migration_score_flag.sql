-- Score flag migration
-- Adds score_flag and score_flag_message columns to track discrepancies
-- between majority-vote auto_recommendation and average composite score.
-- Run in Supabase SQL Editor.

ALTER TABLE students
ADD COLUMN IF NOT EXISTS score_flag         BOOLEAN DEFAULT FALSE;

ALTER TABLE students
ADD COLUMN IF NOT EXISTS score_flag_message TEXT    DEFAULT '';

-- Fix Wonsang Yun's record using the new majority-vote logic
UPDATE students
SET
  avg_cj_score          = 3.5,
  avg_pp_score          = 3.0,
  avg_ga_score          = 4.0,
  avg_composite_score   = 10.5,
  rubric_count          = 2,
  auto_recommendation   = 'Recommend',
  score_flag            = true,
  score_flag_message    = 'Average composite score is 10.5/15, below the Recommend threshold of 12/15. Review scores before finalizing.',
  interview_outcome     = 'Accepted',
  status                = 'Interviewed'
WHERE first_name ILIKE '%wonsang%'
  AND last_name  ILIKE '%yun%';
