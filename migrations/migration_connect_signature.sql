-- ============================================================
-- ASPIRE Intelligence - CONNECT-COMMS-1D: per-user ASPIRE Connect signature
-- ============================================================
--
-- Adds a per-user signature used ONLY for MANUAL ASPIRE Connect direct messages
-- (api/connect-send-direct-email.js). Automated/system emails are unaffected.
--
-- Storage: a single jsonb column `user_profiles.connect_signature`:
--   { display_name, credentials, title, department, phone, signature_enabled, updated_at }
-- (email is NOT stored here - it always comes from the authenticated profile.)
--
-- Security: user_profiles currently has a broad authenticated RLS policy, so writes are NOT
-- routed through a raw client update. This self-scoped SECURITY DEFINER RPC updates ONLY the
-- caller's own row (auth_user_id = auth.uid()), whitelists + length-caps the fields, and stamps
-- updated_at. Broad RLS policies are left unchanged.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute. Wrapped in BEGIN/COMMIT.
-- ============================================================

BEGIN;

-- ── 1. Additive nullable column ───────────────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS connect_signature jsonb;

-- ── 2. Self-scoped updater RPC ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_my_connect_signature(p_signature jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now   timestamptz := now();
  v_clean jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Whitelist + length-cap each field; never persist arbitrary jsonb. Email is intentionally
  -- excluded (always sourced from the authenticated profile, not user-editable here).
  v_clean := jsonb_build_object(
    'display_name',      NULLIF(left(btrim(coalesce(p_signature->>'display_name', '')), 120), ''),
    'credentials',       left(btrim(coalesce(p_signature->>'credentials', '')), 120),
    'title',             left(btrim(coalesce(p_signature->>'title', '')), 120),
    'department',        left(btrim(coalesce(p_signature->>'department', '')), 160),
    'phone',             left(btrim(coalesce(p_signature->>'phone', '')), 40),
    'signature_enabled', coalesce((p_signature->>'signature_enabled')::boolean, true),
    'updated_at',        to_jsonb(v_now)
  );

  UPDATE user_profiles
     SET connect_signature = v_clean
   WHERE auth_user_id = auth.uid();

  RETURN v_clean;
END;
$$;

GRANT EXECUTE ON FUNCTION update_my_connect_signature(jsonb) TO authenticated;

-- ── 3. Reload PostgREST schema cache ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';

COMMIT;
