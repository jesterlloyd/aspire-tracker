-- ============================================================================
-- ACTION CENTER DISMISS (AC-DISMISS-1, 2026-10-07)
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester). Claude Code has applied NOTHING. ***
--
-- Owner, 2026-10-07: the Action Center needs a way to dismiss notifications and actions, not
-- only snooze them, and some actions never leave. Dismissing an ACTION needs no SQL (it is a
-- long snooze keyed to the item's current state, in action_snoozes). This file does the two
-- things that do:
--
--   1. staff_notifications.dismissed_at, written only through dismiss_staff_notifications, the
--      same way mark_staff_notifications_read is the only writer of in_app_read_at (there is no
--      client UPDATE policy on that table, on purpose). A dismissed notification is also read.
--      p_ids NULL dismisses every READ notification of the caller ("Clear read"); an unread one
--      is never cleared in bulk. restore_staff_notifications undoes a dismissal (the toast's Undo).
--   2. evaluation_release_withholds: the record that an Owner or Admin decided a Unit Leader
--      release response will never be released (a legacy snapshot, an ineligible row, no
--      preceptor, or no eligibility date: rowIsReadOnly in src/lib/unitEvaluationReleaseActions.js).
--      Those rows used to sit on Review & Release as Blocked forever. The guarded release table
--      is NOT touched: its states, its CHECKs and its event log are unchanged. A withhold is
--      undone by stamping undone_at, never by deleting, so the record stays. Written only through
--      ul_eval_withhold_response / ul_eval_unwithhold_response, which refuse a row that CAN be
--      released ('releasable').
--
-- Additive and transactional. It rewrites no data.
-- SAFE IN EITHER DEPLOY ORDER: the app reads both as "not enabled" until this is applied.
-- ============================================================================

BEGIN;

-- 1. Notifications ------------------------------------------------------------
ALTER TABLE public.staff_notifications ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

CREATE OR REPLACE FUNCTION public.dismiss_staff_notifications(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_me    uuid := public.portal_profile_id();
  v_count int;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'MS403';
  END IF;
  UPDATE public.staff_notifications
     SET dismissed_at = now(),
         in_app_read_at = COALESCE(in_app_read_at, now()),
         updated_at = now()
   WHERE recipient_profile_id = v_me
     AND dismissed_at IS NULL
     AND (CASE WHEN p_ids IS NULL THEN in_app_read_at IS NOT NULL ELSE id = ANY(p_ids) END);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.dismiss_staff_notifications(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_staff_notifications(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.restore_staff_notifications(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_me    uuid := public.portal_profile_id();
  v_count int;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'MS403';
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN 0; END IF;
  UPDATE public.staff_notifications
     SET dismissed_at = NULL, updated_at = now()
   WHERE recipient_profile_id = v_me
     AND dismissed_at IS NOT NULL
     AND id = ANY(p_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.restore_staff_notifications(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_staff_notifications(uuid[]) TO authenticated, service_role;

-- 2. Won't release --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.evaluation_release_withholds (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id  uuid        NOT NULL REFERENCES public.evaluation_responses(id) ON DELETE RESTRICT,
  withheld_by  uuid        NOT NULL REFERENCES public.user_profiles(id),
  withheld_at  timestamptz NOT NULL DEFAULT now(),
  undone_by    uuid        REFERENCES public.user_profiles(id),
  undone_at    timestamptz,
  CONSTRAINT evaluation_release_withholds_undo_pair CHECK ((undone_at IS NULL) = (undone_by IS NULL))
);
-- One live withhold per response; undone rows stay as the record.
CREATE UNIQUE INDEX IF NOT EXISTS evaluation_release_withholds_live_uidx
  ON public.evaluation_release_withholds (response_id) WHERE undone_at IS NULL;

ALTER TABLE public.evaluation_release_withholds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "evaluation_release_withholds_owner_admin_read" ON public.evaluation_release_withholds;
CREATE POLICY "evaluation_release_withholds_owner_admin_read" ON public.evaluation_release_withholds
  FOR SELECT TO authenticated USING (public.is_active_owner_or_admin());
REVOKE ALL ON TABLE public.evaluation_release_withholds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.evaluation_release_withholds TO authenticated;
GRANT ALL ON TABLE public.evaluation_release_withholds TO service_role;

CREATE OR REPLACE FUNCTION public.ul_eval_withhold_response(p_response_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_me  uuid := public.portal_profile_id();
  v_row public.evaluation_response_unit_release%ROWTYPE;
BEGIN
  IF v_me IS NULL OR NOT public.is_active_owner_or_admin() THEN
    RETURN jsonb_build_object('status', 'not_authorized');
  END IF;
  SELECT * INTO v_row FROM public.evaluation_response_unit_release WHERE response_id = p_response_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  -- Only a row that can never be released (rowIsReadOnly). Anything else is decided on the board.
  IF v_row.snapshot_source IN ('submission_trigger', 'backfill_verified')
     AND v_row.release_state <> 'ineligible'
     AND v_row.hist_preceptor_label IS NOT NULL
     AND v_row.unit_leader_eligible_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'releasable');
  END IF;
  IF EXISTS (SELECT 1 FROM public.evaluation_release_withholds
              WHERE response_id = p_response_id AND undone_at IS NULL) THEN
    RETURN jsonb_build_object('status', 'no_change');
  END IF;
  INSERT INTO public.evaluation_release_withholds (response_id, withheld_by) VALUES (p_response_id, v_me);
  RETURN jsonb_build_object('status', 'success');
END;
$fn$;
REVOKE ALL ON FUNCTION public.ul_eval_withhold_response(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ul_eval_withhold_response(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ul_eval_unwithhold_response(p_response_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_me    uuid := public.portal_profile_id();
  v_count int;
BEGIN
  IF v_me IS NULL OR NOT public.is_active_owner_or_admin() THEN
    RETURN jsonb_build_object('status', 'not_authorized');
  END IF;
  UPDATE public.evaluation_release_withholds
     SET undone_at = now(), undone_by = v_me
   WHERE response_id = p_response_id AND undone_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('status', CASE WHEN v_count > 0 THEN 'success' ELSE 'no_change' END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ul_eval_unwithhold_response(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ul_eval_unwithhold_response(uuid) TO authenticated, service_role;

COMMIT;
