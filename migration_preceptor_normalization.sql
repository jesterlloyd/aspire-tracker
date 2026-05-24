-- =====================================================================
-- ASPIRE Preceptor Normalization Migration
-- Phase B.1 — Foundation schema changes for normalized preceptor data
--
-- Run this file FIRST in your Supabase SQL Editor, then run
-- migration_preceptor_backfill.sql to populate the new structure.
--
-- Safe to run on a database where migration_phase1_analytics.sql has
-- already been applied (the preceptors table already exists).
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────
-- 1.1  Add shift_type to preceptors
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.preceptors
  ADD COLUMN IF NOT EXISTS shift_type TEXT DEFAULT 'Variable'
  CHECK (shift_type IN ('Day', 'Night', 'Mid', 'Variable'));


-- ─────────────────────────────────────────────────────────────────────
-- 1.2  Email uniqueness constraint (case-insensitive, whitespace-tolerant)
-- Partial index: rows with null/empty email are excluded so that
-- name-only preceptors can be inserted during backfill without conflict.
-- ─────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS preceptors_email_unique_idx
  ON public.preceptors (lower(trim(email)))
  WHERE email IS NOT NULL AND trim(email) != '';


-- ─────────────────────────────────────────────────────────────────────
-- 1.3  preceptor_cohort_participation junction table
-- Source of truth for which preceptors participated in which cohorts.
-- The integer counters on preceptors (cohorts_participated, etc.) are
-- denormalized caches kept in sync by the trigger in Part 3.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.preceptor_cohort_participation (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preceptor_id  UUID NOT NULL REFERENCES public.preceptors(id) ON DELETE CASCADE,
  cohort_id     UUID NOT NULL REFERENCES public.cohorts(id)    ON DELETE CASCADE,
  status        TEXT DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive', 'completed')),
  started_at    DATE,
  ended_at      DATE,
  notes         TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (preceptor_id, cohort_id)
);

CREATE INDEX IF NOT EXISTS preceptor_cohort_preceptor_idx
  ON public.preceptor_cohort_participation(preceptor_id);
CREATE INDEX IF NOT EXISTS preceptor_cohort_cohort_idx
  ON public.preceptor_cohort_participation(cohort_id);

ALTER TABLE public.preceptor_cohort_participation ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────
-- 1.4  Add preceptor_id FK to shift_logs
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.shift_logs
  ADD COLUMN IF NOT EXISTS preceptor_id UUID
    REFERENCES public.preceptors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS shift_logs_preceptor_id_idx
  ON public.shift_logs(preceptor_id);


-- ─────────────────────────────────────────────────────────────────────
-- 1.5  Add preceptor_id FK to matches
-- The existing preceptor_assigned text field is preserved as fallback.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS preceptor_id UUID
    REFERENCES public.preceptors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS matches_preceptor_id_idx
  ON public.matches(preceptor_id);


-- =====================================================================
-- Part 2: RLS Policies
-- Replace the permissive "all-authenticated" policy on preceptors with
-- read-for-all / write-for-owners-only. Service role retains full access.
--
-- NOTE: user_profiles uses auth_user_id (not user_id) to link to
-- auth.uid(), and ownership is the boolean is_owner column.
-- =====================================================================

-- ── preceptors ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "authenticated_all_preceptors"          ON public.preceptors;
DROP POLICY IF EXISTS "Anon full access on preceptors"        ON public.preceptors;
DROP POLICY IF EXISTS "Service role full access on preceptors" ON public.preceptors;

CREATE POLICY "authenticated_read_preceptors"
  ON public.preceptors FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "owners_insert_preceptors"
  ON public.preceptors FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid() AND is_owner = true
    )
  );

CREATE POLICY "owners_update_preceptors"
  ON public.preceptors FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid() AND is_owner = true
    )
  );

CREATE POLICY "owners_delete_preceptors"
  ON public.preceptors FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid() AND is_owner = true
    )
  );

