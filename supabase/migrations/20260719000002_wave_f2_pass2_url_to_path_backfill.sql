-- ============================================================================
-- WAVE F-2 PASS 2: student-files public URL -> canonical object path backfill
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester) in the Supabase SQL editor, AFTER running the ***
-- *** read-only preflight in db/audit/wave_f2_pass2_preflight_and_verification.sql ***
-- *** and confirming its counts. This is a DATA migration only. It does NOT touch  ***
-- *** any storage object, does NOT change bucket privacy, and does NOT change any  ***
-- *** storage policy or authorization. It changes no other table than students and ***
-- *** its own backup table. Run the ENTIRE file once (transactional, idempotent).  ***
--
-- Supersedes and replaces the earlier placeholder draft
--   supabase/migrations/20260718000000_DRAFT_DO_NOT_APPLY_wave_f2_pass2_backfill.sql
--   (removed on this branch). Do not apply that draft.
--
-- What it does
--   For students.resume_url and students.headshot_url, it converts values that are
--   recognized public URLs for THIS Supabase project's student-files bucket into the
--   canonical object path:
--     https://<host>/storage/v1/object/public/student-files/<cohort>/<student>/resume.pdf
--     -> <cohort>/<student>/resume.pdf
--   The compatibility resolver (lib/server/studentFiles.js parseStoredFileRef) already
--   resolves BOTH forms to the same object path and keeps doing so after this backfill,
--   so file access is identical before and after. Pass 2 does NOT remove the resolver.
--
-- Recognition (mirrors the server resolver; conservative on purpose)
--   Converts a value that:
--     (a) contains '/storage/v1/object/public/student-files/'  (a public URL for the
--         student-files bucket -- NOT a signed '/object/sign/' URL, NOT another bucket,
--         NOT an arbitrary external URL, NOT an already-canonical path), AND
--     (b) whose extracted path (segment after the marker, with any '?query'/'#fragment'
--         dropped) matches the exact canonical shape
--         <uuid>/<uuid>/(resume|headshot).<ext>  for the matching column.
--   Not touched (correctly): other buckets, signed URLs, arbitrary external URLs,
--   malformed URLs, already-canonical paths, empty strings, and NULLs.
--
-- CONSISTENCY GATE (so "zero public URLs remaining" is exact, never a silent skip):
--   A student-files public URL whose extracted path is NOT canonical (for example a
--   URL-encoded or otherwise non <uuid>/<uuid>/<kind>.<ext> object name) is NOT
--   auto-converted here, because converting an encoded path to a raw stored path
--   could point at a non-existent object key. PREFLIGHT query 5 lists every such
--   value. DO NOT APPLY this migration while preflight 5 returns any rows: resolve
--   those values manually first (or extend this migration with a decode you have
--   reviewed). Only when preflight 5 is empty does this migration convert EVERY
--   student-files public URL, so the post-apply verification "zero public URLs
--   remaining" holds exactly. The migration is host-agnostic like the resolver;
--   preflight 6b lists distinct hosts so you confirm every value belongs to this
--   project (and preflight 6a lists any value pointing outside student-files) before
--   running.
--
-- Rollback information is preserved: every changed value is snapshotted into
--   public.wave_f2_pass2_url_backfill_backup(student_id, column_name, old_value,
--   new_value) before the update, so a full restore is possible (see Rollback below).
-- ============================================================================

BEGIN;

