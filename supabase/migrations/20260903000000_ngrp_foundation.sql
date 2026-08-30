-- ============================================================================
-- NGRP foundation: cycles, cycle→source-cohort mapping, candidate state,
-- and the minimal durable residency-outcome record (prior-hire exclusion)
-- ============================================================================
-- APPLY MANUALLY (Owner/Jester) in the Supabase SQL Editor, as ONE COMPLETE
-- BLOCK (single transaction). Run the PREFLIGHT section first, one statement
-- at a time, and db/audit/ngrp_legacy_reconciliation_checks.sql (read-only)
-- before deciding anything about legacy NGRP data.
--
-- Product source of truth: docs/product/NGRP_WORKSPACE_PRODUCT_PLAN.md.
-- This migration is the Phase-1 subset of that plan's data model (section
-- 14) CORRECTED after review: it now includes the explicit many-to-many
-- cycle→cohort mapping and the minimal durable hire record, hardens every
-- constraint, and makes all four tables SERVER-ONLY.
--
-- WHAT THIS MODELS
--   ngrp_cycles               - the residency cycle (the NGRP workspace's
--                               primary selector; a cycle is NOT a cohort).
--   ngrp_cycle_source_cohorts - which ASPIRE cohorts feed a cycle. One cycle
--                               may combine several cohorts (e.g. a January
--                               2027 NGRP drawing Summer 2026 + Fall 2026 +
--                               Winter 2027 completed alumni). Planning will
--                               manage these rows; the roster endpoint reads
--                               them to resolve its student scope.
--   ngrp_candidates           - one alumnus ATTEMPT per (cycle, student):
--                               interest, calculated + effective eligibility,
--                               application state. Created only when an NGRP
--                               action occurs; absence of a row is a neutral
--                               default, not missing data. No denormalized
--                               cohort_id: the student row carries the
--                               canonical cohort and the cycle carries its
--                               explicit source mappings, so a copy here
--                               could only ever drift.
--   ngrp_residency_outcomes   - the minimal DURABLE employment facts per
--                               attempt: offer, acceptance, hire, unit,
--                               start, separation. Brought forward now
--                               because the approved roster rule needs a
--                               durable hire source: an alumnus hired through
--                               an earlier cycle is excluded from later
--                               rosters (a later separation does NOT make
--                               them a prospect again), while a prior
--                               attempt WITHOUT a hire never excludes. The
--                               legacy students.ngrp_outcome field and the
--                               legacy ngrp_outcomes table are NOT trusted,
--                               migrated, or touched here - see the
--                               reconciliation preflight.
--
-- SECURITY MODEL (server-only tables)
-- RLS is ENABLED on all four tables with NO policies, and every client-role
-- privilege is explicitly revoked; service_role is explicitly granted. All
-- reads and future writes go through authenticated endpoints
-- (api/ngrp-workspace.js and the Phase-2 writers), which verify an ACTIVE
-- Owner-capability / Admin / Co-Lead caller through the one capability table
-- in lib/server/access.js. This deliberately avoids the class of regression
-- fixed by 20260829000000_s22_is_owner_or_admin_requires_active.sql: with no
-- authenticated-role policies at all, there is no role-string or
-- inactive-profile bypass to get wrong.
--
-- WHAT THIS DOES NOT DO
--   - No existing table, row, policy, or function is modified.
--   - No data is backfilled and NO demonstration cycle is seeded: every
--     table starts empty everywhere.
--   - No client write or read path.
-- ============================================================================

-- ── PREFLIGHT (read-only; run BEFORE the transaction below) ─────────────────
-- P1. None of the four tables exists yet (expect 0):
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema = 'public'
--      AND table_name IN ('ngrp_cycles','ngrp_cycle_source_cohorts',
--                         'ngrp_candidates','ngrp_residency_outcomes');
-- P2. The referenced parents exist (expect 3):
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema = 'public'
--      AND table_name IN ('students','cohorts','user_profiles');
-- P3. gen_random_uuid is available (expect one row):
--   SELECT proname FROM pg_proc WHERE proname = 'gen_random_uuid' LIMIT 1;
-- P4. Legacy reconciliation snapshot (read-only, larger):
--   run db/audit/ngrp_legacy_reconciliation_checks.sql and file the output.
--   Nothing below reads or writes the legacy objects.

