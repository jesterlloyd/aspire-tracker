-- db/audit/unit_leader_evaluation_release_gate_rollback.sql
-- ============================================================================
-- Rollback for
--   supabase/migrations/20260725000000_unit_leader_evaluation_release_gate.sql
--   (Owner-review-corrected revision)
--
-- Two options. Pick ONE. Neither ever deletes evaluation_responses content, and neither
-- erases the append-only lifecycle audit unless you are tearing the whole feature down
-- before it was ever used.
-- This branch NEVER runs these; Jester runs the appropriate one if needed.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────
-- OPTION A (PREFERRED, always safe, non-destructive): disable Unit Leader reads and
-- freeze the lifecycle while preserving the tables, all snapshots, all release state,
-- and the full audit history.
--
-- Emergency stop: every Unit Leader read returns nothing (no EXECUTE), and no new
-- moderation/release/revocation can occur. No data is lost. Fully reversible by
-- re-granting.
-- ────────────────────────────────────────────────────────────────
BEGIN;

-- Stop Unit Leader reads.
REVOKE EXECUTE ON FUNCTION public.ul_eval_dashboard_summary(text, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ul_eval_response_list(text, text, text)      FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ul_eval_response_detail(text)               FROM authenticated;

-- Freeze the Owner/Admin lifecycle (optional; omit if you only want to hide reads).
REVOKE EXECUTE ON FUNCTION public.ul_eval_moderate_response(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ul_eval_release_response(uuid)        FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ul_eval_revoke_response(uuid)         FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ul_eval_rerelease_response(uuid)      FROM authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';

-- To restore later, re-GRANT EXECUTE ... TO authenticated for the functions above and
--   NOTIFY pgrst, 'reload schema';


-- ────────────────────────────────────────────────────────────────
-- OPTION B (FULL TEARDOWN): only safe BEFORE any real lifecycle history exists (i.e.,
-- before the release/moderate functions have been used in production). Drops the
-- functions, then the triggers, then BOTH new tables.
--
-- AFTER first production use, do NOT run Option B: it would discard release/snapshot
-- state AND the append-only audit history. Use Option A instead. Dropping the release
-- table never touches evaluation_responses (the FK is FROM the release table TO
-- responses, ON DELETE RESTRICT), so response content is preserved either way.
--
-- Uncomment to run.
-- ────────────────────────────────────────────────────────────────
-- BEGIN;
--
-- -- Read functions
-- DROP FUNCTION IF EXISTS public.ul_eval_response_detail(text);
-- DROP FUNCTION IF EXISTS public.ul_eval_response_list(text, text, text);
-- DROP FUNCTION IF EXISTS public.ul_eval_dashboard_summary(text, text, text);
-- -- Lifecycle functions
-- DROP FUNCTION IF EXISTS public.ul_eval_rerelease_response(uuid);
-- DROP FUNCTION IF EXISTS public.ul_eval_revoke_response(uuid);
-- DROP FUNCTION IF EXISTS public.ul_eval_release_response(uuid);
-- DROP FUNCTION IF EXISTS public.ul_eval_moderate_response(uuid, text);
-- -- Pure helper
-- DROP FUNCTION IF EXISTS public._ul_eval_safe_quantitative(text, jsonb);
--
-- -- Triggers + their functions
-- DROP TRIGGER IF EXISTS trg_ul_eval_capture_snapshot ON public.evaluation_responses;
-- DROP FUNCTION IF EXISTS public._ul_eval_capture_snapshot();
-- DROP TRIGGER IF EXISTS trg_ul_eval_guard_snapshot_immutable
--   ON public.evaluation_response_unit_release;
-- DROP FUNCTION IF EXISTS public._ul_eval_guard_snapshot_immutable();
-- DROP TRIGGER IF EXISTS trg_ul_eval_events_append_only
--   ON public.evaluation_response_unit_release_events;
-- DROP FUNCTION IF EXISTS public._ul_eval_events_append_only();
--
-- -- Tables (audit first; neither cascades to evaluation_responses).
-- DROP TABLE IF EXISTS public.evaluation_response_unit_release_events;
-- DROP TABLE IF EXISTS public.evaluation_response_unit_release;
--
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Safe-before vs safe-after first release:
--   * Option A: safe at any time, before or after first release. Reversible, and it
--     preserves snapshots, release state, and the entire append-only audit log.
--   * Option B: safe ONLY before the lifecycle functions have written real state and
--     audit history you must keep. After first production use, prefer Option A.
-- Neither option deletes any evaluation_responses row.
-- ============================================================================
