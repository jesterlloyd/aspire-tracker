-- ============================================================================
-- WAVE F-2 PASS 2: read-only PREFLIGHT and VERIFICATION queries
-- ============================================================================
-- Run each query SEPARATELY in the Supabase SQL editor. Every query here is
-- READ ONLY. Run the PREFLIGHT section BEFORE applying
-- supabase/migrations/20260719000002_wave_f2_pass2_url_to_path_backfill.sql, and
-- the VERIFICATION section AFTER. None of these expose service-role secrets, and
-- signed query parameters are stripped from any sampled value.
--
-- Classification used throughout (mirrors the server resolver and the migration):
--   recognized public URL = contains '/storage/v1/object/public/student-files/'
--                           AND the extracted path is <uuid>/<uuid>/<kind>.<ext>
--   canonical path        = not an http(s) URL AND matches <uuid>/<uuid>/<kind>.<ext>
--   unrecognized          = a non-empty value that is neither of the above
-- The extracted path drops any '?query' / '#fragment' after the marker.
-- ============================================================================


-- ############################################################################
-- PREFLIGHT (run BEFORE the migration)
-- ############################################################################

-- ── PREFLIGHT 1: per-column value distribution ───────────────────────────────
-- Counts of null / empty / canonical / recognized public URL / unrecognized, for
-- each confirmed column. Run alone.
WITH v AS (
  SELECT 'resume_url' AS col, resume_url AS val, 'resume' AS kind FROM public.students
  UNION ALL
  SELECT 'headshot_url', headshot_url, 'headshot' FROM public.students
),
c AS (
  SELECT col, val,
    (val ~ '/storage/v1/object/public/student-files/') AS has_marker,
    split_part(split_part(regexp_replace(val, '^.*/storage/v1/object/public/student-files/', ''), '?', 1), '#', 1) AS extracted,
    ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' || kind || '\.[a-z0-9]+$') AS pat
  FROM v
)
SELECT col,
  count(*) FILTER (WHERE val IS NULL)                                        AS nulls,
  count(*) FILTER (WHERE val = '')                                          AS empties,
  count(*) FILTER (WHERE val IS NOT NULL AND val <> '' AND val !~ '^https?://' AND val ~* pat) AS canonical_paths,
  -- a student-files public URL whose extracted path IS canonical -> the migration converts it
  count(*) FILTER (WHERE has_marker AND extracted ~* pat)                    AS recognized_convertible,
  -- a student-files public URL whose extracted path is NOT canonical -> GATE: this
  -- must be 0 before applying (see preflight 5 for the rows). Non-zero means STOP.
  count(*) FILTER (WHERE has_marker AND extracted !~* pat)                   AS recognized_non_convertible,
  -- any other non-empty value (other bucket, signed URL, external, non-canonical path)
  count(*) FILTER (WHERE val IS NOT NULL AND val <> ''
                    AND NOT (val !~ '^https?://' AND val ~* pat)
                    AND NOT has_marker)                                      AS other_unrecognized
FROM c
GROUP BY col
ORDER BY col;
-- GATE: recognized_non_convertible MUST be 0 (both columns) before applying the
-- migration, so that verification "zero public URLs remaining" is exact.

-- ── PREFLIGHT 2: sample recognized transformations (query strings removed) ───
-- A few examples of old -> new. Sensitive query strings are stripped by extraction.
-- Run alone.
WITH v AS (
  SELECT 'resume_url' AS col, id, resume_url AS val, 'resume' AS kind FROM public.students
  UNION ALL
  SELECT 'headshot_url', id, headshot_url, 'headshot' FROM public.students
)
SELECT col, id,
  split_part(val, '?', 1) AS old_value_no_query,
  split_part(split_part(regexp_replace(val, '^.*/storage/v1/object/public/student-files/', ''), '?', 1), '#', 1) AS new_canonical_path
FROM v
WHERE val ~ '/storage/v1/object/public/student-files/'
  AND split_part(split_part(regexp_replace(val, '^.*/storage/v1/object/public/student-files/', ''), '?', 1), '#', 1)
      ~* ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' || kind || '\.[a-z0-9]+$')
LIMIT 20;

-- ── PREFLIGHT 3: count of values that would remain UNCHANGED ──────────────────
-- Everything that is NOT a recognized-convertible public URL (nulls, empties,
-- canonical paths, and every unrecognized value). Run alone.
WITH v AS (
  SELECT resume_url AS val, 'resume' AS kind FROM public.students
  UNION ALL
  SELECT headshot_url, 'headshot' FROM public.students
)
SELECT count(*) AS would_remain_unchanged
FROM v
WHERE NOT (
  val ~ '/storage/v1/object/public/student-files/'
  AND split_part(split_part(regexp_replace(val, '^.*/storage/v1/object/public/student-files/', ''), '?', 1), '#', 1)
      ~* ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' || kind || '\.[a-z0-9]+$')
);

