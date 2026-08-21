-- INTERVIEW-RUBRIC-AUTH-1
-- Bind each rubric to a staff profile, keep other interviewers' summary rows
-- visible, and prevent their detailed answers from reaching the browser.

BEGIN;

ALTER TABLE public.interview_rubrics
  ADD COLUMN IF NOT EXISTS interviewer_profile_id uuid
  REFERENCES public.user_profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.interview_rubrics.interviewer_profile_id IS
  'Authoritative rubric owner (user_profiles.id). interviewer_name is display text only.';

CREATE INDEX IF NOT EXISTS idx_interview_rubrics_profile_cohort
  ON public.interview_rubrics (interviewer_profile_id, cohort_id);

-- Backfill legacy rows only when the normalized name identifies exactly one
-- profile. Ambiguous or unmatched rows intentionally remain privileged-only.
WITH unique_profiles AS (
  SELECT lower(btrim(full_name)) AS normalized_name, min(id::text)::uuid AS profile_id
  FROM public.user_profiles
  WHERE nullif(btrim(full_name), '') IS NOT NULL
    AND (
      coalesce(is_owner, false) = true
      OR role IN ('owner', 'admin', 'co-lead', 'co_lead', 'interviewer')
    )
  GROUP BY lower(btrim(full_name))
  HAVING count(*) = 1
)
UPDATE public.interview_rubrics r
SET interviewer_profile_id = p.profile_id
FROM unique_profiles p
WHERE r.interviewer_profile_id IS NULL
  AND lower(btrim(r.interviewer_name)) = p.normalized_name;