CREATE POLICY "service_role_full_preceptors"
  ON public.preceptors FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- ── preceptor_cohort_participation ────────────────────────────────────

CREATE POLICY "authenticated_read_participation"
  ON public.preceptor_cohort_participation FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "owners_insert_participation"
  ON public.preceptor_cohort_participation FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid() AND is_owner = true
    )
  );

CREATE POLICY "owners_update_participation"
  ON public.preceptor_cohort_participation FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid() AND is_owner = true
    )
  );

CREATE POLICY "owners_delete_participation"
  ON public.preceptor_cohort_participation FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid() AND is_owner = true
    )
  );

CREATE POLICY "service_role_full_participation"
  ON public.preceptor_cohort_participation FOR ALL TO service_role
  USING (true) WITH CHECK (true);


-- =====================================================================
-- Part 3: Triggers
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 3.1  Sync denormalized cohort summary fields on preceptors whenever
--      a preceptor_cohort_participation row is inserted/updated/deleted.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_preceptor_denormalized_fields()
RETURNS TRIGGER AS $$
DECLARE
  target_preceptor_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_preceptor_id := OLD.preceptor_id;
  ELSE
    target_preceptor_id := NEW.preceptor_id;
  END IF;

  UPDATE public.preceptors p
  SET
    cohorts_participated = (
      SELECT COUNT(DISTINCT cohort_id)
      FROM public.preceptor_cohort_participation
      WHERE preceptor_id = target_preceptor_id
    ),
    last_active_cohort = (
      SELECT c.name
      FROM public.preceptor_cohort_participation pcp
      JOIN public.cohorts c ON c.id = pcp.cohort_id
      WHERE pcp.preceptor_id = target_preceptor_id
      ORDER BY COALESCE(pcp.started_at, pcp.created_at::date) DESC
      LIMIT 1
    ),
    last_active_date = (
      SELECT COALESCE(pcp.ended_at, pcp.started_at, pcp.created_at::date)
      FROM public.preceptor_cohort_participation pcp
      WHERE pcp.preceptor_id = target_preceptor_id
      ORDER BY COALESCE(pcp.ended_at, pcp.started_at, pcp.created_at::date) DESC
      LIMIT 1
    ),
    updated_at = NOW()
  WHERE p.id = target_preceptor_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_preceptor_denormalized_after_change
  ON public.preceptor_cohort_participation;

CREATE TRIGGER sync_preceptor_denormalized_after_change
  AFTER INSERT OR UPDATE OR DELETE
  ON public.preceptor_cohort_participation
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_preceptor_denormalized_fields();


-- ─────────────────────────────────────────────────────────────────────
-- 3.2  Function to sync total_students_precepted whenever
--      students.preceptor_id changes.
--
--      The trigger is NOT created here — Phase B.2 will add it once
--      the frontend begins writing students.preceptor_id.
--      Activate in Phase B.2 with:
--
--        CREATE TRIGGER sync_preceptor_student_count_after_change
--          AFTER INSERT OR UPDATE OF preceptor_id OR DELETE
--          ON public.students
--          FOR EACH ROW
--          EXECUTE FUNCTION public.sync_preceptor_student_count();
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_preceptor_student_count()
RETURNS TRIGGER AS $$
BEGIN
  -- Decrement count for the old preceptor on UPDATE or DELETE
  IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') AND OLD.preceptor_id IS NOT NULL THEN
    UPDATE public.preceptors
    SET
      total_students_precepted = (
        SELECT COUNT(*) FROM public.students WHERE preceptor_id = OLD.preceptor_id
      ),
      updated_at = NOW()
    WHERE id = OLD.preceptor_id;
  END IF;

  -- Increment count for the new preceptor on INSERT or UPDATE
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.preceptor_id IS NOT NULL THEN
    UPDATE public.preceptors
    SET
      total_students_precepted = (
        SELECT COUNT(*) FROM public.students WHERE preceptor_id = NEW.preceptor_id
      ),
      updated_at = NOW()
    WHERE id = NEW.preceptor_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
