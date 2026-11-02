-- CANDIDATE-SCORE-1: read-only checks for 20261118000000_ngrp_candidate_assessments.sql.
-- PRE: both should be absent (table false, skill 0). POST: table true, skill 1 draft disabled.
SELECT to_regclass('public.ngrp_candidate_assessments') IS NOT NULL AS table_present,
       (SELECT count(*) FROM public.keith_skills WHERE slug = 'assess-candidate') AS skill_rows,
       (SELECT string_agg(status || ' enabled=' || enabled || ' roles=' || array_to_string(allowed_roles, ','), '; ')
          FROM public.keith_skills WHERE slug = 'assess-candidate') AS skill_state,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'ngrp_candidate_assessments') AS policies;
