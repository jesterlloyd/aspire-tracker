-- RESUME-HR-1 checks for supabase/migrations/20261126000000_review_resume_hr_structure.sql.
-- Read-only. Run one section at a time.

-- PRE 1: the skill as it stands. Expect one row, hr_structure false, fair_scoring false.
SELECT version, status, enabled, allowed_roles,
  position('WHAT TALENT ACQUISITION LOOKS FOR' IN instruction_body) > 0 AS hr_structure,
  position('SCORE FAIRLY, NOT STRICTLY' IN instruction_body) > 0 AS fair_scoring,
  length(instruction_body) AS body_length
FROM public.keith_skills WHERE slug = 'review-resume';

-- POST 1: expect hr_structure true, fair_scoring true, version one higher if it was active,
-- status, enabled and allowed_roles as in PRE 1, and one snapshot with the change note.
SELECT k.version, k.status, k.enabled, k.allowed_roles,
  position('WHAT TALENT ACQUISITION LOOKS FOR' IN k.instruction_body) > 0 AS hr_structure,
  position('SCORE FAIRLY, NOT STRICTLY' IN k.instruction_body) > 0 AS fair_scoring,
  (SELECT count(*) FROM public.keith_skill_versions v
     WHERE v.skill_id = k.id AND v.change_note LIKE 'Talent Acquisition''s résumé structure%') AS snapshots
FROM public.keith_skills k WHERE k.slug = 'review-resume';
