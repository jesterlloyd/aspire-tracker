-- db/maintenance/kelly_yam_set_personal_email_20261105.sql
-- ALUMNUS-EMAIL-1 follow-up (Owner, 2026-11-05): Kelly Yam's personal email, found by the Owner.
-- The same address is already her record's school_email and her portal account's email, so the
-- account needs no move. Guarded: Kelly's real Spring 2026 record only, personal email still empty.
BEGIN;
WITH done AS (
  UPDATE public.students SET personal_email = 'kellyyam9@gmail.com'
   WHERE last_name = 'Yam' AND first_name = 'Kelly' AND aspire_cohort = 'Spring 2026' AND is_demo IS NOT TRUE
     AND coalesce(btrim(personal_email), '') = ''
  RETURNING id)
SELECT count(*) AS set_rows FROM done;
COMMIT;
