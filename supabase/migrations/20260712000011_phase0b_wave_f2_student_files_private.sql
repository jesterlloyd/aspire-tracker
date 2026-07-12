-- ============================================================================
-- PHASE 0B, WAVE F-2: student-files private bucket + storage RLS
-- ============================================================================
-- Closes confirmed finding F7: student-files is a PUBLIC storage bucket that
-- contains student resumes and headshots, readable by anyone with (or able to
-- guess) the object URL.
--
-- *** DO NOT RUN YET. HARD GATE (constraint): do not make student-files       ***
-- *** private until the application has a VERIFIED replacement using          ***
-- *** authorized uploads and signed or authenticated downloads. Flipping the  ***
-- *** bucket private before that replacement is deployed WILL break:          ***
-- ***   - the public /student-form resume and headshot upload (anon write)    ***
-- ***   - every getPublicUrl() link the staff app renders                     ***
-- *** and existing stored resume_url/headshot_url values (full public URLs)   ***
-- *** will stop resolving.                                                     ***
--
-- Application prerequisite (must be deployed and verified first; see
-- docs/security/OWNER_SQL_GATE.md, "Wave F-2 code prerequisite"):
--   1. Public intake upload moves to a signed-upload-URL endpoint
--      (resolve student server-side, issue createSignedUploadUrl for
--      cohortId/studentId/<file>), storing the object PATH not a public URL.
--   2. Staff upload sites (StudentSidePanel, StudentRow) keep uploading under
--      the authenticated staff session via a storage INSERT policy, and store
--      the PATH.
--   3. All rendering switches getPublicUrl() -> createSignedUrl() (staff
--      SELECT policy below authorizes this), with a compatibility shim for
--      already-stored public-URL values until they are backfilled to paths.
--
-- Run the ENTIRE file as one block. Transactional, idempotent, rerunnable.
-- ============================================================================

BEGIN;

-- ── 1. Flip the bucket to private ────────────────────────────────────────────
UPDATE storage.buckets SET public = false WHERE id = 'student-files';

-- ── 2. Storage RLS for student-files (drop-then-create = idempotent) ─────────
-- service_role: full backend access (signed-upload issuance, deletes).
DROP POLICY IF EXISTS "student-files-service-role-all" ON storage.objects;
CREATE POLICY "student-files-service-role-all"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'student-files')
  WITH CHECK (bucket_id = 'student-files');

-- Staff read: lets an authenticated staff session call createSignedUrl on any
-- object in the bucket. Portal (non-staff) authenticated users are excluded.
DROP POLICY IF EXISTS "student-files-staff-read" ON storage.objects;
CREATE POLICY "student-files-staff-read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'student-files' AND public.is_staff());

-- Staff write: lets StudentSidePanel / StudentRow uploads continue under the
-- authenticated staff session (the public intake upload uses a service-role
-- signed-upload URL, so anon needs NO policy here).
DROP POLICY IF EXISTS "student-files-staff-insert" ON storage.objects;
CREATE POLICY "student-files-staff-insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'student-files' AND public.is_staff());

DROP POLICY IF EXISTS "student-files-staff-update" ON storage.objects;
CREATE POLICY "student-files-staff-update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'student-files' AND public.is_staff())
  WITH CHECK (bucket_id = 'student-files' AND public.is_staff());

COMMIT;

-- ── Verification ─────────────────────────────────────────────────────────────
-- 1. Bucket is private (expected public = false):
--   SELECT id, public FROM storage.buckets WHERE id = 'student-files';
-- 2. Exactly the four policies above exist for the bucket:
--   SELECT policyname, cmd, roles FROM pg_policies
--   WHERE schemaname='storage' AND tablename='objects'
--     AND policyname LIKE 'student-files-%' ORDER BY policyname;
-- 3. Post-apply smoke (with the app replacement live): submit /student-form
--    with a resume, confirm it stores and a staff user can open it via a
--    signed URL; confirm an anonymous GET of a raw object URL now returns 400.

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- Reverts to the pre-Wave-F-2 public bucket (re-opens finding F7). Use only if
-- the application replacement misbehaves and you must restore public delivery.
/*
BEGIN;
DROP POLICY IF EXISTS "student-files-service-role-all" ON storage.objects;
DROP POLICY IF EXISTS "student-files-staff-read"       ON storage.objects;
DROP POLICY IF EXISTS "student-files-staff-insert"     ON storage.objects;
DROP POLICY IF EXISTS "student-files-staff-update"     ON storage.objects;
UPDATE storage.buckets SET public = true WHERE id = 'student-files';
COMMIT;
*/
