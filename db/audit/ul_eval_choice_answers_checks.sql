-- UL-CHOICE-WORDS-1 checks for supabase/migrations/20261113000000_ul_eval_choice_answers.sql.
-- Read-only. Run one section at a time.

-- PRE 1: the phrase table does not exist yet; the functions it replaces do
-- (expect: false, true, true, false)
SELECT
  to_regclass('public.evaluation_unit_choice_keys') IS NOT NULL AS choice_table,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_ul_eval_safe_quantitative') AS safe_fn,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'ul_eval_dashboard_summary') AS summary_fn,
  (SELECT prosrc LIKE '%choice_counts%' FROM pg_proc WHERE proname = 'ul_eval_dashboard_summary') AS summary_has_choices;

-- PRE 2: how many Preceptor's Assessment responses hold each readiness answer today
-- (counts only, no names). Every value should be one of the five listed phrases.
SELECT r.responses #>> '{readiness_endorsement,transition_readiness}' AS transition_readiness, count(*) AS responses
  FROM public.evaluation_response_unit_release rel
  JOIN public.evaluation_responses r ON r.id = rel.response_id
 WHERE rel.instrument_slug = 'preceptor_progress'
 GROUP BY 1 ORDER BY 2 DESC;

-- POST 1: four phrase rows, the safe function reads them, the summary returns choice_counts
-- (expect: 4, true, true)
SELECT
  (SELECT count(*) FROM public.evaluation_unit_choice_keys) AS choice_rows,
  (SELECT prosrc LIKE '%evaluation_unit_choice_keys%' FROM pg_proc WHERE proname = '_ul_eval_safe_quantitative') AS safe_fn_reads_choices,
  (SELECT prosrc LIKE '%choice_counts%' FROM pg_proc WHERE proname = 'ul_eval_dashboard_summary') AS summary_has_choices;

-- POST 2: a Preceptor's Assessment response now yields its phrases and nothing else
-- (expect: one row per response, keys only from readiness_endorsement / developmental_feedback.context)
SELECT public._ul_eval_safe_quantitative('preceptor_progress', r.responses) AS leader_would_see
  FROM public.evaluation_response_unit_release rel
  JOIN public.evaluation_responses r ON r.id = rel.response_id
 WHERE rel.instrument_slug = 'preceptor_progress'
 LIMIT 3;

-- POST 3: clients read the phrase table only as Owner/Admin and write nothing
-- (expect: authenticated holds SELECT only)
SELECT privilege_type FROM information_schema.role_table_grants
 WHERE table_name = 'evaluation_unit_choice_keys' AND grantee = 'authenticated' ORDER BY 1;
