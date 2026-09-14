-- ============================================================================
-- RESIDENCY-REFLECTION-2: the resident's work schedule, and their shift
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester). Claude Code has applied NOTHING. ***
--
-- Owner decisions, 2026-09-14. The reflection tool's "current work schedule"
-- line becomes a month calendar in every period: a resident marks the days
-- they work or worked, and one mark means one thing everywhere:
--   - it shows on Residency > Activity > Calendar for the team, and
--   - each reflection period seeds a shift card for every marked day inside
--     its two weeks, so a date is never typed twice.
-- ONE schedule per resident, not one per period. A seeded card never blocks a
-- submission; a future shift's card simply waits.
--
-- The resident's SHIFT (Day, Night, Mid, Variable) is recorded on the hire
-- record and colours every mark. A Variable resident says Day, Night or Mid
-- per marked day; everyone else's marks inherit the hire record.
--
-- WHAT THIS FILE DOES
--   1. ngrp_resident_schedule_days: one row per resident per marked day. A
--      removed mark is DELETED: it is a plan, not a record of care, and the
--      Owner's interaction is Add / Delete. service_role holds DELETE here and
--      nowhere else in the NGRP tables.
--   2. ngrp_residency_outcomes.shift, the canonical Rotation vocabulary
--      (src/lib/preceptorProjection.js CANONICAL_SHIFTS), nullable until
--      recorded.
--
-- Additive and transactional; no data rewrite. Safe in either deploy order:
-- the calendar shows "not available yet" until the table exists.
--
-- PREFLIGHT / POSTFLIGHT: db/audit/ngrp_resident_schedule_checks.sql

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.ngrp_candidates') IS NULL OR to_regclass('public.ngrp_residency_outcomes') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: the NGRP foundation tables are missing';
  END IF;
END
$pre$;

-- ############################################################################
-- 1. Schedule days
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.ngrp_resident_schedule_days (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  uuid        NOT NULL REFERENCES public.ngrp_candidates(id) ON DELETE CASCADE,
  student_id    uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  on_date       date        NOT NULL,
  -- Set only for a Variable resident, who names the shift per day. NULL means
  -- "the shift on the hire record".
  shift         text        CHECK (shift IS NULL OR shift IN ('Day', 'Night', 'Mid')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ngrp_resident_schedule_day UNIQUE (candidate_id, on_date)
);
COMMENT ON TABLE public.ngrp_resident_schedule_days IS
  'RESIDENCY-REFLECTION-2: the days a resident works or worked, marked from their reflection link. Shown on Residency > Activity and seeding each period''s shift cards. Deleted on unmark. Server-only.';

CREATE INDEX IF NOT EXISTS idx_ngrp_resident_schedule_days_date
  ON public.ngrp_resident_schedule_days (on_date, candidate_id);

-- ############################################################################
-- 2. The resident's shift, on the hire record
-- ############################################################################
ALTER TABLE public.ngrp_residency_outcomes
  ADD COLUMN IF NOT EXISTS shift text
    CHECK (shift IS NULL OR shift IN ('Day', 'Night', 'Mid', 'Variable'));
COMMENT ON COLUMN public.ngrp_residency_outcomes.shift IS
  'RESIDENCY-REFLECTION-2: the shift the resident was hired into (Rotation''s Day / Night / Mid / Variable). Colours their schedule marks.';

-- ############################################################################
-- 3. Server-only privileges
-- ############################################################################
ALTER TABLE public.ngrp_resident_schedule_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.ngrp_resident_schedule_days FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.ngrp_resident_schedule_days TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── ROLLBACK (only while the table is still empty) ───────────────────────────
-- BEGIN;
--   DROP TABLE IF EXISTS public.ngrp_resident_schedule_days;
--   ALTER TABLE public.ngrp_residency_outcomes DROP COLUMN IF EXISTS shift;
--   NOTIFY pgrst, 'reload schema';
-- COMMIT;
