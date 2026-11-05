-- STUDIO-2 (Owner, 2026-11-05). OWNER-GATED: applied through the linked CLI only after the Owner
-- says yes in chat for THIS file.
--
-- ASPIRE Connect > Studio, Phase 2a: who gets it, and a way to stop getting it.
--
-- WHAT THIS FILE DOES
--   1. studio_sends: one row per Studio send, written BEFORE anything is sent. It holds the list the
--      sender reviewed (frozen: who, at which address, by which route), who was left out and why, the
--      rule it came from (when it came from one), where replies go, and afterwards the batch ids and
--      totals. The bulk endpoint refuses any recipient who is not on this list, so what was reviewed
--      is exactly what is sent. A row is never deleted.
--   2. program_news_optouts: one row per address that turned program news off from a Studio email's
--      Unsubscribe link (Owner: one "program news" switch per person). Studio sends skip these
--      addresses; transactional mail (forms, interviews, signatures, reminders) does not read it.
--      Turning it back on keeps the row and stamps resubscribed_at.
--   Both tables are server-only: RLS on, no policy, no browser grant; service_role reads and writes.
--   is_demo follows the session that made the row (DEMO-DATA-1).
--
-- Additive, one transaction, safe to re-run. Either deploy order: before it runs, Studio sends by
-- hand-picked list exactly as in Phase 1, sending by rule says it is not enabled, and emails carry
-- no Unsubscribe line.
-- Checks: db/audit/studio_audiences_checks.sql.

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.studio_designs') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: public.studio_designs is missing (apply 20261128000000 first)';
  END IF;
END
$pre$;

CREATE TABLE IF NOT EXISTS public.studio_sends (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id     uuid        REFERENCES public.studio_designs(id) ON DELETE SET NULL,
  subject       text        NOT NULL DEFAULT '',
  mode          text        NOT NULL,
  rule          jsonb,
  rule_label    text,
  recipients    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  excluded      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  reply_route   text        NOT NULL DEFAULT 'sender',
  status        text        NOT NULL DEFAULT 'frozen',
  batch_ids     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  sent          integer     NOT NULL DEFAULT 0,
  skipped       integer     NOT NULL DEFAULT 0,
  failed        integer     NOT NULL DEFAULT 0,
  is_demo       boolean     NOT NULL DEFAULT false,
  created_by    uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  CONSTRAINT studio_sends_mode       CHECK (mode IN ('rule', 'hand')),
  CONSTRAINT studio_sends_reply      CHECK (reply_route IN ('sender', 'residency')),
  CONSTRAINT studio_sends_status     CHECK (status IN ('frozen', 'sent')),
  CONSTRAINT studio_sends_lists      CHECK (jsonb_typeof(recipients) = 'array' AND jsonb_typeof(excluded) = 'array' AND jsonb_typeof(batch_ids) = 'array'),
  CONSTRAINT studio_sends_size       CHECK (jsonb_array_length(recipients) <= 2000 AND octet_length(recipients::text) <= 1500000),
  CONSTRAINT studio_sends_totals     CHECK (sent >= 0 AND skipped >= 0 AND failed >= 0)
);
COMMENT ON TABLE public.studio_sends IS
  'STUDIO-2: each Studio send''s reviewed, frozen recipient list; the bulk endpoint sends to nobody else. Server-only.';
CREATE INDEX IF NOT EXISTS idx_studio_sends_design ON public.studio_sends (design_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.program_news_optouts (
  email_norm       text        PRIMARY KEY,
  opted_out        boolean     NOT NULL DEFAULT true,
  opted_out_at     timestamptz NOT NULL DEFAULT now(),
  resubscribed_at  timestamptz,
  studio_send_id   uuid        REFERENCES public.studio_sends(id) ON DELETE SET NULL,
  is_demo          boolean     NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT program_news_optouts_email CHECK (email_norm = lower(email_norm) AND position('@' IN email_norm) > 1 AND char_length(email_norm) <= 320)
);
COMMENT ON TABLE public.program_news_optouts IS
  'STUDIO-2: addresses that turned off program news (Studio sends). Transactional mail ignores it. Server-only.';

ALTER TABLE public.studio_sends         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_news_optouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.studio_sends         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.program_news_optouts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.studio_sends         TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.program_news_optouts TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ── Rollback (run by hand; loses every opt-out, which Studio would then email again) ──
--   BEGIN;
--   DROP TABLE IF EXISTS public.program_news_optouts;
--   DROP TABLE IF EXISTS public.studio_sends;
--   COMMIT;
