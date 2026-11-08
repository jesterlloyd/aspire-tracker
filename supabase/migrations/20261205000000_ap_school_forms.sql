-- AP-SCHOOL-FORMS-1 (Owner, 2026-11-08): an Academic Partner builds its own forms and sends them
-- to its own students. A school form is an ordinary catalog_forms row that names its school and
-- has no Catalog item, so it never appears in ASPIRE's Catalog. Owner-gated.
--
-- The app runs on both sides of this file: before it, the portal's Forms section says it is being
-- prepared, and the staff endpoint reads every form as ASPIRE's (no owner column, no owner).
-- Server-only, like the rest of the Forms tables: /api/portal/school-forms runs on the service role
-- and checks the school against the caller's user_school_scopes before every action.
--
-- PRE and POST checks: db/audit/ap_school_forms_checks.sql

ALTER TABLE public.catalog_forms ADD COLUMN IF NOT EXISTS owner_school_key text;

-- A school form is never a Catalog item and never a starter, and always names its school.
ALTER TABLE public.catalog_forms DROP CONSTRAINT IF EXISTS chk_catalog_forms_school_owner;
ALTER TABLE public.catalog_forms ADD CONSTRAINT chk_catalog_forms_school_owner CHECK (
  owner_school_key IS NULL
  OR (catalog_resource_id IS NULL AND starter_key IS NULL AND length(btrim(owner_school_key)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_catalog_forms_owner_school
  ON public.catalog_forms (owner_school_key, updated_at DESC) WHERE owner_school_key IS NOT NULL;

COMMENT ON COLUMN public.catalog_forms.owner_school_key IS
  'AP-SCHOOL-FORMS-1: the Academic Partner school (user_school_scopes.school_key) that owns this form. NULL is an ASPIRE Catalog form.';

-- Rollback (only while no school form exists):
--   ALTER TABLE public.catalog_forms DROP CONSTRAINT IF EXISTS chk_catalog_forms_school_owner;
--   DROP INDEX IF EXISTS public.idx_catalog_forms_owner_school;
--   ALTER TABLE public.catalog_forms DROP COLUMN IF EXISTS owner_school_key;
