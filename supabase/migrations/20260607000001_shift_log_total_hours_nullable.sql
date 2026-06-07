-- Phase S.2.B2.A: relax total_hours NOT NULL on student_shift_logs
--
-- Allows future in_progress shift log rows to truthfully omit total_hours
-- until check-out (when actual hours are recorded). Existing completed rows
-- continue to have total_hours populated; the current /shift-log public form
-- always provides a non-NULL value.
--
-- This migration is:
--   - additive only (relaxes a constraint; does not add data restrictions)
--   - idempotent (ALTER COLUMN DROP NOT NULL is naturally idempotent;
--     running it twice on an already-nullable column is a no-op)
--   - preserves all existing data, indexes, RLS policies, and defaults
--   - does not modify status, attestation, shift_type, unit_name,
--     preceptor_name, or any other column
--   - does not change any default value or any other constraint
--   - does not touch the partial unique index uq_shift_logs_one_open_per_student
--
-- Production verification (Phase S.2.B2 inspection) confirmed:
--   - total_hours is the only column blocking a truthful in_progress row
--   - All existing rows have non-NULL total_hours; no backfill needed
--   - No CHECK constraints, triggers, or generated columns affect this change
--
-- Owner runs this manually in Supabase SQL Editor after review.

ALTER TABLE student_shift_logs
  ALTER COLUMN total_hours DROP NOT NULL;

-- End of migration
