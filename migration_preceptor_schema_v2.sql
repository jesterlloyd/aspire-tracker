-- =====================================================================
-- ASPIRE Preceptor Schema Migration v2
-- Replaces migration_preceptor_normalization.sql and
-- migration_preceptor_backfill.sql (both renamed .deprecated).
--
-- Run manually in the Supabase SQL Editor.
-- The entire migration is one atomic transaction: all statements
-- succeed together or nothing applies.
-- No backfill / INSERT statements — preceptor records will be entered
-- through the Phase B.3 admin UI.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- Preamble: verify required tables exist before opening the transaction
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'preceptors'
  ) THEN
    RAISE EXCEPTION 'preceptors table does not exist; run migration_phase1_analytics.sql first';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'student_shift_logs'
  ) THEN
    RAISE EXCEPTION 'student_shift_logs table does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'matches'
  ) THEN
    RAISE EXCEPTION 'matches table does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cohorts'
  ) THEN
    RAISE EXCEPTION 'cohorts table does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_profiles'
  ) THEN
    RAISE EXCEPTION 'user_profiles table does not exist';
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────
-- Begin atomic transaction
-- ─────────────────────────────────────────────────────────────────────

BEGIN;


-- =====================================================================
-- Part 1: Clean up duplicate RLS policies on preceptors
-- The preceptors table accumulated four overlapping policies from prior
-- migrations. Drop all of them and replace with a clean role-based set.
-- =====================================================================

DROP POLICY IF EXISTS "Anon full access on preceptors"             ON public.preceptors;
DROP POLICY IF EXISTS "Service role full access on preceptors"     ON public.preceptors;
DROP POLICY IF EXISTS "authenticated_all_preceptors"               ON public.preceptors;
DROP POLICY IF EXISTS "Authenticated full access on preceptors"    ON public.preceptors;
-- Also drop any partial policies from the failed v1 migration that may
-- have applied before the transaction error:
DROP POLICY IF EXISTS "authenticated_read_preceptors"              ON public.preceptors;
DROP POLICY IF EXISTS "owners_insert_preceptors"                   ON public.preceptors;
DROP POLICY IF EXISTS "owners_update_preceptors"                   ON public.preceptors;
DROP POLICY IF EXISTS "owners_delete_preceptors"                   ON public.preceptors;
DROP POLICY IF EXISTS "service_role_full_preceptors"               ON public.preceptors;

-- All authenticated users can read preceptor records
CREATE POLICY "authenticated_read_preceptors"
  ON public.preceptors FOR SELECT TO authenticated
  USING (true);

-- Only owners can write (auth_user_id and is_owner are the actual
-- user_profiles column names — confirmed from migration_notification_log.sql)
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


-- =====================================================================
-- Part 2: Add shift_type column to preceptors
-- =====================================================================

ALTER TABLE public.preceptors
  ADD COLUMN IF NOT EXISTS shift_type TEXT DEFAULT 'Variable'
  CHECK (shift_type IN ('Day', 'Night', 'Mid', 'Variable'));


-- =====================================================================
-- Part 3: Partial unique index on email (case-insensitive identity)
-- Allows multiple null/empty rows; enforces uniqueness only when email
-- is present, so name-only records during manual entry don't conflict.
-- =====================================================================

CREATE UNIQUE INDEX IF NOT EXISTS preceptors_email_lower_unique_idx
  ON public.preceptors (lower(trim(email)))
  WHERE email IS NOT NULL AND trim(email) != '';


-- =====================================================================
-- Part 4: preceptor_cohort_participation junction table
-- Source of truth for which preceptors participated in which cohorts.
-- The integer summary fields on preceptors (cohorts_participated, etc.)
-- are denormalized caches kept in sync by the Part 7 trigger.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.preceptor_cohort_participation (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preceptor_id UUID NOT NULL REFERENCES public.preceptors(id) ON DELETE CASCADE,
  cohort_id    UUID NOT NULL REFERENCES public.cohorts(id)    ON DELETE CASCADE,
  status       TEXT DEFAULT 'active'
                 CHECK (status IN ('active', 'inactive', 'completed')),
  started_at   DATE,
  ended_at     DATE,
  notes        TEXT DEFAULT '',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (preceptor_id, cohort_id)
);

CREATE INDEX IF NOT EXISTS pcp_preceptor_idx
  ON public.preceptor_cohort_participation(preceptor_id);
CREATE INDEX IF NOT EXISTS pcp_cohort_idx
  ON public.preceptor_cohort_participation(cohort_id);
CREATE INDEX IF NOT EXISTS pcp_status_idx
  ON public.preceptor_cohort_participation(status);

