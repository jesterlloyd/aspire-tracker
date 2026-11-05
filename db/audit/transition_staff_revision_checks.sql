-- db/audit/transition_staff_revision_checks.sql (read-only)
-- TRANSITION-STAFF-REVISION-1: run PRE before 20261129000000, POST after.

-- PRE / POST 1: the two revision columns (PRE: 0 rows; POST: 2 rows).
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'ngrp_transition_revisions'
   AND column_name IN ('entered_by_profile_id', 'entered_reason') ORDER BY column_name;

-- PRE / POST 2: the function and who may run it (PRE: none; POST: service_role only).
SELECT p.proname, r.rolname,
       has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
  FROM pg_proc p CROSS JOIN pg_roles r
 WHERE p.proname = 'ngrp_staff_revision_tx' AND r.rolname IN ('anon', 'authenticated', 'service_role')
 ORDER BY r.rolname;

-- PRE / POST 3: the audit table takes actor_kind 'staff' with an actor profile (columns exist).
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'ngrp_audit_events'
   AND column_name IN ('actor_kind', 'actor_profile_id') ORDER BY column_name;
