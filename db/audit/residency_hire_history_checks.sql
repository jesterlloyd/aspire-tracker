-- Checks for supabase/migrations/20261124000000_residency_hire_history.sql (HIRE-HISTORY-1).
-- Run one section at a time (the CLI shows only the last statement's result).

-- PRE 1: the six columns and the titles table do not exist yet; the demo inherit function does.
SELECT (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'ngrp_residency_outcomes'
           AND column_name IN ('hired_as','hired_as_other','licensed_at_application','nclex_passed_on','license_issued_on','backfilled')) AS new_columns_present,
       to_regclass('public.ngrp_resident_titles') IS NOT NULL AS titles_present,
       (SELECT count(*) FROM pg_proc WHERE proname = 'aspire_demo_inherit') AS inherit_fn;

-- PRE 2: the audit CHECK holds 20261120000000's list (49 types) and not the two new ones.
SELECT pg_get_constraintdef(oid) ~ 'form_deadline_extended' AS has_deadline_type,
       pg_get_constraintdef(oid) ~ 'hire_backfilled' AS has_backfill_type
  FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check';

-- POST 1: the six columns exist, nullable, backfilled defaulting to false; no row was touched.
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'ngrp_residency_outcomes'
   AND column_name IN ('hired_as','hired_as_other','licensed_at_application','nclex_passed_on','license_issued_on','backfilled')
 ORDER BY column_name;

-- POST 2: the titles table is server-only and append-only: RLS on, no policies, service_role
-- SELECT and INSERT only, the demo inherit trigger in place.
SELECT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ngrp_resident_titles'::regclass) AS rls_on,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'ngrp_resident_titles') AS policies,
       (SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.role_table_grants
         WHERE table_schema = 'public' AND table_name = 'ngrp_resident_titles' AND grantee = 'service_role') AS service_role_grants,
       (SELECT count(*) FROM information_schema.role_table_grants
         WHERE table_schema = 'public' AND table_name = 'ngrp_resident_titles' AND grantee IN ('anon','authenticated')) AS client_grants,
       (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.ngrp_resident_titles'::regclass AND tgname = 'aspire_demo_inherit_trg') AS inherit_trigger;

-- POST 3: the audit CHECK accepts the two new types and still the old ones.
SELECT pg_get_constraintdef(oid) ~ 'hire_backfilled' AS has_backfill_type,
       pg_get_constraintdef(oid) ~ 'title_changed' AS has_title_type,
       pg_get_constraintdef(oid) ~ 'form_deadline_extended' AS has_deadline_type
  FROM pg_constraint WHERE conname = 'ngrp_audit_events_event_type_check';
