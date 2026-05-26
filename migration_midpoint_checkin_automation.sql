-- Migration: add midpoint_checkin_automation_enabled column to cohorts
--
-- Run in Supabase SQL Editor.
-- Safe to re-run (ADD COLUMN IF NOT EXISTS, UPDATE is idempotent).

ALTER TABLE cohorts
  ADD COLUMN IF NOT EXISTS midpoint_checkin_automation_enabled BOOLEAN DEFAULT false;

-- Enable automation for Summer 2026 cohort
UPDATE cohorts
  SET midpoint_checkin_automation_enabled = true
  WHERE id = '7f4e0a67-ccef-498c-80f5-1e5c7c681bd1';

-- Verification:
-- SELECT id, name, midpoint_checkin_automation_enabled
-- FROM cohorts
-- ORDER BY created_at DESC;
