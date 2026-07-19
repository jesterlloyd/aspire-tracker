-- ============================================================================
-- WAVE F-2 PASS 3: read-only PREFLIGHT and VERIFICATION queries
-- ============================================================================
-- Run each query SEPARATELY in the Supabase SQL editor. Every query here is READ
-- ONLY. Run the PREFLIGHT section BEFORE applying
-- supabase/migrations/20260719000003_wave_f2_pass3_private_bucket_cutover.sql,
-- and the VERIFICATION section AFTER. No query exposes a secret or a signed token.
--
-- STOP CONDITIONS (do not apply the cutover if any of these appear):
--   - preflight 2 shows a BUCKET-AGNOSTIC policy granting anon/authenticated access
--     to all buckets (dropping it would affect other buckets: decide deliberately)
--   - preflight 5 shows object paths outside the canonical pattern
--   - preflight 7 shows a student reference whose object is missing
--   - preflight 8 shows a duplicate or conflicting object key
--   - preflight 4 shows a mimetype outside the application allow-list AND you intend
--     to enable the optional MIME restriction
-- Preflight 6 (orphans) is informational: orphaned objects are left untouched by the
-- cutover and are cleaned up separately, never by this migration.
--
-- Capture the preflight 2 result set before applying: it is the only record of the
-- prior policy state and is needed for a full policy restore.
-- ============================================================================


-- ############################################################################
-- PREFLIGHT (run BEFORE the cutover)
-- ############################################################################

-- ── PREFLIGHT 1: bucket privacy and configuration ────────────────────────────
-- Expected NOW (pre-cutover): public = true. Note file_size_limit / allowed_mime_types
-- so you can restore them exactly if you ever roll back. Run alone.
SELECT id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at
FROM storage.buckets
WHERE id = 'student-files';

-- ── PREFLIGHT 2: every policy on storage.objects ─────────────────────────────
-- The migration drops ONLY rows where affects_student_files = true. Review any row
-- where affects_student_files = false but the policy is bucket-agnostic (qual and
-- with_check do not mention any bucket): such a policy may grant access to every
-- bucket, and dropping it is out of scope for this migration. Run alone. SAVE THIS.
SELECT
  policyname,
  cmd,
  roles,
  (COALESCE(qual, '') LIKE '%student-files%'
    OR COALESCE(with_check, '') LIKE '%student-files%')      AS affects_student_files,
  (COALESCE(qual, '') NOT LIKE '%bucket_id%'
    AND COALESCE(with_check, '') NOT LIKE '%bucket_id%')     AS bucket_agnostic,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY affects_student_files DESC, policyname;

-- ── PREFLIGHT 3: grants on storage.objects and storage.buckets ───────────────
-- Confirms which roles hold table-level privileges. Run alone.
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'storage' AND table_name IN ('objects', 'buckets')
ORDER BY table_name, grantee, privilege_type;

-- ── PREFLIGHT 4: MIME types and file sizes currently in student-files ────────
-- Drives the OPTIONAL MIME/size block in the migration. The application allow-list is
-- application/pdf, application/msword,
-- application/vnd.openxmlformats-officedocument.wordprocessingml.document,
-- image/jpeg, image/png. Only enable that block if every mimetype below is in it and
-- max_bytes is within 10485760. Run alone.
SELECT
  COALESCE(metadata->>'mimetype', '(none)')                   AS mimetype,
  count(*)                                                    AS objects,
  min((metadata->>'size')::bigint)                            AS min_bytes,
  max((metadata->>'size')::bigint)                            AS max_bytes,
  round(avg((metadata->>'size')::numeric))                    AS avg_bytes
FROM storage.objects
WHERE bucket_id = 'student-files'
GROUP BY 1
ORDER BY objects DESC;

-- ── PREFLIGHT 5: object paths OUTSIDE the canonical pattern ──────────────────
-- Canonical is <cohort_uuid>/<student_uuid>/(resume|headshot).<ext>.
-- Expected: 0 rows. Any row means an unexpected key shape: STOP and review. Run alone.
SELECT name, COALESCE(metadata->>'mimetype', '(none)') AS mimetype, created_at
FROM storage.objects
WHERE bucket_id = 'student-files'
  AND name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(resume|headshot)\.[a-z0-9]+$'
ORDER BY name;

-- ── PREFLIGHT 6: orphaned objects (informational, not blocking) ──────────────
-- Objects in the bucket that no student row references. The cutover NEVER deletes
-- them; they are a separate, deliberate cleanup. Run alone.
SELECT o.name, COALESCE(o.metadata->>'size', '?') AS bytes, o.created_at
FROM storage.objects o
WHERE o.bucket_id = 'student-files'
  AND NOT EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.resume_url = o.name OR s.headshot_url = o.name
  )
