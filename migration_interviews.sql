-- ================================================================
-- ASPIRE Interview System
-- Creates interviewers + interviews tables, adds columns to students
-- Run in Supabase SQL Editor before deploying
-- ================================================================

-- ── Interviewers ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interviewers (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT        NOT NULL,
  is_active  BOOLEAN     DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO interviewers (name) VALUES
  ('Jester Lloyd Bautista'),
  ('Krystal Rodriguez'),
  ('Millicent De Jesus'),
  ('Jennifer Gidaya'),
  ('Keith Hoshal'),
  ('Vanessa Lopez'),
  ('Robert Viana'),
  ('Arturo Gomez');

-- ── Interviews ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS interviews (
  id                         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id                 UUID        REFERENCES students(id),
  cohort_id                  UUID        REFERENCES cohorts(id),
  interview_date             TEXT        DEFAULT '',
  interviewer_name           TEXT        DEFAULT '',
  unit_preferences_rationale TEXT        DEFAULT '',
  cj_question_asked          TEXT        DEFAULT '',
  cj_score                   INTEGER     DEFAULT 0,
  cj_notes                   TEXT        DEFAULT '',
  pp_question_asked          TEXT        DEFAULT '',
  pp_score                   INTEGER     DEFAULT 0,
  pp_notes                   TEXT        DEFAULT '',
  ga_question_asked          TEXT        DEFAULT '',
  ga_score                   INTEGER     DEFAULT 0,
  ga_notes                   TEXT        DEFAULT '',
  student_questions          TEXT        DEFAULT '',
  overall_recommendation     TEXT        DEFAULT '',
  suggested_unit             TEXT        DEFAULT '',
  summary_comments           TEXT        DEFAULT '',
  composite_score            INTEGER     DEFAULT 0,
  status                     TEXT        DEFAULT 'In Progress',
  created_at                 TIMESTAMPTZ DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ DEFAULT NOW()
);

-- ── New columns on students ───────────────────────────────────
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS interview_id               UUID    REFERENCES interviews(id),
  ADD COLUMN IF NOT EXISTS composite_score            INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cj_score                   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pp_score                   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ga_score                   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS interviewer_name           TEXT    DEFAULT '',
  ADD COLUMN IF NOT EXISTS interview_date             TEXT    DEFAULT '',
  ADD COLUMN IF NOT EXISTS interviewer_suggested_unit TEXT    DEFAULT '',
  ADD COLUMN IF NOT EXISTS overall_recommendation     TEXT    DEFAULT '',
  ADD COLUMN IF NOT EXISTS summary_comments           TEXT    DEFAULT '';

-- ── RLS: interviewers ────────────────────────────────────────
ALTER TABLE interviewers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon select on interviewers"
  ON interviewers FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert on interviewers"
  ON interviewers FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon update on interviewers"
  ON interviewers FOR UPDATE TO anon USING (true);

-- ── RLS: interviews ──────────────────────────────────────────
ALTER TABLE interviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon select on interviews"
  ON interviews FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert on interviews"
  ON interviews FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon update on interviews"
  ON interviews FOR UPDATE TO anon USING (true);
