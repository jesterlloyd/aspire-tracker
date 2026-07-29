-- ############################################################################
-- Add public.cohort_unit_response_targets: the explicit per-cohort outreach-target set
--
-- Owner-gated. NOT auto-applied by this branch. There is no existing source that enumerates which units
-- were asked to submit a capacity response for a cohort AND includes the ones that did not respond:
--   * unit_cohort_responses has a row only once a unit submits.
--   * public.units rows are created lazily (on submission, or manual UnitSetupPanel/CSV) and are not a
--     seeded roster; units.is_participating is a response OUTCOME, not an outreach flag.
--   * user_unit_scopes is portal authorization; unit_leaders is a global directory; unit catalog is a
--     superset; unit_placement_requests is per-student. None is a cohort outreach-target set.
--
-- This table is that missing denominator. `pending = targets - submitted responses`. Responses stay in
-- unit_cohort_responses; a decline (submitted_not_hosting) still counts as responded. Removing a target
-- is a soft-delete (is_active=false) so it is auditable. NO portal authorization is derived from these
-- rows - they are descriptive data only.
--
-- Until this is applied AND a cohort's targets are configured, the app fails closed: the At a Glance
-- summary shows an honest "response targets not set" state, never a misleading "0 pending".
-- ############################################################################

BEGIN;

CREATE TABLE IF NOT EXISTS public.cohort_unit_response_targets (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id                uuid NOT NULL REFERENCES public.cohorts(id) ON DELETE CASCADE,
  -- Canonical, stable unit key (the unit's canonical name, e.g. '6 NE'). Optional link to a units row
  -- when one exists for the cohort; a target may exist BEFORE any units row does.
  unit_key                 text NOT NULL,
  unit_id                  uuid REFERENCES public.units(id) ON DELETE SET NULL,
  requested_at             timestamptz,                 -- when the capacity request was sent (nullable)
  requested_by_profile_id  uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  is_active                boolean NOT NULL DEFAULT true,   -- soft-remove: false = target removed
  removed_at               timestamptz,
  removed_by_profile_id    uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cohort_unit_target UNIQUE (cohort_id, unit_key)
);

CREATE INDEX IF NOT EXISTS idx_curt_cohort ON public.cohort_unit_response_targets (cohort_id) WHERE is_active;

COMMENT ON TABLE public.cohort_unit_response_targets IS
  'Explicit per-cohort outreach targets: the units asked to submit a capacity response. Denominator for the At a Glance responded/pending metric (pending = active targets minus submitted unit_cohort_responses). Descriptive only; never used for authorization.';

-- RLS: authenticated staff may READ (the client reads this table directly, like units and
-- unit_cohort_responses); all writes go through the service-role client only (no client write policy).
ALTER TABLE public.cohort_unit_response_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS curt_select_authenticated ON public.cohort_unit_response_targets;
CREATE POLICY curt_select_authenticated
  ON public.cohort_unit_response_targets
  FOR SELECT TO authenticated
  USING (true);

COMMIT;

-- ############################################################################
-- Backfill (Owner-gated, NOT run here): the approved outreach list must come from the Owner.
-- This migration intentionally does NOT guess Fall 2026 (or any cohort's) targets from missing response
-- rows - missing outreach cannot be reconstructed from silence. Fill the VALUES list with the approved
-- canonical unit names, then run OUTSIDE this migration:
--
--   INSERT INTO public.cohort_unit_response_targets (cohort_id, unit_key, requested_by_profile_id)
--   SELECT 'eedd91ec-ad6f-4df8-aa20-5c06b2889011'::uuid, v.unit_key, NULL
--   FROM (VALUES ('6 NE'), ('6 NW') /* ...the APPROVED Fall 2026 outreach list... */) AS v(unit_key)
--   ON CONFLICT (cohort_id, unit_key) DO NOTHING;
--   -- Optionally link unit_id where a units row already exists:
--   UPDATE public.cohort_unit_response_targets t
--     SET unit_id = u.id
--   FROM public.units u
--   WHERE u.cohort_id = t.cohort_id AND u.unit_name = t.unit_key AND t.unit_id IS NULL;

-- ############################################################################
-- Verification (AFTER applying + backfilling):
--   SELECT cohort_id, count(*) FILTER (WHERE is_active) AS active_targets
--   FROM public.cohort_unit_response_targets GROUP BY cohort_id;

-- ############################################################################
-- Rollback: DROP TABLE IF EXISTS public.cohort_unit_response_targets;  (removes the denominator; the
-- app fails closed back to "response targets not set"). No other object is affected.
