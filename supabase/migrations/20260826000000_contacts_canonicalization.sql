-- ============================================================================
-- CONTACTS-CANON-1: canonical contact categories, titles, and fields
-- ============================================================================
-- *** APPLY MANUALLY (Owner/Jester). Claude Code has applied NOTHING. ***
--
-- True canonicalization of the ASPIRE Connect contact directory, matching the
-- shared vocabulary module src/lib/contactCategories.js (which both editors
-- and both write endpoints consume). The app ships BEFORE this SQL and keeps
-- working: reads map legacy values through canonicalCategory(), writes
-- normalize to the canonical forms, and the Services field fails closed with
-- a clear error until the column exists.
--
-- WHAT THIS FILE DOES
--   1. Renames the stored contacts.category values to the singular canonical
--      keys: 'Academic Partners' -> 'Academic Partner', 'Unit Leadership' ->
--      'Unit Leader', 'Preceptors' -> 'Preceptor', 'Nursing Executives' ->
--      'Nursing Executive' ('BNI Team' and 'Other' are unchanged).
--   2. Backfills NULL categories from the same role inference the 20260604
--      backfill used (singular outputs); anything still unmatched becomes
--      'Other'. Then sets NOT NULL DEFAULT 'Other' and adds the named CHECK
--      chk_contacts_category over exactly the six canonical values.
--   3. Maps legacy titles into the canonical per-category dropdowns where the
--      mapping is CERTAIN (mirrored in LEGACY_TITLE_MAP in the JS module):
--        Unit Leader:  'Unit NPD-P', 'Unit NPD Practitioner' -> 'NPD Practitioner'
--        Preceptor:    'Preceptor', 'Clinical Preceptor'     -> NULL (the CN
--                      level is unknown for auto-synced preceptor contacts;
--                      the canonical state is "no title", never an invented one)
--      Uncertain candidates are listed COMMENTED for Jester to decide; every
--      remaining non-canonical title keeps working as a passthrough dropdown
--      option until corrected by hand (verification query V4 lists them).
--   4. Relaxes contacts.role to nullable (title is optional in the canonical
--      model; the base table's NOT NULL predates it and already conflicted
--      with the upsert endpoint's empty-string -> NULL normalization).
--   5. Adds contacts.services (free text) for Nursing Executive contacts with
--      the Executive Director title (BNI, Surgical Services, OLAR, ...).
--   6. Drops contacts.preferred_contact_method (decision 2026-08-25: the
--      field carries no answers and is retired from both editors).
--
-- WHAT THIS FILE DOES NOT DO
--   - It does not touch unit columns: the multi-unit model reuses the
--     existing unit_name (primary) + related_units (rest) pair; validation
--     against the unit catalog is enforced by the write endpoints.
--   - It does not rewrite organization/school_name data; the derived
--     affiliation rules apply to writes going forward.
--
-- ── PREFLIGHT (run and review BEFORE the transaction) ────────────────────────
--   -- P1. Current category distribution (expect the plural forms + NULL):
--   SELECT COALESCE(category, '(null)') AS category, count(*)
--   FROM public.contacts GROUP BY 1 ORDER BY 2 DESC;
--
--   -- P2. The full (category, role) inventory - THE mapping worksheet:
--   SELECT COALESCE(category, '(null)') AS category, COALESCE(role, '(null)') AS role, count(*)
--   FROM public.contacts GROUP BY 1, 2 ORDER BY 1, 3 DESC;
--
--   -- P3. preferred_contact_method is expected to carry no real answers:
--   SELECT COALESCE(preferred_contact_method, '(null)') AS v, count(*)
--   FROM public.contacts GROUP BY 1 ORDER BY 2 DESC;
--
--   -- P4. Column state (expect: preferred_contact_method present, services
--   --     absent, role attnotnull = true):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'contacts'
--     AND column_name IN ('preferred_contact_method', 'services', 'role', 'related_units');
--   SELECT attname, attnotnull FROM pg_attribute
--   WHERE attrelid = 'public.contacts'::regclass AND attname IN ('role', 'organization');
-- ============================================================================

BEGIN;

-- ── 1. Category canonicalization ────────────────────────────────────────────

UPDATE public.contacts SET category = 'Academic Partner'  WHERE category = 'Academic Partners';
UPDATE public.contacts SET category = 'Unit Leader'       WHERE category = 'Unit Leadership';
UPDATE public.contacts SET category = 'Preceptor'         WHERE category = 'Preceptors';
UPDATE public.contacts SET category = 'Nursing Executive' WHERE category = 'Nursing Executives';

-- ── 2. NULL backfill (same role inference as the 20260604 backfill, singular
--       outputs, same priority: exec > BNI > unit > preceptor > academic),
--       then Other, then constraints. ──────────────────────────────────────────

UPDATE public.contacts SET category =
  CASE
    WHEN role IN ('Nursing Leadership', 'Nursing Executive', 'Executive Director', 'Chief Nursing Officer',
                  'SVP, Chief Nursing Executive', 'VP of Nursing and Therapies')
      THEN 'Nursing Executive'
    WHEN role IN ('NPD Practitioner', 'BNI Administration', 'BNI Team',
                  'Program/Project Coordinator', 'Lead Administrative Assistant')
      THEN 'BNI Team'
    WHEN role IN ('Associate Director', 'Interim Associate Director', 'Assistant Nurse Manager',
                  'Clinical Nurse Specialist', 'Unit NPD-P', 'Unit NPD Practitioner')
      THEN 'Unit Leader'
    WHEN role IN ('Preceptor', 'Clinical Preceptor', 'CN II', 'CN III')
      THEN 'Preceptor'
    WHEN role IN ('School Coordinator', 'Clinical Placement Coordinator', 'Clinical Placement Coordinators',
                  'Program Assistant', 'Program Assistants', 'Manager', 'Manager, Clinical Operations',
                  'Manager, Clinical Faculty', 'Manager Clinical Faculty', 'Clinical Faculty',
                  'Associate Professor', 'Professor & Assistant Director', 'Program Coordinator')
      THEN 'Academic Partner'
    ELSE 'Other'
  END
WHERE category IS NULL;

ALTER TABLE public.contacts ALTER COLUMN category SET DEFAULT 'Other';
ALTER TABLE public.contacts ALTER COLUMN category SET NOT NULL;
ALTER TABLE public.contacts
  ADD CONSTRAINT chk_contacts_category
  CHECK (category IN ('Academic Partner', 'Unit Leader', 'Preceptor', 'BNI Team', 'Nursing Executive', 'Other'));

-- ── 3. Title becomes optional ───────────────────────────────────────────────
-- MUST precede the title mapping: step 4 sets Preceptor titles to NULL, which
-- 23502s while the base table's NOT NULL is still in force (found on the
-- first live apply attempt; the transaction rolled back cleanly).

