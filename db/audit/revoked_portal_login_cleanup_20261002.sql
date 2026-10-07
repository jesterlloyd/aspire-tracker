-- ONE-TIME cleanup of the five reviewed, explicitly revoked portal logins.
-- Run the ENTIRE file in the production Supabase SQL Editor.
-- This permanently removes Auth accounts. It does NOT delete user_profiles,
-- student/contact records, grants, links, files, messages, or clinical history.
-- Any failed safety check aborts the transaction. Do not bypass it.

DO $cleanup$
DECLARE
  fk record;
  has_rows boolean;
  affected integer;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
CREATE TEMP TABLE pg_temp.revoked_login_targets (
  profile_id uuid PRIMARY KEY,
  auth_user_id uuid UNIQUE NOT NULL
) ON COMMIT DROP;

INSERT INTO pg_temp.revoked_login_targets VALUES
('244fb7c1-62c5-44a5-b6a3-764a3641d4c1', 'a4bdfe18-6b4e-4419-875c-8f2648ed1687'),
('8dea4b02-2a73-49ef-bb3b-894351973eab', '96dd9c8a-6383-4b00-b55a-3a86f5f9e597'),
('3c1f4c05-d1d0-4d42-9e54-b549440fe609', '526e83a3-62de-440d-9a31-3856959c361a'),
('220ec54e-d589-4239-af68-6cb5a09a68b5', 'dd724fe3-2308-4c66-ad10-9df5efcd3529'),
('88ec7126-8303-40d5-9afb-ad838fcbbe97', '8d723d10-544c-4239-80b1-50f28f8ce191');

-- Prevent a concurrent access grant or profile relink during these checks.
LOCK TABLE public.user_profiles, public.user_role_grants,
  public.user_student_links, public.user_unit_scopes, public.user_school_scopes
  IN SHARE ROW EXCLUSIVE MODE;


  PERFORM u.id FROM auth.users u JOIN pg_temp.revoked_login_targets t
    ON t.auth_user_id = u.id FOR UPDATE OF u;
  IF (SELECT count(*) FROM auth.users u JOIN pg_temp.revoked_login_targets t
        ON t.auth_user_id = u.id) <> 5 THEN
    RAISE EXCEPTION 'STOP: Expected all five reviewed Auth accounts. Nothing deleted.';
  END IF;

  IF (SELECT count(*) FROM public.user_profiles p JOIN pg_temp.revoked_login_targets t
        ON p.id = t.profile_id AND p.auth_user_id = t.auth_user_id
      WHERE p.role = 'portal' AND p.is_owner IS NOT TRUE
        AND COALESCE((to_jsonb(p)->>'can_conduct_interviews')::boolean, false) = false) <> 5
  THEN
    RAISE EXCEPTION 'STOP: A profile changed or has staff permissions.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_temp.revoked_login_targets t
    WHERE NOT EXISTS (SELECT 1 FROM public.user_role_grants g
                      WHERE g.user_profile_id = t.profile_id AND g.revoked_at IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.user_role_grants g
                  WHERE g.user_profile_id = t.profile_id AND g.revoked_at IS NULL)
       OR EXISTS (SELECT 1 FROM public.user_profiles p
                  WHERE p.auth_user_id = t.auth_user_id AND p.id <> t.profile_id)
  ) THEN
    RAISE EXCEPTION 'STOP: Missing revocation, unrevoked access, or shared login.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_student_links s JOIN pg_temp.revoked_login_targets t
             ON s.user_profile_id = t.profile_id WHERE s.revoked_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.user_unit_scopes s JOIN pg_temp.revoked_login_targets t
                ON s.user_profile_id = t.profile_id WHERE s.revoked_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.user_school_scopes s JOIN pg_temp.revoked_login_targets t
                ON s.user_profile_id = t.profile_id WHERE s.revoked_at IS NULL)
  THEN
    RAISE EXCEPTION 'STOP: An unrevoked portal link or scope still exists.';
  END IF;

  -- Preserve uploads: do not delete files or change their ownership.
  IF EXISTS (
    SELECT 1 FROM storage.objects o JOIN pg_temp.revoked_login_targets t
      ON to_jsonb(o)->>'owner_id' = t.auth_user_id::text
      OR to_jsonb(o)->>'owner' = t.auth_user_id::text
  ) THEN
    RAISE EXCEPTION 'STOP: A target owns uploaded files. Review ownership first; no files deleted.';
  END IF;

  -- Unknown custom deletion triggers need review before Auth deletion.
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal
      AND tgenabled <> 'D' AND (tgtype & 8) <> 0
  ) THEN
    RAISE EXCEPTION 'STOP: Custom Auth deletion trigger requires review.';
  END IF;

  -- Retain historical profile identity; remove only its login binding.
  UPDATE public.user_profiles p
    SET auth_user_id = NULL, login_enabled = false, is_active = false
    FROM pg_temp.revoked_login_targets t WHERE p.id = t.profile_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 5 THEN RAISE EXCEPTION 'STOP: Profile count mismatch.'; END IF;

  -- Live schema safeguard: no external rows may be cascaded or nulled by
  -- deleting Auth accounts. This also protects rotation creator attribution.
  FOR fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col,
           array_length(c.conkey, 1) AS column_count
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = 'auth.users'::regclass
      AND n.nspname <> 'auth'
  LOOP
    IF fk.column_count <> 1 THEN
      RAISE EXCEPTION 'STOP: Composite Auth reference requires review: %', fk.tbl;
    END IF;
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %s r JOIN pg_temp.revoked_login_targets t ON r.%I = t.auth_user_id)',
      fk.tbl, fk.col
    ) INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'STOP: % still references a target login. Preserving that data.', fk.tbl;
    END IF;
  END LOOP;

  DELETE FROM auth.users u USING pg_temp.revoked_login_targets t
    WHERE u.id = t.auth_user_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 5 THEN RAISE EXCEPTION 'STOP: Auth deletion count mismatch.'; END IF;
  RAISE NOTICE 'Removed five Auth logins; historical profiles and records retained.';
END;
$cleanup$;
