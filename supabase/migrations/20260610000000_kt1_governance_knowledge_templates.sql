-- =============================================================================
-- ASPIRE Intelligence: KT-1 Governance Schema (Knowledge Center + Templates)
-- Migration: 20260610000000_kt1_governance_knowledge_templates
-- =============================================================================
--
-- PURPOSE
-- Establish the governed data model for the Keith Knowledge Center and the
-- Templates store. Schema only: eight new, additive tables. No endpoints, no
-- UI, no Keith/Connect/Action Center integration, no content, no seed data.
-- No existing table is modified by this migration.
--
-- STATE VOCABULARY (Knowledge, Templates, Partials)
--   draft | active | deprecated | archived
-- (These four values are the complete set; no other state vocabulary appears.)
--
-- EDIT MODEL
-- Active entries/templates are edited via a single pending revision per parent
-- (UNIQUE on the parent reference in the *_revisions tables). Immutable history
-- lives in the *_versions tables. Partial edit revisions are handled at the
-- endpoint layer (KT-2) against draft-state partials, so there is intentionally
-- no template_partial_revisions table.
--
-- ACTOR DOMAIN (deliberate departure from older tables)
-- Every actor column (created_by, updated_by, editor_id, author_id) is a UUID
-- referencing user_profiles(id) -- the staff-profile identifier domain that
-- activity_logs already uses -- NOT auth.users(id). This corrects the
-- attribution pattern some earlier tables used (auth.users(id)). Actor FKs use
-- ON DELETE RESTRICT: actor columns are NOT NULL (so SET NULL is impossible)
-- and governance history must retain attribution.
--
-- VOCABULARY ENFORCEMENT
-- All state/category/audience/channel/management vocabularies are enforced with
-- CHECK constraints (this project has no enum types; CHECK ... IN (...) is the
-- established precedent, e.g. migration_preceptor_schema_v2.sql). Future
-- taxonomy expansion is a CHECK constraint change, not a table rewrite.
--
-- RLS POSTURE
-- RLS is ENABLED on all eight tables with ZERO policies (deny-all to anon and
-- authenticated client roles). These tables have no UI in KT-1; all access in
-- KT-2 is mediated by serverless endpoints using the service role, which
-- bypasses RLS by design. No service-role policies are created.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute.
-- Idempotent: all DDL uses IF NOT EXISTS / DROP ... IF EXISTS. No INSERTs.
-- =============================================================================


-- ============================================================
-- 1. PRECONDITION: shared updated_at trigger function must exist
-- ============================================================
-- update_updated_at_column() was created by an earlier migration
-- (migration_concurrency_protections.sql). KT-1 does NOT create, replace, or
-- otherwise modify it -- the new tables' triggers below depend on it. This is a
-- read-only existence check: if the function is absent, the migration stops with
-- a clear error rather than altering any existing object. No existing function
-- is created or modified.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'update_updated_at_column'
      AND n.nspname = 'public'
      AND p.pronargs = 0
  ) THEN
    RAISE EXCEPTION 'KT-1 precondition failed: function public.update_updated_at_column() does not exist. Apply the migration that creates it (migration_concurrency_protections.sql) before running KT-1.';
  END IF;
END;
$$;


-- ============================================================
-- 2. NEW TABLE: knowledge_entries
-- ============================================================
-- Governed, addressable knowledge entries that will later back Keith retrieval.

CREATE TABLE IF NOT EXISTS knowledge_entries (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  title              text        NOT NULL,
  slug               text        NOT NULL UNIQUE,
  category           text        NOT NULL,
  body               text        NOT NULL DEFAULT '',
  source_attribution text        NOT NULL DEFAULT '',
  precedence_rank    integer     NOT NULL DEFAULT 100 CHECK (precedence_rank >= 0),

  state              text        NOT NULL DEFAULT 'draft',
  effective_date     date,
  expires_at         date,

  current_version    integer     NOT NULL DEFAULT 0 CHECK (current_version >= 0),

  -- Actor columns (user_profiles.id domain)
  created_by         uuid        NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  updated_by         uuid        NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT knowledge_entries_state_check
    CHECK (state IN ('draft', 'active', 'deprecated', 'archived')),
  CONSTRAINT knowledge_entries_category_check
    CHECK (category IN (
      'program_overview',
      'eligibility_placement',
      'interview_selection',
      'rotations_matching',
      'student_requirements',
      'communication_guidance',
      'terminology_navigation',
      'faq'
    ))
);

