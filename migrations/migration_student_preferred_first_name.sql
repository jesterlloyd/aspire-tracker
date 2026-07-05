-- ============================================================
-- ASPIRE Intelligence - STUDENT-PREFERRED-FIRST-NAME-1A
-- ============================================================
--
-- Adds an OPTIONAL preferred first name to students. This is a preferred FIRST name only
-- (the last name is unchanged), used for student-facing display/greetings/badges/emails in
-- later phases. It NEVER replaces the legal first_name/last_name, and the composed `name`
-- column remains server-controlled.
--
-- Additive + nullable. No backfill. No RLS / index / trigger changes.
--
-- DEPLOYMENT SEQUENCING (important): apply this in the Supabase SQL Editor and VERIFY the
-- column exists BEFORE pushing the code, because the code SELECTs preferred_first_name and
-- PostgREST errors on an unknown column.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute.
-- ============================================================

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS preferred_first_name text;

-- Reload PostgREST schema cache so the new column is immediately selectable.
NOTIFY pgrst, 'reload schema';

-- ── Verification (read-only) ──────────────────────────────────────────────────
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'students'
--   AND column_name = 'preferred_first_name';
