-- ============================================================================
-- WAVE F-2 PASS 3: student-files PRIVATE BUCKET CUTOVER
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester) in the Supabase SQL editor, ONLY AFTER      ***
-- *** running every query in db/audit/wave_f2_pass3_preflight_and_verification. ***
-- *** sql separately and reviewing the results. This is the privacy cutover: it ***
-- *** makes the bucket private and removes direct client access. It does NOT    ***
-- *** delete, rename, move, or rewrite ANY storage object, does NOT modify any  ***
-- *** student file reference, and does NOT change any other bucket setting.     ***
-- *** Run the ENTIRE file once (transactional).                                 ***
--
-- Supersedes and replaces the earlier drafts (both removed / must not be applied):
--   supabase/migrations/20260712000014_phase0b_wave_f2_student_files_private.sql
--   supabase/migrations/20260718000001_DRAFT_DO_NOT_APPLY_wave_f2_pass3_private_cutover.sql
-- Those added broad public.is_staff() storage policies. They are unnecessary: the
-- deployed application never reads or writes storage from the browser except through
-- a server-issued signed upload token.
--
-- Prerequisites (all true as of this migration)
--   Pass 1 (server-mediated access) deployed; Pass 2 backfill applied and verified
--   (public_urls_remaining = 0, canonical_paths = 57, remaining_http_values = 0);
--   the canonical-write patch is live so every new upload persists a canonical path;
--   public.wave_f2_pass2_url_backfill_backup is intact.
--
-- Intended post-cutover state for student-files
--   bucket is private; NO anon policy; NO authenticated policy; NO PUBLIC grant that
--   enables client access; NO is_staff() policy; and NO policy of any kind naming this
--   bucket. Server access continues through the service-role client, which BYPASSES
--   RLS, so no storage policy is created for it. A service-role policy would be
--   redundant and would obscure the intended model.
--
-- Why no application change is required
--   Reads   : api/student-file-access.js (createSignedUrls) and
--             api/portal/student-file-access.js (createSignedUrl) run as service_role
--             behind role/entitlement authorization. Signed URLs work on a PRIVATE
--             bucket, so every current read path is unaffected.
--   Uploads : api/student-file-sign.js and api/student-intake-file-sign.js issue a
--             per-path token with createSignedUploadUrl as service_role. The browser
--             then calls
--             uploadToSignedUrl(path, token, file); that token is the authorization,
--             so NO anon or authenticated storage policy is required for uploads on a
--             private bucket.
--   Cleanup : api/student-file-cleanup.js removes objects as service_role.
--
-- SCOPE LIMIT (deliberate)
--   This migration changes exactly two things: storage.buckets.public for this bucket,
--   and policies that grant direct client access to this bucket. file_size_limit and
--   allowed_mime_types are left EXACTLY as they are. Any future MIME or size
--   restriction is a separate reviewed change after the private cutover is accepted.
--
-- FAIL-CLOSED GATE (step 1 below)
--   The migration aborts, before writing anything, if storage.objects carries a policy
--   that grants anon / authenticated / PUBLIC access and either
--     (a) is bucket-agnostic (names no bucket, so it can reach student-files), or
--     (b) names student-files together with at least one other existing bucket.
--   Neither is dropped automatically, because dropping it would change access for other
--   buckets. The abort reports the policy names so they can be reviewed and decided
--   separately. Preflight query 2 shows the same assessment before you apply.
-- ============================================================================

BEGIN;

-- ── 1. FAIL-CLOSED GATE: unresolved client-access policies abort the cutover ──
DO $$
DECLARE
  v_blockers text;
BEGIN
  SELECT string_agg(
           p.policyname || '  [cmd=' || p.cmd
             || ', roles=' || array_to_string(p.roles, '/')
             || ', reason=' || CASE
                  WHEN COALESCE(p.qual, '') NOT LIKE '%bucket_id%'
                   AND COALESCE(p.with_check, '') NOT LIKE '%bucket_id%'
                  THEN 'bucket-agnostic'
                  ELSE 'names student-files together with another bucket'
                END || ']',
           E'\n  ' ORDER BY p.policyname)
    INTO v_blockers
  FROM pg_policies p
  WHERE p.schemaname = 'storage'
    AND p.tablename  = 'objects'
    AND p.roles && ARRAY['anon', 'authenticated', 'public']::name[]
    AND (
      -- (a) bucket-agnostic: constrains no bucket, so it can reach student-files
      (COALESCE(p.qual, '') NOT LIKE '%bucket_id%'
        AND COALESCE(p.with_check, '') NOT LIKE '%bucket_id%')
      -- (b) multi-bucket: names student-files AND at least one other existing bucket
      OR (
        (COALESCE(p.qual, '') LIKE '%student-files%'
          OR COALESCE(p.with_check, '') LIKE '%student-files%')
        AND EXISTS (
          SELECT 1 FROM storage.buckets b
          WHERE b.id <> 'student-files'
            AND (COALESCE(p.qual, '') LIKE '%' || b.id || '%'
              OR COALESCE(p.with_check, '') LIKE '%' || b.id || '%')
        )
      )
    );

  IF v_blockers IS NOT NULL THEN
    RAISE EXCEPTION
      'WAVE F-2 PASS 3 ABORTED: unresolved client-access policy on storage.objects.%'
      '  %'
      'These are NOT dropped automatically because they affect other buckets. Review '
      'each one and decide separately, then re-run this migration.',
      E'\n  ', v_blockers;
  END IF;