ALTER TABLE public.contacts ALTER COLUMN role DROP NOT NULL;

-- ── 4. Title mapping (certain mappings only; category-scoped) ───────────────

UPDATE public.contacts SET role = 'NPD Practitioner'
WHERE category = 'Unit Leader' AND role IN ('Unit NPD-P', 'Unit NPD Practitioner');

-- Auto-synced preceptor contacts carried the literal role 'Preceptor'; the CN
-- level is unknown, so the canonical state is "no title".
UPDATE public.contacts SET role = NULL
WHERE category = 'Preceptor' AND role IN ('Preceptor', 'Clinical Preceptor');

-- CANDIDATE mappings, deliberately commented: review the P2 worksheet and
-- uncomment (or hand-correct in the editor) only what is actually right.
-- Everything left unmapped passes through as a legacy dropdown option.
-- (2026-08-25 live P2 review: none of the three apply to current data.)
-- UPDATE public.contacts SET role = 'SVP, Chief Nursing Executive'
--   WHERE category = 'Nursing Executive' AND role = 'Chief Nursing Officer';
-- UPDATE public.contacts SET role = 'Program/Project Coordinator'
--   WHERE category = 'BNI Team' AND role = 'BNI Administration';
-- UPDATE public.contacts SET role = 'Clinical Placement Coordinator'
--   WHERE category = 'Academic Partner' AND role = 'School Coordinator';

