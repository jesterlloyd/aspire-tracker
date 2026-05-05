-- Interview Rubric Redesign Migration
-- Creates interview_rubrics table (one rubric per interviewer per student),
-- migrates existing interviews data, and adds scheduling/scoring columns to students.
-- Run in Supabase SQL Editor before deploying.

-- ── New interview_rubrics table ───────────────────────────────

CREATE TABLE IF NOT EXISTS interview_rubrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  cohort_id UUID REFERENCES cohorts(id),
  interviewer_name TEXT DEFAULT '',
  interview_date TEXT DEFAULT '',
  interview_time TEXT DEFAULT '',
  unit_preferences_rationale TEXT DEFAULT '',
  cj_question_asked TEXT DEFAULT '',
  cj_score INTEGER DEFAULT 0,
  cj_notes TEXT DEFAULT '',
  pp_question_asked TEXT DEFAULT '',
  pp_score INTEGER DEFAULT 0,
  pp_notes TEXT DEFAULT '',
  ga_question_asked TEXT DEFAULT '',
  ga_score INTEGER DEFAULT 0,
  ga_notes TEXT DEFAULT '',
  student_questions TEXT DEFAULT '',
  individual_recommendation TEXT DEFAULT '',
  suggested_unit TEXT DEFAULT '',
  summary_comments TEXT DEFAULT '',
  composite_score INTEGER DEFAULT 0,
  status TEXT DEFAULT 'In Progress',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE interview_rubrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_rubrics" ON interview_rubrics
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── Migrate existing interviews → interview_rubrics ───────────

INSERT INTO interview_rubrics (
  student_id, cohort_id, interviewer_name, interview_date,
  cj_question_asked, cj_score, cj_notes,
  pp_question_asked, pp_score, pp_notes,
  ga_question_asked, ga_score, ga_notes,
  student_questions, individual_recommendation,
  suggested_unit, summary_comments, composite_score, status
)
SELECT
  student_id, cohort_id, interviewer_name, interview_date,
  cj_question_asked, cj_score, cj_notes,
  pp_question_asked, pp_score, pp_notes,
  ga_question_asked, ga_score, ga_notes,
  student_questions, overall_recommendation,
  suggested_unit, summary_comments, composite_score, status
FROM interviews
WHERE student_id IS NOT NULL;

-- ── New columns on students ───────────────────────────────────

ALTER TABLE students ADD COLUMN IF NOT EXISTS interview_scheduled_date TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS interview_scheduled_time TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS interview_duration_minutes INTEGER DEFAULT 45;
ALTER TABLE students ADD COLUMN IF NOT EXISTS flagged_for_second_interview BOOLEAN DEFAULT FALSE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS flag_note TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS avg_cj_score DECIMAL(4,2) DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS avg_pp_score DECIMAL(4,2) DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS avg_ga_score DECIMAL(4,2) DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS avg_composite_score DECIMAL(4,2) DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS auto_recommendation TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS rubric_count INTEGER DEFAULT 0;