BEGIN;

-- ── Residency cycles ────────────────────────────────────────────────────────
-- status follows plan section 10.1 exactly. Date sanity is DB-enforced:
-- a deadline cannot precede its opening, an interview window cannot end
-- before it starts. jsonb configuration columns enforce their intended
-- shape so a stringified or scalar value cannot slip in.
CREATE TABLE IF NOT EXISTS public.ngrp_cycles (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL UNIQUE CHECK (btrim(name) <> ''),
  status                 text NOT NULL DEFAULT 'Planning'
                           CHECK (status IN ('Planning','Accepting Interest','Application Open',
                                             'Application Closed','Interviews','Offers',
                                             'Residency Active','Completed','Archived')),
  application_open_date  date,
  application_deadline   date,
  interview_window_start date,
  interview_window_end   date,
  -- Explicit licensing deadline; when null the Phase-2 engine applies the
  -- plan's default rule (21 days before the interview window opens).
  licensure_deadline     date,
  residency_start_date   date,
  qualification_rules    jsonb NOT NULL DEFAULT '{}'::jsonb
                           CHECK (jsonb_typeof(qualification_rules) = 'object'),
  application_checklist  jsonb NOT NULL DEFAULT '[]'::jsonb
                           CHECK (jsonb_typeof(application_checklist) = 'array'),
  retention_benchmarks   jsonb NOT NULL DEFAULT '{}'::jsonb
                           CHECK (jsonb_typeof(retention_benchmarks) = 'object'),
  is_active              boolean NOT NULL DEFAULT false,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ngrp_cycles_application_window
    CHECK (application_open_date IS NULL OR application_deadline IS NULL
           OR application_deadline >= application_open_date),
  CONSTRAINT ngrp_cycles_interview_window
    CHECK (interview_window_start IS NULL OR interview_window_end IS NULL
           OR interview_window_end >= interview_window_start)
);

-- At most one cycle is the workspace default at a time (the same
-- partial-unique pattern as cohorts_one_accepting_submissions). Explicitly
-- selecting another cycle in the UI is always allowed.
CREATE UNIQUE INDEX IF NOT EXISTS ngrp_cycles_one_active
  ON public.ngrp_cycles (is_active)
  WHERE is_active = true;

-- ── Cycle → source ASPIRE cohorts (explicit many-to-many) ───────────────────
-- No cohort names and no student identity are duplicated here: the row is a
-- pure (cycle, cohort) link plus audit. cycle_id cascades (the mapping is
-- cycle configuration, not history); cohort_id RESTRICTs so a cohort still
-- feeding a cycle cannot vanish out from under it.
CREATE TABLE IF NOT EXISTS public.ngrp_cycle_source_cohorts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id              uuid NOT NULL REFERENCES public.ngrp_cycles(id) ON DELETE CASCADE,
  cohort_id             uuid NOT NULL REFERENCES public.cohorts(id)     ON DELETE RESTRICT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by_profile_id uuid REFERENCES public.user_profiles(id),
  CONSTRAINT ngrp_cycle_source_cohorts_unique UNIQUE (cycle_id, cohort_id)
);

CREATE INDEX IF NOT EXISTS ngrp_cycle_source_cohorts_cycle_idx
  ON public.ngrp_cycle_source_cohorts (cycle_id);
CREATE INDEX IF NOT EXISTS ngrp_cycle_source_cohorts_cohort_idx
  ON public.ngrp_cycle_source_cohorts (cohort_id);

