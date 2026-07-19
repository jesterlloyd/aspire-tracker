-- ============================================================================
-- WAVE F-2 PASS 3: student-files PRIVATE BUCKET CUTOVER
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester) in the Supabase SQL editor, ONLY AFTER      ***
-- *** running every query in db/audit/wave_f2_pass3_preflight_and_verification. ***
-- *** sql separately and reviewing the results. This is the privacy cutover: it ***
-- *** makes the bucket private and removes anonymous and broad access. It does  ***
-- *** NOT delete, rename, move, or rewrite ANY storage object, and it does NOT  ***
-- *** modify any student file reference. Run the ENTIRE file once.              ***
--
-- Supersedes and replaces the earlier drafts (both removed / must not be applied):
--   supabase/migrations/20260712000014_phase0b_wave_f2_student_files_private.sql
--   supabase/migrations/20260718000001_DRAFT_DO_NOT_APPLY_wave_f2_pass3_private_cutover.sql
-- Those added broad public.is_staff() storage policies. They are unnecessary: the
-- deployed application never reads or writes storage from the browser except through
-- a server-issued signed upload token, so only service_role needs storage access.
--
-- Prerequisites (all true as of this migration)
--   Pass 1 (server-mediated access) deployed; Pass 2 backfill applied and verified
--   (public_urls_remaining = 0, canonical_paths = 57, remaining_http_values = 0);
--   the canonical-write patch is live so every new upload persists a canonical path;
--   public.wave_f2_pass2_url_backfill_backup is intact.
--
-- Why only service_role is needed after this cutover
--   Reads   : api/student-file-access.js (createSignedUrls) and
--             api/portal/student-file-access.js (createSignedUrl) run as service_role
--             behind role/entitlement authorization. Signed URLs work on a PRIVATE
--             bucket, so every current read path is unaffected.
--   Uploads : api/student-file-sign.js and api/student-intake-file-sign.js issue a
--             per-path signed upload token as service_role. The browser then calls
--             uploadToSignedUrl(path, token, file); that token is the authorization,
--             so NO anon or authenticated storage policy is required for uploads on a
--             private bucket.
--   Cleanup : api/student-file-cleanup.js removes objects as service_role.
--   service_role bypasses RLS; the explicit policy below simply makes the intent
--   visible and survives any future RLS forcing.
--
-- IMPORTANT review note before applying
--   Preflight query 2 lists EVERY policy on storage.objects. This migration drops only
--   policies whose definition explicitly references the student-files bucket, so other
--   buckets (avatars, contact-avatars, aspire-catalog) are never affected. If preflight
--   2 shows a BUCKET-AGNOSTIC policy that grants anon or authenticated access to all
--   buckets, STOP: dropping it would change other buckets, so it needs a deliberate,
--   separate decision.
-- ============================================================================

BEGIN;

-- ── 1. Make the bucket private (removes anonymous public read) ───────────────
UPDATE storage.buckets SET public = false WHERE id = 'student-files';

-- ── 2. Drop every student-files-specific policy on storage.objects ───────────
-- Deterministic and complete: drops by name any policy whose USING or WITH CHECK
-- expression names the student-files bucket. This covers the known anonymous read /
-- upload / update policies and any broad authenticated policy scoped to this bucket,
-- without needing to hard-code names and without touching bucket-agnostic policies.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND (COALESCE(qual, '') LIKE '%student-files%'
        OR COALESCE(with_check, '') LIKE '%student-files%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', p.policyname);
    RAISE NOTICE 'dropped student-files policy: %', p.policyname;
  END LOOP;
END $$;

-- ── 3. The only access the deployed application needs: service_role ──────────
DROP POLICY IF EXISTS "student-files-service-role-all" ON storage.objects;
CREATE POLICY "student-files-service-role-all"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'student-files')
  WITH CHECK (bucket_id = 'student-files');

COMMIT;


-- ── 4. OPTIONAL, GATED: bucket-level size and MIME restrictions ──────────────
-- Apply this block ONLY if preflight query 4 shows that every existing object's
-- mimetype is already inside the application allow-list below. These limits apply to
-- FUTURE uploads only and never alter existing objects, but an unexpected mimetype in
-- the wild would mean a future upload of that type is rejected at the storage layer.
-- The values mirror lib/server/studentFiles.js FILE_KIND_RULES exactly:
--   resume   pdf, doc, docx  (max 10 MB)
--   headshot jpg, jpeg, png  (max  5 MB)
-- file_size_limit takes the larger of the two (10 MB); the server already enforces the
-- per-kind limit before issuing an upload token.
/*
BEGIN;
UPDATE storage.buckets
SET file_size_limit    = 10485760,
    allowed_mime_types = ARRAY[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png'
    ]
WHERE id = 'student-files';
COMMIT;
*/


-- ── Verification (run separately, one at a time, AFTER applying) ─────────────
-- See db/audit/wave_f2_pass3_preflight_and_verification.sql (VERIFICATION section).

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Restores the pre-cutover state: bucket public again and the service_role policy
-- removed. It does NOT recreate the old anonymous policies, because those are the
-- finding this wave closes; if a full restore of the prior policy set is ever needed,
-- recreate them from the preflight query 2 output captured BEFORE applying (save that
-- result set). No storage object and no student reference is touched by either
-- direction.
/*
BEGIN;
DROP POLICY IF EXISTS "student-files-service-role-all" ON storage.objects;
UPDATE storage.buckets
SET public = true,
    file_size_limit = NULL,
    allowed_mime_types = NULL
WHERE id = 'student-files';
COMMIT;
*/
