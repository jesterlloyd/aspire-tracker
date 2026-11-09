-- supabase/migrations/20261206000000_portal_terms.sql
--
-- PORTAL-TERMS-1 (Owner, 2026-11-09): every portal user accepts the ASPIRE Portal Terms of Use
-- and Confidentiality Agreement before any portal content renders, again when the text changes,
-- and once a year. The text and its version live in src/lib/portalTerms.js; this file only
-- records who accepted which version, and when.
--
-- WHAT.
--   1. public.portal_terms_acceptances: one row per acceptance (profile, version, the portal
--      roles they held, when, the browser's user agent). Append-only: no client may UPDATE or
--      DELETE, and a trigger refuses UPDATE for everyone. A deleted profile takes its rows with it
--      (ON DELETE CASCADE), so a profile delete is never blocked by this table.
--   2. RLS: a person reads their OWN rows; an active Owner or Admin reads all of them. No client
--      INSERT: the only way in is the function below.
--   3. public.accept_portal_terms(p_version, p_roles, p_user_agent) RETURNS jsonb: SECURITY
--      DEFINER, writes one row for the CALLER only, only while their account is active. The
--      version must look like an ISO date; roles are filtered to the five portal roles; the user
--      agent is trimmed to 400 characters.
--
-- NOT CHANGED. No existing table, policy or function. No anon grant. Portal access itself is not
-- enforced here: the gate is the portal screen (PortalApp), as click-through terms are. The app
-- runs on both sides of this file: before it, the gate stays out of the way.
--
-- RE-RUN. Safe: IF NOT EXISTS, DROP POLICY IF EXISTS, CREATE OR REPLACE, then REVOKE and GRANT.
-- CHECKS: db/audit/portal_terms_checks.sql (PRE 1, then this file, then POST 1 to 4).
-- ROLLBACK: at the end of this file.

BEGIN;

CREATE TABLE IF NOT EXISTS public.portal_terms_acceptances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  terms_version text NOT NULL CHECK (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  portal_roles  text[] NOT NULL DEFAULT '{}',
  accepted_at   timestamptz NOT NULL DEFAULT now(),
  user_agent    text CHECK (user_agent IS NULL OR char_length(user_agent) <= 400)
);

CREATE INDEX IF NOT EXISTS portal_terms_acceptances_profile_idx
  ON public.portal_terms_acceptances (profile_id, accepted_at DESC);

ALTER TABLE public.portal_terms_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_terms_read_own ON public.portal_terms_acceptances;
CREATE POLICY portal_terms_read_own ON public.portal_terms_acceptances
  FOR SELECT TO authenticated
  USING (profile_id = public.portal_profile_id());

DROP POLICY IF EXISTS portal_terms_read_staff ON public.portal_terms_acceptances;
CREATE POLICY portal_terms_read_staff ON public.portal_terms_acceptances
  FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());

REVOKE ALL ON public.portal_terms_acceptances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.portal_terms_acceptances TO authenticated;

CREATE OR REPLACE FUNCTION public.portal_terms_refuse_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'portal_terms_acceptances is append-only' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_portal_terms_no_update ON public.portal_terms_acceptances;
CREATE TRIGGER trg_portal_terms_no_update
  BEFORE UPDATE ON public.portal_terms_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.portal_terms_refuse_update();

CREATE OR REPLACE FUNCTION public.accept_portal_terms(p_version text, p_roles text[], p_user_agent text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile uuid;
  v_roles   text[];
  v_at      timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_profile
    FROM public.user_profiles
   WHERE auth_user_id = auth.uid() AND is_active IS DISTINCT FROM false;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'No active account' USING ERRCODE = '42501';
  END IF;

  IF p_version IS NULL OR p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'Unknown terms version' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(array_agg(DISTINCT r ORDER BY r), '{}') INTO v_roles
    FROM unnest(coalesce(p_roles, '{}')) AS r
   WHERE r IN ('student', 'unit_leader', 'academic_partner', 'nursing_academic', 'talent_acquisition');

  INSERT INTO public.portal_terms_acceptances (profile_id, terms_version, portal_roles, user_agent)
  VALUES (v_profile, p_version, v_roles,
          NULLIF(left(btrim(regexp_replace(coalesce(p_user_agent, ''), '[[:cntrl:]]', '', 'g')), 400), ''))
  RETURNING accepted_at INTO v_at;

  RETURN jsonb_build_object('terms_version', p_version, 'accepted_at', v_at);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_portal_terms(text, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_portal_terms(text, text[], text) TO authenticated;
REVOKE ALL ON FUNCTION public.portal_terms_refuse_update() FROM PUBLIC, anon, authenticated;

COMMIT;

-- ROLLBACK (only if nothing should be kept; this deletes every acceptance record):
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.accept_portal_terms(text, text[], text);
-- DROP TABLE IF EXISTS public.portal_terms_acceptances;
-- DROP FUNCTION IF EXISTS public.portal_terms_refuse_update();
-- COMMIT;
