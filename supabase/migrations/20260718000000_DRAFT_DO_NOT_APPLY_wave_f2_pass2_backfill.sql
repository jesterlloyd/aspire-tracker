-- ============================================================================
-- WAVE F-2 PASS 2 (DRAFT): backfill legacy public URLs -> canonical object paths
-- ============================================================================
-- *** DO NOT APPLY. This is a gated draft prepared during Pass 1.             ***
-- *** It is a DATA migration only: it changes no bucket setting and no        ***
-- *** storage policy, and it does not remove public access. Apply only AFTER  ***
-- *** Pass 1 is deployed and manually accepted, and take a students snapshot  ***
-- *** first.                                                                  ***
--
-- Purpose
--   students.resume_url / headshot_url currently hold either a full public URL
--   (legacy) or a canonical object path (new Pass 1 uploads). This normalizes the
--   legacy full URLs to the canonical path so Pass 3 can privatize the bucket
--   cleanly. It is deterministic: the path is derived from the existing URL, never
--   guessed. Rows already storing a path are left untouched.
--
-- Compatibility window
--   The Pass 1 resolver reads BOTH forms, so this backfill is safe to run (or not
--   run) independently of any code deploy, and Pass 3 does not depend on it having
--   run. Keep the snapshot until Pass 3 is verified so this is reversible.
--
-- Transformation
--   From: https://<host>/storage/v1/object/public/student-files/<cohort>/<student>/<file>[?query]
--   To:   <cohort>/<student>/<file>
--   (strip everything up to and including '/object/public/student-files/', then
--    drop any '?...' query string).
--
-- Run the ENTIRE file as one block. Transactional and idempotent (re-running it
-- is a no-op once no public-URL values remain).
-- ============================================================================

BEGIN;

-- ── Resume ───────────────────────────────────────────────────────────────────
UPDATE students
SET resume_url = split_part(
      substring(resume_url FROM '/object/public/student-files/(.*)$'), '?', 1)
WHERE resume_url LIKE '%/object/public/student-files/%';

-- ── Headshot ─────────────────────────────────────────────────────────────────
UPDATE students
SET headshot_url = split_part(
      substring(headshot_url FROM '/object/public/student-files/(.*)$'), '?', 1)
WHERE headshot_url LIKE '%/object/public/student-files/%';

COMMIT;

-- ── Verification ─────────────────────────────────────────────────────────────
-- 1. No public-URL values remain (expected 0 for each):
--   SELECT count(*) FROM students WHERE resume_url   LIKE '%/object/public/%';
--   SELECT count(*) FROM students WHERE headshot_url LIKE '%/object/public/%';
-- 2. Remaining non-empty values are two-slash paths (cohort/student/file):
--   SELECT count(*) FROM students
--   WHERE resume_url <> '' AND resume_url IS NOT NULL
--     AND (length(resume_url) - length(replace(resume_url, '/', ''))) <> 2;
--   -- expected 0 (same check for headshot_url)

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- There is no in-place inverse (the original host is not retained). Restore the
-- affected columns from the pre-backfill students snapshot if needed.
