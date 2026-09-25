-- FORM-SHEET-2 (Responses > Sheet, Smartsheet-style editing), 2026-09-24. OWNER-GATED: do not
-- apply from a session.
--
-- The Sheet becomes editable, the way a Smartsheet grid is, WITHOUT ever overwriting what a
-- person submitted (Owner, 2026-09-24: "also edit their answers"):
--
--   1. form_sheet_views        one row per form: the layout staff arranged (column order,
--                              widths, hidden, frozen, group by) and the staff's own columns
--                              (Lot assignment, Processed, Notes...).
--   2. form_sheet_cells        one row per (response, column) a staff member touched: the
--                              value of a staff column, and/or the cell's formatting (bold,
--                              italic, colours, alignment, wrap).
--   3. form_answer_corrections an append-only history of corrections to submitted answers.
--                              The submission keeps its answers and its filed PDF as sent; the
--                              Sheet, the Summary and the Excel export read the latest
--                              correction, tagged Corrected, with who, when and the original.
--                              A trigger refuses UPDATE and DELETE: undoing a correction is a
--                              new correction back to the original.
--
-- Every table has org_id and an Owner/Admin read policy of the caller's organization, like
-- FORMS-PHASE3. Writes are the service role only, through /api/form-staff. The app runs on
-- both sides of this migration: without it the Sheet is read-only and says why.
--
-- Requires: 20260928000000_forms_phase3.sql. Checks: db/audit/form_sheet_checks.sql.
-- Rollback: end of file.

BEGIN;

-- ── 1. The layout and the staff columns ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS form_sheet_views (
  form_id     uuid        PRIMARY KEY REFERENCES catalog_forms(id) ON DELETE CASCADE,
  org_id      uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES organizations(id) ON DELETE CASCADE,
  layout      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_by  uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_form_sheet_views_layout CHECK (jsonb_typeof(layout) = 'object')
);

-- ── 2. Staff values and cell formatting ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS form_sheet_cells (
  assignment_id uuid        NOT NULL REFERENCES form_assignments(id) ON DELETE CASCADE,
  column_key    text        NOT NULL,
  form_id       uuid        NOT NULL REFERENCES catalog_forms(id) ON DELETE CASCADE,
  org_id        uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES organizations(id) ON DELETE CASCADE,
  value         text,
  format        jsonb,
  updated_by    uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, column_key),
  CONSTRAINT chk_form_sheet_cells_key CHECK (char_length(column_key) BETWEEN 1 AND 60),
  CONSTRAINT chk_form_sheet_cells_value CHECK (value IS NULL OR char_length(value) <= 5000),
  CONSTRAINT chk_form_sheet_cells_format CHECK (format IS NULL OR jsonb_typeof(format) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_form_sheet_cells_form ON form_sheet_cells (form_id);

-- ── 3. Corrections to submitted answers, append-only ──────────────────────────────

CREATE TABLE IF NOT EXISTS form_answer_corrections (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL DEFAULT 'a5f1e000-0000-4000-8000-000000000001' REFERENCES organizations(id) ON DELETE CASCADE,
  form_id           uuid        NOT NULL REFERENCES catalog_forms(id) ON DELETE CASCADE,
  assignment_id     uuid        NOT NULL REFERENCES form_assignments(id) ON DELETE CASCADE,
  question_id       text        NOT NULL,
  original          jsonb,                    -- what the person submitted, copied for the record
  value             jsonb,                    -- the corrected answer (null = cleared)
  reason            text,
  corrected_by      uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  corrected_by_name text,
  corrected_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_form_answer_corrections_q CHECK (char_length(question_id) BETWEEN 1 AND 40),
  CONSTRAINT chk_form_answer_corrections_reason CHECK (reason IS NULL OR char_length(reason) <= 500)
);
CREATE INDEX IF NOT EXISTS idx_form_answer_corrections_form ON form_answer_corrections (form_id, corrected_at);

CREATE OR REPLACE FUNCTION public.form_answer_corrections_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'form_answer_corrections is append-only: record a new correction instead'
    USING ERRCODE = 'check_violation';
END;
$$;
DROP TRIGGER IF EXISTS trg_form_answer_corrections_append_only ON form_answer_corrections;
CREATE TRIGGER trg_form_answer_corrections_append_only BEFORE UPDATE OR DELETE ON form_answer_corrections
  FOR EACH ROW EXECUTE FUNCTION public.form_answer_corrections_append_only();

-- ── 4. Row level security: Owner/Admin of the caller's organization read; nobody writes ──

ALTER TABLE form_sheet_views        ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_sheet_cells        ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_answer_corrections ENABLE ROW LEVEL SECURITY;

DO $policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['form_sheet_views', 'form_sheet_cells', 'form_answer_corrections'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_admin_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (org_id = public.sig_caller_org_id() AND public.is_active_owner_or_admin())',
      t || '_owner_admin_read', t);
  END LOOP;
END
$policies$;

COMMIT;

-- ── Rollback (run by hand; drops the layouts, staff values and correction history) ──
--   BEGIN;
--   DROP TABLE IF EXISTS form_answer_corrections;
--   DROP TABLE IF EXISTS form_sheet_cells;
--   DROP TABLE IF EXISTS form_sheet_views;
--   DROP FUNCTION IF EXISTS public.form_answer_corrections_append_only();
--   COMMIT;
