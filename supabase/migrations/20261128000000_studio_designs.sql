-- STUDIO-1 (Owner, 2026-11-05). OWNER-GATED: applied through the linked CLI only after the Owner
-- says yes in chat for THIS file.
--
-- ASPIRE Connect > Studio designs newsletters, announcements and sign-ups as blocks and sends them
-- through Outreach's bulk engine. This file gives Studio a place to keep its work.
--
-- WHAT THIS FILE DOES
--   1. studio_designs: one row per design. The design itself is blocks JSON (never HTML), plus its
--      name, who made and last changed it, and a short history of its sends (counts and batch ids,
--      never recipients' addresses; those are in notification_log, as for every Outreach send).
--      A design is archived, never deleted.
--   2. studio_saved_blocks: a block the Owner saved to reuse ("NGRP key dates").
--   3. studio-images: a PUBLIC storage bucket for pictures placed in a design. It must be public:
--      an email can only show an image anyone can fetch. 5 MB, JPEG, PNG, GIF and WebP only.
--      Uploads go through /api/studio with the service role; no browser policy is added.
--   Both tables are server-only: RLS on, no policy, no browser grant; service_role reads and
--   writes. is_demo follows the session that made the row (DEMO-DATA-1).
--
-- Additive, one transaction, safe to re-run. Either deploy order: before it runs, Studio keeps
-- designs in the browser and says so, and image upload is not offered.
-- Checks: db/audit/studio_designs_checks.sql.

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.user_profiles') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: public.user_profiles is missing';
  END IF;
END
$pre$;

CREATE TABLE IF NOT EXISTS public.studio_designs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL DEFAULT 'Untitled design',
  design        jsonb       NOT NULL,
  status        text        NOT NULL DEFAULT 'draft',
  sends         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  last_sent_at  timestamptz,
  is_demo       boolean     NOT NULL DEFAULT false,
  created_by    uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_by    uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_designs_name   CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT studio_designs_design CHECK (jsonb_typeof(design) = 'object' AND coalesce(jsonb_typeof(design -> 'blocks'), '') = 'array'),
  CONSTRAINT studio_designs_size   CHECK (octet_length(design::text) <= 200000),
  CONSTRAINT studio_designs_status CHECK (status IN ('draft', 'sent', 'archived')),
  CONSTRAINT studio_designs_sends  CHECK (jsonb_typeof(sends) = 'array')
);
COMMENT ON TABLE public.studio_designs IS
  'STUDIO-1: ASPIRE Connect > Studio designs (blocks JSON, never HTML) and a summary of their sends. Server-only.';
CREATE INDEX IF NOT EXISTS idx_studio_designs_recent ON public.studio_designs (is_demo, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.studio_saved_blocks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  block       jsonb       NOT NULL,
  is_demo     boolean     NOT NULL DEFAULT false,
  created_by  uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_saved_blocks_name  CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT studio_saved_blocks_block CHECK (jsonb_typeof(block) = 'object' AND coalesce(block ->> 'type', '') <> '' AND octet_length(block::text) <= 20000)
);
COMMENT ON TABLE public.studio_saved_blocks IS
  'STUDIO-1: blocks saved for reuse in Studio designs. Server-only.';

ALTER TABLE public.studio_designs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_saved_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.studio_designs      FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.studio_saved_blocks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.studio_designs      TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.studio_saved_blocks TO service_role;

DO $bucket$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('studio-images', 'studio-images', true, 5242880,
          ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
  ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 5242880,
          allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
EXCEPTION WHEN undefined_table THEN NULL;
END
$bucket$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ── Rollback (run by hand; drops every design and saved block; images stay in the bucket) ──
--   BEGIN;
--   DROP TABLE IF EXISTS public.studio_saved_blocks;
--   DROP TABLE IF EXISTS public.studio_designs;
--   COMMIT;