CREATE OR REPLACE FUNCTION public.can_manage_all_interview_rubrics()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.auth_user_id = auth.uid()
      AND coalesce(up.is_active, true) = true
      AND (
        coalesce(up.is_owner, false) = true
        OR up.role IN ('owner', 'admin', 'co-lead', 'co_lead')
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_own_interview_rubric(
  p_interviewer_profile_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = p_interviewer_profile_id
      AND up.auth_user_id = auth.uid()
      AND up.role = 'interviewer'
      AND coalesce(up.is_active, true) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.interview_rubric_identity_matches_caller(
  p_interviewer_profile_id uuid,
  p_interviewer_name text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = p_interviewer_profile_id
      AND up.auth_user_id = auth.uid()
      AND up.role = 'interviewer'
      AND coalesce(up.is_active, true) = true
      AND lower(btrim(coalesce(p_interviewer_name, ''))) = lower(btrim(up.full_name))
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_all_interview_rubrics() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_own_interview_rubric(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.interview_rubric_identity_matches_caller(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_all_interview_rubrics() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_own_interview_rubric(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.interview_rubric_identity_matches_caller(uuid, text) TO authenticated, service_role;

-- Remove every legacy browser policy on this table before installing the
-- least-privilege command policies below. This avoids an older permissive
-- policy silently defeating the new boundary.
DO $policy_cleanup$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'interview_rubrics'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.interview_rubrics',
      policy_record.policyname
    );
  END LOOP;
END
$policy_cleanup$;

ALTER TABLE public.interview_rubrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY interview_rubrics_select_own_or_privileged
  ON public.interview_rubrics
  FOR SELECT TO authenticated
  USING (
    public.can_manage_all_interview_rubrics()
    OR public.is_own_interview_rubric(interviewer_profile_id)
  );

CREATE POLICY interview_rubrics_insert_own_or_privileged
  ON public.interview_rubrics
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_all_interview_rubrics()
    OR public.interview_rubric_identity_matches_caller(
      interviewer_profile_id,
      interviewer_name
    )
  );

CREATE POLICY interview_rubrics_update_own_or_privileged
  ON public.interview_rubrics
  FOR UPDATE TO authenticated
  USING (
    public.can_manage_all_interview_rubrics()
    OR public.is_own_interview_rubric(interviewer_profile_id)
  )
  WITH CHECK (
    public.can_manage_all_interview_rubrics()
    OR public.interview_rubric_identity_matches_caller(
      interviewer_profile_id,
      interviewer_name
    )
  );

CREATE POLICY interview_rubrics_delete_privileged
  ON public.interview_rubrics
  FOR DELETE TO authenticated
  USING (public.can_manage_all_interview_rubrics());

-- This is the only browser list path. Privileged users and the rubric's owner
-- receive the complete row. Everyone else receives the existing summary fields
-- while answer-bearing fields are replaced with NULL before leaving Postgres.
CREATE OR REPLACE FUNCTION public.list_interview_rubrics_for_cohort(
  p_cohort_id uuid
)
RETURNS TABLE (
  id uuid,
  student_id uuid,
  cohort_id uuid,
  interviewer_profile_id uuid,
  interviewer_name text,
  interview_date text,
  interview_time text,
  unit_preferences_rationale text,
  cj_question_asked text,
  cj_score integer,
  cj_notes text,
  pp_question_asked text,
  pp_score integer,
  pp_notes text,
  ga_question_asked text,
  ga_score integer,
  ga_notes text,
  student_questions text,
  individual_recommendation text,
  suggested_unit text,
  summary_comments text,
  composite_score integer,
  status text,
  created_at timestamptz,
  updated_at timestamptz,
  can_view_details boolean,
  can_edit boolean,
  is_own boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  actor_profile_id uuid;
  actor_is_privileged boolean;
BEGIN
  SELECT up.id,
         (
           coalesce(up.is_owner, false) = true
           OR up.role IN ('owner', 'admin', 'co-lead', 'co_lead')
         )
  INTO actor_profile_id, actor_is_privileged
  FROM public.user_profiles up
  WHERE up.auth_user_id = auth.uid()
    AND coalesce(up.is_active, true) = true
    AND (
      coalesce(up.is_owner, false) = true
      OR up.role IN ('owner', 'admin', 'co-lead', 'co_lead', 'interviewer', 'viewer')
    )
  LIMIT 1;

  IF actor_profile_id IS NULL THEN
    RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.student_id,
    r.cohort_id,
    CASE WHEN actor_is_privileged OR r.interviewer_profile_id = actor_profile_id THEN r.interviewer_profile_id ELSE NULL END,
    r.interviewer_name,
    r.interview_date,
    CASE WHEN actor_is_privileged OR r.interviewer_profile_id = actor_profile_id THEN r.interview_time ELSE NULL END,
    CASE WHEN actor_is_privileged OR r.interviewer_profile_id = actor_profile_id THEN r.unit_preferences_rationale ELSE NULL END,
    CASE WHEN actor_is_privileged OR r.interviewer_profile_id = actor_profile_id THEN r.cj_question_asked ELSE NULL END,
    r.cj_score,
    CASE WHEN actor_is_privileged OR r.interviewer_profile_id = actor_profile_id THEN r.cj_notes ELSE NULL END,
    CASE WHEN actor_is_privileged OR r.interviewer_profile_id = actor_profile_id THEN r.pp_question_asked ELSE NULL END,
    r.pp_score,
    CASE WHEN actor_is_privileged OR r.interviewer_profile_id = actor_profile_id THEN r.pp_notes ELSE NULL END,
    CASE WHEN actor_is_privileged OR r.interviewer_profile_id = actor_profile_id THEN r.ga_question_asked ELSE NULL END,
    r.ga_score,
    CASE WHEN actor_is_privileged OR r.interviewer_profile_id = actor_profile_id THEN r.ga_notes ELSE NULL END,
    CASE WHEN actor_is_privileged OR r.interviewer_profile_id = actor_profile_id THEN r.student_questions ELSE NULL END,
    r.individual_recommendation,
    r.suggested_unit,
    r.summary_comments,
    r.composite_score,
    r.status,
    r.created_at,
    r.updated_at,
    actor_is_privileged OR r.interviewer_profile_id = actor_profile_id,
    actor_is_privileged OR r.interviewer_profile_id = actor_profile_id,
    r.interviewer_profile_id = actor_profile_id
  FROM public.interview_rubrics r
  WHERE r.cohort_id = p_cohort_id
  ORDER BY r.created_at, r.id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_interview_rubrics_for_cohort(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_interview_rubrics_for_cohort(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.list_interview_rubrics_for_cohort(uuid) IS
  'Returns full rubric details to Owner/Admin/Co-Lead or the rubric author; returns summary-only redacted rows to other active staff.';

COMMIT;

-- Verification after applying:
-- 1. Legacy rows not safely attributable (review before assigning manually):
--    SELECT id, interviewer_name FROM public.interview_rubrics
--    WHERE interviewer_profile_id IS NULL;
-- 2. Policies (expect four rows, no staff_all_rubrics):
--    SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'interview_rubrics'
--    ORDER BY policyname;
-- 3. As an Interviewer, another author's detail fields from the RPC must be
--    NULL and can_view_details/can_edit must be false.
