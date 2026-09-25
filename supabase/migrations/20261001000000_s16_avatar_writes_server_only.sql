-- supabase/migrations/20261001000000_s16_avatar_writes_server_only.sql
--
-- S-16 (FINDINGS_REGISTER.md): avatar uploads bypass the server; avatar_url accepted as an
-- arbitrary string. The application side (commit S16-1) moved every upload onto a server
-- endpoint and made every writer of avatar_url refuse anything that is not a file in
-- ASPIRE's own Storage. This migration closes the paths a browser session could still
-- use WITHOUT the application:
--
--   1. user_profiles.avatar_url was a column any authenticated user could UPDATE on their
--      own row (Wave E, 20260712000004, granted it for the old self-service menu). The
--      grant is revoked; the five other self-service columns keep theirs.
--   2. update_my_avatar(p_url), dashboard-created, EXECUTE to authenticated (Wave F-1
--      allowlist). Nothing calls it any more; its body cannot be seen from the
--      repository, so it is not redefined. EXECUTE is revoked from PUBLIC, anon and
--      authenticated on every overload that exists. service_role keeps whatever it has.
--   3. contact-avatars: the two Storage policies that let an Owner or Admin session write
--      the bucket from the browser (20260601000001) are dropped by name. The public read
--      policy stays; stored avatar_url values keep resolving.
--   4. avatars: its policies were never in the repository. Any INSERT, UPDATE, DELETE or
--      ALL policy on storage.objects whose expression names the 'avatars' bucket is
--      dropped, and each name is raised as a NOTICE so the run records what went. A
--      SELECT-only policy is left alone.
--
-- Server endpoints upload with the service role, which bypasses Storage RLS, so nothing
-- the application does depends on any policy dropped here. No row is touched.
--
-- Owner-gated. Apply as ONE block. Checks, one section at a time, are in
-- db/audit/s16_avatar_writes_server_only_checks.sql: PRE 1 to 4 first, then this file,
-- then POST 1 to 4. Do not apply before commit S16-1 is live: the old UserMenu and the
-- old contact uploader would start failing on the revoked grant and policies.

BEGIN;

-- 1. The browser can no longer write avatar_url directly.
REVOKE UPDATE (avatar_url) ON public.user_profiles FROM authenticated;

-- 2. update_my_avatar: no browser caller. Revoke on every overload, if the function exists.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_my_avatar'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    RAISE NOTICE 'S-16: revoked browser EXECUTE on %', r.sig;
  END LOOP;
END $$;

-- 3. contact-avatars: the named browser write policies.
DROP POLICY IF EXISTS "contact-avatars-owner-admin-insert" ON storage.objects;
DROP POLICY IF EXISTS "contact-avatars-owner-admin-update" ON storage.objects;

-- 4. avatars: any write policy that names the bucket, whatever it was called.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND (coalesce(qual, '') ~ '''avatars''' OR coalesce(with_check, '') ~ '''avatars''')
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
    RAISE NOTICE 'S-16: dropped % policy % on storage.objects', r.cmd, r.policyname;
  END LOOP;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (Owner-gated, one block). Restores browser writes; do this only if the
-- application is rolled back below S16-1 as well.
--
--   BEGIN;
--   GRANT UPDATE (avatar_url) ON public.user_profiles TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.update_my_avatar(text) TO authenticated;
--   -- then re-run sections 3 and 4 of
--   -- supabase/migrations/20260601000001_contact_avatars_bucket.sql to recreate
--   -- contact-avatars-owner-admin-insert and contact-avatars-owner-admin-update.
--   COMMIT;
--
-- The avatars-bucket policies dropped in step 4 were dashboard-created and are not in the
-- repository; the NOTICE lines from the apply are the record of their names, and their
-- expressions are what PRE 3 of the audit file printed before the apply.
-- ─────────────────────────────────────────────────────────────────────────────
