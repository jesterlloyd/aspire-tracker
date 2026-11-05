-- db/maintenance/move_alumni_portal_email_20261105.sql
--
-- ALUMNUS-EMAIL-1 follow-up (Owner, 2026-11-05). The Spring 2026 Transition Form sends went to
-- school addresses (no rotation row, so the old rule chose school), and each send created a
-- Student Portal account on that address. This moves the sign-in email of those accounts to the
-- alumnus's personal email, only where nothing is lost. An account is moved when ALL hold:
--   - its student is Completed, real (not demo), ASPIRE cohort Spring 2026
--   - the account's email is the school email, and a different, valid personal email is on file
--   - it has never signed in (user_profiles.last_login_at and auth last_sign_in_at both null)
--   - it links exactly this one student and holds no role but student
--   - it has exactly one identity (email) and no pending email change
--   - no other account, auth or profile, already uses the personal email
-- (Kelly Yam fails the last rule and is left alone.) The three Spring 2026 alumni who signed in
-- and the Fall 2026 internship accounts are not touched.
--
-- Three writes per account, in one transaction: auth.users.email, the email identity's
-- identity_data.email, user_profiles.email. Nothing is emailed. The transaction refuses to commit
-- unless exactly the expected number of accounts qualify.
--
-- Read-only preview: run the SELECT at the bottom of section 1 alone.
-- ROLLBACK (puts each moved account back on its school email, which students.school_email still
-- holds): see the end of this file.

BEGIN;

CREATE TEMP TABLE move_targets ON COMMIT DROP AS
SELECT s.id AS student_id, up.id AS profile_id, up.auth_user_id,
       lower(btrim(s.school_email)) AS school, lower(btrim(s.personal_email)) AS personal
  FROM public.students s
  JOIN public.user_student_links l ON l.student_id = s.id AND l.revoked_at IS NULL
  JOIN public.user_profiles up ON up.id = l.user_profile_id
  JOIN auth.users au ON au.id = up.auth_user_id
 WHERE s.status = 'Completed' AND s.is_demo IS NOT TRUE AND s.aspire_cohort = 'Spring 2026'
   AND lower(up.email) = lower(btrim(s.school_email))
   AND lower(au.email) = lower(btrim(s.school_email))
   AND coalesce(btrim(s.personal_email), '') <> ''
   AND lower(btrim(s.personal_email)) <> lower(btrim(s.school_email))
   AND btrim(s.personal_email) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
   AND up.last_login_at IS NULL AND au.last_sign_in_at IS NULL
   AND coalesce(au.email_change, '') = ''
   AND (SELECT count(*) FROM public.user_student_links l2 WHERE l2.user_profile_id = up.id AND l2.revoked_at IS NULL) = 1
   AND NOT EXISTS (SELECT 1 FROM public.user_role_grants g WHERE g.user_profile_id = up.id AND g.revoked_at IS NULL AND g.role <> 'student')
   AND (SELECT count(*) FROM auth.identities i WHERE i.user_id = au.id) = 1
   AND EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = au.id AND i.provider = 'email')
   AND NOT EXISTS (SELECT 1 FROM auth.users a2 WHERE lower(a2.email) = lower(btrim(s.personal_email)) AND a2.id <> au.id)
   AND NOT EXISTS (SELECT 1 FROM public.user_profiles p2 WHERE lower(p2.email) = lower(btrim(s.personal_email)) AND p2.id <> up.id);

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM move_targets;
  IF n <> 27 THEN RAISE EXCEPTION 'expected 27 accounts to move, found %; nothing changed', n; END IF;
  IF (SELECT count(DISTINCT personal) FROM move_targets) <> n THEN RAISE EXCEPTION 'two accounts share a personal email; nothing changed'; END IF;
END $$;

UPDATE auth.users u SET email = t.personal, updated_at = now()
  FROM move_targets t WHERE u.id = t.auth_user_id;

UPDATE auth.identities i
   SET identity_data = jsonb_set(i.identity_data, '{email}', to_jsonb(t.personal)), updated_at = now()
  FROM move_targets t WHERE i.user_id = t.auth_user_id AND i.provider = 'email';

UPDATE public.user_profiles p SET email = t.personal, updated_at = now()
  FROM move_targets t WHERE p.id = t.profile_id;

-- What moved (no addresses): 27 rows, each with every write landed.
SELECT s.last_name,
       lower(au.email) = t.personal AS auth_moved,
       lower(i.identity_data->>'email') = t.personal AS identity_moved,
       lower(p.email) = t.personal AS profile_moved
  FROM move_targets t
  JOIN public.students s ON s.id = t.student_id
  JOIN auth.users au ON au.id = t.auth_user_id
  JOIN auth.identities i ON i.user_id = t.auth_user_id AND i.provider = 'email'
  JOIN public.user_profiles p ON p.id = t.profile_id
 ORDER BY s.last_name;

COMMIT;

-- ROLLBACK (only for accounts still never signed in; run as one transaction):
--   BEGIN;
--   CREATE TEMP TABLE back ON COMMIT DROP AS
--   SELECT up.id AS profile_id, up.auth_user_id, lower(btrim(s.school_email)) AS school
--     FROM public.students s
--     JOIN public.user_student_links l ON l.student_id = s.id AND l.revoked_at IS NULL
--     JOIN public.user_profiles up ON up.id = l.user_profile_id
--    WHERE s.aspire_cohort = 'Spring 2026' AND s.status = 'Completed' AND s.is_demo IS NOT TRUE
--      AND lower(up.email) = lower(btrim(s.personal_email)) AND up.last_login_at IS NULL
--      AND up.updated_at >= '2026-11-05';
--   UPDATE auth.users u SET email = b.school, updated_at = now() FROM back b WHERE u.id = b.auth_user_id;
--   UPDATE auth.identities i SET identity_data = jsonb_set(i.identity_data, '{email}', to_jsonb(b.school)), updated_at = now()
--     FROM back b WHERE i.user_id = b.auth_user_id AND i.provider = 'email';
--   UPDATE public.user_profiles p SET email = b.school, updated_at = now() FROM back b WHERE p.id = b.profile_id;
--   COMMIT;
