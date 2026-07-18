-- ============================================================================
-- WAVE F-2 PASS 3 (DRAFT): student-files private-bucket cutover
-- ============================================================================
-- *** DO NOT APPLY. This is a gated draft prepared during Pass 1.             ***
-- *** Apply only AFTER Pass 1 is deployed and manually accepted AND Pass 2    ***
-- *** backfill has run and been verified. Flipping the bucket private is the  ***
-- *** privacy cutover; keep it separate from the Pass 2 data migration.       ***
--
-- Supersedes 20260712000014_phase0b_wave_f2_student_files_private.sql
--   That earlier draft added broad public.is_staff() SELECT / INSERT / UPDATE
--   storage policies. Under the Wave F-2 server-mediated design the browser NEVER
--   reads or writes storage directly: reads are service-role createSignedUrl via
--   /api/student-file-access (+ portal), uploads are service-role signed-upload
--   tokens, cleanup is service-role. So NO authenticated staff storage policy is
--   needed, and none is created here. Do not apply the superseded draft.
--
-- Effect
--   1. student-files bucket becomes private (public = false).
--   2. Only service_role has a storage.objects policy for the bucket. authenticated
--      and anon get NO policy, so a raw object URL stops resolving for everyone;
--      access is exclusively through the signed URLs the API mints.
--
-- Prerequisite (must be true before applying)
--   - Pass 1 deployed and accepted: all reads/uploads go through the API; no
--     getPublicUrl-rendered <img>/<a> to student-files remains in the app.
--   - Pass 2 backfill verified: stored values are canonical paths.
--
-- Run the ENTIRE file as one block. Transactional, idempotent, rerunnable.
-- ============================================================================

BEGIN;

-- ── 1. Flip the bucket private ───────────────────────────────────────────────
UPDATE storage.buckets SET public = false WHERE id = 'student-files';

-- ── 2. Remove any legacy anon/authenticated student-files object policies ─────
-- (Idempotent: only drops if present. These are the pre-Wave-F-2 public-era
-- policies and the superseded 000014 staff policies; none are recreated.)
DROP POLICY IF EXISTS "Student files: anon insert (school-form)" ON storage.objects;
DROP POLICY IF EXISTS "anon_upload_student_files"                ON storage.objects;
DROP POLICY IF EXISTS "anon_update_student_files"                ON storage.objects;
DROP POLICY IF EXISTS "student-files-staff-read"                 ON storage.objects;
DROP POLICY IF EXISTS "student-files-staff-insert"               ON storage.objects;
DROP POLICY IF EXISTS "student-files-staff-update"               ON storage.objects;

-- ── 3. service_role full access (all storage access is server-mediated) ──────
DROP POLICY IF EXISTS "student-files-service-role-all" ON storage.objects;
CREATE POLICY "student-files-service-role-all"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'student-files')
  WITH CHECK (bucket_id = 'student-files');

COMMIT;

-- ── Verification ─────────────────────────────────────────────────────────────
-- 1. Bucket is private (expected public = false):
--   SELECT id, public FROM storage.buckets WHERE id = 'student-files';
-- 2. Only the service_role policy exists for the bucket (no is_staff, no anon):
--   SELECT policyname, cmd, roles FROM pg_policies
--   WHERE schemaname='storage' AND tablename='objects'
--     AND policyname LIKE 'student-files-%' ORDER BY policyname;
-- 3. Post-apply smoke (with Pass 1 live): a staff user opens a resume/headshot via
--    a signed URL; the Student Portal shows its own headshot; an anonymous GET of a
--    raw object URL now fails; intake upload still succeeds via the signed-upload
--    endpoint.

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Restores the public bucket (re-opens finding F7). Use only if the server-mediated
-- delivery misbehaves and public delivery must be restored temporarily.
/*
BEGIN;
DROP POLICY IF EXISTS "student-files-service-role-all" ON storage.objects;
UPDATE storage.buckets SET public = true WHERE id = 'student-files';
COMMIT;
*/
