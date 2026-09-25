-- Checks for supabase/migrations/20261001000000_s16_avatar_writes_server_only.sql
-- READ ONLY. Nothing here creates, alters, writes or deletes anything. No names, emails
-- or URLs are selected; only catalog facts and counts.
--
-- Run each numbered section on its own in the Supabase SQL editor, in this order:
--   PRE 1 to PRE 4, then the migration as ONE block, then POST 1 to POST 4.
-- Keep the PRE 3 result: it is the only record of the avatars-bucket policy expressions
-- the migration drops. Keep PRE 4 to compare with POST 4.

-- ── PRE 1: which user_profiles columns the browser may UPDATE today ──────────
-- Expect: avatar_url, last_login_at, onboarding_tour_completed,
-- onboarding_tour_completed_at, onboarding_tour_dismissed, onboarding_tour_version
-- (six rows). STOP if avatar_url is absent: the grant is already gone, go to POST 1.
SELECT column_name
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'user_profiles'
  AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
ORDER BY column_name;

-- ── PRE 2: update_my_avatar, its overloads and who may execute it ────────────
-- Expect: one row per overload (normally one, update_my_avatar(text)), with
-- authenticated true. Zero rows means the function does not exist on this instance,
-- which is fine: step 2 of the migration then does nothing.
SELECT p.oid::regprocedure AS signature,
       p.prosecdef AS security_definer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'update_my_avatar'
ORDER BY 1;

-- ── PRE 3: every Storage policy that names either avatar bucket ──────────────
-- Expect: contact-avatars-public-read (SELECT), contact-avatars-owner-admin-insert
-- (INSERT), contact-avatars-owner-admin-update (UPDATE), plus whatever dashboard-created
-- policies exist for the avatars bucket. KEEP THIS RESULT: the write policies for
-- 'avatars' are dropped by expression match and their text lives nowhere else.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (coalesce(qual, '') ~ '''(avatars|contact-avatars)'''
       OR coalesce(with_check, '') ~ '''(avatars|contact-avatars)''')
ORDER BY policyname;

-- ── PRE 4: stored avatar_url values, and how many are outside ASPIRE's Storage ─
-- Expect: any numbers. "outside" counts values that are neither empty nor a public
-- object in the avatars or contact-avatars bucket; those were pasted or written before
-- S-16 and keep rendering (an unchanged value passes validation on later saves) until
-- replaced through an upload or cleared. The migration changes no row, so POST 4 must
-- match exactly.
SELECT 'user_profiles' AS t,
       count(*) FILTER (WHERE coalesce(avatar_url, '') <> '') AS with_avatar,
       count(*) FILTER (WHERE coalesce(avatar_url, '') <> ''
                          AND avatar_url NOT LIKE '%/storage/v1/object/public/avatars/%'
                          AND avatar_url NOT LIKE '%/storage/v1/object/public/contact-avatars/%') AS outside_own_storage
FROM public.user_profiles
UNION ALL
SELECT 'contacts',
       count(*) FILTER (WHERE coalesce(avatar_url, '') <> ''),
       count(*) FILTER (WHERE coalesce(avatar_url, '') <> ''
                          AND avatar_url NOT LIKE '%/storage/v1/object/public/avatars/%'
                          AND avatar_url NOT LIKE '%/storage/v1/object/public/contact-avatars/%')
FROM public.contacts
ORDER BY t;

-- ═════════════════════════════════════════════════════════════════════════════
-- APPLY supabase/migrations/20261001000000_s16_avatar_writes_server_only.sql
-- as ONE block. Expected: "Success. No rows returned." plus NOTICE lines naming each
-- revoked overload and each dropped avatars-bucket policy (the editor shows NOTICEs
-- under the result; note them down).
-- ═════════════════════════════════════════════════════════════════════════════

-- ── POST 1: avatar_url is no longer browser-writable; the other five columns are ─
-- Expect exactly five rows: last_login_at, onboarding_tour_completed,
-- onboarding_tour_completed_at, onboarding_tour_dismissed, onboarding_tour_version.
-- STOP if avatar_url is still listed. STOP if any of the five is missing (the REVOKE
-- was column-scoped and must not have touched them).
SELECT column_name
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'user_profiles'
  AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
ORDER BY column_name;

-- ── POST 2: no browser may execute update_my_avatar ──────────────────────────
-- Expect: the same overloads as PRE 2 with authenticated false and anon false
-- (service_role as it was). Zero rows if the function does not exist. STOP if
-- authenticated is true.
SELECT p.oid::regprocedure AS signature,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'update_my_avatar'
ORDER BY 1;

-- ── POST 3: no write policy names either bucket; the read policy remains ─────
-- Expect: contact-avatars-public-read (SELECT) and, if one existed in PRE 3, a
-- SELECT-only policy for avatars. No INSERT, UPDATE, DELETE or ALL row.
-- STOP if any row has cmd other than SELECT.
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (coalesce(qual, '') ~ '''(avatars|contact-avatars)'''
       OR coalesce(with_check, '') ~ '''(avatars|contact-avatars)''')
ORDER BY policyname;

-- ── POST 4: no row changed ───────────────────────────────────────────────────
-- Expect: exactly the numbers PRE 4 returned.
SELECT 'user_profiles' AS t,
       count(*) FILTER (WHERE coalesce(avatar_url, '') <> '') AS with_avatar,
       count(*) FILTER (WHERE coalesce(avatar_url, '') <> ''
                          AND avatar_url NOT LIKE '%/storage/v1/object/public/avatars/%'
                          AND avatar_url NOT LIKE '%/storage/v1/object/public/contact-avatars/%') AS outside_own_storage
FROM public.user_profiles
UNION ALL
SELECT 'contacts',
       count(*) FILTER (WHERE coalesce(avatar_url, '') <> ''),
       count(*) FILTER (WHERE coalesce(avatar_url, '') <> ''
                          AND avatar_url NOT LIKE '%/storage/v1/object/public/avatars/%'
                          AND avatar_url NOT LIKE '%/storage/v1/object/public/contact-avatars/%')
FROM public.contacts
ORDER BY t;
