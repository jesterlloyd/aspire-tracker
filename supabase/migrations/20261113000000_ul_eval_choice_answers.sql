-- ============================================================================
-- UNIT LEADERS SEE THE PRECEPTOR'S ANSWERS AS WORDS (UL-CHOICE-WORDS-1, 2026-10-07)
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester). Claude Code has applied NOTHING. ***
--
-- Owner, 2026-10-07: "show answers as words". The Preceptor's Assessment (preceptor_progress)
-- stores its readiness and endorsement answers as fixed phrases ("Yes, enthusiastically",
-- "Progressing appropriately for student level"), not numbers. The release gate's allowlist
-- passed numbers only (_ul_eval_safe_quantitative: jsonb_typeof = 'number'), so a released
-- preceptor response showed its unit leader nothing at all.
--
-- WHAT THIS FILE DOES
--   1. evaluation_unit_choice_keys: the exact answer phrases a unit leader may see, per path.
--      Same instrument and section CHECKs as evaluation_unit_quantitative_keys, so a free-text
--      or identifying section can never be listed. Seeded with the four preceptor_progress
--      choice questions and their options, word for word from
--      lib/server/evaluation/preceptor_progress_validation.js (a test holds them equal).
--   2. _ul_eval_safe_quantitative (same signature) now returns, besides the allowlisted
--      numbers, an allowlisted STRING only when it equals one of its path's listed phrases.
--      Anything else (a typed comment, an unknown word) is still dropped.
--   3. ul_eval_dashboard_summary (same signature) adds choice_counts: per path, how many
--      released responses gave each phrase. The averages are unchanged (numbers only).
--
-- UNCHANGED: every release predicate (released, cleared, quantitative_visible, free_text_visible
-- false, verified snapshot, eligibility, the caller's unit scope), ul_eval_response_list (it
-- already returns _ul_eval_safe_quantitative's output), every grant. The server re-checks each
-- phrase against the same lists and fails closed (assertUnitLeaderShape).
--
-- Additive and transactional; rewrites no data. Either deploy order: before it runs, unit
-- leaders keep seeing numbers only.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.evaluation_unit_choice_keys (
  instrument_slug text   NOT NULL,
  json_path       text[] NOT NULL,
  allowed_values  text[] NOT NULL,
  label           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instrument_slug, json_path),
  CONSTRAINT chk_uck_instrument
    CHECK (instrument_slug IN ('student_preceptor_eval', 'preceptor_progress')),
  CONSTRAINT chk_uck_safe_section CHECK (
    (instrument_slug = 'student_preceptor_eval'
       AND json_path[1] IN ('preceptor_support', 'learning_environment',
                            'psychological_safety', 'overall_experience'))
    OR
    (instrument_slug = 'preceptor_progress'
       AND json_path[1] IN ('developmental_feedback', 'readiness_endorsement'))
  ),
  CONSTRAINT chk_uck_values CHECK (cardinality(allowed_values) BETWEEN 1 AND 12)
);

COMMENT ON TABLE public.evaluation_unit_choice_keys IS
  'Exact per-path answer phrases that MAY be shown to Unit Leaders. A stored string is shown only when it equals one of these. The section CHECK forbids listing a free-text or identifying section.';

ALTER TABLE public.evaluation_unit_choice_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.evaluation_unit_choice_keys FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.evaluation_unit_choice_keys TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.evaluation_unit_choice_keys TO service_role;
DROP POLICY IF EXISTS "owner_admin_select_ul_eval_ckeys" ON public.evaluation_unit_choice_keys;
CREATE POLICY "owner_admin_select_ul_eval_ckeys"
  ON public.evaluation_unit_choice_keys FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());

INSERT INTO public.evaluation_unit_choice_keys (instrument_slug, json_path, allowed_values, label) VALUES
  ('preceptor_progress', ARRAY['developmental_feedback', 'context', 'shifts_observed'],
   ARRAY['1 shift', '2–3 shifts', '4–6 shifts', '7 or more shifts', 'Not sure'], 'Shifts observed'),
  ('preceptor_progress', ARRAY['readiness_endorsement', 'transition_readiness'],
   ARRAY['Strongly progressing and demonstrating readiness', 'Progressing appropriately for student level',
         'Progressing, with continued focused support recommended', 'Not yet demonstrating expected readiness',
         'Unable to assess'], 'Transition readiness'),
  ('preceptor_progress', ARRAY['readiness_endorsement', 'unit_endorsement_consideration'],
   ARRAY['Yes, enthusiastically', 'Yes', 'Yes, with focused support or continued development', 'Not at this time',
         'Unable to assess'], 'Unit endorsement consideration'),
  ('preceptor_progress', ARRAY['readiness_endorsement', 'cedars_consideration_recommendation'],
   ARRAY['Yes, enthusiastically', 'Yes', 'Yes, with focused support or continued development', 'Not at this time',
         'Unable to assess'], 'Cedars consideration recommendation')
