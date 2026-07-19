-- ============================================================================
-- WAVE F-2 PASS 3: read-only PREFLIGHT and VERIFICATION queries
-- ============================================================================
-- Run each query SEPARATELY in the Supabase SQL editor. Every query here is READ
-- ONLY. Run the PREFLIGHT section BEFORE applying
-- supabase/migrations/20260719000003_wave_f2_pass3_private_bucket_cutover.sql,
-- and the VERIFICATION section AFTER. No query exposes a secret or a signed token.
--
-- STOP CONDITIONS (do not apply the cutover if any of these appear):
--   - preflight 2 shows any row with assessment starting 'STOP'. That means a policy
--     grants anon / authenticated / PUBLIC access and is either bucket-agnostic or
--     names student-files together with another bucket. Dropping it would change
--     access for other buckets, so it needs a separate, deliberate decision. The
--     migration itself also aborts in this case: it fails closed, it never leaves such
--     a policy in place and calls the cutover complete.
--   - preflight 5 shows object paths outside the canonical pattern
--   - preflight 7 shows a student reference whose object is missing
--   - preflight 8 shows a duplicate or conflicting object key
-- Preflight 4 (mimetypes and sizes) is informational for this pass: the cutover does
-- NOT change file_size_limit or allowed_mime_types. Preflight 6 (orphans) is also
-- informational: orphaned objects are left untouched and are cleaned up separately.
--
-- Capture the preflight 1 and preflight 2 result sets before applying. Preflight 1
-- records the bucket settings that must be unchanged afterwards; preflight 2b prints
-- the exact CREATE POLICY statements for the policies about to be dropped (the
-- migration also stores them in public.wave_f2_pass3_policy_backup for the rollback).
-- ============================================================================


-- ############################################################################
-- PREFLIGHT (run BEFORE the cutover)
-- ############################################################################

-- ── PREFLIGHT 1: bucket privacy and configuration ────────────────────────────
-- Expected NOW (pre-cutover): public = true. RECORD file_size_limit and
-- allowed_mime_types: the cutover must leave both exactly as they are, and VERIFY 6
-- compares against these values. Run alone.
SELECT id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at
FROM storage.buckets
WHERE id = 'student-files';

-- ── PREFLIGHT 2: every policy on storage.objects, with an explicit assessment ─
-- One row per policy, with the full USING and WITH CHECK expressions and a computed
-- assessment. Run alone. SAVE THIS RESULT SET.
--   assessment = 'DROP'  the migration drops this policy (names student-files only)
--   assessment = 'STOP: bucket-agnostic client access'
--                        grants anon/authenticated/PUBLIC and constrains no bucket, so
--                        it can reach student-files. NOT dropped automatically.
--   assessment = 'STOP: multi-bucket client access'
--                        grants anon/authenticated/PUBLIC and names student-files with
--                        at least one other bucket. NOT dropped automatically.
--   assessment = 'leave: other bucket only' / 'leave: no client roles'
--                        out of scope, untouched.
-- Expected: zero rows whose assessment starts with 'STOP'.
SELECT
  p.policyname,
  p.cmd,
  p.permissive,
  p.roles,
  p.qual                                                        AS using_expression,
  p.with_check                                                  AS with_check_expression,
  (COALESCE(p.qual, '') LIKE '%student-files%'
    OR COALESCE(p.with_check, '') LIKE '%student-files%')        AS names_student_files,
  (COALESCE(p.qual, '') NOT LIKE '%bucket_id%'
    AND COALESCE(p.with_check, '') NOT LIKE '%bucket_id%')       AS bucket_agnostic,
  (p.roles && ARRAY['anon', 'authenticated', 'public']::name[])  AS grants_client_roles,
  (SELECT array_agg(b.id ORDER BY b.id)
     FROM storage.buckets b
    WHERE b.id <> 'student-files'
      AND (COALESCE(p.qual, '') LIKE '%' || b.id || '%'
        OR COALESCE(p.with_check, '') LIKE '%' || b.id || '%'))  AS other_buckets_named,
  CASE
    WHEN p.roles && ARRAY['anon', 'authenticated', 'public']::name[]
     AND COALESCE(p.qual, '') NOT LIKE '%bucket_id%'
     AND COALESCE(p.with_check, '') NOT LIKE '%bucket_id%'
      THEN 'STOP: bucket-agnostic client access'
    WHEN p.roles && ARRAY['anon', 'authenticated', 'public']::name[]
     AND (COALESCE(p.qual, '') LIKE '%student-files%'
       OR COALESCE(p.with_check, '') LIKE '%student-files%')
     AND EXISTS (SELECT 1 FROM storage.buckets b
                  WHERE b.id <> 'student-files'
                    AND (COALESCE(p.qual, '') LIKE '%' || b.id || '%'
                      OR COALESCE(p.with_check, '') LIKE '%' || b.id || '%'))
      THEN 'STOP: multi-bucket client access'
    WHEN (COALESCE(p.qual, '') LIKE '%student-files%'
       OR COALESCE(p.with_check, '') LIKE '%student-files%')
      THEN 'DROP'
    WHEN p.roles && ARRAY['anon', 'authenticated', 'public']::name[]
      THEN 'leave: other bucket only'
    ELSE 'leave: no client roles'
  END                                                            AS assessment
