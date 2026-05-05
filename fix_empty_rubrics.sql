-- Deletes rubric records with no meaningful data (all scores 0, no questions answered).
-- Run this in Supabase SQL Editor before deploying the fix.

DELETE FROM interview_rubrics
WHERE cj_score = 0
AND pp_score = 0
AND ga_score = 0
AND (cj_question_asked IS NULL OR cj_question_asked = '')
AND (pp_question_asked IS NULL OR pp_question_asked = '')
AND (ga_question_asked IS NULL OR ga_question_asked = '');