ON CONFLICT (instrument_slug, json_path) DO UPDATE SET allowed_values = EXCLUDED.allowed_values, label = EXCLUDED.label;

CREATE OR REPLACE FUNCTION public._ul_eval_safe_quantitative(p_slug text, p_responses jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
      (SELECT jsonb_object_agg(array_to_string(k.json_path, '.'), v.val)
         FROM public.evaluation_unit_quantitative_keys k
         CROSS JOIN LATERAL (SELECT p_responses #> k.json_path AS val) v
        WHERE k.instrument_slug = p_slug
          AND jsonb_typeof(v.val) = 'number'),
      '{}'::jsonb)
    || COALESCE(
      (SELECT jsonb_object_agg(array_to_string(c.json_path, '.'), w.val)
         FROM public.evaluation_unit_choice_keys c
         CROSS JOIN LATERAL (SELECT p_responses #> c.json_path AS val) w
        WHERE c.instrument_slug = p_slug
          AND jsonb_typeof(w.val) = 'string'
          AND (w.val #>> '{}') = ANY (c.allowed_values)),
      '{}'::jsonb);
$$;
REVOKE ALL ON FUNCTION public._ul_eval_safe_quantitative(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ul_eval_dashboard_summary(
  p_instrument_slug text, p_timepoint text DEFAULT NULL, p_unit_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  WITH scoped AS (
    SELECT rel.id,
           public._ul_eval_safe_quantitative(rel.instrument_slug, r.responses) AS q
    FROM public.evaluation_response_unit_release rel
    JOIN public.evaluation_responses r ON r.id = rel.response_id
    WHERE public.has_active_role_grant('unit_leader')
      AND rel.instrument_slug = p_instrument_slug
      AND rel.instrument_slug IN ('student_preceptor_eval', 'preceptor_progress')
      AND rel.release_state = 'released'
      AND rel.release_state <> 'revoked'
      AND rel.moderation_state = 'cleared'
      AND rel.quantitative_visible = true
      AND rel.free_text_visible = false
      AND rel.snapshot_source IN ('submission_trigger', 'backfill_verified')
      AND rel.hist_preceptor_id IS NOT NULL
      AND rel.unit_leader_eligible_at IS NOT NULL
      AND now() >= rel.unit_leader_eligible_at
      AND (p_timepoint IS NULL OR rel.timepoint = p_timepoint)
      AND (p_unit_key IS NULL OR rel.hist_unit_key = p_unit_key)
      AND EXISTS (
        SELECT 1 FROM public.my_unit_scope_keys() s
        WHERE s.unit_key = rel.hist_unit_key
          AND (s.cohort_id IS NULL OR s.cohort_id = rel.hist_cohort_id)
      )
  ),
  nums AS (
    SELECT e.key, (e.value #>> '{}')::numeric AS val
    FROM scoped sc, jsonb_each(sc.q) e
    WHERE jsonb_typeof(e.value) = 'number'
  ),
  per_key AS (
    SELECT key, round(avg(val), 3) AS avg_value, count(*) AS n
    FROM nums GROUP BY key
  ),
  words AS (
    SELECT e.key, e.value #>> '{}' AS word
    FROM scoped sc, jsonb_each(sc.q) e
    WHERE jsonb_typeof(e.value) = 'string'
  ),
  per_word AS (
    SELECT key, jsonb_object_agg(word, n) AS counts
    FROM (SELECT key, word, count(*) AS n FROM words GROUP BY key, word) x
    GROUP BY key
  )
  SELECT jsonb_build_object(
    'instrument_slug', p_instrument_slug,
    'timepoint', p_timepoint,
    'unit_key', p_unit_key,
    'released_response_count', (SELECT count(*) FROM scoped),
    'quantitative_averages', COALESCE(
      (SELECT jsonb_object_agg(key, jsonb_build_object('avg', avg_value, 'n', n)) FROM per_key),
      '{}'::jsonb),
    'choice_counts', COALESCE(
      (SELECT jsonb_object_agg(key, counts) FROM per_word),
      '{}'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.ul_eval_dashboard_summary(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ul_eval_dashboard_summary(text, text, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