FROM pg_policies p
WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
ORDER BY assessment, p.policyname;

-- ── PREFLIGHT 2b: exact restore SQL for the policies about to be dropped ─────
-- The reproducible policy-backup artifact. Save this output. The migration stores the
-- same statements in public.wave_f2_pass3_policy_backup, and the rollback replays them
-- verbatim, so no policy definition is ever guessed or hand-reconstructed. Run alone.
SELECT
  p.policyname,
  format(
    'CREATE POLICY %I ON storage.objects AS %s FOR %s TO %s%s%s;',
    p.policyname,
    p.permissive,
    p.cmd,
    (SELECT string_agg(CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END, ', ')
       FROM unnest(p.roles::text[]) AS r),
    CASE WHEN p.qual       IS NULL THEN '' ELSE ' USING (' || p.qual || ')' END,
    CASE WHEN p.with_check IS NULL THEN '' ELSE ' WITH CHECK (' || p.with_check || ')' END
  )                                                              AS restore_sql
FROM pg_policies p
WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
  AND (COALESCE(p.qual, '') LIKE '%student-files%'
    OR COALESCE(p.with_check, '') LIKE '%student-files%')
ORDER BY p.policyname;

-- ── PREFLIGHT 3: grants on storage.objects and storage.buckets ───────────────
-- Confirms which roles hold table-level privileges. Expected: no privilege held by
-- PUBLIC. anon and authenticated may hold table privileges from the Supabase storage
-- defaults; those are gated by RLS, which is why the policy state above is what
-- matters. Run alone.
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'storage' AND table_name IN ('objects', 'buckets')
ORDER BY table_name, grantee, privilege_type;

-- ── PREFLIGHT 4: MIME types and file sizes currently in student-files ────────
-- Informational for Pass 3: this cutover does NOT set file_size_limit or
-- allowed_mime_types. Recorded so a future, separate MIME/size change can be reviewed
-- against real data. Run alone.
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
-- policies currently name this bucket. VERIFY 2 and VERIFY 3 compare against these.
-- Expected NOW: bucket_public_now = true. Run alone.
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
-- PASS: public = false.
SELECT id, public
FROM storage.buckets
WHERE id = 'student-files';

-- ── VERIFY 2: no policy grants direct client access to student-files ────────
-- PASS: 0 rows. No policy of any kind names this bucket (no anon, no authenticated,
-- no PUBLIC, no is_staff, and deliberately no service_role policy either: service_role
-- bypasses RLS, so server-mediated access needs none). Run alone.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (COALESCE(qual, '') LIKE '%student-files%'
    OR COALESCE(with_check, '') LIKE '%student-files%')
ORDER BY policyname;

-- ── VERIFY 2b: no unresolved bucket-agnostic client-access policy remains ───
-- PASS: 0 rows. Proves nothing reaches student-files through a policy that names no
-- bucket, and that no is_staff() path was left behind. Run alone.
SELECT
  policyname,
  cmd,
  roles,
  qual,
  with_check,
  (COALESCE(qual, '') LIKE '%is_staff%'
    OR COALESCE(with_check, '') LIKE '%is_staff%')  AS uses_is_staff
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND roles && ARRAY['anon', 'authenticated', 'public']::name[]
  AND COALESCE(qual, '')       NOT LIKE '%bucket_id%'
  AND COALESCE(with_check, '') NOT LIKE '%bucket_id%'
ORDER BY policyname;

-- ── VERIFY 3: no storage object was deleted, renamed, or moved ──────────────
-- PASS: objects_in_bucket equals PREFLIGHT 9's objects_in_bucket, and
-- non_canonical_paths equals PREFLIGHT 5's row count (normally 0). Run alone.
SELECT
  count(*)                                                                            AS objects_in_bucket,
  count(*) FILTER (WHERE name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(resume|headshot)\.[a-z0-9]+$') AS non_canonical_paths
FROM storage.objects
WHERE bucket_id = 'student-files';

-- ── VERIFY 4: no student file reference was modified ────────────────────────
-- PASS: canonical_paths = 57, remaining_http_values = 0 (unchanged from Pass 2), and
-- every reference still resolves to an existing object (missing_objects = 0). Run alone.
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
-- PASS: headshot_url = 29 and resume_url = 27 (unchanged by Pass 3). Run alone.
SELECT column_name, count(*) AS backed_up
FROM public.wave_f2_pass2_url_backfill_backup
GROUP BY column_name
ORDER BY column_name;

-- ── VERIFY 6: no bucket MIME or size setting changed ───────────────────────
-- PASS: file_size_limit and allowed_mime_types are IDENTICAL to the values recorded by
-- PREFLIGHT 1. The cutover never writes either column. Run alone and compare by eye.
SELECT id, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'student-files';

-- ── VERIFY 7: the policy backup artifact captured the dropped policies ─────
-- PASS: one row per policy dropped by the cutover (equal to PREFLIGHT 9's
-- student_files_policies_now), each with a non-empty restore_sql. This is what the
-- rollback replays. Run alone.
SELECT policyname, cmd, permissive, roles, left(restore_sql, 120) AS restore_sql_head, captured_at
FROM public.wave_f2_pass3_policy_backup
ORDER BY captured_at, policyname;
