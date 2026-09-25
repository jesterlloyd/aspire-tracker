-- supabase/migrations/20261002000000_s08_school_form_password_hash.sql
--
-- S-08, step A of two: the school form password becomes a bcrypt hash in a table no
-- browser can read, and the two password RPCs get bodies that live in this repository.
--
-- WHAT IS WRONG. cohorts.school_form_password holds each cohort's coordinator password
-- in plaintext. Every staff session that selects cohorts (the app does `select *`)
-- receives it, every backup holds it, and the Manage Cohort modal prefilled it into a
-- text input. verify_school_form_password and school_form_requires_password were
-- created in the dashboard; their bodies are not in this repository.
--
-- WHAT THIS DOES, in one transaction:
--   1. Makes sure pgcrypto is installed (Supabase keeps it in the `extensions` schema;
--      elsewhere it lands in public) and finds the schema crypt() lives in, so the
--      function bodies name it fully qualified under the pinned search_path.
--   2. Creates public.cohort_form_secrets (cohort_id, password_hash): RLS on, NO policy
--      for anon or authenticated, so a hash never reaches a browser; only service_role
--      and the SECURITY DEFINER functions below can read it.
--   3. Replaces the two dashboard-created RPCs with repository definitions of the same
--      signatures, SECURITY DEFINER, search_path = public, pg_catalog, EXECUTE to anon,
--      authenticated and service_role (anon MUST keep it: the public school form calls
--      both before anyone signs in). verify_school_form_password checks the hash first
--      and, ONLY while the plaintext column still exists, falls back to the old
--      TRIM-equality comparison, so the app and this file can land in either order.
--   4. Adds set_school_form_password(cohort, password), service_role only: hashes with
--      bcrypt (cost 10), stores the hash, and NULLs the plaintext for that cohort. An
--      empty password clears the secret. The Owner/Admin endpoint
--      api/cohort-password-set.js is its only caller.
--   5. Backfills a hash for every cohort that has a plaintext password, then PROVES
--      inside the transaction that verify_school_form_password accepts each cohort's
--      own plaintext through the hash path. One mismatch raises and nothing commits.
--
-- TRIM is preserved: the hash is taken over btrim(password) and the entered value is
-- btrim'd before comparison, exactly what the old TRIM(stored) = TRIM(entered) did, so
-- no password that verifies today is refused after this. The plaintext column is NOT
-- dropped here; that is step B (20261003000000), which runs only after the code that
-- stops writing plaintext (S08-1) is live and POST-A has passed.
--
-- Owner-gated. Apply as ONE block. Checks, one section at a time, are in
-- db/audit/s08_school_form_password_hash_checks.sql: PRE-A 1 to 4, then this file, then
-- POST-A 1 to 5. No password value is selected, printed or logged by anything here.

BEGIN;

-- ── 1. pgcrypto ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    IF to_regnamespace('extensions') IS NOT NULL THEN
      EXECUTE 'CREATE EXTENSION pgcrypto WITH SCHEMA extensions';
    ELSE
      EXECUTE 'CREATE EXTENSION pgcrypto';
    END IF;
  END IF;
END $$;

-- ── 2. The secrets table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cohort_form_secrets (
  cohort_id     uuid        PRIMARY KEY REFERENCES public.cohorts(id) ON DELETE CASCADE,
  password_hash text        NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL
);
COMMENT ON TABLE public.cohort_form_secrets IS
  'S-08: bcrypt hash of each cohort''s school form password. No browser role can read this table; verify_school_form_password (SECURITY DEFINER) compares against it and set_school_form_password (service_role) writes it.';
ALTER TABLE public.cohort_form_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cohort_form_secrets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cohort_form_secrets TO service_role;

-- ── 3 and 4. The functions, named against the schema pgcrypto lives in ───────
DO $$
DECLARE
  s text;
