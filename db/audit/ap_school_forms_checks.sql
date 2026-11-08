-- AP-SCHOOL-FORMS-1: PRE and POST checks for 20261205000000_ap_school_forms.sql. Read-only.

-- PRE: expect owner_column false, forms_table true. The new CHECK binds only a row that names a
--      school, so every existing row (owner NULL) passes it whatever forms_without_catalog_item says.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'catalog_forms' AND column_name = 'owner_school_key') AS owner_column,
  to_regclass('public.catalog_forms') IS NOT NULL AS forms_table,
  (SELECT COUNT(*) FROM public.catalog_forms) AS forms_total,
  (SELECT COUNT(*) FROM public.catalog_forms WHERE catalog_resource_id IS NULL) AS forms_without_catalog_item;

-- POST: expect owner_column true, school_owner_check 1, owner_index 1, school_forms 0,
--       forms_total unchanged from PRE.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'catalog_forms' AND column_name = 'owner_school_key') AS owner_column,
  (SELECT COUNT(*) FROM pg_constraint WHERE conname = 'chk_catalog_forms_school_owner') AS school_owner_check,
  (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_catalog_forms_owner_school') AS owner_index,
  (SELECT COUNT(*) FROM public.catalog_forms WHERE owner_school_key IS NOT NULL) AS school_forms,
  (SELECT COUNT(*) FROM public.catalog_forms) AS forms_total;
