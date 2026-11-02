-- APPLICANT-SHEET-1: PRE and POST checks for 20261119000000_ngrp_applicant_sheet.sql. Read-only.
-- PRE: both prerequisites exist and neither sheet table does yet.
-- POST: both tables exist, RLS on, no policy, only service_role holds privileges.

SELECT
  to_regclass('public.ngrp_cycles')      IS NOT NULL AS cycles_present,
  to_regclass('public.ngrp_candidates')  IS NOT NULL AS candidates_present,
  to_regclass('public.ngrp_sheet_views') IS NOT NULL AS sheet_views_present,
  to_regclass('public.ngrp_sheet_cells') IS NOT NULL AS sheet_cells_present,
  (SELECT count(*) FROM pg_class c WHERE c.relname IN ('ngrp_sheet_views', 'ngrp_sheet_cells') AND c.relrowsecurity) AS rls_on,
  (SELECT count(*) FROM pg_policies WHERE tablename IN ('ngrp_sheet_views', 'ngrp_sheet_cells')) AS policies,
  (SELECT string_agg(DISTINCT grantee, ',') FROM information_schema.role_table_grants
     WHERE table_name IN ('ngrp_sheet_views', 'ngrp_sheet_cells')) AS grantees;