-- ── PREFLIGHT 4: duplicate canonical paths referenced by multiple records ────
-- The post-conversion canonical path (or an already-canonical value) shared by
-- more than one student row. Run alone. Expected: 0 rows (each student owns a
-- distinct cohort/student/kind key).
WITH resolved AS (
  SELECT id,
    CASE WHEN resume_url ~ '/storage/v1/object/public/student-files/'
         THEN split_part(split_part(regexp_replace(resume_url, '^.*/storage/v1/object/public/student-files/', ''), '?', 1), '#', 1)
         ELSE resume_url END AS path
  FROM public.students WHERE resume_url IS NOT NULL AND resume_url <> ''
  UNION ALL
  SELECT id,
    CASE WHEN headshot_url ~ '/storage/v1/object/public/student-files/'
         THEN split_part(split_part(regexp_replace(headshot_url, '^.*/storage/v1/object/public/student-files/', ''), '?', 1), '#', 1)
         ELSE headshot_url END
  FROM public.students WHERE headshot_url IS NOT NULL AND headshot_url <> ''
)
SELECT path, count(*) AS referencing_rows
FROM resolved
WHERE path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(resume|headshot)\.[a-z0-9]+$'
GROUP BY path HAVING count(*) > 1
ORDER BY referencing_rows DESC;

-- ── PREFLIGHT 5: records whose canonical path does NOT match the expected ─────
-- cohort/student/kind pattern. These are LEFT UNCHANGED by the migration and want
-- a human look. Run alone. Expected: 0 rows.
WITH v AS (
  SELECT id, 'resume_url' AS col, resume_url AS val, 'resume' AS kind FROM public.students
  UNION ALL
  SELECT id, 'headshot_url', headshot_url, 'headshot' FROM public.students
)
SELECT id, col, split_part(val, '?', 1) AS value_no_query
FROM v
WHERE val ~ '/storage/v1/object/public/student-files/'
  AND split_part(split_part(regexp_replace(val, '^.*/storage/v1/object/public/student-files/', ''), '?', 1), '#', 1)
      !~* ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' || kind || '\.[a-z0-9]+$');

-- ── PREFLIGHT 6: values pointing OUTSIDE student-files + distinct hosts ───────
-- Any http(s) value that is NOT a student-files public URL (other bucket, signed
-- URL, external), plus the distinct hosts of ALL student-files public URLs so you
-- can confirm every recognized value belongs to THIS project. Run each SELECT alone.
-- 6a. Non-student-files http values (expected: 0, or explainable):
WITH v AS (
  SELECT id, 'resume_url' AS col, resume_url AS val FROM public.students
  UNION ALL
  SELECT id, 'headshot_url', headshot_url FROM public.students
)
SELECT id, col, split_part(val, '?', 1) AS value_no_query
FROM v
WHERE val ~ '^https?://'
  AND val !~ '/storage/v1/object/public/student-files/'
LIMIT 50;
-- 6b. Distinct hosts among student-files public URLs (expect ONE, this project):
WITH v AS (
  SELECT resume_url AS val FROM public.students
  UNION ALL SELECT headshot_url FROM public.students
)
SELECT (regexp_match(val, '^https?://([^/]+)/'))[1] AS host, count(*) AS n
FROM v
WHERE val ~ '/storage/v1/object/public/student-files/'
GROUP BY 1 ORDER BY n DESC;


-- ############################################################################
-- VERIFICATION (run AFTER the migration)
-- ############################################################################

-- ── VERIFY 1: no student-files public URL remains (expected 0) ───────────────
-- This is exact because the apply gate required preflight 'recognized_non_convertible'
-- (and preflight 5) to be 0, so the migration converted EVERY student-files public URL.
-- A non-zero result here means the gate was not clean: handle those rows and re-run.
SELECT count(*) AS public_urls_remaining
FROM public.students
WHERE resume_url   LIKE '%/object/public/student-files/%'
   OR headshot_url LIKE '%/object/public/student-files/%';

-- ── VERIFY 2: every non-empty value is now a canonical path or an unchanged ──
-- non-student-files value (expected: recognized set fully converted). Run alone.
WITH v AS (
  SELECT resume_url AS val, 'resume' AS kind FROM public.students
  UNION ALL SELECT headshot_url, 'headshot' FROM public.students
)
SELECT
  count(*) FILTER (WHERE val ~* ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' || kind || '\.[a-z0-9]+$')) AS canonical_paths,
  count(*) FILTER (WHERE val ~ '^https?://')                                   AS remaining_http_values
FROM v WHERE val IS NOT NULL AND val <> '';

-- ── VERIFY 3: backup row count matches the number of converted values ────────
-- (Sanity: every changed value was snapshotted.) Run alone.
SELECT column_name, count(*) AS backed_up
FROM public.wave_f2_pass2_url_backfill_backup
GROUP BY column_name ORDER BY column_name;
