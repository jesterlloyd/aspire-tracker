-- ============================================================================
-- RUBRIC-RESUME-OWN-1: read-only RECOVERY and DIAGNOSIS
-- ============================================================================
-- Run each block SEPARATELY in the Supabase SQL editor. Every query here is READ
-- ONLY: no INSERT, UPDATE, DELETE, or DDL appears in this file. Nothing here
-- changes a rubric.
--
-- WHY THIS EXISTS
-- An in-progress rubric was invisible in the app. The session seeded the form
-- from the author's own unfinished rubric only when the signed-in account's role
-- was interviewer and nothing more (src/components/RubricSession.jsx), so an
-- Owner, Admin, or Co-lead reopened a student and got a blank form. The
-- "All Rubrics for This Student" list renders completed rubrics only, so the row
-- appeared in no list either. It was counted in the banner and rendered nowhere.
--
-- Section 1 proves the row exists and says who it belongs to.
-- Section 2 returns the interview questions themselves, so they can be copied
--   out before any code change ships.
-- Section 3 explains WHY the row may be unclaimed, which decides whether the
--   is_own fix alone is enough to reopen it.
-- Section 4 measures the blast radius across the cohort.
--
-- READ THE RESULT OF SECTION 1 BEFORE RUNNING THE REST. If section 1 returns no
-- row, stop: the draft is not in the database and the browser copy in
-- localStorage is the only remaining source.
-- ============================================================================


-- ── 1. Does the row exist, and whose is it? ─────────────────────────────────
-- One row per rubric for this student. interviewer_profile_id is the identity
-- the app compares against: list_interview_rubrics_for_cohort reports
-- is_own = (interviewer_profile_id = the caller's user_profiles.id). A NULL here
-- means the row is claimed by nobody, and no is_own match can ever reopen it.
SELECT
  r.id                        AS rubric_id,
  r.status,
  r.interviewer_name,
  r.interviewer_profile_id,
  CASE
    WHEN r.interviewer_profile_id IS NULL THEN 'UNCLAIMED: no profile stamped'
    ELSE 'claimed'
  END                         AS ownership,
  up.full_name                AS claimed_by,
  r.created_at,
  r.updated_at,
  r.composite_score
FROM public.interview_rubrics r
JOIN public.students s          ON s.id = r.student_id
LEFT JOIN public.user_profiles up ON up.id = r.interviewer_profile_id
WHERE s.first_name ILIKE 'Reena'
  AND s.last_name  ILIKE 'Witkin'
ORDER BY r.updated_at DESC NULLS LAST;


-- ── 2. The questions themselves ─────────────────────────────────────────────
-- The three prepared questions plus the notes and the student-questions field.
-- Copy anything worth keeping out of the result grid before the fix ships. The
-- fix reopens the row in the app, so this is a belt-and-braces capture, not the
-- only route back to the content.
SELECT
  r.id                          AS rubric_id,
  r.status,
  r.interview_date,
  r.cj_question_asked,
  r.pp_question_asked,
  r.ga_question_asked,
  r.student_questions,
  r.unit_preferences_rationale,
  r.cj_notes,
  r.pp_notes,
  r.ga_notes,
  r.summary_comments,
  length(coalesce(r.cj_question_asked, ''))
    + length(coalesce(r.pp_question_asked, ''))
    + length(coalesce(r.ga_question_asked, ''))
    + length(coalesce(r.student_questions, '')) AS prepared_text_chars
FROM public.interview_rubrics r
JOIN public.students s ON s.id = r.student_id
WHERE s.first_name ILIKE 'Reena'
  AND s.last_name  ILIKE 'Witkin'
ORDER BY r.updated_at DESC NULLS LAST;


-- ── 3. Why the row may be unclaimed ─────────────────────────────────────────
-- When a privileged user picks a name in Section 1 of the rubric, the app maps
-- that name to a profile id through get_active_interviewers
-- (can_conduct_interviews = true) and the role='interviewer' fallback. A name
-- that reaches the dropdown only from the `interviewers` catalog carries no id,
-- so the row is written with interviewer_profile_id NULL.
-- If can_conduct_interviews is false or null for the account below, that is the
-- reason its own rubrics are unclaimed.
SELECT
  up.id                              AS profile_id,
  up.full_name,
  up.role,
  up.is_owner,
  up.can_conduct_interviews,
  EXISTS (
    SELECT 1 FROM public.interviewers i
    WHERE i.name = up.full_name
  )                                  AS in_interviewer_catalog,
  CASE
    WHEN coalesce(up.can_conduct_interviews, false) THEN 'name maps to this profile id'
    ELSE 'name does NOT map to a profile id: new rows land UNCLAIMED'
  END                                AS dropdown_mapping
FROM public.user_profiles up
WHERE up.full_name ILIKE '%Bautista%'
ORDER BY up.full_name;


-- ── 4. Blast radius ─────────────────────────────────────────────────────────
-- Every unfinished rubric that no profile owns. Each one is invisible to its
-- author today, exactly as the Reena Witkin row was. Counted per cohort and per
-- name so the size of the problem is explicit before anything is changed.
SELECT
  c.name                       AS cohort,
  r.interviewer_name,
  count(*)                     AS unclaimed_in_progress,
  min(r.created_at)            AS oldest,
  max(r.updated_at)            AS newest
FROM public.interview_rubrics r
LEFT JOIN public.cohorts c ON c.id = r.cohort_id
WHERE r.interviewer_profile_id IS NULL
  AND coalesce(r.status, '') <> 'Completed'
GROUP BY c.name, r.interviewer_name
ORDER BY unclaimed_in_progress DESC, c.name, r.interviewer_name;
