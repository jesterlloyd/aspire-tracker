-- db/audit/unit_leader_evaluation_release_gate_rollback.sql
-- ============================================================================
-- Rollback for
--   supabase/migrations/20260725000000_unit_leader_evaluation_release_gate.sql
--
-- Two options. Pick ONE. Neither ever deletes evaluation_responses content.
-- This branch NEVER runs these; Jester runs the appropriate one if needed.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────
-- OPTION A (PREFERRED, always safe, non-destructive): disable Unit Leader reads
-- while preserving the table, all snapshots, and all release history.
--
-- Use this as the emergency stop. It instantly makes every Unit Leader read return
-- nothing (no EXECUTE), without losing any moderation/release/snapshot state. Fully
-- reversible by re-granting.
-- ────────────────────────────────────────────────────────────────
BEGIN;

REVOKE EXECUTE ON FUNCTION public.ul_eval_dashboard_summary(text, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ul_eval_response_list(text, text, text)      FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ul_eval_response_detail(uuid)               FROM authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';

-- To restore reads later:
--   GRANT EXECUTE ON FUNCTION public.ul_eval_dashboard_summary(text,text,text) TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.ul_eval_response_list(text,text,text)      TO authenticated;
--   GRANT EXECUTE ON FUNCTION public.ul_eval_response_detail(uuid)              TO authenticated;
--   NOTIFY pgrst, 'reload schema';


-- ────────────────────────────────────────────────────────────────
-- OPTION B (FULL TEARDOWN): only safe BEFORE the release functions have been used in
-- production (i.e., before any real release/snapshot history exists that must be kept
-- for audit). Drops the functions, then the triggers, then the table.
--
-- AFTER first production use, do NOT run Option B: it would discard release and snapshot
-- history. Use Option A instead. Dropping the release table never touches
-- evaluation_responses (the FK is FROM the release table TO responses, ON DELETE CASCADE
-- in that direction only), so response content is preserved either way.
--
-- Uncomment to run.
-- ────────────────────────────────────────────────────────────────
-- BEGIN;
--
-- DROP FUNCTION IF EXISTS public.ul_eval_response_detail(uuid);
-- DROP FUNCTION IF EXISTS public.ul_eval_response_list(text, text, text);
-- DROP FUNCTION IF EXISTS public.ul_eval_dashboard_summary(text, text, text);
-- DROP FUNCTION IF EXISTS public.ul_eval_revoke_response(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.ul_eval_release_response(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.ul_eval_moderate_response(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public._ul_eval_is_active_owner_admin(uuid);
--
-- DROP TRIGGER IF EXISTS trg_ul_eval_capture_snapshot ON public.evaluation_responses;
-- DROP FUNCTION IF EXISTS public._ul_eval_capture_snapshot();
--
-- DROP TRIGGER IF EXISTS trg_ul_eval_guard_snapshot_immutable
--   ON public.evaluation_response_unit_release;
-- DROP FUNCTION IF EXISTS public._ul_eval_guard_snapshot_immutable();
--
-- -- Preserves evaluation_responses; drops only the new gate table and its data.
-- DROP TABLE IF EXISTS public.evaluation_response_unit_release;
--
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Safe-before vs safe-after first release:
--   * Option A: safe at any time, before or after first release. Reversible.
--   * Option B: safe ONLY before the release/moderate functions have written real
--     lifecycle state you need to keep. After first production release, prefer Option A
--     (disable reads) so snapshot and release history survive for audit.
-- Neither option deletes any evaluation_responses row.
-- ============================================================================
