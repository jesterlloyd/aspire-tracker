-- db/audit/unit_leader_evaluation_release_gate_rollback.sql
-- ============================================================================
-- Rollback for
--   supabase/migrations/20260725000000_unit_leader_evaluation_release_gate.sql
--   (second Owner-review-corrected revision)
--
-- Two options. Pick ONE. Neither ever deletes evaluation_responses content, and neither
-- erases the append-only lifecycle audit unless you are tearing the whole feature down
-- before it was ever used.
-- This branch NEVER runs these; Jester runs the appropriate one if needed.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────
-- OPTION A (PREFERRED, always safe, non-destructive): disable Unit Leader reads and
-- freeze the lifecycle while preserving all tables, snapshots, release state, and the
-- full audit history. Reversible by re-granting.
-- ────────────────────────────────────────────────────────────────
BEGIN;

-- Stop Unit Leader reads.
REVOKE EXECUTE ON FUNCTION public.ul_eval_dashboard_summary(text, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.ul_eval_response_list(text, text, text)      FROM authenticated;

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
-- OPTION B (FULL TEARDOWN): only safe BEFORE any real lifecycle history exists (before
-- the release/moderate functions have been used in production). Drops the functions, then
-- the triggers, then the three new tables.
--
-- AFTER first production use, do NOT run Option B: it would discard release/snapshot state
-- AND the append-only audit. Use Option A instead. Dropping the release table never
-- touches evaluation_responses (the FK is FROM the release table TO responses, ON DELETE
-- RESTRICT). The block-write triggers deny DML DELETE/TRUNCATE but DROP TABLE (DDL) still
-- succeeds.
--
-- Uncomment to run.
-- ────────────────────────────────────────────────────────────────
-- BEGIN;
--
-- -- Read functions
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
-- DROP TRIGGER IF EXISTS trg_ul_eval_release_no_delete   ON public.evaluation_response_unit_release;
-- DROP TRIGGER IF EXISTS trg_ul_eval_release_no_truncate ON public.evaluation_response_unit_release;
-- DROP TRIGGER IF EXISTS trg_ul_eval_events_no_update_delete
--   ON public.evaluation_response_unit_release_events;
-- DROP TRIGGER IF EXISTS trg_ul_eval_events_no_truncate
--   ON public.evaluation_response_unit_release_events;
-- DROP FUNCTION IF EXISTS public._ul_eval_block_write();
--
-- -- Tables (audit first; the allowlist table; then the release table). None cascade to
-- -- evaluation_responses.
-- DROP TABLE IF EXISTS public.evaluation_response_unit_release_events;
-- DROP TABLE IF EXISTS public.evaluation_unit_quantitative_keys;
-- DROP TABLE IF EXISTS public.evaluation_response_unit_release;
--
-- COMMIT;
-- NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Safe-before vs safe-after first release:
--   * Option A: safe at any time. Reversible; preserves snapshots, release state, and the
--     entire append-only audit log.
--   * Option B: safe ONLY before the lifecycle functions have written real state/audit.
--     After first production use, prefer Option A.
-- Neither option deletes any evaluation_responses row.
-- ============================================================================