-- Future Keith retrieval: active entries within a category, ordered by precedence.
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_state_category_precedence
  ON knowledge_entries(state, category, precedence_rank);

DROP TRIGGER IF EXISTS set_updated_at_knowledge_entries ON knowledge_entries;
CREATE TRIGGER set_updated_at_knowledge_entries
  BEFORE UPDATE ON knowledge_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 3. NEW TABLE: knowledge_entry_versions (immutable history)
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge_entry_versions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  entry_id           uuid        NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  version_number     integer     NOT NULL CHECK (version_number > 0),

  -- Snapshot of the entry content at this version
  title              text        NOT NULL,
  category           text        NOT NULL,
  body               text        NOT NULL DEFAULT '',
  source_attribution text        NOT NULL DEFAULT '',
  precedence_rank    integer     NOT NULL DEFAULT 100 CHECK (precedence_rank >= 0),

  change_note        text        NOT NULL DEFAULT '',
  editor_id          uuid        NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,

  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT knowledge_entry_versions_unique UNIQUE (entry_id, version_number),
  CONSTRAINT knowledge_entry_versions_category_check
    CHECK (category IN (
      'program_overview',
      'eligibility_placement',
      'interview_selection',
      'rotations_matching',
      'student_requirements',
      'communication_guidance',
      'terminology_navigation',
      'faq'
    ))
);


-- ============================================================
-- 4. NEW TABLE: knowledge_revisions (one pending revision per entry)
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge_revisions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  entry_id           uuid        NOT NULL REFERENCES knowledge_entries(id) ON DELETE CASCADE,

  -- Proposed content
  title              text        NOT NULL,
  category           text        NOT NULL,
  body               text        NOT NULL DEFAULT '',
  source_attribution text        NOT NULL DEFAULT '',
  precedence_rank    integer     NOT NULL DEFAULT 100 CHECK (precedence_rank >= 0),

  change_note        text        NOT NULL DEFAULT '',
  author_id          uuid        NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,

  submitted_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT knowledge_revisions_entry_unique UNIQUE (entry_id),
  CONSTRAINT knowledge_revisions_category_check
    CHECK (category IN (
      'program_overview',
      'eligibility_placement',
      'interview_selection',
      'rotations_matching',
      'student_requirements',
      'communication_guidance',
      'terminology_navigation',
      'faq'
    ))
);

DROP TRIGGER IF EXISTS set_updated_at_knowledge_revisions ON knowledge_revisions;
CREATE TRIGGER set_updated_at_knowledge_revisions
  BEFORE UPDATE ON knowledge_revisions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 5. NEW TABLE: templates
-- ============================================================
-- Governed communication templates. No Catalog-referencing column (future
-- Catalog/template linkage will be a separate join table after Catalog exists).

CREATE TABLE IF NOT EXISTS templates (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  title              text        NOT NULL,
  purpose            text        NOT NULL DEFAULT '',
  audience           text        NOT NULL,
  channel            text        NOT NULL,
  subject_pattern    text        NOT NULL DEFAULT '',
  body               text        NOT NULL DEFAULT '',
  placeholder_schema jsonb       NOT NULL DEFAULT '[]',

  management         text        NOT NULL DEFAULT 'governed',
  state              text        NOT NULL DEFAULT 'draft',

  current_version    integer     NOT NULL DEFAULT 0 CHECK (current_version >= 0),

  created_by         uuid        NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  updated_by         uuid        NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT templates_state_check
    CHECK (state IN ('draft', 'active', 'deprecated', 'archived')),
  CONSTRAINT templates_audience_check
    CHECK (audience IN ('student', 'coordinator', 'preceptor', 'unit_leader', 'internal', 'executive')),
  CONSTRAINT templates_channel_check
    CHECK (channel IN ('keith_draft', 'connect_outreach', 'transactional_readonly')),
  CONSTRAINT templates_management_check
    CHECK (management IN ('governed', 'code_managed'))
);

-- Future Connect/Keith template listing: active templates by channel + audience.
CREATE INDEX IF NOT EXISTS idx_templates_state_channel_audience
  ON templates(state, channel, audience);

DROP TRIGGER IF EXISTS set_updated_at_templates ON templates;
CREATE TRIGGER set_updated_at_templates
  BEFORE UPDATE ON templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 6. NEW TABLE: template_versions (immutable history)
-- ============================================================

