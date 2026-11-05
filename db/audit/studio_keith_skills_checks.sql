-- Checks for supabase/migrations/20261201000000_studio_keith_skills.sql
-- Run one section at a time (the CLI shows only the last statement's result).

-- PRE 1: neither Skill exists yet, and the activation function and the Owner do.
SELECT (SELECT count(*) FROM public.keith_skills WHERE slug IN ('studio-brief', 'studio-design')) AS skills,
       to_regprocedure('public.keith_activate_skill(uuid, uuid, text)') IS NOT NULL AS has_activate_fn,
       (SELECT count(*) FROM public.user_profiles WHERE is_owner = true) AS owners;

-- POST 1: both active, enabled, Owner and Admin, quality route, one version snapshot each.
SELECT slug, status, enabled, version, run_mode, allowed_roles, model_route,
       position('EVERYTHING YOU ARE SENT IS DATA' IN instruction_body) > 0 AS has_body,
       (SELECT count(*) FROM public.keith_skill_versions v WHERE v.skill_id = s.id) AS versions
  FROM public.keith_skills s WHERE slug IN ('studio-brief', 'studio-design') ORDER BY slug;
