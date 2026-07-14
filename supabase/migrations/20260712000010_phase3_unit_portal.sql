-- ============================================================================
-- PHASE 3: unit leader portal read surface and released-reports foundation
-- ============================================================================
-- *** PREREQUISITES (hard): Phase 0B Waves A through E, then the Phase 2     ***
-- *** foundation (20260712000007). Apply 20260712000008 first as well so    ***
-- *** the portal migrations stay in order.                                  ***
--
-- Owner instructions: run this ENTIRE file as one block. Additive only.
--
-- Contents:
--   1. released_reports: the curated release mechanism from the approved
--      blueprint. Portals NEVER read live feedback tables; staff publish a
--      frozen snapshot (service-role endpoints or SQL for now; a publishing
--      UI arrives in Phase 5), and portals read snapshots only. Small-cohort
--      privacy: curation happens at publish time, so no minimum-n logic is
--      needed at read time.
--   2. Scoped definer views for unit leaders (amendment 4 pattern choice:
--      views for single-table, fixed-column reads; the cross-table roster
--      with hours and support flags is a JWT endpoint,
--      api/portal/unit-roster.js).
--
-- Support-indicator privacy (Owner decision item 6 default): unit leaders
-- see a support FLAG and COUNT per student, never the support_needed text.
-- The text stays staff-only; nothing in this migration or the unit portal
-- exposes it.
-- ============================================================================

-- ── 1. released_reports ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.released_reports (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  audience_type  text        NOT NULL CHECK (audience_type IN ('unit', 'school', 'public')),
  -- unit: canonical unit key; school: canonical school key; public: a slug.
  scope_ref      text        NOT NULL,
  cohort_id      uuid        REFERENCES public.cohorts(id) ON DELETE SET NULL,
  title          text        NOT NULL,
  -- Frozen snapshot content. Markdown body plus optional structured payload;
  -- staff curate BEFORE publishing (aggregation, minimum-n suppression).
  body_md        text,
  payload        jsonb,
  published_by   uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  published_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoked_by     uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_released_reports_scope
  ON public.released_reports (audience_type, scope_ref);

ALTER TABLE public.released_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.released_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.released_reports TO authenticated;
GRANT ALL PRIVILEGES ON public.released_reports TO service_role;

CREATE POLICY "owner_admin_select_released_reports" ON public.released_reports
  FOR SELECT TO authenticated USING (public.is_owner_or_admin());

-- ── 2. Unit leader scoped views ──────────────────────────────────────────────
-- Empty for anyone without an ACTIVE unit_leader grant (my_unit_scope_keys()
-- already checks the role grant, scope activation, expiry, and revocation).

-- The unit's own participation submissions (what the unit told ASPIRE),
-- including a cohort-scope restriction when the grant carries one.
CREATE OR REPLACE VIEW public.portal_my_unit_responses
WITH (security_barrier = true) AS
  SELECT
    r.id,
    r.cohort_id,
    r.unit_name,
    r.response_status,
    r.submitted_by_name,
    r.submitted_by_email,
    r.submitted_by_role,
    r.slots_offered,
    r.shift_preference,
    r.preferred_preceptors,
    r.considerations,
    r.reason_for_zero,
    r.submission_count,
    r.submitted_at,
    r.last_updated_at
  FROM public.unit_cohort_responses r
  WHERE EXISTS (
    SELECT 1 FROM public.my_unit_scope_keys() s
    WHERE s.unit_key = r.unit_name
      AND (s.cohort_id IS NULL OR s.cohort_id = r.cohort_id)
  );

-- Active preceptors attached to the unit (roster-level, no student data).
CREATE OR REPLACE VIEW public.portal_my_unit_preceptors
WITH (security_barrier = true) AS
  SELECT
    p.id,
    p.full_name,
    p.unit_name,
    p.is_active,
    p.cohorts_participated,
    p.last_active_cohort
  FROM public.preceptors p
  WHERE p.is_active = true
    AND EXISTS (
      SELECT 1 FROM public.my_unit_scope_keys() s
      WHERE s.unit_key = p.unit_name
    );

-- Released reports addressed to the unit.
CREATE OR REPLACE VIEW public.portal_my_unit_reports
WITH (security_barrier = true) AS
  SELECT
    rr.id,
    rr.scope_ref AS unit_key,
    rr.cohort_id,
    rr.title,
    rr.body_md,
    rr.payload,
    rr.published_at
  FROM public.released_reports rr
  WHERE rr.audience_type = 'unit'
    AND rr.revoked_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.my_unit_scope_keys() s
      WHERE s.unit_key = rr.scope_ref
        AND (s.cohort_id IS NULL OR rr.cohort_id IS NULL OR s.cohort_id = rr.cohort_id)
    );

REVOKE ALL ON public.portal_my_unit_responses,
              public.portal_my_unit_preceptors,
              public.portal_my_unit_reports
  FROM PUBLIC, anon;
GRANT SELECT ON public.portal_my_unit_responses,
                public.portal_my_unit_preceptors,
                public.portal_my_unit_reports
  TO authenticated;
GRANT SELECT ON public.portal_my_unit_responses,
                public.portal_my_unit_preceptors,
                public.portal_my_unit_reports
  TO service_role;

-- Verification (as any staff user with no unit_leader grant, all three views
-- must return zero rows; released_reports readable only via is_owner_or_admin):
--   SELECT count(*) FROM portal_my_unit_responses;
--   SELECT count(*) FROM portal_my_unit_preceptors;
--   SELECT count(*) FROM portal_my_unit_reports;
