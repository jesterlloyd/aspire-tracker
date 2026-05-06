-- Interview Sessions Migration
-- Creates the shared interview_sessions table that coordinates question locking
-- across simultaneous rubrics for the same student.
-- Run in Supabase SQL Editor, then enable Realtime for interview_sessions in the dashboard.

CREATE TABLE IF NOT EXISTS interview_sessions (
  id                    UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id            UUID          REFERENCES students(id) ON DELETE CASCADE,
  cohort_id             UUID          REFERENCES cohorts(id),
  session_number        INTEGER       DEFAULT 1,
  cj_question_index     INTEGER       DEFAULT NULL,
  cj_question_text      TEXT          DEFAULT '',
  cj_locked_by          TEXT          DEFAULT '',
  pp_question_index     INTEGER       DEFAULT NULL,
  pp_question_text      TEXT          DEFAULT '',
  pp_locked_by          TEXT          DEFAULT '',
  ga_question_index     INTEGER       DEFAULT NULL,
  ga_question_text      TEXT          DEFAULT '',
  ga_locked_by          TEXT          DEFAULT '',
  created_at            TIMESTAMPTZ   DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   DEFAULT NOW()
);

ALTER TABLE interview_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_sessions" ON interview_sessions
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Notes:
-- session_number=1 is created when the first rubric page is opened for a student.
-- session_number increments when all existing rubrics are Completed and a new rubric page is opened.
-- question_index: NULL = not yet locked, 0 = Other/Custom, 1-5 = preset question (1-based array index).
-- locked_by: name of the first interviewer to select the question for that domain.
-- Enable Realtime for this table in Supabase Dashboard → Database → Replication → interview_sessions.
