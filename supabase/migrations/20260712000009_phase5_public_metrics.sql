-- ============================================================================
-- PHASE 5: public metrics registry (verification-gated public numbers)
-- ============================================================================
-- *** PREREQUISITES (hard): Phase 0B Waves A through E, Phase 2 foundation.  ***
--
-- Owner instructions: run this ENTIRE file as one block. Additive only.
-- Seeds NOTHING: no metric exists until it is inserted with its full
-- provenance, and nothing renders publicly until status = 'approved'.
--
-- This implements the blueprint's public-metrics verification workflow (the
-- SharePoint outcome figures MUST NOT be published without source
-- verification, denominator definitions, reporting periods, and leadership
-- approval). The public site reads approved rows ONLY, through the
-- service-role endpoint api/public-metrics.js; the anon key has no access
-- to this table at all.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.public_metrics (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key       text        NOT NULL UNIQUE,   -- e.g. 'retention_rate'
  label            text        NOT NULL,           -- public display label
  value_display    text        NOT NULL,           -- e.g. '93.4%'
  -- Provenance (all REQUIRED before approval; see the CHECK below)
  numerator_def    text,
  denominator_def  text,
  reporting_period text,                           -- e.g. 'FY2024 to FY2026'
  source           text,                           -- system or report of record
  verified_by      text,                           -- who verified the source data
  verified_at      timestamptz,
  approved_by      text,                           -- leadership approver
  approved_at      timestamptz,
  review_due       date,                           -- next mandatory re-review
  status           text        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'verified', 'approved', 'retired')),
  sort_order       integer     NOT NULL DEFAULT 0,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- An approved metric must carry its full provenance.
  CONSTRAINT chk_approved_metric_provenance CHECK (
    status <> 'approved' OR (
      numerator_def    IS NOT NULL AND
      denominator_def  IS NOT NULL AND
      reporting_period IS NOT NULL AND
      source           IS NOT NULL AND
      verified_by      IS NOT NULL AND
      verified_at      IS NOT NULL AND
      approved_by      IS NOT NULL AND
      approved_at      IS NOT NULL AND
      review_due       IS NOT NULL
    )
  )
);

ALTER TABLE public.public_metrics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_metrics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_metrics TO authenticated;
GRANT ALL PRIVILEGES ON public.public_metrics TO service_role;

-- Staff read the registry (management UI arrives later; inserts and status
-- changes go through service-role SQL or endpoints in the meantime).
CREATE POLICY "staff_select_public_metrics" ON public.public_metrics
  FOR SELECT TO authenticated USING (public.is_staff());

-- Verification (expected: table exists, zero rows, RLS enabled):
--   SELECT count(*) FROM public.public_metrics;
--   SELECT rowsecurity FROM pg_tables WHERE tablename = 'public_metrics';