BEGIN
  SELECT n.nspname INTO s
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'crypt' AND p.pronargs = 2
  LIMIT 1;
  IF s IS NULL THEN
    RAISE EXCEPTION 'S-08: pgcrypto crypt() is not installed; nothing was applied';
  END IF;

  -- The dashboard-created functions may carry different parameter names, which
  -- CREATE OR REPLACE would refuse, so they are dropped and recreated. Grants are
  -- restated below; nothing else depends on them (PRE-A 2 proves it).
  EXECUTE 'DROP FUNCTION IF EXISTS public.school_form_requires_password(uuid)';
  EXECUTE 'DROP FUNCTION IF EXISTS public.verify_school_form_password(uuid, text)';
  EXECUTE 'DROP FUNCTION IF EXISTS public.set_school_form_password(uuid, text)';

  EXECUTE format($f$
    CREATE FUNCTION public.school_form_requires_password(p_cohort_id uuid)
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public, pg_catalog
    AS $body$
      SELECT EXISTS (SELECT 1 FROM public.cohort_form_secrets s WHERE s.cohort_id = p_cohort_id)
          -- transition only: a plaintext value written before the app moved to the
          -- hashing endpoint still counts. Step B removes this branch with the column.
          OR EXISTS (SELECT 1 FROM public.cohorts c
                     WHERE c.id = p_cohort_id AND btrim(coalesce(c.school_form_password, '')) <> '');
    $body$
  $f$);

  EXECUTE format($f$
    CREATE FUNCTION public.verify_school_form_password(p_cohort_id uuid, p_entered_password text)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    STABLE
    SET search_path = public, pg_catalog
    AS $body$
    DECLARE
      v     text := btrim(coalesce(p_entered_password, ''));
      h     text;
      plain text;
    BEGIN
      IF v = '' THEN RETURN false; END IF;
      SELECT password_hash INTO h FROM public.cohort_form_secrets WHERE cohort_id = p_cohort_id;
      IF h IS NOT NULL THEN
        RETURN %1$I.crypt(v, h) = h;
      END IF;
      -- transition only: no hash yet, so the old TRIM-equality rule decides. Step B
      -- removes this branch with the column.
      SELECT school_form_password INTO plain FROM public.cohorts WHERE id = p_cohort_id;
      IF btrim(coalesce(plain, '')) = '' THEN RETURN false; END IF;
      RETURN btrim(plain) = v;
    END
    $body$
  $f$, s);

  EXECUTE format($f$
    CREATE FUNCTION public.set_school_form_password(p_cohort_id uuid, p_password text)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_catalog
    AS $body$
    DECLARE
      v text := btrim(coalesce(p_password, ''));
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.cohorts WHERE id = p_cohort_id) THEN RETURN false; END IF;
      IF v = '' THEN
        DELETE FROM public.cohort_form_secrets WHERE cohort_id = p_cohort_id;
      ELSE
        INSERT INTO public.cohort_form_secrets (cohort_id, password_hash, updated_at)
        VALUES (p_cohort_id, %1$I.crypt(v, %1$I.gen_salt('bf', 10)), now())
        ON CONFLICT (cohort_id) DO UPDATE
          SET password_hash = EXCLUDED.password_hash, updated_at = now();
      END IF;
      -- Whatever happens to the hash, no plaintext stays behind for this cohort.
      UPDATE public.cohorts SET school_form_password = NULL
       WHERE id = p_cohort_id AND school_form_password IS NOT NULL;
      RETURN true;
    END
    $body$
  $f$, s);

  -- ── 5. Backfill and prove ─────────────────────────────────────────────────
  EXECUTE format($f$
    INSERT INTO public.cohort_form_secrets (cohort_id, password_hash)
    SELECT c.id, %1$I.crypt(btrim(c.school_form_password), %1$I.gen_salt('bf', 10))
    FROM public.cohorts c
    WHERE btrim(coalesce(c.school_form_password, '')) <> ''
      AND NOT EXISTS (SELECT 1 FROM public.cohort_form_secrets x WHERE x.cohort_id = c.id)
  $f$, s);
END $$;

REVOKE ALL ON FUNCTION public.school_form_requires_password(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_school_form_password(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_school_form_password(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.school_form_requires_password(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_school_form_password(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_school_form_password(uuid, text) TO service_role;

-- Every cohort that holds a plaintext password must verify through the NEW function,
-- which prefers the hash. One failure rolls the whole file back. The password itself
-- is passed from column to function inside the database and never leaves it.
DO $$
DECLARE
  c  record;
  n  integer := 0;
BEGIN
  FOR c IN SELECT id, name, school_form_password FROM public.cohorts
           WHERE btrim(coalesce(school_form_password, '')) <> ''
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.cohort_form_secrets x WHERE x.cohort_id = c.id) THEN
      RAISE EXCEPTION 'S-08: cohort % has no hash after the backfill; nothing was applied', c.name;
    END IF;
    IF NOT public.verify_school_form_password(c.id, c.school_form_password) THEN
      RAISE EXCEPTION 'S-08: cohort % does not verify through its hash; nothing was applied', c.name;
    END IF;
    IF public.verify_school_form_password(c.id, c.school_form_password || '-not-the-password') THEN
      RAISE EXCEPTION 'S-08: cohort % accepts a wrong password; nothing was applied', c.name;
    END IF;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'S-08: % cohort password(s) hashed and re-verified through the hash', n;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (Owner-gated, one block). Restores the pre-S-08 state: the plaintext column
-- is untouched by this file, so only the new objects go and the two RPCs return to their
-- plaintext bodies (the semantics PRE-A 1 recorded before the apply).
--
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.set_school_form_password(uuid, text);
--   DROP FUNCTION IF EXISTS public.verify_school_form_password(uuid, text);
--   DROP FUNCTION IF EXISTS public.school_form_requires_password(uuid);
--   CREATE FUNCTION public.school_form_requires_password(p_cohort_id uuid)
--   RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_catalog AS $$
--     SELECT EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = p_cohort_id
--                    AND btrim(coalesce(c.school_form_password, '')) <> '');
--   $$;
--   CREATE FUNCTION public.verify_school_form_password(p_cohort_id uuid, p_entered_password text)
--   RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_catalog AS $$
--     SELECT EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = p_cohort_id
--                    AND btrim(coalesce(c.school_form_password, '')) <> ''
--                    AND btrim(c.school_form_password) = btrim(coalesce(p_entered_password, '')));
--   $$;
--   REVOKE ALL ON FUNCTION public.school_form_requires_password(uuid) FROM PUBLIC;
--   REVOKE ALL ON FUNCTION public.verify_school_form_password(uuid, text) FROM PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.school_form_requires_password(uuid) TO anon, authenticated, service_role;
--   GRANT EXECUTE ON FUNCTION public.verify_school_form_password(uuid, text) TO anon, authenticated, service_role;
--   DROP TABLE IF EXISTS public.cohort_form_secrets;
--   COMMIT;
--
-- If the live bodies PRE-A 1 printed differ from the two above, restore those instead.
-- ─────────────────────────────────────────────────────────────────────────────
