-- supabase/migrations/20261003000000_s08_school_form_password_plaintext_drop.sql
--
-- S-08, step B of two: the plaintext column goes, and the RPCs lose their transition
-- fallback. Run ONLY when all three of these are true:
--
--   1. 20261002000000_s08_school_form_password_hash.sql is applied and POST-A 1 to 5
--      passed (every cohort with a password has a hash that verifies).
--   2. The application commit S08-1 is LIVE in production: the cohort modals set the
--      password through api/cohort-password-set.js and nothing writes the column. After
--      this file, a write to cohorts.school_form_password fails, so the old modal code
--      would break cohort saves.
--   3. PRE-B 1 and 2 passed: no plaintext row is without a hash, and nothing else in the
--      database depends on the column.
--
-- In one transaction: proves again that every remaining plaintext value verifies through
-- its hash, NULLs the plaintext, drops the column, and recreates the three functions
-- without the fallback branch, same signatures, SECURITY DEFINER, pinned search_path,
-- same grants (anon keeps EXECUTE on the two public ones).
--
-- Owner-gated. Apply as ONE block. Then POST-B 1 to 4 in
-- db/audit/s08_school_form_password_hash_checks.sql. No password value is selected,
-- printed or logged by anything here.

BEGIN;

-- ── 1 and 2. Refuse to drop a password that has no hash; then no plaintext remains ─
-- The column is read through EXECUTE so this file can be re-run after it is gone
-- (a second run is a no-op rather than an error).
DO $$
DECLARE
  c record;
  column_present boolean;
BEGIN
  IF to_regclass('public.cohort_form_secrets') IS NULL THEN
    RAISE EXCEPTION 'S-08: cohort_form_secrets does not exist; apply 20261002000000 first';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cohorts' AND column_name = 'school_form_password'
  ) INTO column_present;
  IF NOT column_present THEN
    RAISE NOTICE 'S-08: the plaintext column is already gone; functions are (re)defined below';
    RETURN;
  END IF;
  FOR c IN EXECUTE $q$ SELECT id, name, school_form_password FROM public.cohorts
                       WHERE btrim(coalesce(school_form_password, '')) <> '' $q$
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.cohort_form_secrets x WHERE x.cohort_id = c.id) THEN
      RAISE EXCEPTION 'S-08: cohort % still has a plaintext password and no hash; nothing was applied', c.name;
    END IF;
    IF NOT public.verify_school_form_password(c.id, c.school_form_password) THEN
      RAISE EXCEPTION 'S-08: cohort % does not verify through its hash; nothing was applied', c.name;
    END IF;
  END LOOP;
  EXECUTE 'UPDATE public.cohorts SET school_form_password = NULL WHERE school_form_password IS NOT NULL';
END $$;

ALTER TABLE public.cohorts DROP COLUMN IF EXISTS school_form_password;

-- ── 3. The functions, without the transition branch ──────────────────────────
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

  EXECUTE 'DROP FUNCTION IF EXISTS public.school_form_requires_password(uuid)';
  EXECUTE 'DROP FUNCTION IF EXISTS public.verify_school_form_password(uuid, text)';
  EXECUTE 'DROP FUNCTION IF EXISTS public.set_school_form_password(uuid, text)';

  EXECUTE $f$
    CREATE FUNCTION public.school_form_requires_password(p_cohort_id uuid)
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public, pg_catalog
    AS $body$
      SELECT EXISTS (SELECT 1 FROM public.cohort_form_secrets s WHERE s.cohort_id = p_cohort_id);
    $body$
  $f$;

  EXECUTE format($f$
    CREATE FUNCTION public.verify_school_form_password(p_cohort_id uuid, p_entered_password text)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    STABLE
    SET search_path = public, pg_catalog
    AS $body$
    DECLARE
      v text := btrim(coalesce(p_entered_password, ''));
      h text;
    BEGIN
      IF v = '' THEN RETURN false; END IF;
      SELECT password_hash INTO h FROM public.cohort_form_secrets WHERE cohort_id = p_cohort_id;
      IF h IS NULL THEN RETURN false; END IF;
      RETURN %1$I.crypt(v, h) = h;
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
      RETURN true;
    END
    $body$
  $f$, s);
END $$;

REVOKE ALL ON FUNCTION public.school_form_requires_password(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_school_form_password(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_school_form_password(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.school_form_requires_password(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_school_form_password(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_school_form_password(uuid, text) TO service_role;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback: the plaintext values are gone by design and cannot be restored from the
-- hashes. Re-adding the column (ALTER TABLE public.cohorts ADD COLUMN
-- school_form_password text) and re-running 20261002000000's function block would only
-- reinstate the transition fallback with nothing to fall back to. The hashes keep
-- working either way; a cohort's password is changed through Manage Cohort.
-- ─────────────────────────────────────────────────────────────────────────────
