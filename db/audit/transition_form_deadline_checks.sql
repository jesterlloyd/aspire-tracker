-- Checks for supabase/migrations/20261121000000_transition_form_deadline.sql
-- Run one section at a time (the CLI shows only the last statement's result).

-- PRE 1: the column is not there yet, and the deployed functions still read application_deadline.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'ngrp_cycles' AND column_name = 'transition_form_deadline') AS column_present,
  position('application_deadline' IN pg_get_functiondef('public.ngrp_submit_revision_tx(uuid, jsonb, text, text, jsonb, jsonb)'::regprocedure)) > 0 AS submit_reads_application_deadline,
  position('application_deadline' IN pg_get_functiondef('public.ngrp_save_draft_tx(uuid, jsonb)'::regprocedure)) > 0 AS save_reads_application_deadline;

-- PRE 2: every live assignment already carries its own close date (expect 0), so no open form
-- changes its close when the fallback moves.
SELECT count(*) AS live_assignments_without_own_date
  FROM public.ngrp_transition_assignments
 WHERE revoked_at IS NULL AND deadline_at IS NULL;

-- POST 1: column present, both functions read the new column and not the application deadline.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'ngrp_cycles' AND column_name = 'transition_form_deadline') AS column_present,
  position('transition_form_deadline' IN pg_get_functiondef('public.ngrp_submit_revision_tx(uuid, jsonb, text, text, jsonb, jsonb)'::regprocedure)) > 0
    AND position('application_deadline' IN pg_get_functiondef('public.ngrp_submit_revision_tx(uuid, jsonb, text, text, jsonb, jsonb)'::regprocedure)) = 0 AS submit_ok,
  position('transition_form_deadline' IN pg_get_functiondef('public.ngrp_save_draft_tx(uuid, jsonb)'::regprocedure)) > 0
    AND position('application_deadline' IN pg_get_functiondef('public.ngrp_save_draft_tx(uuid, jsonb)'::regprocedure)) = 0 AS save_ok;

-- POST 2: only service_role may execute them.
SELECT p.proname, r.rolname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  CROSS JOIN LATERAL aclexplode(p.proacl) a
  JOIN pg_roles r ON r.oid = a.grantee
 WHERE p.proname IN ('ngrp_submit_revision_tx', 'ngrp_save_draft_tx') AND a.privilege_type = 'EXECUTE'
 ORDER BY 1, 2;
