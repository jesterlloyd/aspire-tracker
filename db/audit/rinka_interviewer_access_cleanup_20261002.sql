-- ONE-TIME removal of Rinka Shiraishi's login only.
-- Run this entire file. Any failed check rolls back all changes.
-- Preserves contact, profile, interview and other historical records.
DO $cleanup$
DECLARE
  fk record;
  has_rows boolean;
  affected integer;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
CREATE TEMP TABLE pg_temp.rinka_login_target (
  profile_id uuid PRIMARY KEY,
  auth_user_id uuid UNIQUE NOT NULL
) ON COMMIT DROP;

INSERT INTO pg_temp.rinka_login_target VALUES
('b24c05f9-7951-4cfd-bde5-385f0268b8a4', '30339111-b898-42d3-9959-a204ddcaaf61');

-- Prevent a concurrent access grant or profile relink during these checks.
LOCK TABLE public.user_profiles, public.user_role_grants,
  public.user_student_links, public.user_unit_scopes, public.user_school_scopes
  IN SHARE ROW EXCLUSIVE MODE;


  PERFORM u.id FROM auth.users u JOIN pg_temp.rinka_login_target t
    ON t.auth_user_id = u.id FOR UPDATE OF u;
  IF (SELECT count(*) FROM auth.users u JOIN pg_temp.rinka_login_target t
        ON t.auth_user_id = u.id) <> 1 THEN
    RAISE EXCEPTION 'STOP: Expected all one reviewed Auth accounts. Nothing deleted.';
  END IF;

  IF (SELECT count(*) FROM public.user_profiles p JOIN pg_temp.rinka_login_target t
        ON p.id = t.profile_id AND p.auth_user_id = t.auth_user_id
      WHERE p.role = 'interviewer' AND p.is_owner IS NOT TRUE
        AND p.is_active IS FALSE
        AND lower(p.email) = 'rinka.shiraishi@cshs.org') <> 1
  THEN
    RAISE EXCEPTION 'STOP: A profile changed or has staff permissions.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_temp.rinka_login_target t
    WHERE EXISTS (SELECT 1 FROM public.user_role_grants g
                  WHERE g.user_profile_id = t.profile_id AND g.revoked_at IS NULL)
       OR EXISTS (SELECT 1 FROM public.user_profiles p
                  WHERE p.auth_user_id = t.auth_user_id AND p.id <> t.profile_id)
  ) THEN
    RAISE EXCEPTION 'STOP: Missing revocation, unrevoked access, or shared login.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_student_links s JOIN pg_temp.rinka_login_target t
             ON s.user_profile_id = t.profile_id WHERE s.revoked_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.user_unit_scopes s JOIN pg_temp.rinka_login_target t
                ON s.user_profile_id = t.profile_id WHERE s.revoked_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.user_school_scopes s JOIN pg_temp.rinka_login_target t
                ON s.user_profile_id = t.profile_id WHERE s.revoked_at IS NULL)
  THEN
    RAISE EXCEPTION 'STOP: An unrevoked portal link or scope still exists.';
  END IF;

  -- Preserve uploads: do not delete files or change their ownership.
  IF EXISTS (
    SELECT 1 FROM storage.objects o JOIN pg_temp.rinka_login_target t
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
    SET auth_user_id = NULL, login_enabled = false, is_active = false,
        can_conduct_interviews = false
    FROM pg_temp.rinka_login_target t WHERE p.id = t.profile_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'STOP: Profile count mismatch.'; END IF;

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
      'SELECT EXISTS (SELECT 1 FROM %s r JOIN pg_temp.rinka_login_target t ON r.%I = t.auth_user_id)',
      fk.tbl, fk.col
    ) INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'STOP: % still references a target login. Preserving that data.', fk.tbl;
    END IF;
  END LOOP;

  DELETE FROM auth.users u USING pg_temp.rinka_login_target t
    WHERE u.id = t.auth_user_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'STOP: Auth deletion count mismatch.'; END IF;
  -- Directory-only filtering; historical profiles remain in the database.
  -- Preserve the existing authorization check and function privileges.
  EXECUTE $directory$
    CREATE OR REPLACE FUNCTION public.get_all_user_profiles()
    RETURNS SETOF public.user_profiles
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $body$
    BEGIN
      IF NOT public.is_owner_or_admin() THEN
        RAISE EXCEPTION 'Insufficient permissions';
      END IF;
      RETURN QUERY
      SELECT p.*
      FROM public.user_profiles p
      WHERE NOT (
        p.is_owner IS NOT TRUE
        AND p.auth_user_id IS NULL
        AND p.login_enabled IS FALSE
        AND p.is_active IS FALSE
      )
      ORDER BY p.created_at DESC;
    END;
    $body$;
  $directory$;
  RAISE NOTICE 'Removed one Auth logins; historical profiles and records retained.';
END;
$cleanup$;

