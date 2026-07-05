-- =============================================================================
-- Automation settings: automation_settings table  (AUTOMATION-SETTINGS-V2)
-- Migration: 20260624000000_automation_settings
-- =============================================================================
--
-- Durable on/off model for ASPIRE Connect > Automation > Automation Controls. One row per
-- (automation_key, scope). ABSENCE OF A ROW IS NOT "DISABLED": the server returns code-level
-- defaults (existing crons default ON; the future interviewer packet reminder defaults OFF), and
-- the first toggle UPSERTs a row. An empty table therefore disables nothing.
--
-- Midpoint is intentionally NOT modeled here yet - it keeps using
-- cohorts.midpoint_checkin_automation_enabled. This table covers the other crons (and future ones).
--
-- ADDITIVE and ISOLATED: one new table, one unique index, RLS enabled with NO policies. It
-- instruments NO cron, adds NO UI, sends NO email, and changes nothing existing. All reads/writes
-- happen later via the SERVICE-ROLE Owner/Admin endpoint (service role bypasses RLS); nothing
-- client-side can read or write this table. automation_key is intentionally NOT constrained to a
-- value list, so adding a future automation needs NO schema change - the server owns the key list.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute. Claude Code applies nothing - the
-- Owner applies this manually, runs the verification block below (confirming the table is empty),
-- THEN authorizes the next phase. Idempotent: CREATE TABLE / CREATE INDEX use IF NOT EXISTS.
-- =============================================================================

-- ── 1. Table ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_settings (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_key text        NOT NULL,                  -- 'teams_invite_reminders', 'interview_reminders', ...
  scope_type     text        NOT NULL DEFAULT 'global', -- 'global' | 'cohort' | 'school' | 'contact'
  scope_ref      text,                                  -- NULL for global; cohort_id / contact_id / school_name (as text)
  enabled        boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,                                  -- user_profiles.id at creation (audit snapshot)
  updated_at     timestamptz NOT NULL DEFAULT now(),    -- server sets = now() on every upsert
  updated_by     uuid,                                  -- user_profiles.id at last change (audit snapshot)

  -- scope_type is a small closed set (UI/server-driven); keys are NOT constrained on purpose.
  CONSTRAINT chk_automation_scope_type CHECK (scope_type IN ('global','cohort','school','contact')),

  -- global ⇒ no ref; non-global ⇒ a non-empty ref (empty string forbidden so it can't collide with
  -- a global row under the COALESCE(...,'') unique index below).
  CONSTRAINT chk_automation_scope_ref CHECK (
    (scope_type =  'global' AND scope_ref IS NULL) OR
    (scope_type <> 'global' AND scope_ref IS NOT NULL AND btrim(scope_ref) <> '')
  )
);

-- ── 2. Uniqueness ───────────────────────────────────────────────────────────────
-- One row per (automation, scope). COALESCE so a single GLOBAL row is enforced
-- (NULL scope_ref is otherwise "distinct" under a plain UNIQUE and would allow duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_settings_key_scope
  ON automation_settings (automation_key, scope_type, COALESCE(scope_ref, ''));

-- ── 3. Row Level Security - ENABLED, NO POLICIES ────────────────────────────────
-- Mirrors cron_runs: service-role endpoints bypass RLS; with no policies, no client (anon/
-- authenticated) can read or write. Owner/Admin access is enforced server-side at the endpoint.
ALTER TABLE automation_settings ENABLE ROW LEVEL SECURITY;

-- ── 4. Reload schema cache ──────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- VERIFICATION (Owner runs after applying - not part of the migration)
-- =============================================================================
--
-- (a) table exists
--   SELECT to_regclass('public.automation_settings');                              -- expect: automation_settings (not null)
--
-- (b) all 9 columns present, correct nullability/defaults
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='automation_settings'
--    ORDER BY ordinal_position;
--   -- expect, in order: id, automation_key, scope_type, scope_ref, enabled,
--   --                   created_at, created_by, updated_at, updated_by
--
-- (c) RLS enabled
--   SELECT relrowsecurity FROM pg_class WHERE oid='public.automation_settings'::regclass;  -- expect: true
--
-- (d) ZERO client policies
--   SELECT count(*) FROM pg_policies
--    WHERE schemaname='public' AND tablename='automation_settings';                -- expect: 0
--
-- (e) unique index exists (plus pkey)
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND tablename='automation_settings';
--   -- expect: automation_settings_pkey, uq_automation_settings_key_scope
--
-- (f) both CHECK constraints exist
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid='public.automation_settings'::regclass AND contype='c';
--   -- expect: chk_automation_scope_type, chk_automation_scope_ref
--
-- (g) no accidental rows
--   SELECT count(*) FROM automation_settings;                                     -- expect: 0
--
-- OPTIONAL constraint smoke test (always rolls back - leaves the table empty):
--   BEGIN;
--     -- these SHOULD fail if run alone:
--     --   INSERT INTO automation_settings (automation_key, scope_type, scope_ref) VALUES ('x','global','abc');  -- FAILS chk_automation_scope_ref
--     --   INSERT INTO automation_settings (automation_key, scope_type, scope_ref) VALUES ('x','cohort',NULL);   -- FAILS
--     --   INSERT INTO automation_settings (automation_key, scope_type, scope_ref) VALUES ('x','cohort','');     -- FAILS
--     INSERT INTO automation_settings (automation_key, scope_type) VALUES ('smoke_global','global');
--     INSERT INTO automation_settings (automation_key, scope_type, scope_ref) VALUES ('smoke_cohort','cohort','cohort-uuid-123');
--     --   INSERT INTO automation_settings (automation_key, scope_type) VALUES ('smoke_global','global');         -- FAILS uq index
--     SELECT count(*) FROM automation_settings;   -- expect: 2 inside the txn
--   ROLLBACK;
--   SELECT count(*) FROM automation_settings;     -- expect: 0
--
-- =============================================================================
-- ROLLBACK (safe - table is new, additive, nothing references it yet)
-- =============================================================================
--   DROP TABLE IF EXISTS automation_settings;   -- also drops its indexes + CHECK constraints
--   NOTIFY pgrst, 'reload schema';
-- =============================================================================
