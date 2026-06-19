-- =============================================================================
-- Cron run observability: cron_runs table  (CRON-OBS-1-pre)
-- Migration: 20260620000000_cronobs1_pre_cron_runs
-- =============================================================================
--
-- Records ONE ROW PER CRON RUN so the system can prove a cron RAN (not just that it sent
-- something). The later instrumentation (CRON-OBS-1) inserts a 'running' row at run-start and
-- updates the SAME row to 'success'/'error' at run-finish — so a start-without-finish leaves a
-- stale 'running' row, which is itself diagnostic. Everything except identity + start is
-- NULLABLE so both writes stay minimal and the wrapping can be best-effort / non-fatal.
--
-- This migration is ADDITIVE and ISOLATED: one new table, RLS enabled with NO policies, two
-- indexes. It instruments NO cron, adds NO UI, sends NO email, and changes nothing existing.
-- Writes happen later via the SERVICE-ROLE cron clients (which bypass RLS); nothing client-side
-- can read or write this table. An Owner/Admin read policy may be added later IF a UI needs it.
--
-- status is RUN EXECUTION state only ('running' | 'success' | 'error'); business outcomes
-- ("sent nothing because nothing was due" = success, "sent five", "skipped two") live in the
-- free-shape `details` JSONB, never in status.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute. Claude Code applies nothing — the
-- Owner applies this manually, runs the verification + smoke test below (confirming the table is
-- empty again afterward), THEN authorizes commit of this file.
-- Idempotent: CREATE TABLE / CREATE INDEX use IF NOT EXISTS.
-- =============================================================================

-- ── 1. Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cron_runs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_name    text        NOT NULL,                 -- e.g. 'coordinator-weekly-digest'
  started_at   timestamptz NOT NULL DEFAULT now(),   -- set at run-start
  finished_at  timestamptz,                          -- set at run-finish (NULL while running)
  status       text        NOT NULL DEFAULT 'running',
  details      jsonb,                                -- per-cron counts/metadata (free shape)
  error_text   text,                                 -- set when status = 'error'
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Run-execution status only — not business outcome. Kept intentionally minimal.
  CONSTRAINT chk_cron_runs_status CHECK (status IN ('running', 'success', 'error'))
);


-- ── 2. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_cron_runs_name_started ON cron_runs (cron_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_started      ON cron_runs (started_at DESC);


-- ── 3. Row Level Security — ENABLED, NO POLICIES ────────────────────────────────
-- Service-role cron writers bypass RLS; with no policies, no client (anon/authenticated) can
-- read or write. This is the least-surface default for a pre-UI observability table.

ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;


-- ── 4. Reload schema cache ──────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- VERIFICATION (Owner runs after applying — not part of the migration)
-- =============================================================================
--   -- 1. Table exists:
--   SELECT to_regclass('public.cron_runs');                                  -- not null
--
--   -- 2. Expected columns/types:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='cron_runs'
--   ORDER BY ordinal_position;
--   -- expect: id uuid NO · cron_name text NO · started_at timestamptz NO · finished_at timestamptz YES
--   --         · status text NO · details jsonb YES · error_text text YES · created_at timestamptz NO
--
--   -- 3. RLS enabled:
--   SELECT relrowsecurity FROM pg_class WHERE oid='public.cron_runs'::regclass;   -- true
--
--   -- 4. NO policies exist:
--   SELECT polname FROM pg_policies WHERE schemaname='public' AND tablename='cron_runs'; -- 0 rows
--
--   -- 5. Indexes exist (pkey + the two below):
--   SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='cron_runs';
--   -- expect: cron_runs_pkey, idx_cron_runs_name_started, idx_cron_runs_started
--
--   -- 6. Smoke test the insert -> update -> select -> delete lifecycle the helper will use:
--   INSERT INTO cron_runs (cron_name) VALUES ('smoke-test');                 -- starts as 'running'
--   UPDATE cron_runs
--     SET status='success', finished_at=now(), details='{"checked": 3, "sent": 0}'::jsonb
--     WHERE cron_name='smoke-test';
--   SELECT id, cron_name, status, started_at, finished_at, details, error_text
--     FROM cron_runs WHERE cron_name='smoke-test';                           -- one success row
--   DELETE FROM cron_runs WHERE cron_name='smoke-test';
--   SELECT count(*) FROM cron_runs;                                          -- expect 0 (empty again)
-- =============================================================================
-- ROLLBACK (fully additive/reversible; nothing else affected):
--   DROP INDEX IF EXISTS idx_cron_runs_started;
--   DROP INDEX IF EXISTS idx_cron_runs_name_started;
--   DROP TABLE IF EXISTS cron_runs;
--   NOTIFY pgrst, 'reload schema';
-- =============================================================================