-- ── 5. Services (Nursing Executive / Executive Director) ────────────────────

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS services text;
COMMENT ON COLUMN public.contacts.services IS
  'Free-text service line(s) for a Nursing Executive with the Executive Director title (BNI, Surgical Services, Medical Services, OLAR, ...). Not used by any other category.';

-- ── 6. Retire preferred_contact_method ──────────────────────────────────────

ALTER TABLE public.contacts DROP COLUMN IF EXISTS preferred_contact_method;

COMMIT;

-- ── VERIFICATION (run after COMMIT) ──────────────────────────────────────────
--   -- V1. Every category is canonical (expect exactly rows from the six):
--   SELECT category, count(*) FROM public.contacts GROUP BY 1 ORDER BY 2 DESC;
--
--   -- V2. Constraint present:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.contacts'::regclass AND conname = 'chk_contacts_category';
--
--   -- V3. Columns: services present, preferred_contact_method gone, role nullable:
--   SELECT column_name, is_nullable FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'contacts'
--     AND column_name IN ('services', 'preferred_contact_method', 'role');
--
--   -- V4. THE MANUAL-CORRECTION WORKLIST: titles still outside the canonical
--   --     dropdowns (they keep working as passthrough options until fixed):
--   SELECT category, role, count(*)
--   FROM public.contacts
--   WHERE role IS NOT NULL AND role <> '' AND NOT (
--     (category = 'Academic Partner')  -- free text allowed
--     OR (category = 'Other')          -- free text allowed
--     OR (category = 'Unit Leader' AND role IN ('Associate Director', 'Interim Associate Director', 'Assistant Nurse Manager', 'NPD Practitioner', 'Clinical Nurse Specialist'))
--     OR (category = 'Preceptor' AND role IN ('CN II', 'CN III'))
--     OR (category = 'BNI Team' AND role IN ('Executive Director', 'NPD Practitioner', 'Program/Project Coordinator', 'Lead Administrative Assistant'))
--     OR (category = 'Nursing Executive' AND role IN ('SVP, Chief Nursing Executive', 'VP of Nursing and Therapies', 'Executive Director', 'Manager'))
--   )
--   GROUP BY 1, 2 ORDER BY 1, 3 DESC;

-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- Category renames reverse cleanly; the preferred_contact_method DATA is not
-- recoverable (it was verified empty in P3 before applying).
/*
BEGIN;
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS chk_contacts_category;
ALTER TABLE public.contacts ALTER COLUMN category DROP NOT NULL;
ALTER TABLE public.contacts ALTER COLUMN category DROP DEFAULT;
UPDATE public.contacts SET category = 'Academic Partners'  WHERE category = 'Academic Partner';
UPDATE public.contacts SET category = 'Unit Leadership'    WHERE category = 'Unit Leader';
UPDATE public.contacts SET category = 'Preceptors'         WHERE category = 'Preceptor';
UPDATE public.contacts SET category = 'Nursing Executives' WHERE category = 'Nursing Executive';
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS preferred_contact_method text;
ALTER TABLE public.contacts DROP COLUMN IF EXISTS services;
-- Restore role NOT NULL only after confirming no NULL titles remain:
--   SELECT count(*) FROM public.contacts WHERE role IS NULL;
-- ALTER TABLE public.contacts ALTER COLUMN role SET NOT NULL;
COMMIT;
*/