ORDER BY o.created_at;

-- ── PREFLIGHT 7: student references whose object is MISSING ──────────────────
-- A stored canonical path with no matching object. Expected: 0 rows. Any row means a
-- broken reference that privatization would make visibly broken: STOP. Run alone.
WITH refs AS (
  SELECT id AS student_id, 'resume_url'   AS col, resume_url   AS path FROM public.students WHERE resume_url   IS NOT NULL AND resume_url   <> ''
  UNION ALL
  SELECT id,               'headshot_url',        headshot_url        FROM public.students WHERE headshot_url IS NOT NULL AND headshot_url <> ''
)
SELECT r.student_id, r.col, r.path
FROM refs r
WHERE NOT EXISTS (
  SELECT 1 FROM storage.objects o
  WHERE o.bucket_id = 'student-files' AND o.name = r.path
)
ORDER BY r.col, r.student_id;

-- ── PREFLIGHT 8: duplicate or conflicting object keys ────────────────────────
-- Same key more than once, or keys differing only by case (which would collide on a
-- case-insensitive comparison). Expected: 0 rows. Run alone.
SELECT lower(name) AS key_lower, count(*) AS objects, array_agg(name ORDER BY name) AS variants
FROM storage.objects
WHERE bucket_id = 'student-files'
GROUP BY 1
HAVING count(*) > 1
ORDER BY objects DESC;

-- ── PREFLIGHT 9: public accessibility state BEFORE the cutover ───────────────
-- Records the pre-cutover baseline: bucket public flag, object count, and how many
-- objects are therefore anonymously readable by raw URL today. Run alone.
SELECT
  (SELECT public FROM storage.buckets WHERE id = 'student-files')                      AS bucket_public_now,
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'student-files')             AS objects_in_bucket,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname='storage' AND tablename='objects'
       AND (COALESCE(qual,'') LIKE '%student-files%' OR COALESCE(with_check,'') LIKE '%student-files%')) AS student_files_policies_now;


-- ############################################################################
-- VERIFICATION (run AFTER the cutover)
-- ############################################################################

-- ── VERIFY 1: the bucket is private ─────────────────────────────────────────
-- PASS: public = false. (file_size_limit / allowed_mime_types are non-null only if
-- you applied the optional block.)
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'student-files';

-- ── VERIFY 2: only the service_role policy remains for student-files ────────
-- PASS: exactly one row, policyname = 'student-files-service-role-all',
-- roles = {service_role}. No anon or authenticated policy for this bucket.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (COALESCE(qual, '') LIKE '%student-files%'
    OR COALESCE(with_check, '') LIKE '%student-files%')
ORDER BY policyname;

-- ── VERIFY 3: no storage object was deleted, renamed, or moved ──────────────
-- PASS: objects_in_bucket equals PREFLIGHT 9's objects_in_bucket, and
-- non_canonical_paths equals PREFLIGHT 5's row count (normally 0).
SELECT
  count(*)                                                                            AS objects_in_bucket,
  count(*) FILTER (WHERE name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(resume|headshot)\.[a-z0-9]+$') AS non_canonical_paths
FROM storage.objects
WHERE bucket_id = 'student-files';

-- ── VERIFY 4: no student file reference was modified ────────────────────────
-- PASS: canonical_paths = 57, remaining_http_values = 0 (unchanged from Pass 2), and
-- every reference still resolves to an existing object (missing_objects = 0).
WITH refs AS (
  SELECT resume_url AS path, 'resume' AS kind FROM public.students WHERE resume_url IS NOT NULL AND resume_url <> ''
  UNION ALL
  SELECT headshot_url,        'headshot'      FROM public.students WHERE headshot_url IS NOT NULL AND headshot_url <> ''
)
SELECT
  count(*) FILTER (WHERE path ~* ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' || kind || '\.[a-z0-9]+$')) AS canonical_paths,
  count(*) FILTER (WHERE path ~ '^https?://')                                          AS remaining_http_values,
  count(*) FILTER (WHERE NOT EXISTS (
    SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'student-files' AND o.name = refs.path
  ))                                                                                   AS missing_objects
FROM refs;

-- ── VERIFY 5: the Pass 2 rollback backup is still intact ───────────────────
-- PASS: headshot_url = 29 and resume_url = 27 (unchanged by Pass 3).
SELECT column_name, count(*) AS backed_up
FROM public.wave_f2_pass2_url_backfill_backup
GROUP BY column_name
ORDER BY column_name;
