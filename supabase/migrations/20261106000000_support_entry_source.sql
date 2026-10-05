-- SUPPORT-OUTREACH-1 (résumé review build, Phase 4), 2026-10-05.
-- OWNER-GATED: do not apply from a session.
--
-- Where each support entry came from. Owner decisions, 2026-10-04: Résumé Review is no longer
-- logged by hand; a résumé review sent from ASPIRE Connect > Outreach logs it on the send date.
--
--   ngrp_support_entries.source      'manual' (the record form, every entry before this),
--                                    'bulk' (Log Group Activity) or 'outreach' (a send).
--   ngrp_support_entries.source_ref  for an Outreach entry, the notification_log id of the
--                                    message that logged it.
--
-- Additive, one transaction, safe to re-run. Existing rows read 'manual'. Either deploy order:
-- the app writes these columns when they exist and the same rows without them when they do
-- not; until it runs, By Alumnus shows no message icon on a Résumé Review date.

BEGIN;

ALTER TABLE public.ngrp_support_entries
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_ref text;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ngrp_support_entry_source') THEN
    ALTER TABLE public.ngrp_support_entries
      ADD CONSTRAINT chk_ngrp_support_entry_source CHECK (source IN ('manual', 'bulk', 'outreach'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ngrp_support_entry_source_ref') THEN
    ALTER TABLE public.ngrp_support_entries
      ADD CONSTRAINT chk_ngrp_support_entry_source_ref CHECK (source_ref IS NULL OR char_length(source_ref) <= 80);
  END IF;
END
$chk$;

CREATE INDEX IF NOT EXISTS idx_ngrp_support_entries_source_ref
  ON public.ngrp_support_entries (source_ref) WHERE source_ref IS NOT NULL;

COMMENT ON COLUMN public.ngrp_support_entries.source IS
  'SUPPORT-OUTREACH-1: manual | bulk (Log Group Activity) | outreach (logged by a sent résumé review).';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Check (read-only): expect source_column 1, source_ref_column 1, constraints 2, every row 'manual'
-- before anything new is logged.
--   SELECT
--     (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ngrp_support_entries' AND column_name = 'source') AS source_column,
--     (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ngrp_support_entries' AND column_name = 'source_ref') AS source_ref_column,
--     (SELECT COUNT(*) FROM pg_constraint WHERE conname IN ('chk_ngrp_support_entry_source', 'chk_ngrp_support_entry_source_ref')) AS constraints,
--     (SELECT string_agg(DISTINCT source, ',') FROM public.ngrp_support_entries) AS sources;
--
-- Rollback:
--   BEGIN;
--   DROP INDEX IF EXISTS public.idx_ngrp_support_entries_source_ref;
--   ALTER TABLE public.ngrp_support_entries DROP CONSTRAINT IF EXISTS chk_ngrp_support_entry_source_ref;
--   ALTER TABLE public.ngrp_support_entries DROP CONSTRAINT IF EXISTS chk_ngrp_support_entry_source;
--   ALTER TABLE public.ngrp_support_entries DROP COLUMN IF EXISTS source_ref;
--   ALTER TABLE public.ngrp_support_entries DROP COLUMN IF EXISTS source;
--   COMMIT;
