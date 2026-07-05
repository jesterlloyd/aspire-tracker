-- =============================================================================
-- ASPIRE Catalog: catalog_resources table  (CATALOG-1-pre)
-- Migration: 20260617000000_catalog1_pre_catalog_resources
-- =============================================================================
--
-- Backend foundation for a read-only, curated ASPIRE Catalog resource library.
-- This migration is ADDITIVE and ISOLATED: it creates ONE new table and touches
-- no existing table, bucket, policy, or function.
--
-- Files themselves do NOT live here. Internal files live in a SEPARATE PRIVATE
-- Storage bucket ('aspire-catalog', created manually by the Owner - see the
-- CATALOG-1-pre report) and are opened later (CATALOG-1) only via an authenticated
-- server-side endpoint that returns a short-lived signed URL. This table stores
-- the catalog metadata plus, per row, EITHER a storage_path (internal_file) OR an
-- external_url (external_link). No public URLs, no persisted signed URLs.
--
-- Access (CATALOG-1 default): Owner/Admin READ only. RLS is ENABLED with a single
-- Owner/Admin SELECT policy and NO client write policy. Seeds/writes are performed
-- by the Owner via the Supabase dashboard / service role (which bypasses RLS).
-- Broader staff/interviewer/viewer read is a later, deliberate decision.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute. Claude Code applies
-- nothing - the Owner applies this manually, creates the bucket, seeds rows, and
-- uploads files, THEN authorizes commit of this file.
-- Idempotent: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS before CREATE.
-- =============================================================================

-- ── 1. Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS catalog_resources (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable, human-readable identifier for a resource (used by URLs / lookups).
  slug             text        NOT NULL UNIQUE,

  title            text        NOT NULL,
  description      text,

  -- Single-text category with a CHECK constraint (no separate categories table).
  -- 'All' is a UI filter only and is intentionally NOT a stored value.
  category         text        NOT NULL,

  -- 'internal_file'  -> file in the private 'aspire-catalog' bucket (storage_path)
  -- 'external_link'  -> navigates to an existing, already-access-controlled URL
  resource_type    text        NOT NULL,
  storage_path     text,                              -- internal_file only
  external_url     text,                              -- external_link only

  file_type_label  text,                              -- icon hint: 'PDF' | 'DOC' | 'LINK' ...

  -- Lightweight metadata (CATALOG-1-pre Owner addendum)
  tags             text[]      NOT NULL DEFAULT '{}', -- search / filtering
  audience         text[]      NOT NULL DEFAULT '{}', -- later staff/student/preceptor classification
  collection_keys  text[]      NOT NULL DEFAULT '{}', -- powers Featured Collections (no collection table yet)
  sort_order       integer     NOT NULL DEFAULT 0,    -- curated ordering

  is_featured      boolean     NOT NULL DEFAULT false,
  is_pinned        boolean     NOT NULL DEFAULT false,
  is_active        boolean     NOT NULL DEFAULT true,

  -- Actor columns mirror the app convention: user_profiles(id) domain.
  -- Nullable (with ON DELETE SET NULL) so the Owner can seed rows manually in the
  -- dashboard without first resolving their user_profiles.id; the writer sets these.
  created_by       uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_by       uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- Category allowlist (7 stored values; 'All' is UI-only).
  CONSTRAINT chk_catalog_category CHECK (category IN (
    'orientation',
    'forms',
    'clinical_resources',
    'unit_guides',
    'student_support',
    'preceptor_resources',
    'policies'
  )),

  -- Resource type allowlist.
  CONSTRAINT chk_catalog_resource_type CHECK (resource_type IN ('internal_file', 'external_link')),

  -- Exactly-one-target: internal_file rows carry storage_path (no external_url);
  -- external_link rows carry external_url (no storage_path).
  CONSTRAINT chk_catalog_resource_target CHECK (
    (resource_type = 'internal_file' AND storage_path IS NOT NULL AND external_url IS NULL)
    OR
    (resource_type = 'external_link' AND external_url IS NOT NULL AND storage_path IS NULL)
  )
);

-- Browse-oriented indexes (additive, optional but cheap).
CREATE INDEX IF NOT EXISTS idx_catalog_resources_active_category_sort
  ON catalog_resources (is_active, category, sort_order);
CREATE INDEX IF NOT EXISTS idx_catalog_resources_tags        ON catalog_resources USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_catalog_resources_collections ON catalog_resources USING gin (collection_keys);


-- ── 2. Row Level Security ───────────────────────────────────────────────────────
-- RLS ENABLED. One Owner/Admin SELECT policy. NO client INSERT/UPDATE/DELETE policy
-- (seeds/writes go through the service role / dashboard, which bypass RLS). The
-- CATALOG-1 signed-URL endpoint will also read via the service-role admin client.

ALTER TABLE catalog_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catalog_resources_owner_admin_read" ON catalog_resources;
CREATE POLICY "catalog_resources_owner_admin_read"
  ON catalog_resources FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );


-- ── 3. Reload schema cache ──────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