CREATE TABLE IF NOT EXISTS template_versions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  template_id        uuid        NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  version_number     integer     NOT NULL CHECK (version_number > 0),

  -- Snapshot of the template content at this version
  title              text        NOT NULL,
  purpose            text        NOT NULL DEFAULT '',
  audience           text        NOT NULL,
  channel            text        NOT NULL,
  subject_pattern    text        NOT NULL DEFAULT '',
  body               text        NOT NULL DEFAULT '',
  placeholder_schema jsonb       NOT NULL DEFAULT '[]',

  change_note        text        NOT NULL DEFAULT '',
  editor_id          uuid        NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,

  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT template_versions_unique UNIQUE (template_id, version_number),
  CONSTRAINT template_versions_audience_check
    CHECK (audience IN ('student', 'coordinator', 'preceptor', 'unit_leader', 'internal', 'executive')),
  CONSTRAINT template_versions_channel_check
    CHECK (channel IN ('keith_draft', 'connect_outreach', 'transactional_readonly'))
);


-- ============================================================
-- 7. NEW TABLE: template_revisions (one pending revision per template)
-- ============================================================

CREATE TABLE IF NOT EXISTS template_revisions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  template_id        uuid        NOT NULL REFERENCES templates(id) ON DELETE CASCADE,

  -- Proposed content
  title              text        NOT NULL,
  purpose            text        NOT NULL DEFAULT '',
  audience           text        NOT NULL,
  channel            text        NOT NULL,
  subject_pattern    text        NOT NULL DEFAULT '',
  body               text        NOT NULL DEFAULT '',
  placeholder_schema jsonb       NOT NULL DEFAULT '[]',

  change_note        text        NOT NULL DEFAULT '',
  author_id          uuid        NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,

  submitted_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT template_revisions_template_unique UNIQUE (template_id),
  CONSTRAINT template_revisions_audience_check
    CHECK (audience IN ('student', 'coordinator', 'preceptor', 'unit_leader', 'internal', 'executive')),
  CONSTRAINT template_revisions_channel_check
    CHECK (channel IN ('keith_draft', 'connect_outreach', 'transactional_readonly'))
);

DROP TRIGGER IF EXISTS set_updated_at_template_revisions ON template_revisions;
CREATE TRIGGER set_updated_at_template_revisions
  BEFORE UPDATE ON template_revisions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 8. NEW TABLE: template_partials
-- ============================================================
-- Reusable building blocks (signatures, footer, HTML wrapper) referenced by
-- templates at the endpoint layer in later phases.

CREATE TABLE IF NOT EXISTS template_partials (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  name               text        NOT NULL UNIQUE,
  description        text        NOT NULL DEFAULT '',
  body               text        NOT NULL DEFAULT '',

  state              text        NOT NULL DEFAULT 'draft',
  current_version    integer     NOT NULL DEFAULT 0 CHECK (current_version >= 0),

  created_by         uuid        NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  updated_by         uuid        NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT template_partials_state_check
    CHECK (state IN ('draft', 'active', 'deprecated', 'archived'))
);

DROP TRIGGER IF EXISTS set_updated_at_template_partials ON template_partials;
CREATE TRIGGER set_updated_at_template_partials
  BEFORE UPDATE ON template_partials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 9. NEW TABLE: template_partial_versions (immutable history)
-- ============================================================

CREATE TABLE IF NOT EXISTS template_partial_versions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  partial_id         uuid        NOT NULL REFERENCES template_partials(id) ON DELETE CASCADE,
  version_number     integer     NOT NULL CHECK (version_number > 0),

  -- Snapshot of the partial content at this version
  name               text        NOT NULL,
  description        text        NOT NULL DEFAULT '',
  body               text        NOT NULL DEFAULT '',

  change_note        text        NOT NULL DEFAULT '',
  editor_id          uuid        NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,

  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT template_partial_versions_unique UNIQUE (partial_id, version_number)
);


-- ============================================================
-- 10. RLS: enable on all eight tables (deny-all; zero policies)
-- ============================================================
-- No anon access. No authenticated client policies. All access in KT-2 is
-- through serverless endpoints using the service role, which bypasses RLS.
-- No service-role policies are created (none are needed).

ALTER TABLE knowledge_entries          ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_entry_versions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_revisions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_versions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_revisions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_partials          ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_partial_versions  ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 11. RELOAD SCHEMA CACHE
-- ============================================================

NOTIFY pgrst, 'reload schema';