-- ── 0. Rollback backup table (additive, server-mediated only) ────────────────
CREATE TABLE IF NOT EXISTS public.wave_f2_pass2_url_backfill_backup (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   uuid        NOT NULL,
  column_name  text        NOT NULL,   -- 'resume_url' | 'headshot_url'
  old_value    text        NOT NULL,   -- the pre-conversion public URL
  new_value    text        NOT NULL,   -- the canonical path written
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wave_f2_pass2_url_backfill_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wave_f2_pass2_url_backfill_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.wave_f2_pass2_url_backfill_backup TO service_role;

-- ── 1. RESUME: snapshot the rows about to change, then convert ───────────────
-- Extraction: everything after the last marker, minus any query/fragment.
-- Gate: extracted path must be <uuid>/<uuid>/resume.<ext>.
WITH recognized AS (
  SELECT
    s.id AS student_id,
    s.resume_url AS old_value,
    split_part(split_part(
      regexp_replace(s.resume_url, '^.*/storage/v1/object/public/student-files/', ''),
      '?', 1), '#', 1) AS new_value
  FROM public.students s
  WHERE s.resume_url ~ '/storage/v1/object/public/student-files/'
)
INSERT INTO public.wave_f2_pass2_url_backfill_backup (student_id, column_name, old_value, new_value)
SELECT r.student_id, 'resume_url', r.old_value, r.new_value
FROM recognized r
WHERE r.new_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/resume\.[a-z0-9]+$'
  AND NOT EXISTS (
    SELECT 1 FROM public.wave_f2_pass2_url_backfill_backup b
    WHERE b.student_id = r.student_id AND b.column_name = 'resume_url' AND b.old_value = r.old_value
  );

UPDATE public.students s
SET resume_url = split_part(split_part(
      regexp_replace(s.resume_url, '^.*/storage/v1/object/public/student-files/', ''),
      '?', 1), '#', 1)
WHERE s.resume_url ~ '/storage/v1/object/public/student-files/'
  AND split_part(split_part(
        regexp_replace(s.resume_url, '^.*/storage/v1/object/public/student-files/', ''),
        '?', 1), '#', 1)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/resume\.[a-z0-9]+$';

-- ── 2. HEADSHOT: snapshot the rows about to change, then convert ─────────────
WITH recognized AS (
  SELECT
    s.id AS student_id,
    s.headshot_url AS old_value,
    split_part(split_part(
      regexp_replace(s.headshot_url, '^.*/storage/v1/object/public/student-files/', ''),
      '?', 1), '#', 1) AS new_value
  FROM public.students s
  WHERE s.headshot_url ~ '/storage/v1/object/public/student-files/'
)
INSERT INTO public.wave_f2_pass2_url_backfill_backup (student_id, column_name, old_value, new_value)
SELECT r.student_id, 'headshot_url', r.old_value, r.new_value
FROM recognized r
WHERE r.new_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/headshot\.[a-z0-9]+$'
  AND NOT EXISTS (
    SELECT 1 FROM public.wave_f2_pass2_url_backfill_backup b
    WHERE b.student_id = r.student_id AND b.column_name = 'headshot_url' AND b.old_value = r.old_value
  );

UPDATE public.students s
SET headshot_url = split_part(split_part(
      regexp_replace(s.headshot_url, '^.*/storage/v1/object/public/student-files/', ''),
      '?', 1), '#', 1)
WHERE s.headshot_url ~ '/storage/v1/object/public/student-files/'
  AND split_part(split_part(
        regexp_replace(s.headshot_url, '^.*/storage/v1/object/public/student-files/', ''),
        '?', 1), '#', 1)
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/headshot\.[a-z0-9]+$';

COMMIT;

-- ── Verification (run separately, one at a time, AFTER applying) ─────────────
-- See db/audit/wave_f2_pass2_preflight_and_verification.sql (VERIFICATION section).
-- Quick check: no student-files public URL remains in either column (expected 0):
--   SELECT count(*) FROM public.students
--   WHERE resume_url   LIKE '%/object/public/student-files/%'
--      OR headshot_url LIKE '%/object/public/student-files/%';

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Restores every value this migration changed from the backup table, then (optionally)
-- drops the backup. Only rows the migration actually converted are restored, so values
-- that were already canonical or were intentionally left unchanged are never touched.
/*
BEGIN;
UPDATE public.students s
SET resume_url = b.old_value
FROM public.wave_f2_pass2_url_backfill_backup b
WHERE b.student_id = s.id AND b.column_name = 'resume_url' AND s.resume_url = b.new_value;

UPDATE public.students s
SET headshot_url = b.old_value
FROM public.wave_f2_pass2_url_backfill_backup b
WHERE b.student_id = s.id AND b.column_name = 'headshot_url' AND s.headshot_url = b.new_value;
COMMIT;

-- After confirming the rollback, the backup table may be dropped:
-- DROP TABLE IF EXISTS public.wave_f2_pass2_url_backfill_backup;
*/
