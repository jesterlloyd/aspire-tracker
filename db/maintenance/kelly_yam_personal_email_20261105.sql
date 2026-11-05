-- db/maintenance/kelly_yam_personal_email_20261105.sql
-- ALUMNUS-EMAIL-1 follow-up (Owner, 2026-11-05). Kelly Yam's student record (Spring 2026) held
-- Momoca Kino's address as its personal email (most likely an import row mix-up): it is the
-- address of Momoca's own signed-in portal account. With alumni now routed personal-first, the
-- daily reminder would have sent Kelly's Transition Form link to Momoca. This clears it, so her
-- mail falls back to her school email until the right personal email is entered.
-- Guarded: changes only Kelly's real Spring 2026 record, and only while it still holds the address
-- that Momoca's portal account uses. Refuses unless exactly one row changes.
BEGIN;
WITH target AS (
  SELECT s.id FROM public.students s
   WHERE s.last_name = 'Yam' AND s.aspire_cohort = 'Spring 2026' AND s.is_demo IS NOT TRUE
     AND EXISTS (
       SELECT 1 FROM public.user_profiles up
         JOIN public.user_student_links l ON l.user_profile_id = up.id AND l.revoked_at IS NULL
         JOIN public.students m ON m.id = l.student_id AND m.first_name = 'Momoca' AND m.last_name = 'Kino'
        WHERE lower(up.email) = lower(btrim(s.personal_email)))
), done AS (
  UPDATE public.students s SET personal_email = NULL FROM target t WHERE s.id = t.id RETURNING s.id
)
SELECT count(*) AS cleared FROM done;
COMMIT;
-- ROLLBACK: put the address back only if it turns out to be Kelly's (it is not: it is Momoca's).
