-- ############################################################################
-- Add public.cohort_unit_response_targets: the explicit per-cohort outreach-target set (hardened)
--
-- Owner-gated. NOT auto-applied by this branch. There is no existing source that enumerates which units
-- were asked to submit a capacity response for a cohort AND includes non-responders (unit_cohort_responses
-- has a row only on submit; public.units is created lazily and is_participating is a hosting outcome;
-- user_unit_scopes is portal authorization; unit_leaders is a global directory). This table is that
-- missing denominator: pending = active targets minus submitted responses. Responses stay in
-- unit_cohort_responses; a decline (submitted_not_hosting) still counts as responded.
--
-- ACCESS: RESTRICTIVE. RLS is enabled with NO anon/authenticated policy, and anon/authenticated grants
-- are revoked, so no browser reads this table directly. All reads/writes go through the staff-authorized
-- server endpoint api/cohort-unit-response-targets.js (owner/admin only) using the service-role client.
-- NO portal authorization (Student / Unit Leader / Academic Partner) is derived from these rows.
--
-- FAIL CLOSED: the service-role-only sentinel cohort_unit_response_targets_ready() is created LAST; the
-- API probes it and, until this migration is applied, reports "targets not set" and refuses writes.
-- ############################################################################

BEGIN;

CREATE TABLE IF NOT EXISTS public.cohort_unit_response_targets (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id                uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  -- Canonical, stable unit key (e.g. '6 NE') AND a durable human-readable display name. Both are
  -- required and nonblank so a pending target that has no public.units row still has a name to show.
  unit_key                 text NOT NULL,
  unit_name                text NOT NULL,
  -- One canonical normalization rule (whitespace/punctuation/case-insensitive), so aliases collapse.
  unit_key_canon           text GENERATED ALWAYS AS (regexp_replace(upper(coalesce(unit_key, '')), '[^A-Z0-9]', '', 'g')) STORED,
  -- Optional link to a cohort units row when/if one exists (a target may exist before any units row).
  unit_id                  uuid REFERENCES public.units(id) ON DELETE SET NULL,
  requested_at             timestamptz,
  requested_by_profile_id  uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  is_active                boolean NOT NULL DEFAULT true,
  removed_at               timestamptz,
  removed_by_profile_id    uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_curt_unit_key_nonblank   CHECK (btrim(unit_key)  <> ''),
  CONSTRAINT chk_curt_unit_name_nonblank  CHECK (btrim(unit_name) <> ''),
  CONSTRAINT chk_curt_canon_nonblank      CHECK (unit_key_canon <> ''),
  -- Active/removal consistency: an active target has no removal stamp; a removed target does.
  CONSTRAINT chk_curt_active_removal CHECK (
    (is_active = true  AND removed_at IS NULL AND removed_by_profile_id IS NULL)
    OR (is_active = false AND removed_at IS NOT NULL)
  )
);

-- Uniqueness that supports safe reactivation and historical audit: at most ONE ACTIVE target per
-- canonical unit per cohort; deactivated (historical) rows are exempt so the audit trail is preserved
-- and a removed target can be recreated/reactivated.
CREATE UNIQUE INDEX IF NOT EXISTS uq_curt_active_cohort_unit
  ON public.cohort_unit_response_targets (cohort_id, unit_key_canon) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_curt_cohort_active
  ON public.cohort_unit_response_targets (cohort_id) WHERE is_active;

-- updated_at maintenance (repo convention: update_updated_at_column()).
DROP TRIGGER IF EXISTS set_updated_at_cohort_unit_response_targets ON public.cohort_unit_response_targets;
CREATE TRIGGER set_updated_at_cohort_unit_response_targets
  BEFORE UPDATE ON public.cohort_unit_response_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.cohort_unit_response_targets IS
  'Explicit per-cohort outreach targets: the units asked to submit a capacity response. Denominator for the At a Glance responded/pending metric (pending = active targets minus submitted unit_cohort_responses). Read/written ONLY via the staff-authorized server endpoint; RLS denies anon/authenticated. Descriptive data only; never used for authorization.';

-- Restrictive access: RLS on, NO anon/authenticated policy (no direct browser access); service-role only.
ALTER TABLE public.cohort_unit_response_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cohort_unit_response_targets FROM anon;
REVOKE ALL ON public.cohort_unit_response_targets FROM authenticated;
GRANT  ALL ON public.cohort_unit_response_targets TO service_role;

-- Readiness sentinel, created LAST. service_role-only EXECUTE; the API probes it to fail closed before
-- this migration is applied. Explicit empty search_path.
CREATE OR REPLACE FUNCTION public.cohort_unit_response_targets_ready()
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SECURITY INVOKER
  SET search_path = ''
AS $$ SELECT true $$;
COMMENT ON FUNCTION public.cohort_unit_response_targets_ready() IS
  'Readiness sentinel for cohort_unit_response_targets. Returns true only when this migration is applied. Probed by api/cohort-unit-response-targets.js with the service-role client; EXECUTE is service_role-only.';
REVOKE ALL ON FUNCTION public.cohort_unit_response_targets_ready() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cohort_unit_response_targets_ready() FROM anon;
REVOKE ALL ON FUNCTION public.cohort_unit_response_targets_ready() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cohort_unit_response_targets_ready() TO service_role;

COMMIT;

-- ############################################################################
-- Backfill (Owner-gated, NOT run here): the approved outreach list must come from the Owner. This
-- migration does NOT guess Fall 2026 (or any cohort's) targets from missing response rows. Fill the
-- VALUES list with (canonical unit_key, display unit_name) pairs from the APPROVED list, then run
-- OUTSIDE this migration:
--
--   INSERT INTO public.cohort_unit_response_targets (cohort_id, unit_key, unit_name, requested_by_profile_id)
--   SELECT 'eedd91ec-ad6f-4df8-aa20-5c06b2889011'::uuid, v.unit_key, v.unit_name, NULL
--   FROM (VALUES ('6 NE','6 NE'), ('6 NW','6 NW') /* ...the APPROVED Fall 2026 list... */) AS v(unit_key, unit_name)
--   ON CONFLICT DO NOTHING;
--   -- Link unit_id where a units row already exists (canonical match):
--   UPDATE public.cohort_unit_response_targets t SET unit_id = u.id
--   FROM public.units u
--   WHERE u.cohort_id = t.cohort_id
--     AND regexp_replace(upper(coalesce(u.unit_name,'')), '[^A-Z0-9]', '', 'g') = t.unit_key_canon
--     AND t.unit_id IS NULL;

-- ############################################################################
-- Verification (AFTER applying + backfilling):
--   SELECT cohort_id, count(*) FILTER (WHERE is_active) AS active_targets
--   FROM public.cohort_unit_response_targets GROUP BY cohort_id;

-- ############################################################################
-- Rollback:
--   DROP FUNCTION IF EXISTS public.cohort_unit_response_targets_ready();
--   DROP TABLE IF EXISTS public.cohort_unit_response_targets;  -- removes the denominator; app fails closed