-- ── Cycle-specific candidate state (one alumnus attempt per cycle) ──────────
CREATE TABLE IF NOT EXISTS public.ngrp_candidates (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: a cycle with recorded attempts cannot be deleted (the
  -- Phase-2 cycle-manage endpoint refuses it too; the DB makes it stick).
  cycle_id                          uuid NOT NULL REFERENCES public.ngrp_cycles(id) ON DELETE RESTRICT,
  -- CASCADE is acceptable HERE because candidate rows are workflow state,
  -- not durable employment history - and once a durable outcome row exists,
  -- its own RESTRICT FKs (below) block the whole student deletion anyway.
  student_id                        uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,

  -- Residency interest. 'no_response' is the neutral default, not a decline.
  interest                          text NOT NULL DEFAULT 'no_response'
                                      CHECK (interest IN ('no_response','interested','undecided','not_interested')),

  -- Eligibility. The CALCULATED result is always retained; a staff override
  -- (effective) must carry a NONBLANK reason, the acting profile's stable id,
  -- and its timestamp - enforced here, not merely by UI. The typed name is a
  -- display denormalization only; the profile id is the actor of record.
  eligibility_calculated            text NOT NULL DEFAULT 'pending'
                                      CHECK (eligibility_calculated IN ('pending','eligible','conditionally_eligible','not_eligible')),
  eligibility_effective             text
                                      CHECK (eligibility_effective IN ('pending','eligible','conditionally_eligible','not_eligible')),
  eligibility_reasons               jsonb NOT NULL DEFAULT '[]'::jsonb
                                      CHECK (jsonb_typeof(eligibility_reasons) = 'array'),
  eligibility_override_reason       text
                                      CHECK (eligibility_override_reason IS NULL OR btrim(eligibility_override_reason) <> ''),
  eligibility_overridden_by_profile_id uuid REFERENCES public.user_profiles(id),
  eligibility_overridden_by_name    text,
  eligibility_overridden_at         timestamptz,
  CONSTRAINT ngrp_override_requires_reason_actor_time
    CHECK (eligibility_effective IS NULL
           OR (eligibility_override_reason IS NOT NULL
               AND eligibility_overridden_by_profile_id IS NOT NULL
               AND eligibility_overridden_at IS NOT NULL)),

  -- Official application. A submitted form or an eligible result is NOT an
  -- application; only 'confirmed' places the alumnus on the official NGRP
  -- list, always by explicit staff act. Timestamps stay coherent with the
  -- state: not_confirmed carries neither, confirmed carries exactly the
  -- confirmation, withdrawn carries the withdrawal (and may retain the
  -- earlier confirmation for the record).
  application_status                text NOT NULL DEFAULT 'not_confirmed'
                                      CHECK (application_status IN ('not_confirmed','confirmed','withdrawn')),
  application_confirmed_at          timestamptz,
  application_withdrawn_at          timestamptz,
  CONSTRAINT ngrp_application_state_times
    CHECK (
      (application_status = 'not_confirmed' AND application_confirmed_at IS NULL AND application_withdrawn_at IS NULL)
      OR (application_status = 'confirmed'  AND application_confirmed_at IS NOT NULL AND application_withdrawn_at IS NULL)
      OR (application_status = 'withdrawn'  AND application_withdrawn_at IS NOT NULL)
    ),

  notes                             text,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now(),

  -- One attempt per student per cycle; the same student may attempt again in
  -- a LATER cycle (plan section 8) - unless a durable hire exists, which the
  -- roster excludes.
  CONSTRAINT ngrp_candidates_one_per_cycle UNIQUE (cycle_id, student_id)
);

CREATE INDEX IF NOT EXISTS ngrp_candidates_cycle_idx   ON public.ngrp_candidates (cycle_id);
CREATE INDEX IF NOT EXISTS ngrp_candidates_student_idx ON public.ngrp_candidates (student_id);

-- Composite identity target for the outcomes FK below: an outcome row can
-- then never disagree with its candidate about which student and cycle the
-- attempt belongs to - the database makes the mismatch unrepresentable.
CREATE UNIQUE INDEX IF NOT EXISTS ngrp_candidates_identity
  ON public.ngrp_candidates (id, student_id, cycle_id);

