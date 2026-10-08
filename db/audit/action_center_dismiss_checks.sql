-- AC-DISMISS-1 checks for supabase/migrations/20261112000000_action_center_dismiss.sql.
-- Read-only. Run one section at a time.

-- PRE 1: nothing from this migration exists yet (expect: false, false, 0)
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'staff_notifications' AND column_name = 'dismissed_at') AS dismissed_at_present,
  to_regclass('public.evaluation_release_withholds') IS NOT NULL AS withholds_present,
  (SELECT count(*) FROM pg_proc WHERE proname IN ('dismiss_staff_notifications', 'restore_staff_notifications',
     'ul_eval_withhold_response', 'ul_eval_unwithhold_response')) AS functions;

-- PRE 2: the objects it relies on are there (expect: true, true, true, true)
SELECT
  to_regclass('public.staff_notifications') IS NOT NULL AS staff_notifications,
  to_regclass('public.evaluation_response_unit_release') IS NOT NULL AS release_table,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'portal_profile_id') AS portal_profile_id,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_active_owner_or_admin') AS owner_admin_check;

-- PRE 3: the Unit Leader responses that can never be released, by reason (the ones the board
-- will offer "won't release" for). Counts only; no names.
SELECT CASE
         WHEN snapshot_source NOT IN ('submission_trigger', 'backfill_verified') THEN 'Legacy response'
         WHEN release_state = 'ineligible' THEN 'Ineligible for release'
         WHEN hist_preceptor_label IS NULL THEN 'No preceptor on the response'
         WHEN unit_leader_eligible_at IS NULL THEN 'No eligibility date'
       END AS reason, count(*) AS responses
  FROM public.evaluation_response_unit_release
 WHERE release_state <> 'released'
   AND (snapshot_source NOT IN ('submission_trigger', 'backfill_verified') OR release_state = 'ineligible'
        OR hist_preceptor_label IS NULL OR unit_leader_eligible_at IS NULL)
 GROUP BY 1 ORDER BY 2 DESC;

-- POST 1: everything is in place (expect: true, true, 4, 0 dismissed yet)
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'staff_notifications' AND column_name = 'dismissed_at') AS dismissed_at_present,
  to_regclass('public.evaluation_release_withholds') IS NOT NULL AS withholds_present,
  (SELECT count(*) FROM pg_proc WHERE proname IN ('dismiss_staff_notifications', 'restore_staff_notifications',
     'ul_eval_withhold_response', 'ul_eval_unwithhold_response')) AS functions,
  (SELECT count(*) FROM public.staff_notifications WHERE dismissed_at IS NOT NULL) AS dismissed;

-- POST 2: clients can read the withholds (owner/admin RLS) and write nothing directly
-- (expect: one SELECT policy; authenticated holds SELECT only)
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'evaluation_release_withholds';
SELECT privilege_type FROM information_schema.role_table_grants
 WHERE table_name = 'evaluation_release_withholds' AND grantee = 'authenticated' ORDER BY 1;
