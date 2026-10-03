-- supabase/migrations/20261103000000_my_profile_name.sql
--
-- TOPBAR-PROFILE-1 (2026-10-02): a person edits their own display name.
--
-- WHY. Settings > General > Profile replaces the Email Signature page. Its Display name is
-- the account's name (user_profiles.full_name), which shows on messages, signatures and
-- outreach. The Owner decided (2026-10-02) that each person may edit their own. Nobody
-- could before: Wave E (20260712000004) grants authenticated UPDATE on six user_profiles
-- columns only, and full_name is not one of them.
--
-- WHAT. One SECURITY DEFINER function, the same shape as update_my_connect_signature
-- (migrations/migration_connect_signature.sql):
--   update_my_profile(p_full_name text, p_signature jsonb) RETURNS jsonb
-- It writes the CALLER'S OWN row only (auth_user_id = auth.uid()), and only while the
-- account is active. It sets full_name (trimmed, control characters removed, 1 to 120
-- characters) and connect_signature (the same whitelist and length caps as the signature
-- RPC), in one statement, so the name and the signature can never half-save.
--
-- NOT CHANGED. No column grant: full_name stays unwritable by a raw client update; this
-- function is the only self-service path. No table, no policy, no data rewrite, no anon
-- grant. update_my_connect_signature stays, unchanged: the app falls back to it while this
-- function does not exist, so either deploy order works.
--
-- RE-RUN. Safe: CREATE OR REPLACE of a function nothing else wraps, then REVOKE and GRANT.
--
-- CHECKS: db/audit/my_profile_name_checks.sql (PRE 1, then this file, then POST 1 to 3).
-- The name conflicts to decide by hand: db/audit/my_profile_name_conflicts.sql (read-only).
-- ROLLBACK: at the end of this file.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_my_profile(p_full_name text, p_signature jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now   timestamptz := now();
  v_name  text;
  v_clean jsonb;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_name := left(btrim(regexp_replace(coalesce(p_full_name, ''), '[[:cntrl:]]', '', 'g')), 120);
  IF v_name = '' THEN
    RAISE EXCEPTION 'Display name is required.' USING ERRCODE = '22023';
  END IF;
  IF p_signature IS NULL OR jsonb_typeof(p_signature) <> 'object' THEN
    RAISE EXCEPTION 'Signature must be an object.' USING ERRCODE = '22023';
  END IF;

  -- The signature RPC's whitelist, field for field. Email is never stored here.
  v_clean := jsonb_build_object(
    'display_name',      NULLIF(left(btrim(coalesce(p_signature->>'display_name', '')), 120), ''),
    'credentials',       left(btrim(coalesce(p_signature->>'credentials', '')), 120),
    'title',             left(btrim(coalesce(p_signature->>'title', '')), 120),
    'department',        left(btrim(coalesce(p_signature->>'department', '')), 160),
    'phone',             left(btrim(coalesce(p_signature->>'phone', '')), 40),
    'signature_enabled', coalesce((p_signature->>'signature_enabled')::boolean, true),
    'updated_at',        to_jsonb(v_now)
  );

  UPDATE public.user_profiles
     SET full_name = v_name,
         connect_signature = v_clean
   WHERE auth_user_id = auth.uid()
     AND is_active IS DISTINCT FROM false;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'No active profile for this account.' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object('full_name', v_name, 'connect_signature', v_clean);
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_profile(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, jsonb) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (the Profile page then falls back to the signature RPC and says the account
-- name was not changed; nothing breaks):
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.update_my_profile(text, jsonb);
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';
