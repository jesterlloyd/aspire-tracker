-- ============================================================
-- ASPIRE Intelligence — AVAILABILITY-CANON-1B: Availability Capture
-- ============================================================
--
-- Adds lightweight, NULLABLE rotation-availability columns to the two canonical
-- source tables (Option A from the 1A discovery):
--   * cohort_school_rotations  → COORDINATOR-owned, captured via /school-form
--   * students                 → STUDENT-owned, captured via /student-form
--
-- This phase is DATA MODEL + CAPTURE only. No risk-flag storage, no display logic.
--
-- Encoding conventions (validated in form/server code, not by DB CHECKs, per repo style):
--   * weekday jsonb arrays use the exact strings: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
--   * date    jsonb arrays use plain ISO strings:  ["2026-06-28","2026-06-29"]
--
-- SAFETY: additive + nullable only. No existing column/row is altered, so all
-- existing students and rotations remain valid (availability simply reads NULL).
-- students.shift_availability (the day/night preference) is left untouched.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute. Wrapped in BEGIN/COMMIT.
-- ============================================================

BEGIN;


-- ────────────────────────────────────────────────────────────────────────────
-- PART A: cohort_school_rotations — coordinator-owned availability (/school-form)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE cohort_school_rotations
  ADD COLUMN IF NOT EXISTS unavailable_weekdays jsonb,    -- e.g. ["Mon","Tue"]
  ADD COLUMN IF NOT EXISTS min_days_per_week    integer,  -- 1..7 (validated app-side)
  ADD COLUMN IF NOT EXISTS weekends_allowed     boolean,
  ADD COLUMN IF NOT EXISTS nights_allowed       boolean,
  ADD COLUMN IF NOT EXISTS blackout_dates       jsonb,    -- e.g. ["2026-06-28","2026-06-29"]
  ADD COLUMN IF NOT EXISTS scheduling_notes     text;


-- ────────────────────────────────────────────────────────────────────────────
-- PART B: students — student-owned availability (/student-form)
-- ────────────────────────────────────────────────────────────────────────────
-- NOTE: students.shift_availability (day/night preference) is intentionally NOT
-- changed here; these columns are additive structured availability.
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS unavailable_weekdays        jsonb,   -- e.g. ["Mon","Tue"]
  ADD COLUMN IF NOT EXISTS unavailable_weekdays_reason text,
  ADD COLUMN IF NOT EXISTS personal_blackout_dates     jsonb,   -- e.g. ["2026-06-28"]
  ADD COLUMN IF NOT EXISTS weekends_available          boolean,
  ADD COLUMN IF NOT EXISTS nights_available            boolean,
  ADD COLUMN IF NOT EXISTS preferred_days              jsonb,   -- e.g. ["Wed","Thu"]
  ADD COLUMN IF NOT EXISTS availability_notes          text,
  ADD COLUMN IF NOT EXISTS availability_ack            boolean;


-- ────────────────────────────────────────────────────────────────────────────
-- Reload PostgREST schema cache so the new columns are immediately writable.
-- ────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


COMMIT;
