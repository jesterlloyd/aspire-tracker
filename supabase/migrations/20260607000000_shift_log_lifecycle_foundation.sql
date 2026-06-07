-- Phase S.2.A: Shift Log lifecycle schema foundation
--
-- Adds additive, nullable columns to student_shift_logs to support a FUTURE
-- two-stage check-in/check-out lifecycle. No frontend or API code references
-- these columns yet. The existing one-stage /shift-log form continues to work
-- unchanged; new inserts get lifecycle_state='completed' via the column default.
-- Existing historical rows are backfilled to 'completed'.
--
-- Owner runs this manually in Supabase SQL Editor after review.
--
-- This migration is:
--   - additive only (no DROP, no DELETE)
--   - idempotent (every statement uses IF NOT EXISTS)
--   - preserves all existing data, columns, indexes, and RLS policies
--   - does NOT modify the existing 'status' (approval) column or its taxonomy
--   - does NOT activate any new lifecycle behavior
--   - adds ONE partial unique index (the one-open-shift-per-student rule), which
--     also serves the primary open-shift lookup
--     (WHERE student_id = ? AND lifecycle_state = 'in_progress')

-- 1. lifecycle_state — nullable, DEFAULT 'completed'.
--    New inserts from the current form get 'completed' automatically; existing
--    rows are backfilled in step 4.
ALTER TABLE student_shift_logs
  ADD COLUMN IF NOT EXISTS lifecycle_state text DEFAULT 'completed';

-- 2. Check-in / check-out timestamps (nullable)
ALTER TABLE student_shift_logs
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;

ALTER TABLE student_shift_logs
  ADD COLUMN IF NOT EXISTS checked_out_at timestamptz;

-- 3. Planned-value columns captured at check-in (nullable)
ALTER TABLE student_shift_logs
  ADD COLUMN IF NOT EXISTS expected_hours decimal(4,2);

ALTER TABLE student_shift_logs
  ADD COLUMN IF NOT EXISTS planned_unit_name text;

ALTER TABLE student_shift_logs
  ADD COLUMN IF NOT EXISTS planned_preceptor_name text;

ALTER TABLE student_shift_logs
  ADD COLUMN IF NOT EXISTS planned_shift_type text;

-- 4. Backfill existing rows to 'completed'.
--    Adding a column with a DEFAULT already sets existing rows in PostgreSQL;
--    this guarded UPDATE is a safety net for any NULL rows. Re-running is a no-op.
UPDATE student_shift_logs
   SET lifecycle_state = 'completed'
 WHERE lifecycle_state IS NULL;

-- 5. Partial UNIQUE index — enforces ONE open shift per student and also serves
--    the open-shift lookup (WHERE student_id = ? AND lifecycle_state = 'in_progress').
--    Only 'in_progress' rows are indexed; unlimited 'completed' rows per student
--    are unaffected. A single index covers both the constraint and the query
--    (no separate non-unique lookup index is created).
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_logs_one_open_per_student
  ON student_shift_logs(student_id)
  WHERE lifecycle_state = 'in_progress';

-- End of migration
