-- STUDIO-1: PRE and POST checks for 20261128000000_studio_designs.sql. Read-only.
-- PRE: user_profiles exists; neither Studio table nor the bucket does yet.
-- POST: both tables exist, RLS on, no policy, only service_role holds privileges, and the
--       studio-images bucket is public with the 5 MB limit and the four image types.

SELECT
  to_regclass('public.user_profiles')       IS NOT NULL AS user_profiles_present,
  to_regclass('public.studio_designs')      IS NOT NULL AS designs_present,
  to_regclass('public.studio_saved_blocks') IS NOT NULL AS saved_blocks_present,
  (SELECT count(*) FROM pg_class c WHERE c.relname IN ('studio_designs', 'studio_saved_blocks') AND c.relrowsecurity) AS rls_on,
  (SELECT count(*) FROM pg_policies WHERE tablename IN ('studio_designs', 'studio_saved_blocks')) AS policies,
  (SELECT string_agg(DISTINCT grantee, ',') FROM information_schema.role_table_grants
     WHERE table_name IN ('studio_designs', 'studio_saved_blocks')) AS grantees,
  (SELECT public FROM storage.buckets WHERE id = 'studio-images') AS bucket_public,
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'studio-images') AS bucket_limit,
  (SELECT allowed_mime_types FROM storage.buckets WHERE id = 'studio-images') AS bucket_types;
