-- ============================================================
-- ASPIRE Intelligence - Concurrency Protection Migration
-- ============================================================
--
-- WHAT THIS DOES:
--   1. Adds updated_at TIMESTAMPTZ column to tables that are missing it
--   2. Installs a trigger on each table so updated_at refreshes
--      automatically on every UPDATE (no application code needed)
--   3. Enables Supabase Realtime for the tables whose changes need
--      to propagate to other open browser tabs
--
-- BACKGROUND:
--   The optimistic concurrency control (OCC) feature in StudentSidePanel
--   sends a `loaded_updated_at` timestamp with every save.  The API handler
--   adds .eq('updated_at', loaded_updated_at) to the WHERE clause so it
--   only writes if the row hasn't changed since the user loaded it.
--   If 0 rows are updated, the API returns HTTP 409 and the UI shows a
--   conflict-resolution dialog instead of silently overwriting.
--
-- HOW TO RUN: Paste into the Supabase SQL Editor and execute.
-- All statements use IF NOT EXISTS / CREATE OR REPLACE so this is
-- safe to re-run.
--
-- ============================================================


-- ── Shared trigger function (created once, reused by all tables) ──────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ── students ─────────────────────────────────────────────────────────────────

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Back-fill existing rows that have NULL (migration ran after rows existed)
UPDATE students SET updated_at = NOW() WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at_students ON students;
CREATE TRIGGER set_updated_at_students
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ── units ─────────────────────────────────────────────────────────────────────

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE units SET updated_at = NOW() WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at_units ON units;
CREATE TRIGGER set_updated_at_units
  BEFORE UPDATE ON units
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ── interviewers ──────────────────────────────────────────────────────────────

ALTER TABLE interviewers
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE interviewers SET updated_at = NOW() WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at_interviewers ON interviewers;
CREATE TRIGGER set_updated_at_interviewers
  BEFORE UPDATE ON interviewers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ── preceptors ────────────────────────────────────────────────────────────────

ALTER TABLE preceptors
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE preceptors SET updated_at = NOW() WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at_preceptors ON preceptors;
CREATE TRIGGER set_updated_at_preceptors
  BEFORE UPDATE ON preceptors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ── ngrp_outcomes ─────────────────────────────────────────────────────────────

ALTER TABLE ngrp_outcomes
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE ngrp_outcomes SET updated_at = NOW() WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at_ngrp_outcomes ON ngrp_outcomes;
CREATE TRIGGER set_updated_at_ngrp_outcomes
  BEFORE UPDATE ON ngrp_outcomes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ── interview_rubrics ─────────────────────────────────────────────────────────
-- updated_at already exists on this table (set by RubricSession.jsx) but
-- adding an automatic trigger ensures it's always current even if the
-- application code changes.

DROP TRIGGER IF EXISTS set_updated_at_interview_rubrics ON interview_rubrics;
CREATE TRIGGER set_updated_at_interview_rubrics
  BEFORE UPDATE ON interview_rubrics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ── Supabase Realtime publication ─────────────────────────────────────────────
-- Adds the four tables whose changes must propagate to other open browser tabs.
-- If a table is already in the publication (default in newer Supabase projects),
-- the ADD TABLE call is a no-op.  The DO block swallows duplicate-object errors.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE students;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE interview_sessions;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE interview_rubrics;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE interview_slots;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;


-- ── Reload schema cache ───────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
