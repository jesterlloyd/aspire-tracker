-- ============================================================
-- STUDENT-FORM-INFORMATION-ACKNOWLEDGMENT
-- ============================================================
--
-- Adds the Student Information Use Acknowledgment fields captured on /student-form.
-- This is a product-level information notice — NOT FERPA consent, NOT a release of records.
--
-- Additive + nullable. Timestamp presence (student_form_privacy_ack_at) is the acknowledgment
-- signal (no boolean column). Existing students remain NULL ("Not on file"). No backfill.
--
-- DEPLOYMENT SEQUENCING (important): apply this in the Supabase SQL Editor and VERIFY (3 rows)
-- BEFORE pushing the code — the endpoint writes these columns and the profile selects them, and
-- PostgREST errors on an unknown column.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute.
-- ============================================================

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS student_form_privacy_ack_version text,
  ADD COLUMN IF NOT EXISTS student_form_privacy_ack_at      timestamptz,
  ADD COLUMN IF NOT EXISTS student_form_privacy_ack_name    text;

NOTIFY pgrst, 'reload schema';

-- ── Verification (read-only) ──────────────────────────────────────────────────
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'students'
--   AND column_name IN (
--     'student_form_privacy_ack_version',
--     'student_form_privacy_ack_at',
--     'student_form_privacy_ack_name'
--   )
-- ORDER BY column_name;
-- expect 3 rows
