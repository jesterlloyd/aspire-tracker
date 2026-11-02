-- APPLICANT-SHEET-1 (Owner, 2026-11-02). OWNER-GATED: applied through the linked CLI only after
-- the Owner says yes in chat for THIS file.
--
-- Residency > Profiles & Interest > Interest & Eligibility opens the Transition Form answers in a
-- Sheet (the Catalog Forms' Answers grid) instead of downloading them, so Talent Acquisition can
-- sort, highlight, colour and classify applicants in the app. ONE shared sheet per residency
-- cohort: the ASPIRE team and Talent Acquisition arrange and mark the same sheet.
--
-- WHAT THIS FILE DOES
--   1. ngrp_sheet_views: one row per residency cohort: the layout (column order, widths, hidden,
--      frozen, group by, the staff's own columns, number formats, summaries).
--   2. ngrp_sheet_cells: one row per (applicant, column) someone touched: a staff column's value
--      and/or the cell's formatting (fill, ink, bold...). Who and when are kept on the row.
--      A submitted answer is never changed here: the Sheet has no corrections.
--   Both are server-only, like every ngrp table since CANDIDATE-SCORE-1: RLS on, no policy, no
--   browser grant; service_role SELECT/INSERT/UPDATE/DELETE (a cleared cell is deleted). A cohort's
--   or a candidate's deletion cascades.
--
-- Additive, one transaction, safe to re-run. Either deploy order: before it runs, the Sheet opens
-- read-only and says why. Checks: db/audit/ngrp_applicant_sheet_checks.sql.

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.ngrp_cycles') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: public.ngrp_cycles is missing';
  END IF;
  IF to_regclass('public.ngrp_candidates') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: public.ngrp_candidates is missing';
  END IF;
END
$pre$;

CREATE TABLE IF NOT EXISTS public.ngrp_sheet_views (
  cycle_id    uuid        PRIMARY KEY REFERENCES public.ngrp_cycles(id) ON DELETE CASCADE,
  layout      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ngrp_sheet_views_layout CHECK (jsonb_typeof(layout) = 'object')
);
COMMENT ON TABLE public.ngrp_sheet_views IS
  'APPLICANT-SHEET-1: the shared layout of one residency cohort''s applicant Sheet. Server-only.';

CREATE TABLE IF NOT EXISTS public.ngrp_sheet_cells (
  candidate_id uuid        NOT NULL REFERENCES public.ngrp_candidates(id) ON DELETE CASCADE,
  column_key   text        NOT NULL,
  cycle_id     uuid        NOT NULL REFERENCES public.ngrp_cycles(id) ON DELETE CASCADE,
  value        text,
  format       jsonb,
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, column_key),
  CONSTRAINT ngrp_sheet_cells_key CHECK (char_length(column_key) BETWEEN 1 AND 60),
  CONSTRAINT ngrp_sheet_cells_value CHECK (value IS NULL OR char_length(value) <= 5000),
  CONSTRAINT ngrp_sheet_cells_format CHECK (format IS NULL OR jsonb_typeof(format) = 'object')
);
COMMENT ON TABLE public.ngrp_sheet_cells IS
  'APPLICANT-SHEET-1: staff values and cell formatting on the applicant Sheet. Never a submitted answer. Server-only.';
CREATE INDEX IF NOT EXISTS idx_ngrp_sheet_cells_cycle ON public.ngrp_sheet_cells (cycle_id);

ALTER TABLE public.ngrp_sheet_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngrp_sheet_cells ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.ngrp_sheet_views FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.ngrp_sheet_cells FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ngrp_sheet_views TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ngrp_sheet_cells TO service_role;

COMMIT;

-- ── Rollback (run by hand; drops the layout and every highlight and staff value) ──
--   BEGIN;
--   DROP TABLE IF EXISTS public.ngrp_sheet_cells;
--   DROP TABLE IF EXISTS public.ngrp_sheet_views;
--   COMMIT;
