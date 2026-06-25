-- =============================================================================
-- Message archive: message_archive table  (SENT-HISTORY-PHASE2A)
-- Migration: 20260625000000_message_archive
-- =============================================================================
--
-- Forward-only storage of REDACTED rendered bodies for MANUAL/DIRECT Outreach emails, so Sent
-- History can preview future manual messages (automated/system messages are reconstructed on the
-- fly in Phase 1 and are NOT stored here). One row per notification_log row, keyed + FK'd by
-- notification_log_id (ON DELETE CASCADE — the archive never outlives its audit row).
--
-- Stores ONLY redacted content: NO secure tokens, NO survey/magic links, NO candidate documents
-- (resume/LOI/headshot/interview-question/packet content). Redaction is performed by the (later)
-- storage code before insert; redaction_version records which redaction ruleset produced the row.
--
-- ADDITIVE and ISOLATED: one new table, RLS enabled with NO policies. It modifies nothing existing
-- (notification_log is untouched — no rendered_html column), instruments no send, and changes no
-- behavior. Writes happen later via SERVICE-ROLE code only (service role bypasses RLS); nothing
-- client-side can read or write this table — Sent History reaches it through an Owner/Admin endpoint.
--
-- NO BACKFILL: historical manual emails had no body stored and stay preview-unavailable.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute. Claude Code applies nothing — the
-- Owner applies this manually, runs the verification block below (confirming the table is empty),
-- THEN authorizes Phase 2B storage code. Idempotent: CREATE TABLE uses IF NOT EXISTS.
-- =============================================================================

-- ── 1. Table ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_archive (
  notification_log_id uuid        PRIMARY KEY
                                  REFERENCES public.notification_log(id) ON DELETE CASCADE,
  content_kind        text        NOT NULL DEFAULT 'manual_direct_email',
  html_redacted       text,                                  -- redacted rendered HTML (no tokens/links/docs)
  text_redacted       text,                                  -- redacted plain-text alternative
  redaction_version   integer     NOT NULL DEFAULT 1,        -- which redaction ruleset produced this row
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,                                  -- user_profiles.id of the sender (audit snapshot)
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- At least one redacted body must be present and non-empty.
  CONSTRAINT chk_message_archive_has_body CHECK (
    (html_redacted IS NOT NULL AND btrim(html_redacted) <> '') OR
    (text_redacted IS NOT NULL AND btrim(text_redacted) <> '')
  ),
  -- content_kind is a small closed set for now (manual/direct email only).
  CONSTRAINT chk_message_archive_content_kind CHECK (content_kind IN ('manual_direct_email')),
  -- redaction ruleset version is 1-based.
  CONSTRAINT chk_message_archive_redaction_version CHECK (redaction_version >= 1),
  -- metadata is always a JSON object (never a scalar/array).
  CONSTRAINT chk_message_archive_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

-- ── 2. Indexes ────────────────────────────────────────────────────────────────
-- The PRIMARY KEY on notification_log_id covers the only access pattern (detail fetch by id).
-- No additional index added (no justified secondary access pattern in this phase).

-- ── 3. Row Level Security — ENABLED, NO POLICIES ────────────────────────────────
-- Mirrors cron_runs / automation_settings: service-role code bypasses RLS; with no policies, no
-- client (anon/authenticated) can read or write. Owner/Admin access is enforced server-side at the
-- (later) endpoint.
ALTER TABLE public.message_archive ENABLE ROW LEVEL SECURITY;

-- ── 4. Reload schema cache ──────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- VERIFICATION (Owner runs after applying — not part of the migration)
-- =============================================================================
--
-- (a) table exists
--   SELECT to_regclass('public.message_archive');                                 -- expect: message_archive (not null)
--
-- (b) all 8 columns present, correct types/nullability/defaults
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'message_archive'
--    ORDER BY ordinal_position;
--   -- expect, in order: notification_log_id, content_kind, html_redacted, text_redacted,
--   --                   redaction_version, created_at, created_by, metadata
--
-- (c) indexes (PK only)
--   SELECT indexname, indexdef
--     FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename = 'message_archive'
--    ORDER BY indexname;
--   -- expect: message_archive_pkey (on notification_log_id)
--
-- (d) constraints — PK, FK (cascade), and the four CHECKs
--   SELECT conname, pg_get_constraintdef(oid) AS constraint_def
--     FROM pg_constraint
--    WHERE conrelid = 'public.message_archive'::regclass
--    ORDER BY conname;
--   -- expect: PRIMARY KEY (notification_log_id);
--   --         FOREIGN KEY (notification_log_id) REFERENCES notification_log(id) ON DELETE CASCADE;
--   --         chk_message_archive_has_body, chk_message_archive_content_kind,
--   --         chk_message_archive_redaction_version, chk_message_archive_metadata_object
--
-- (e) RLS enabled
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.message_archive'::regclass;  -- expect: true
--
-- (f) ZERO client policies
--   SELECT policyname FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'message_archive';                -- expect: 0 rows
--
-- (g) no accidental rows
--   SELECT COUNT(*) AS row_count FROM public.message_archive;                      -- expect: 0
--
-- OPTIONAL constraint smoke test (always rolls back — leaves the table empty). Requires a real
-- notification_log id; substitute one for <LOG_ID>:
--   BEGIN;
--     -- empty body must fail chk_message_archive_has_body:
--     --   INSERT INTO message_archive (notification_log_id) VALUES ('<LOG_ID>');                    -- FAILS
--     --   INSERT INTO message_archive (notification_log_id, html_redacted) VALUES ('<LOG_ID>',''); -- FAILS
--     -- unknown content_kind must fail:
--     --   INSERT INTO message_archive (notification_log_id, html_redacted, content_kind)
--     --     VALUES ('<LOG_ID>', '<p>x</p>', 'other');                                               -- FAILS
--     -- valid row:
--     INSERT INTO message_archive (notification_log_id, html_redacted) VALUES ('<LOG_ID>', '<p>hello</p>');
--     SELECT COUNT(*) FROM message_archive;   -- expect: 1 inside the txn
--   ROLLBACK;
--   SELECT COUNT(*) FROM message_archive;     -- expect: 0
--
-- =============================================================================
-- ROLLBACK (safe — table is new, additive, nothing references it yet)
-- =============================================================================
--   DROP TABLE IF EXISTS message_archive;   -- also drops its PK/FK/CHECK constraints
--   NOTIFY pgrst, 'reload schema';
-- =============================================================================
