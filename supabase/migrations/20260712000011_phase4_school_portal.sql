-- ============================================================================
-- PHASE 4: schools normalization and academic partner read surface
-- ============================================================================
-- *** PREREQUISITES (hard): Phase 0B Waves A through E, Phase 2 foundation   ***
-- *** (20260712000007), Phase 3 (20260712000010, for released_reports).     ***
--
-- Owner instructions: run this ENTIRE file as one block. Additive plus ONE
-- backfill UPDATE (students.school_id, described below). The backfill only
-- fills NULLs and never touches students.school text, so it is idempotent
-- and reversible (SET school_id = NULL).
--
-- Contents:
--   1. schools: normalization table seeded with the seven operative schools
--      (the students.school dropdown values plus canonical long names and
--      abbreviations from api/lib/schoolAliases.js).
--   2. students.school_id: nullable FK, backfilled by normalized matching.
--      students.school (text) remains the operative column; school_id is the
--      stable key for scoping and future reporting.
--   3. portal_my_school_reports: released-reports view for academic partners
--      (audience 'school', scope_ref = the school's canonical_name).
--
-- The academic partner roster itself is a JWT endpoint
-- (api/portal/school-students.js), not a view: it filters by alias-aware
-- school matching and derives evaluation-completion status, which is easier
-- to audit in one server-side allowlist.
-- ============================================================================

-- ── 1. schools ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.schools (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name  text    NOT NULL UNIQUE,
  -- The value the app's dropdowns use today (students.school), when it
  -- differs from the canonical name.
  operative_name  text,
  aliases         text[]  NOT NULL DEFAULT '{}',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.schools (canonical_name, operative_name, aliases) VALUES
  ('Azusa Pacific University', 'Azusa Pacific University',
   ARRAY['APU', 'Azusa Pacific', 'Azusa']),
  ('California State University, Long Beach', 'Cal State Long Beach',
   ARRAY['CSULB', 'CSU Long Beach', 'Long Beach State']),
  ('California State University, Los Angeles', 'Cal State LA',
   ARRAY['CSULA', 'Cal State Los Angeles', 'CSU Los Angeles']),
  ('California State University, Northridge', 'Cal State Northridge',
   ARRAY['CSUN', 'CSU Northridge']),
  ('University of California, Los Angeles', 'UCLA',
   ARRAY['UC Los Angeles']),
  ('West Coast University Anaheim', 'West Coast University Anaheim',
   ARRAY['WCU Anaheim']),
  ('West Coast University North Hollywood', 'West Coast University North Hollywood',
   ARRAY['WCU North Hollywood', 'WCU NoHo', 'West Coast University NoHo'])
ON CONFLICT (canonical_name) DO NOTHING;

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schools FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.schools TO authenticated;
GRANT ALL PRIVILEGES ON public.schools TO service_role;
-- Staff read; portal roles have no need for the roster of schools.
CREATE POLICY "staff_select_schools" ON public.schools
  FOR SELECT TO authenticated USING (public.is_staff());

-- ── 2. students.school_id plus backfill ─────────────────────────────────────

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS school_id uuid
  REFERENCES public.schools(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_students_school_id ON public.students (school_id);

-- Backfill by normalized matching (lowercase, punctuation stripped, spaces
-- collapsed) of students.school against canonical, operative, and alias
-- names. Fills NULLs only.
WITH school_terms AS (
  SELECT id,
         lower(regexp_replace(regexp_replace(term, '[.,&/-]', ' ', 'g'), '\s+', ' ', 'g')) AS norm_term
  FROM (
    SELECT id, canonical_name AS term FROM public.schools
    UNION ALL
    SELECT id, operative_name FROM public.schools WHERE operative_name IS NOT NULL
    UNION ALL
    SELECT id, unnest(aliases) FROM public.schools
  ) t
)
UPDATE public.students s
SET school_id = st.id
FROM school_terms st
WHERE s.school_id IS NULL
  AND s.school IS NOT NULL
  AND lower(regexp_replace(regexp_replace(trim(s.school), '[.,&/-]', ' ', 'g'), '\s+', ' ', 'g')) = st.norm_term;

-- ── 3. Academic partner released-reports view ────────────────────────────────

CREATE OR REPLACE VIEW public.portal_my_school_reports
WITH (security_barrier = true) AS
  SELECT
    rr.id,
    rr.scope_ref AS school_key,
    rr.cohort_id,
    rr.title,
    rr.body_md,
    rr.payload,
    rr.published_at
  FROM public.released_reports rr
  WHERE rr.audience_type = 'school'
    AND rr.revoked_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.my_school_scope_keys() s
      WHERE s.school_key = rr.scope_ref
        AND (s.cohort_id IS NULL OR rr.cohort_id IS NULL OR s.cohort_id = rr.cohort_id)
    );

REVOKE ALL ON public.portal_my_school_reports FROM PUBLIC, anon;
GRANT SELECT ON public.portal_my_school_reports TO authenticated;
GRANT SELECT ON public.portal_my_school_reports TO service_role;

-- Verification:
--   1. Backfill coverage (review any unmatched values; they stay NULL):
--      SELECT school, count(*) FROM public.students
--      WHERE school_id IS NULL AND school IS NOT NULL AND school <> ''
--      GROUP BY school ORDER BY count(*) DESC;
--   2. Seed count (expected 7):
--      SELECT count(*) FROM public.schools;
--   3. As a staff user with no academic_partner grant (expected 0):
--      SELECT count(*) FROM portal_my_school_reports;
