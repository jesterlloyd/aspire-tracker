-- ============================================================================
-- MENTORSHIP-1: the mentorship session record
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester). Claude Code has applied NOTHING. ***
--
-- Owner decisions, 2026-09-14. Support becomes Before Residency | At the Start
-- of Residency | During Residency. During Residency is the mentorship record,
-- and it replaces Cedars-Sinai's mentorship platform, so a session needs more
-- than a date, a mentor name and a note.
--
-- WHAT THIS FILE DOES (ngrp_support_entries only; no new table)
--   1. session_format   in_person | virtual | phone
--   2. duration_minutes whole minutes, 5 to 480
--   3. topics           what the session covered (up to 2000 characters)
--   4. next_steps       what comes next (up to 2000 characters)
--   5. logged_by        aspire_team | mentor | resident, DEFAULT aspire_team.
--      Only the ASPIRE team logs today. mentor and resident are the future
--      self-logging paths (a cron link or a portal), named now so the column
--      never needs widening. Existing rows take the default.
--   6. chk_ngrp_support_session_details: the four session fields stay empty on
--      every activity that is not a mentorship session.
--
-- The lists match src/lib/ngrp/ngrpMentorshipSession.js (a test pins that).
-- Additive and transactional. Existing sessions keep their date, mentor and
-- note and read as logged by the ASPIRE team. No grant change: still no DELETE.
--
-- SAFE IN EITHER DEPLOY ORDER: before it is applied, Before Residency records
-- as today, the session log shows date, mentor and note only, and logging a new
-- session says the details are not available yet.
--
-- PREFLIGHT / POSTFLIGHT: db/audit/ngrp_mentorship_session_details_checks.sql

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.ngrp_support_entries') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: ngrp_support_entries is missing (20260914000000 first)';
  END IF;
END
$pre$;

ALTER TABLE public.ngrp_support_entries
  ADD COLUMN IF NOT EXISTS session_format text
    CHECK (session_format IS NULL OR session_format IN ('in_person', 'virtual', 'phone')),
  ADD COLUMN IF NOT EXISTS duration_minutes integer
    CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 480),
  ADD COLUMN IF NOT EXISTS topics text
    CHECK (topics IS NULL OR (btrim(topics) <> '' AND char_length(topics) <= 2000)),
  ADD COLUMN IF NOT EXISTS next_steps text
    CHECK (next_steps IS NULL OR (btrim(next_steps) <> '' AND char_length(next_steps) <= 2000)),
  ADD COLUMN IF NOT EXISTS logged_by text NOT NULL DEFAULT 'aspire_team'
    CHECK (logged_by IN ('aspire_team', 'mentor', 'resident'));

ALTER TABLE public.ngrp_support_entries
  DROP CONSTRAINT IF EXISTS chk_ngrp_support_session_details;
ALTER TABLE public.ngrp_support_entries
  ADD CONSTRAINT chk_ngrp_support_session_details CHECK (
    activity = 'mentorship_session'
    OR (session_format IS NULL AND duration_minutes IS NULL AND topics IS NULL AND next_steps IS NULL)
  );

COMMENT ON COLUMN public.ngrp_support_entries.session_format IS
  'MENTORSHIP-1: how a mentorship session happened (in_person, virtual, phone).';
COMMENT ON COLUMN public.ngrp_support_entries.duration_minutes IS
  'MENTORSHIP-1: mentorship session length in minutes.';
COMMENT ON COLUMN public.ngrp_support_entries.topics IS
  'MENTORSHIP-1: what the mentorship session covered.';
COMMENT ON COLUMN public.ngrp_support_entries.next_steps IS
  'MENTORSHIP-1: agreed next steps after the mentorship session.';
COMMENT ON COLUMN public.ngrp_support_entries.logged_by IS
  'MENTORSHIP-1: who wrote the record. aspire_team today; mentor and resident are the future self-logging paths.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── ROLLBACK (only while no session has details recorded) ────────────────────
-- BEGIN;
--   ALTER TABLE public.ngrp_support_entries DROP CONSTRAINT IF EXISTS chk_ngrp_support_session_details;
--   ALTER TABLE public.ngrp_support_entries
--     DROP COLUMN IF EXISTS session_format,
--     DROP COLUMN IF EXISTS duration_minutes,
--     DROP COLUMN IF EXISTS topics,
--     DROP COLUMN IF EXISTS next_steps,
--     DROP COLUMN IF EXISTS logged_by;
--   NOTIFY pgrst, 'reload schema';
-- COMMIT;
