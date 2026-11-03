-- Checks for supabase/migrations/20261122000000_assess_candidate_statement_source.sql
-- Run one section at a time (the CLI shows only the last statement's result).

-- PRE 1: the Skill is still a disabled draft with the form-only wording.
SELECT status, enabled, version, allowed_roles, model_route,
       position('personal statement the applicant uploaded' IN instruction_body) > 0 AS has_new_wording
  FROM public.keith_skills WHERE slug = 'assess-candidate';

-- POST 1: active, enabled, one version higher, new wording, roles and route unchanged.
SELECT status, enabled, version, allowed_roles, model_route,
       position('personal statement the applicant uploaded' IN instruction_body) > 0 AS has_new_wording,
       (SELECT count(*) FROM public.keith_skill_versions v WHERE v.skill_id = s.id) AS versions
  FROM public.keith_skills s WHERE slug = 'assess-candidate';
