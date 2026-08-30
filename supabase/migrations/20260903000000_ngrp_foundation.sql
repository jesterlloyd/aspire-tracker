-- ============================================================================
-- NGRP foundation: residency cycles + cycle-specific candidate state
-- ============================================================================
-- APPLY MANUALLY (Owner/Jester) in the Supabase SQL Editor, as ONE COMPLETE
-- BLOCK (single transaction). Run the PREFLIGHT section first, one statement
-- at a time; every check must come back as stated before applying.
--
-- Product source of truth: docs/product/NGRP_WORKSPACE_PRODUCT_PLAN.md
-- (2026-08-28). This migration is the PHASE-1 SUBSET of that plan's data
-- model (section 14): the two tables the Applicants roster and cycle selector
-- read. The remaining tables (ngrp_transition_assignments / _tokens /
-- _drafts / _revisions, ngrp_cycle_units, ngrp_interviews, support,
-- residency, mentorship, retention, audit) belong to their own workflow
-- phases and are deliberately NOT created here.
--
-- WHAT THIS IS
-- The NGRP workspace derives its Applicants roster from existing COMPLETED
-- ASPIRE students - the canonical students table remains the only source of
-- identity (id, name, headshot, school, program, cohort). Nothing here
-- duplicates or imports a student.
--
-- What cannot be derived is CYCLE-SPECIFIC state: one alumnus can
-- participate in one residency cycle and not another, and one NGRP cycle
-- draws alumni from several ASPIRE cohorts (a cycle is NOT a cohort and
-- never references one). Two additive tables carry that state:
--
--   ngrp_cycles      - the residency cycle itself (name, status, dates,
--                      rule configuration). The workspace's primary selector.
--   ngrp_candidates  - one alumnus attempt per (cycle, student), created
--                      ONLY when an NGRP action occurs (form sent, interest
--                      recorded, eligibility calculated, application
--                      confirmed). Carries interest, calculated + effective
--                      eligibility, and application state - per the plan,
--                      the Transition Form lifecycle itself will live in
--                      ngrp_transition_assignments (Phase 2), and interview /
--                      assigned-unit state in ngrp_interviews (Phase 3).
--                      A completed student with no row still appears on the
--                      roster with neutral defaults - absence of a row is a
--                      neutral state, not missing data.
--
-- WHAT THIS DOES NOT DO
--   - No existing table, row, policy, or function is modified. The legacy
--     ngrp_outcomes table and students.ngrp_cohort_target / ngrp_outcome
--     fields are NOT touched, migrated, or dropped (plan section 14:
--     reconciliation is its own later, evidence-first step).
--   - No data is backfilled: both tables start empty.
--   - No client write path: RLS grants staff SELECT only. Every write goes
--     through service-role endpoints (plan sections 4, 15) which verify the
--     staff role and record who acted.
--   - Support participation is deliberately NOT modeled here: it never
--     affects eligibility, so it gets its own tables in a later migration.
-- ============================================================================

-- ── PREFLIGHT (read-only; run BEFORE the transaction below) ─────────────────
-- P1. Neither table exists yet (expect 0):
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name IN ('ngrp_cycles','ngrp_candidates');
-- P2. The referenced parents exist (expect 2):
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name IN ('students','cohorts');
-- P3. gen_random_uuid is available (expect one row):
--   SELECT proname FROM pg_proc WHERE proname = 'gen_random_uuid' LIMIT 1;
-- P4. Record (do not change) the legacy landscape for the later
--     reconciliation step - row count and shape of the legacy table:
--   SELECT count(*) FROM public.ngrp_outcomes;   -- may error if absent; that is fine, note it
--   SELECT count(*) FILTER (WHERE ngrp_cohort_target IS NOT NULL) AS targets,
--          count(*) FILTER (WHERE ngrp_outcome IS NOT NULL)       AS outcomes
--     FROM public.students;

BEGIN;