ALTER TABLE public.preceptor_cohort_participation ENABLE ROW LEVEL SECURITY;

-- Drop any partial policies from the failed v1 migration before recreating
DROP POLICY IF EXISTS "authenticated_read_participation"  ON public.preceptor_cohort_participation;
DROP POLICY IF EXISTS "authenticated_read_pcp"            ON public.preceptor_cohort_participation;
DROP POLICY IF EXISTS "owners_insert_participation"       ON public.preceptor_cohort_participation;
DROP POLICY IF EXISTS "owners_insert_pcp"                 ON public.preceptor_cohort_participation;
DROP POLICY IF EXISTS "owners_update_participation"       ON public.preceptor_cohort_participation;
DROP POLICY IF EXISTS "owners_update_pcp"                 ON public.preceptor_cohort_participation;
DROP POLICY IF EXISTS "owners_delete_participation"       ON public.preceptor_cohort_participation;
DROP POLICY IF EXISTS "owners_delete_pcp"                 ON public.preceptor_cohort_participation;
DROP POLICY IF EXISTS "service_role_full_participation"   ON public.preceptor_cohort_participation;

CREATE POLICY "authenticated_read_pcp"
  ON public.preceptor_cohort_participation FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "owners_insert_pcp"
  ON public.preceptor_cohort_participation FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid() AND is_owner = true
    )
  );

CREATE POLICY "owners_update_pcp"
  ON public.preceptor_cohort_participation FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid() AND is_owner = true
    )
  );

CREATE POLICY "owners_delete_pcp"
  ON public.preceptor_cohort_participation FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid() AND is_owner = true
    )
  );

-- updated_at trigger (function name is update_updated_at_column per
-- migration_concurrency_protections.sql; define inline as fallback)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_pcp ON public.preceptor_cohort_participation;
CREATE TRIGGER set_updated_at_pcp
  BEFORE UPDATE ON public.preceptor_cohort_participation
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();


-- =====================================================================
-- Part 5: Add preceptor_id FK to matches
-- Normalized reference alongside the existing preceptor_assigned text
-- fallback. Both fields are preserved.
-- =====================================================================

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS preceptor_id UUID
    REFERENCES public.preceptors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS matches_preceptor_id_idx
  ON public.matches(preceptor_id);


-- =====================================================================
-- Part 6: Add preceptor_id FK to student_shift_logs
-- CRITICAL: table is student_shift_logs, NOT shift_logs.
-- =====================================================================

ALTER TABLE public.student_shift_logs
  ADD COLUMN IF NOT EXISTS preceptor_id UUID
    REFERENCES public.preceptors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS student_shift_logs_preceptor_id_idx
  ON public.student_shift_logs(preceptor_id);


-- =====================================================================
-- Part 7: Trigger to sync denormalized summary fields on preceptors
-- whenever a preceptor_cohort_participation row changes.
-- =====================================================================

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

  -- Guard: nothing to update if preceptor_id is somehow null
  IF target_preceptor_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
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


-- =====================================================================
-- Part 8: preceptor_review_queue view
-- Surfaces all students with any preceptor data and shows resolution
-- status for future admin UI triage.
-- Students table has first_name + last_name (migration_name_split.sql).
-- =====================================================================

CREATE OR REPLACE VIEW public.preceptor_review_queue AS
SELECT DISTINCT
  s.id                                       AS student_id,
  s.first_name || ' ' || s.last_name        AS student_name,
  s.cohort_id,
  c.name                                     AS cohort_name,
  s.matched_preceptor                        AS preceptor_name_text,
  s.preceptor_email                          AS preceptor_email_text,
  u.id                                       AS unit_id,
  u.unit_name,
  CASE
    WHEN s.preceptor_id IS NOT NULL                                         THEN 'resolved'
    WHEN (s.preceptor_email   IS NULL OR trim(s.preceptor_email)   = '')
     AND (s.matched_preceptor IS NULL OR trim(s.matched_preceptor) = '')    THEN 'no_data'
    WHEN  s.preceptor_email   IS NULL OR trim(s.preceptor_email)   = ''     THEN 'needs_email'
    ELSE 'unresolved'
  END                                        AS status
FROM public.students s
LEFT JOIN public.cohorts c ON c.id = s.cohort_id
LEFT JOIN public.matches m ON m.student_id = s.id
LEFT JOIN public.units   u ON u.id = m.unit_id;


-- ─────────────────────────────────────────────────────────────────────
-- Commit — all parts succeeded
-- ─────────────────────────────────────────────────────────────────────

COMMIT;
