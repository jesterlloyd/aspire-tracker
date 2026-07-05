-- =============================================================================
-- ASPIRE Connect Phase C.1: Add category column to contacts table
-- Migration: 20260604000000_contacts_add_category
-- =============================================================================
--
-- Adds a nullable TEXT column `category` to the contacts table and backfills
-- it using the exact role-to-category rules from ContactsView.jsx
-- (post-commit 45ead69, which added 'Professor & Assistant Director' to
-- ACADEMIC_ROLES).
--
-- Design decisions:
--   - Additive only. No existing column is modified.
--   - Contacts whose role doesn't match any current Set remain NULL (not 'Other').
--     NULL rows are surfaced by verification query C.3 for Owner manual review.
--   - The CASE branch order mirrors CATEGORY_PRIORITY in ContactsView.jsx:
--     Nursing Executives > BNI Team > Unit Leadership > Preceptors > Academic Partners.
--   - The two computed secondary-category rules (NPD Practitioner + unit_name → Unit
--     Leadership; Nursing Exec in BNI org → BNI Team) are NOT stored here. They remain
--     computed at read-time by the JS frontend (Phase C.2 will update read logic to
--     prefer stored primary + apply computed secondaries on top).
--   - WHERE category IS NULL makes the UPDATE idempotent: re-running after manual
--     assignments does not overwrite Owner-curated values.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute.
-- Test against a preview branch before applying to Production.
-- Idempotent: ADD COLUMN IF NOT EXISTS, UPDATE WHERE category IS NULL.
-- =============================================================================

-- ── Step 1: Add nullable category column ─────────────────────────────────────
--
-- TEXT, no CHECK constraint - allows future category values to be added
-- without a migration. Validation enforced at application layer.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS category TEXT;


-- ── Step 2: Conservative backfill ────────────────────────────────────────────
--
-- Translates the JS role Sets from ContactsView.jsx into SQL.
-- Each role appears in exactly one branch, matching its Set membership.
-- Roles not present in any Set evaluate to ELSE NULL and are left unset.
-- Priority order (CASE evaluates top-to-bottom, first match wins):
--   1. Nursing Executives  (highest priority)
--   2. BNI Team
--   3. Unit Leadership
--   4. Preceptors
--   5. Academic Partners   (lowest priority of named categories)
--   ELSE → NULL            (unmatched roles, for Owner manual review)

UPDATE contacts
SET category = CASE

  -- 1. NURSING_EXEC_ROLES
  WHEN role IN (
    'Nursing Leadership',
    'Nursing Executive',
    'Executive Director',
    'Chief Nursing Officer'
  ) THEN 'Nursing Executives'

  -- 2. BNI_TEAM_ROLES
  WHEN role IN (
    'NPD Practitioner',
    'BNI Administration',
    'BNI Team'
  ) THEN 'BNI Team'

  -- 3. UNIT_LEADERSHIP_ROLES
  WHEN role IN (
    'Associate Director',
    'Assistant Nurse Manager',
    'Unit NPD-P',
    'Unit NPD Practitioner'
  ) THEN 'Unit Leadership'

  -- 4. PRECEPTOR_ROLES
  WHEN role IN (
    'Preceptor',
    'Clinical Preceptor'
  ) THEN 'Preceptors'

  -- 5. ACADEMIC_ROLES (including 'Professor & Assistant Director' added in
  --    commit 45ead69 as part of Phase A+B Contacts categorization fix)
  WHEN role IN (
    'School Coordinator',
    'Clinical Placement Coordinator',
    'Clinical Placement Coordinators',
    'Program Assistant',
    'Program Assistants',
    'Manager',
    'Manager, Clinical Operations',
    'Manager, Clinical Faculty',
    'Manager Clinical Faculty',
    'Clinical Faculty',
    'Associate Professor',
    'Professor & Assistant Director',
    'Program Coordinator'
  ) THEN 'Academic Partners'

  -- Unmatched roles remain NULL for Owner review (never stored as 'Other')
  ELSE NULL

END
WHERE category IS NULL;


-- ── Step 3: Index for category filtering ─────────────────────────────────────
--
-- Partial index over non-NULL rows. Supports future queries filtering by
-- category without scanning contacts with no category assigned yet.

CREATE INDEX IF NOT EXISTS idx_contacts_category
  ON contacts(category)
  WHERE category IS NOT NULL;


-- ── Reload PostgREST schema cache ─────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