-- ── Residency cycles ────────────────────────────────────────────────────────
-- status follows plan section 10.1. Rule configuration is jsonb so the
-- Phase-2 eligibility engine reads versioned cycle rules without further DDL;
-- shapes are documented in the plan (sections 7, 10).
CREATE TABLE IF NOT EXISTS public.ngrp_cycles (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL UNIQUE,
  status                 text NOT NULL DEFAULT 'Planning'
                           CHECK (status IN ('Planning','Accepting Interest','Application Open',
                                             'Application Closed','Interviews','Offers',
                                             'Residency Active','Completed','Archived')),
  application_open_date  date,
  application_deadline   date,
  interview_window_start date,
  interview_window_end   date,
  -- Default licensing deadline rule (21 days before the interview window)
  -- is applied by the Phase-2 engine when this explicit date is null.
  licensure_deadline     date,
  residency_start_date   date,
  qualification_rules    jsonb NOT NULL DEFAULT '{}'::jsonb,
  application_checklist  jsonb NOT NULL DEFAULT '[]'::jsonb,
  retention_benchmarks   jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active              boolean NOT NULL DEFAULT false,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- At most one cycle is the workspace default at a time (same partial-unique
-- pattern as cohorts_one_accepting_submissions). Explicitly selecting another
-- cycle in the UI is always allowed; this only disciplines the default.
CREATE UNIQUE INDEX IF NOT EXISTS ngrp_cycles_one_active
  ON public.ngrp_cycles (is_active)
  WHERE is_active = true;

-- ── Cycle-specific candidate state (one alumnus attempt per cycle) ──────────
CREATE TABLE IF NOT EXISTS public.ngrp_candidates (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id                       uuid NOT NULL REFERENCES public.ngrp_cycles(id) ON DELETE CASCADE,
  student_id                     uuid NOT NULL REFERENCES public.students(id)    ON DELETE CASCADE,
  -- Denormalized from the student at creation time so cycle reporting can
  -- group by ASPIRE cohort even if student rows move later. Never identity.
  cohort_id                      uuid REFERENCES public.cohorts(id) ON DELETE SET NULL,

  -- Residency interest. 'no_response' is the neutral default, not a decline.
  interest                       text NOT NULL DEFAULT 'no_response'
                                   CHECK (interest IN ('no_response','interested','undecided','not_interested')),

  -- Eligibility: the CALCULATED result is always retained; a staff override
  -- (effective) requires a reason - enforced here, not merely by UI.
  -- eligibility_reasons is the engine's explicit reason codes:
  -- [{code, label, met, deadline}] - never an unexplained score.
  eligibility_calculated         text NOT NULL DEFAULT 'pending'
                                   CHECK (eligibility_calculated IN ('pending','eligible','conditionally_eligible','not_eligible')),
  eligibility_effective          text
                                   CHECK (eligibility_effective IN ('pending','eligible','conditionally_eligible','not_eligible')),
  eligibility_reasons            jsonb NOT NULL DEFAULT '[]'::jsonb,
  eligibility_override_reason    text,
  eligibility_overridden_by_name text,
  eligibility_overridden_at      timestamptz,
  CONSTRAINT ngrp_override_requires_reason
    CHECK (eligibility_effective IS NULL OR eligibility_override_reason IS NOT NULL),

  -- Official application. A submitted form or an eligible result is NOT an
  -- application; only 'confirmed' places the alumnus on the official NGRP
  -- list, and confirmation is always an explicit staff act - no trigger and
  -- no default path can ever set it.
  application_status             text NOT NULL DEFAULT 'not_confirmed'
                                   CHECK (application_status IN ('not_confirmed','confirmed','withdrawn')),
  application_confirmed_at       timestamptz,
  application_withdrawn_at       timestamptz,

  notes                          text,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),

  -- One attempt per student per cycle; the same student MAY hold rows in
  -- different cycles (reapplication across cycles is a real path, plan §8).
  CONSTRAINT ngrp_candidates_one_per_cycle UNIQUE (cycle_id, student_id)
);

CREATE INDEX IF NOT EXISTS ngrp_candidates_cycle_idx   ON public.ngrp_candidates (cycle_id);
CREATE INDEX IF NOT EXISTS ngrp_candidates_student_idx ON public.ngrp_candidates (student_id);
CREATE INDEX IF NOT EXISTS ngrp_candidates_cohort_idx  ON public.ngrp_candidates (cohort_id);

-- ── updated_at maintenance ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ngrp_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ngrp_cycles_touch ON public.ngrp_cycles;
CREATE TRIGGER ngrp_cycles_touch
  BEFORE UPDATE ON public.ngrp_cycles
  FOR EACH ROW EXECUTE FUNCTION public.ngrp_touch_updated_at();

