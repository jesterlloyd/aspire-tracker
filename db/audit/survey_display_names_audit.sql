-- db/audit/survey_display_names_audit.sql
--
-- SURVEY-NAMES-1 (2026-09-20). READ-ONLY. Run one section at a time in the Supabase SQL editor.
--
-- The four instruments are named in code (src/lib/evaluation/surveyNames.js), and every
-- surface that shows a name maps the instrument SLUG through that module. The stored
-- evaluation_instruments.display_name is no longer rendered anywhere a respondent, a student,
-- a Unit Leader or staff can see; it survives only as the fallback for a slug the module does
-- not know, and in the Responses CSV export, which keeps its historical words on purpose.
--
-- This query lists what the table still says, next to the name the app shows, so the Owner
-- can decide separately whether the stored values should be brought into line. Nothing here
-- writes. A rename of the stored values is a migration and is Owner-gated
-- (docs/security/OWNER_SQL_GATE.md).

-- ── 1. What the table stores, and what the app shows for the same slug ─────────────────────
SELECT
  i.slug,
  i.display_name                                   AS stored_display_name,
  CASE i.slug
    WHEN 'casey_fink_readiness_2024' THEN 'Casey-Fink Readiness for Practice'
    WHEN 'preceptor_progress'        THEN 'Preceptor''s Assessment of Student Readiness'
    WHEN 'student_preceptor_eval'    THEN 'Student''s Feedback on Unit and Preceptor'
    WHEN 'post_rotation_evaluation'  THEN 'Student''s Feedback on ASPIRE'
    ELSE NULL
  END                                              AS name_the_app_shows,
  (i.display_name IS DISTINCT FROM CASE i.slug
    WHEN 'casey_fink_readiness_2024' THEN 'Casey-Fink Readiness for Practice'
    WHEN 'preceptor_progress'        THEN 'Preceptor''s Assessment of Student Readiness'
    WHEN 'student_preceptor_eval'    THEN 'Student''s Feedback on Unit and Preceptor'
    WHEN 'post_rotation_evaluation'  THEN 'Student''s Feedback on ASPIRE'
  END)                                             AS differs
FROM evaluation_instruments i
ORDER BY i.slug;

-- ── 2. Any instrument slug the code does not name (would fall back to the stored value) ────
SELECT i.slug, i.display_name
FROM evaluation_instruments i
WHERE i.slug NOT IN ('casey_fink_readiness_2024', 'preceptor_progress', 'student_preceptor_eval', 'post_rotation_evaluation')
ORDER BY i.slug;
