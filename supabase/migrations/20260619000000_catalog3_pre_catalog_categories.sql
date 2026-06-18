-- =============================================================================
-- ASPIRE Catalog: catalog_categories table + FK + CHECK swap  (CATALOG-3-pre)
-- Migration: 20260619000000_catalog3_pre_catalog_categories
-- =============================================================================
--
-- Introduces an editable-category FOUNDATION: a catalog_categories table seeded from the
-- current seven fixed categories, a foreign key from catalog_resources.category (slug) to it,
-- and removal of the now-redundant category CHECK (the FK replaces it). This is ADDITIVE and
-- SLUG-STABLE: resources keep referencing the slug (NOT migrated to category_id), so ZERO
-- resource rows are modified. No Storage operation. No UI (that is CATALOG-3). No add/archive
-- (CATALOG-3B). No category delete.
--
-- Design: slug = stable machine id (resources reference it, never changes); display_name =
-- editable human label (renaming a category later = display_name update only; resources and
-- deep links keyed on slug keep working).
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute the STEPS IN ORDER. Run the
-- verification query in STEP 3 and confirm it returns ZERO rows BEFORE running STEP 4 (the FK).
-- Claude Code applies nothing — the Owner applies and verifies each step, then authorizes commit.
-- Idempotency: CREATE TABLE IF NOT EXISTS; DROP POLICY/CONSTRAINT IF EXISTS before CREATE/ADD;
-- seed uses ON CONFLICT (slug) DO NOTHING (re-running never duplicates and never clobbers a
-- future CATALOG-3 rename).
-- =============================================================================


-- ── STEP 1. catalog_categories table + RLS + read policy ─────────────────────────

CREATE TABLE IF NOT EXISTS catalog_categories (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text        NOT NULL UNIQUE,          -- stable machine id (FK target)
  display_name text        NOT NULL,                 -- editable human label (CATALOG-3)
  description  text,
  sort_order   integer     NOT NULL DEFAULT 0,
  is_active    boolean     NOT NULL DEFAULT true,    -- archive is CATALOG-3B; all seeded active
  created_by   uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_by   uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- RLS ENABLED. Read for catalog-viewing roles (Owner/Admin/Interviewer) so display names and
-- order render for everyone who browses. NO client write policy — category writes go through a
-- server (service-role) Owner/Admin endpoint in CATALOG-3.
ALTER TABLE catalog_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catalog_categories_read" ON catalog_categories;
CREATE POLICY "catalog_categories_read"
  ON catalog_categories FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid()
        AND role IN ('owner', 'admin', 'interviewer')
    )
  );


-- ── STEP 2. Seed the seven existing categories (slugs unchanged) ─────────────────
-- ON CONFLICT (slug) DO NOTHING: re-running never duplicates and never overwrites a later
-- display_name rename made in CATALOG-3.

INSERT INTO catalog_categories (slug, display_name, sort_order) VALUES
  ('orientation',         'Orientation',         10),
  ('forms',               'Forms',               20),
  ('clinical_resources',  'Clinical Resources',  30),
  ('unit_guides',         'Unit Guides',         40),
  ('student_support',     'Student Support',     50),
  ('preceptor_resources', 'Preceptor Resources', 60),
  ('policies',            'Policies',            70)
ON CONFLICT (slug) DO NOTHING;


-- ── STEP 3. PRE-FK VERIFICATION — run this and confirm ZERO rows BEFORE STEP 4 ───
-- Any row returned here is a resource whose category does not resolve to a seeded slug; the FK
-- in STEP 4 would fail. Expected: 0 rows. If non-zero, STOP and resolve before continuing.
--
--   SELECT DISTINCT r.category
--   FROM catalog_resources r
--   WHERE NOT EXISTS (SELECT 1 FROM catalog_categories c WHERE c.slug = r.category);


-- ── STEP 4. Foreign key: catalog_resources.category → catalog_categories.slug ────
-- Validates resource categories THROUGH the live table (as the CHECK did through a frozen list).
-- Adds a constraint only — resource ROWS are never modified. DROP-then-ADD makes it idempotent.

ALTER TABLE catalog_resources DROP CONSTRAINT IF EXISTS fk_catalog_resources_category;
ALTER TABLE catalog_resources
  ADD CONSTRAINT fk_catalog_resources_category
  FOREIGN KEY (category) REFERENCES catalog_categories (slug);


-- ── STEP 5. Drop the now-redundant category CHECK (the FK replaces it) ────────────
-- This is a SWAP, not a loosening: category is still constrained — now by the FK against the
-- live catalog_categories table instead of a frozen IN-list.

ALTER TABLE catalog_resources DROP CONSTRAINT IF EXISTS chk_catalog_category;


-- ── STEP 6. Reload schema cache ──────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- ROLLBACK (reverses everything; resources remain untouched throughout)
-- =============================================================================
--   -- 1. Re-add the original CHECK (resources already satisfy it):
--   ALTER TABLE catalog_resources ADD CONSTRAINT chk_catalog_category CHECK (category IN (
--     'orientation','forms','clinical_resources','unit_guides',
--     'student_support','preceptor_resources','policies'
--   ));
--   -- 2. Drop the FK:
--   ALTER TABLE catalog_resources DROP CONSTRAINT IF EXISTS fk_catalog_resources_category;
--   -- 3. Drop the table (also drops its RLS policy):
--   DROP TABLE IF EXISTS catalog_categories;
--   NOTIFY pgrst, 'reload schema';
-- =============================================================================
