-- =============================================================================
-- Preceptor projection DRIFT AUDIT  (PRECEPTOR-ASSIGNMENT-PROJECTION-1)
-- READ-ONLY. Run BEFORE applying 20260820000000 to see exactly what the
-- backfill would change. Nothing here writes.
-- =============================================================================
--
-- ONE query, ONE result grid. The Supabase SQL editor shows only the LAST
-- result when several statements run together, so everything below is a single
-- SELECT: one labelled row per finding, ordered so the summary comes first and
-- the per-row detail follows. Run the whole file as one block.
--
-- Expected shift = the SAME rule the migration installs: Day|Night|Mid|Variable
-- pass through; NULL, blank, or anything else is blank.
-- =============================================================================

WITH expected AS (
  SELECT s.id                        AS student_id,
         s.name                      AS student_name,
         s.cohort_id,
         s.preceptor_id,
         s.matched_preceptor         AS cur_name,
         s.preceptor_email           AS cur_email,
         s.shift_assigned            AS cur_shift,
         COALESCE(p.full_name, '')   AS exp_name,
         COALESCE(p.email, '')       AS exp_email,
         p.shift_type                AS preceptor_shift_type,
         CASE WHEN btrim(COALESCE(p.shift_type, '')) IN ('Day','Night','Mid','Variable')
              THEN btrim(p.shift_type) ELSE '' END AS exp_shift
  FROM public.students s
  JOIN public.preceptors p ON p.id = s.preceptor_id
  WHERE s.preceptor_id IS NOT NULL
),
single_match AS (
  SELECT m.id AS match_id, m.student_id, m.cohort_id,
         m.preceptor_id       AS cur_match_fk,
         m.preceptor_assigned AS cur_match_name,
         m.shift_assigned     AS cur_match_shift,
         e.preceptor_id       AS exp_match_fk,
         e.exp_name           AS exp_match_name,
         e.exp_shift          AS exp_match_shift
  FROM public.matches m
  JOIN expected e ON e.student_id = m.student_id AND e.cohort_id = m.cohort_id
  WHERE (SELECT count(*) FROM public.matches m2
         WHERE m2.student_id = m.student_id AND m2.cohort_id = m.cohort_id) = 1
),
multi_match AS (
  SELECT m.student_id, count(*) AS match_rows
  FROM public.matches m
  JOIN expected e ON e.student_id = m.student_id AND e.cohort_id = m.cohort_id
  GROUP BY m.student_id
  HAVING count(*) > 1
),
rows_out AS (
  -- ── 1. Student projection summary ─────────────────────────────────────────
  SELECT 1 AS sort_1, 0 AS sort_2, 'SUMMARY · students' AS section,
         'linked students'::text AS metric,
         count(*)::text          AS value,
         NULL::text              AS detail
  FROM expected
  UNION ALL
  SELECT 1, 1, 'SUMMARY · students', 'name drift',
         count(*) FILTER (WHERE cur_name IS DISTINCT FROM exp_name)::text, NULL FROM expected
  UNION ALL
  SELECT 1, 2, 'SUMMARY · students', 'email drift',
         count(*) FILTER (WHERE cur_email IS DISTINCT FROM exp_email)::text, NULL FROM expected
  UNION ALL
  SELECT 1, 3, 'SUMMARY · students', 'shift drift',
         count(*) FILTER (WHERE cur_shift IS DISTINCT FROM exp_shift)::text, NULL FROM expected
  UNION ALL
  SELECT 1, 4, 'SUMMARY · students', 'shift would CLEAR (preceptor has none)',
         count(*) FILTER (WHERE exp_shift = '' AND COALESCE(cur_shift,'') <> '')::text, NULL FROM expected
  UNION ALL
  SELECT 1, 5, 'SUMMARY · students', 'already correct',
         count(*) FILTER (WHERE cur_name  IS NOT DISTINCT FROM exp_name
                            AND cur_email IS NOT DISTINCT FROM exp_email
                            AND cur_shift IS NOT DISTINCT FROM exp_shift)::text, NULL FROM expected

  -- ── 2. Match projection summary (single-match students only) ──────────────
  UNION ALL
  SELECT 2, 0, 'SUMMARY · matches (single-match only)', 'single-match rows',
         count(*)::text, NULL FROM single_match
  UNION ALL
  SELECT 2, 1, 'SUMMARY · matches (single-match only)', 'preceptor_id drift',
         count(*) FILTER (WHERE cur_match_fk IS DISTINCT FROM exp_match_fk)::text, NULL FROM single_match
  UNION ALL
  SELECT 2, 2, 'SUMMARY · matches (single-match only)', 'preceptor_assigned drift',
         count(*) FILTER (WHERE cur_match_name IS DISTINCT FROM exp_match_name)::text, NULL FROM single_match
  UNION ALL
  SELECT 2, 3, 'SUMMARY · matches (single-match only)', 'shift_assigned drift',
         count(*) FILTER (WHERE cur_match_shift IS DISTINCT FROM exp_match_shift)::text, NULL FROM single_match

  -- ── 3. Deliberately SKIPPED: multi-match students ─────────────────────────
  UNION ALL
  SELECT 3, 0, 'SKIPPED · multi-match students', 'students with >1 match row',
         count(*)::text,
         'These keep raising the existing matches_anomaly event and are left untouched by design.'
  FROM multi_match

  -- ── 4. Non-canonical shift values currently stored ────────────────────────
  UNION ALL
  SELECT 4, 0, 'DETAIL · stored student shift values',
         COALESCE(NULLIF(btrim(cur_shift), ''), '(blank)'),
         count(*)::text,
         CASE WHEN btrim(COALESCE(cur_shift,'')) IN ('Day','Night','Mid','Variable','')
              THEN 'canonical' ELSE 'NON-CANONICAL - will be rewritten' END
  FROM expected
  GROUP BY COALESCE(NULLIF(btrim(cur_shift), ''), '(blank)'),
           CASE WHEN btrim(COALESCE(cur_shift,'')) IN ('Day','Night','Mid','Variable','')
                THEN 'canonical' ELSE 'NON-CANONICAL - will be rewritten' END

  -- ── 5. Every student row the backfill would change ────────────────────────
  UNION ALL
  SELECT 5, 0, 'DETAIL · student rows that would change',
         student_name,
         format('shift %s -> %s', COALESCE(NULLIF(cur_shift,''),'(blank)'),
                                  COALESCE(NULLIF(exp_shift,''),'(blank)')),
         format('name %s -> %s | email %s -> %s | preceptor.shift_type=%s',
                COALESCE(NULLIF(cur_name,''),'(blank)'),  COALESCE(NULLIF(exp_name,''),'(blank)'),
                COALESCE(NULLIF(cur_email,''),'(blank)'), COALESCE(NULLIF(exp_email,''),'(blank)'),
                COALESCE(preceptor_shift_type,'(null)'))
  FROM expected
  WHERE cur_name  IS DISTINCT FROM exp_name
     OR cur_email IS DISTINCT FROM exp_email
     OR cur_shift IS DISTINCT FROM exp_shift

  -- ── 6. Every match row the backfill would change ──────────────────────────
  UNION ALL
  SELECT 6, 0, 'DETAIL · match rows that would change',
         match_id::text,
         format('fk %s -> %s', COALESCE(cur_match_fk::text,'(null)'), COALESCE(exp_match_fk::text,'(null)')),
         format('name %s -> %s | shift %s -> %s',
                COALESCE(NULLIF(cur_match_name,''),'(blank)'),  COALESCE(NULLIF(exp_match_name,''),'(blank)'),
                COALESCE(NULLIF(cur_match_shift,''),'(blank)'), COALESCE(NULLIF(exp_match_shift,''),'(blank)'))
  FROM single_match
  WHERE cur_match_fk    IS DISTINCT FROM exp_match_fk
     OR cur_match_name  IS DISTINCT FROM exp_match_name
     OR cur_match_shift IS DISTINCT FROM exp_match_shift
)
SELECT section, metric, value, detail
FROM rows_out
ORDER BY sort_1, sort_2, metric;
-- =============================================================================