DROP TRIGGER IF EXISTS ngrp_candidates_touch ON public.ngrp_candidates;
CREATE TRIGGER ngrp_candidates_touch
  BEFORE UPDATE ON public.ngrp_candidates
  FOR EACH ROW EXECUTE FUNCTION public.ngrp_touch_updated_at();

-- ── RLS: staff SELECT only; writes are service-role endpoints ───────────────
ALTER TABLE public.ngrp_cycles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_candidates ENABLE ROW LEVEL SECURITY;

-- Read roles follow the plan's role model (section 4): Owner, Admin, and
-- Co-Lead manage NGRP; Interviewer and Viewer have no general NGRP access in
-- the initial release. Both historical co-lead spellings are included, the
-- same pair PORTAL_STAFF_ROLES carries in src/App.jsx. No policy grants the
-- authenticated role INSERT/UPDATE/DELETE, so the only writers are the
-- Phase-2 service-role endpoints (which also enforce is_active per S-05).
DROP POLICY IF EXISTS "ngrp_cycles_staff_read" ON public.ngrp_cycles;
CREATE POLICY "ngrp_cycles_staff_read"
  ON public.ngrp_cycles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid()
        AND role IN ('owner', 'admin', 'co_lead', 'co-lead')
    )
  );

DROP POLICY IF EXISTS "ngrp_candidates_staff_read" ON public.ngrp_candidates;
CREATE POLICY "ngrp_candidates_staff_read"
  ON public.ngrp_candidates FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid()
        AND role IN ('owner', 'admin', 'co_lead', 'co-lead')
    )
  );

COMMENT ON TABLE public.ngrp_cycles IS
  'NGRP residency cycles - the NGRP workspace''s primary selector. A cycle is '
  'a different entity from an ASPIRE cohort: one cycle draws completed alumni '
  'from several cohorts. Writes are service-role endpoints only. Plan: '
  'docs/product/NGRP_WORKSPACE_PRODUCT_PLAN.md.';
COMMENT ON TABLE public.ngrp_candidates IS
  'One alumnus attempt per (cycle, student): interest, calculated + effective '
  'eligibility, application state. Created only when an NGRP action occurs. '
  'Identity always comes from students; this table never stores a name, '
  'email, or headshot. Absence of a row is a neutral default, not missing '
  'data. Form lifecycle: ngrp_transition_assignments (later phase).';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── VERIFICATION (run after applying; expect the stated values) ─────────────
-- SELECT
--   (SELECT count(*) FROM information_schema.tables
--     WHERE table_schema='public' AND table_name IN ('ngrp_cycles','ngrp_candidates')) AS tables_created,        -- 2
--   (SELECT bool_and(relrowsecurity) FROM pg_class
--     WHERE relname IN ('ngrp_cycles','ngrp_candidates'))                              AS rls_enabled,           -- t
--   (SELECT count(*) FROM pg_policies
--     WHERE tablename IN ('ngrp_cycles','ngrp_candidates'))                            AS policy_count,          -- 2
--   (SELECT count(*) FROM pg_indexes
--     WHERE indexname IN ('ngrp_cycles_one_active','ngrp_candidates_cycle_idx',
--                         'ngrp_candidates_student_idx','ngrp_candidates_cohort_idx')) AS index_count,           -- 4
--   (SELECT count(*) FROM pg_trigger
--     WHERE tgname IN ('ngrp_cycles_touch','ngrp_candidates_touch'))                   AS trigger_count,         -- 2
--   (SELECT count(*) FROM public.ngrp_cycles)                                          AS cycles_rows,           -- 0
--   (SELECT count(*) FROM public.ngrp_candidates)                                      AS candidate_rows;        -- 0
--
-- VERIFICATION MUST RETURN ROWS: if the single SELECT above returns no row or
-- errors, the migration did not apply as intended - stop and report.

-- ── ROLLBACK (only if required; removes ONLY what this migration created) ───
-- BEGIN;
-- DROP TABLE IF EXISTS public.ngrp_candidates;
-- DROP TABLE IF EXISTS public.ngrp_cycles;
-- DROP FUNCTION IF EXISTS public.ngrp_touch_updated_at();
-- COMMIT;
-- (Both tables start empty and nothing else references them, so rollback is
-- lossless until the first NGRP action is recorded. After real candidate rows
-- exist, export them before any rollback. The legacy ngrp_outcomes table and
-- student ngrp_* fields are untouched by both apply and rollback.)