END $$;

-- ── 2. Policy backup artifact (exact definitions, for an exact rollback) ─────
-- Every policy this migration drops is snapshotted here first, together with the exact
-- CREATE POLICY statement that recreates it. The rollback replays restore_sql verbatim;
-- it never guesses or reconstructs a policy definition.
CREATE TABLE IF NOT EXISTS public.wave_f2_pass3_policy_backup (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  policyname  text        NOT NULL,
  cmd         text        NOT NULL,
  permissive  text        NOT NULL,
  roles       text[]      NOT NULL,
  qual        text,
  with_check  text,
  restore_sql text        NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wave_f2_pass3_policy_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wave_f2_pass3_policy_backup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.wave_f2_pass3_policy_backup TO service_role;

INSERT INTO public.wave_f2_pass3_policy_backup
  (policyname, cmd, permissive, roles, qual, with_check, restore_sql)
SELECT
  p.policyname,
  p.cmd,
  p.permissive,
  p.roles::text[],
  p.qual,
  p.with_check,
  format(
    'CREATE POLICY %I ON storage.objects AS %s FOR %s TO %s%s%s;',
    p.policyname,
    p.permissive,
    p.cmd,
    (SELECT string_agg(CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END, ', ')
       FROM unnest(p.roles::text[]) AS r),
    CASE WHEN p.qual       IS NULL THEN '' ELSE ' USING (' || p.qual || ')' END,
    CASE WHEN p.with_check IS NULL THEN '' ELSE ' WITH CHECK (' || p.with_check || ')' END
  )
FROM pg_policies p
WHERE p.schemaname = 'storage'
  AND p.tablename  = 'objects'
  AND (COALESCE(p.qual, '') LIKE '%student-files%'
    OR COALESCE(p.with_check, '') LIKE '%student-files%')
  AND NOT EXISTS (
    SELECT 1 FROM public.wave_f2_pass3_policy_backup b
    WHERE b.policyname = p.policyname
  );

-- ── 3. Make the bucket private (removes anonymous public read) ───────────────
-- Only the public flag changes. file_size_limit and allowed_mime_types are untouched.
UPDATE storage.buckets SET public = false WHERE id = 'student-files';

-- ── 4. Drop every policy that grants direct client access to student-files ───
-- Restricted to policies whose definition names student-files and names no other
-- existing bucket. The step 1 gate has already proved that no bucket-agnostic and no
-- multi-bucket client-access policy remains, so this set is exactly the reviewed set
-- shown by preflight query 2 as assessment = 'DROP'. Their exact definitions are in
-- public.wave_f2_pass3_policy_backup from step 2.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT pol.policyname
    FROM pg_policies pol
    WHERE pol.schemaname = 'storage'
      AND pol.tablename  = 'objects'
      AND (COALESCE(pol.qual, '') LIKE '%student-files%'
        OR COALESCE(pol.with_check, '') LIKE '%student-files%')
      AND NOT EXISTS (
        SELECT 1 FROM storage.buckets b
        WHERE b.id <> 'student-files'
          AND (COALESCE(pol.qual, '') LIKE '%' || b.id || '%'
            OR COALESCE(pol.with_check, '') LIKE '%' || b.id || '%')
      )
    ORDER BY pol.policyname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', p.policyname);
    RAISE NOTICE 'dropped student-files policy: %', p.policyname;
  END LOOP;
END $$;

-- ── 5. No new storage policy is created ──────────────────────────────────────
-- service_role bypasses RLS, so server-mediated access continues with no policy at all.
-- Creating one here would be redundant and would blur the intended security model.

COMMIT;


-- ── Verification (run separately, one at a time, AFTER applying) ─────────────
-- See db/audit/wave_f2_pass3_preflight_and_verification.sql (VERIFICATION section).

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Restores the pre-cutover state exactly: the public flag returns to true, and every
-- dropped policy is recreated from its captured definition in
-- public.wave_f2_pass3_policy_backup. Nothing is guessed or reconstructed by hand.
-- file_size_limit and allowed_mime_types are not referenced, because the cutover never
-- changed them. No storage object and no student reference is touched in either
-- direction.
/*
BEGIN;
DO $$
DECLARE
  b record;
BEGIN
  FOR b IN
    SELECT policyname, restore_sql
    FROM public.wave_f2_pass3_policy_backup
    ORDER BY captured_at, policyname
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = b.policyname
    ) THEN
      EXECUTE b.restore_sql;
      RAISE NOTICE 'restored student-files policy: %', b.policyname;
    END IF;
  END LOOP;
END $$;
UPDATE storage.buckets SET public = true WHERE id = 'student-files';
COMMIT;
*/