-- ── Minimal durable residency outcomes (the prior-hire source of truth) ─────
-- Offer, acceptance, hire, and separation are DISTINCT facts (timestamps),
-- not a single status column - no broader workflow vocabulary is invented
-- here. hired_at IS NOT NULL is the durable hire fact the roster exclusion
-- reads. Every FK is RESTRICT: deleting a student, candidate, or cycle can
-- never silently erase employment history (the archival convention; a
-- deliberate removal requires removing the outcome row first, explicitly).
CREATE TABLE IF NOT EXISTS public.ngrp_residency_outcomes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id           uuid NOT NULL UNIQUE,
  student_id             uuid NOT NULL REFERENCES public.students(id)    ON DELETE RESTRICT,
  cycle_id               uuid NOT NULL REFERENCES public.ngrp_cycles(id) ON DELETE RESTRICT,
  CONSTRAINT ngrp_outcomes_candidate_identity
    FOREIGN KEY (candidate_id, student_id, cycle_id)
    REFERENCES public.ngrp_candidates (id, student_id, cycle_id) ON DELETE RESTRICT,

  offer_extended_at      timestamptz,
  offer_accepted_at      timestamptz,
  hired_at               timestamptz,
  hired_unit             text,
  residency_start_date   date,
  separated_at           timestamptz,
  separation_reason      text,
  recorded_by_profile_id uuid REFERENCES public.user_profiles(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- Coherence: an acceptance implies an offer; a separation implies a hire.
  -- A hire without a recorded offer stays representable (HR sometimes
  -- reports only the hire), so no tighter coupling is imposed.
  CONSTRAINT ngrp_outcomes_accept_requires_offer
    CHECK (offer_accepted_at IS NULL OR offer_extended_at IS NOT NULL),
  CONSTRAINT ngrp_outcomes_separation_requires_hire
    CHECK (separated_at IS NULL OR hired_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ngrp_residency_outcomes_student_idx
  ON public.ngrp_residency_outcomes (student_id);
CREATE INDEX IF NOT EXISTS ngrp_residency_outcomes_hired_idx
  ON public.ngrp_residency_outcomes (student_id, cycle_id)
  WHERE hired_at IS NOT NULL;

-- ── updated_at maintenance ──────────────────────────────────────────────────
-- SECURITY INVOKER (the default) with a pinned search_path; executable by no
-- client role (triggers run under the table owner on service-role writes).
CREATE OR REPLACE FUNCTION public.ngrp_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.ngrp_touch_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ngrp_cycles_touch ON public.ngrp_cycles;
CREATE TRIGGER ngrp_cycles_touch
  BEFORE UPDATE ON public.ngrp_cycles
  FOR EACH ROW EXECUTE FUNCTION public.ngrp_touch_updated_at();

DROP TRIGGER IF EXISTS ngrp_candidates_touch ON public.ngrp_candidates;
CREATE TRIGGER ngrp_candidates_touch
  BEFORE UPDATE ON public.ngrp_candidates
  FOR EACH ROW EXECUTE FUNCTION public.ngrp_touch_updated_at();

DROP TRIGGER IF EXISTS ngrp_residency_outcomes_touch ON public.ngrp_residency_outcomes;
CREATE TRIGGER ngrp_residency_outcomes_touch
  BEFORE UPDATE ON public.ngrp_residency_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.ngrp_touch_updated_at();

-- ── Server-only privileges: RLS on, NO policies, explicit grants ────────────
ALTER TABLE public.ngrp_cycles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_cycle_source_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_candidates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_residency_outcomes   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ngrp_cycles               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ngrp_cycle_source_cohorts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ngrp_candidates           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ngrp_residency_outcomes   FROM PUBLIC, anon, authenticated;

-- Explicit, not ambient: the service role's privileges are stated here even
-- though service_role also bypasses RLS, so the intended surface is readable
-- from the migration alone. No DELETE on outcomes: durable employment
-- history has no endpoint-deletable path in this phase.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ngrp_cycles               TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ngrp_cycle_source_cohorts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ngrp_candidates           TO service_role;
GRANT SELECT, INSERT, UPDATE         ON public.ngrp_residency_outcomes   TO service_role;

COMMENT ON TABLE public.ngrp_cycles IS
  'NGRP residency cycles - the NGRP workspace''s primary selector. A cycle '
  'is a different entity from an ASPIRE cohort; its student scope comes from '
  'ngrp_cycle_source_cohorts. Server-only: reads and writes go through '
  'authenticated endpoints (api/ngrp-workspace.js and Phase-2 writers).';
COMMENT ON TABLE public.ngrp_cycle_source_cohorts IS
  'Which ASPIRE cohorts feed an NGRP cycle (explicit many-to-many). Pure '
  'link + audit rows; no names or student identity duplicated. Managed by '
  'Planning (Phase 2).';
COMMENT ON TABLE public.ngrp_candidates IS
  'One alumnus attempt per (cycle, student): interest, calculated + '
  'effective eligibility, application state. Created only when an NGRP '
  'action occurs; a completed student without a row is a neutral default. '
  'Identity always comes from students - never stored here.';
COMMENT ON TABLE public.ngrp_residency_outcomes IS
  'Minimal durable residency employment facts per attempt: offer, '
  'acceptance, hire, unit, start, separation as distinct timestamps. '
  'hired_at is the durable hire fact behind the roster''s prior-hire '
  'exclusion; a later separation never re-opens prospect status. RESTRICT '
  'FKs: deleting a student/candidate/cycle cannot erase this history.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── VERIFICATION (run after COMMIT; expect the stated values) ───────────────
-- V1. Structure (one row):
-- SELECT
--   (SELECT count(*) FROM information_schema.tables
--     WHERE table_schema='public'
--       AND table_name IN ('ngrp_cycles','ngrp_cycle_source_cohorts',
--                          'ngrp_candidates','ngrp_residency_outcomes'))     AS tables_created,   -- 4
--   (SELECT bool_and(relrowsecurity) FROM pg_class
--     WHERE relname IN ('ngrp_cycles','ngrp_cycle_source_cohorts',
--                       'ngrp_candidates','ngrp_residency_outcomes'))        AS rls_enabled,      -- t
--   (SELECT count(*) FROM pg_policies
--     WHERE tablename LIKE 'ngrp_%')                                         AS policy_count,     -- 0 (server-only)
--   (SELECT count(*) FROM pg_trigger
--     WHERE tgname IN ('ngrp_cycles_touch','ngrp_candidates_touch',
--                      'ngrp_residency_outcomes_touch'))                     AS trigger_count,    -- 3
--   (SELECT count(*) FROM public.ngrp_cycles)
--   + (SELECT count(*) FROM public.ngrp_cycle_source_cohorts)
--   + (SELECT count(*) FROM public.ngrp_candidates)
--   + (SELECT count(*) FROM public.ngrp_residency_outcomes)                  AS total_rows;       -- 0 (nothing seeded)
--
-- V2. ACTUAL privileges, not policy counts (four rows; every anon/authenticated
--     column must be f, every service_role select/insert must be t):
-- SELECT t.table_name,
--   has_table_privilege('anon',          format('public.%I', t.table_name), 'SELECT') AS anon_select,
--   has_table_privilege('authenticated', format('public.%I', t.table_name), 'SELECT') AS auth_select,
--   has_table_privilege('authenticated', format('public.%I', t.table_name), 'INSERT') AS auth_insert,
--   has_table_privilege('authenticated', format('public.%I', t.table_name), 'UPDATE') AS auth_update,
--   has_table_privilege('authenticated', format('public.%I', t.table_name), 'DELETE') AS auth_delete,
--   has_table_privilege('service_role',  format('public.%I', t.table_name), 'SELECT') AS svc_select,
--   has_table_privilege('service_role',  format('public.%I', t.table_name), 'INSERT') AS svc_insert
-- FROM (VALUES ('ngrp_cycles'),('ngrp_cycle_source_cohorts'),
--              ('ngrp_candidates'),('ngrp_residency_outcomes')) AS t(table_name);
--
-- VERIFICATION MUST RETURN ROWS: if either SELECT returns no row or errors,
-- the migration did not apply as intended - stop and report.

-- ── ROLLBACK (only if required; removes ONLY what this migration created) ───
-- BEGIN;
-- DROP TABLE IF EXISTS public.ngrp_residency_outcomes;
-- DROP TABLE IF EXISTS public.ngrp_candidates;
-- DROP TABLE IF EXISTS public.ngrp_cycle_source_cohorts;
-- DROP TABLE IF EXISTS public.ngrp_cycles;
-- DROP FUNCTION IF EXISTS public.ngrp_touch_updated_at();
-- COMMIT;
-- (All four tables start empty and nothing else references them, so rollback
-- is lossless until real rows exist. Once outcome rows exist, EXPORT them
-- first - they are durable employment history. The legacy ngrp_outcomes
-- table and students.ngrp_* fields are untouched by both apply and rollback.)
