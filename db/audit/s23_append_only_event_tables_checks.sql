-- Checks for supabase/migrations/20261006000000_s23_append_only_event_tables.sql
-- Nothing here leaves a change behind. PRE 1 to 4 and POST 1, 2 and 5 are plain SELECTs
-- over the catalog. POST 3 and POST 4 exercise the triggers inside a DO block that ENDS
-- WITH RAISE EXCEPTION on purpose, so everything the block did is rolled back and its
-- report is the error message the editor shows. No names or emails are selected.
--
-- Run each numbered section on its own in the Supabase SQL editor, in this order:
--   PRE 1 to 4, then the migration as ONE block, then POST 1 to 5.

-- ── PRE 1: the fifteen covered tables exist, and what triggers they carry today ──
-- Expect 15 rows, one per table, present true. trigger_names is NULL for every table
-- except form_answer_corrections, which shows trg_form_answer_corrections_append_only.
-- STOP if any table is present false, or if a trigger name you do not recognise appears
-- (this file only ever adds trg_<table>_append_only and trg_<table>_no_truncate).
WITH covered(tbl) AS (VALUES
  ('preceptor_assignment_events'), ('unit_placement_request_events'),
  ('cohort_unit_response_target_events'), ('support_checkin_events'),
  ('preceptor_mirror_repair_audit'), ('preceptor_projection_backfill_audit'),
  ('conversation_events'), ('ngrp_audit_events'), ('ngrp_preceptor_feedback_access_events'),
  ('portal_invitation_events'), ('shift_log_reviews'), ('student_shift_log_edits'),
  ('keith_requests'), ('keith_skill_invocations'), ('form_answer_corrections'))
SELECT c.tbl,
       to_regclass('public.' || c.tbl) IS NOT NULL AS present,
       (SELECT string_agg(t.tgname, ', ' ORDER BY t.tgname)
          FROM pg_trigger t
         WHERE t.tgrelid = to_regclass('public.' || c.tbl) AND NOT t.tgisinternal) AS trigger_names
FROM covered c
ORDER BY c.tbl;

-- ── PRE 2: what each role may do on the covered tables today ─────────────────
-- Expect 15 rows. svc_update / svc_delete / svc_truncate are true on the six tables that
-- carried GRANT ALL or the default privileges (preceptor_assignment_events,
-- unit_placement_request_events, cohort_unit_response_target_events,
-- support_checkin_events, preceptor_mirror_repair_audit, form_answer_corrections) and
-- false on the rest. auth_update true on a table is the Supabase default privilege, held
-- back only by RLS today; note it, it is closed by the migration. Keep this result:
-- POST 5 compares svc_select and svc_insert against it.
WITH covered(tbl) AS (VALUES
  ('preceptor_assignment_events'), ('unit_placement_request_events'),
  ('cohort_unit_response_target_events'), ('support_checkin_events'),
  ('preceptor_mirror_repair_audit'), ('preceptor_projection_backfill_audit'),
  ('conversation_events'), ('ngrp_audit_events'), ('ngrp_preceptor_feedback_access_events'),
  ('portal_invitation_events'), ('shift_log_reviews'), ('student_shift_log_edits'),
  ('keith_requests'), ('keith_skill_invocations'), ('form_answer_corrections'))
SELECT tbl,
       has_table_privilege('service_role',  'public.' || tbl, 'SELECT')   AS svc_select,
       has_table_privilege('service_role',  'public.' || tbl, 'INSERT')   AS svc_insert,
       has_table_privilege('service_role',  'public.' || tbl, 'UPDATE')   AS svc_update,
       has_table_privilege('service_role',  'public.' || tbl, 'DELETE')   AS svc_delete,
       has_table_privilege('service_role',  'public.' || tbl, 'TRUNCATE') AS svc_truncate,
       has_table_privilege('authenticated', 'public.' || tbl, 'UPDATE')   AS auth_update,
       has_table_privilege('authenticated', 'public.' || tbl, 'DELETE')   AS auth_delete,
       has_table_privilege('anon',          'public.' || tbl, 'UPDATE')   AS anon_update
FROM covered
ORDER BY tbl;

-- ── PRE 3: foreign keys INTO the covered tables' parents, with their delete rule ──
-- A CASCADE from a parent becomes a refused DELETE on the parent once the triggers are
-- on. Expect CASCADE on exactly: unit_placement_request_events (request_id, from
-- unit_placement_requests), cohort_unit_response_target_events (target_id, from
-- cohort_unit_response_targets), and form_answer_corrections (org_id, form_id,
-- assignment_id). Every other row is RESTRICT, SET NULL or NO ACTION.
-- STOP if a CASCADE from students or cohorts appears on any covered table: that table
-- would then block student or cohort deletion and must be taken out of the migration.
SELECT c.conrelid::regclass  AS child_table,
       a.attname             AS child_column,
       c.confrelid::regclass AS parent_table,
       CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'r' THEN 'RESTRICT'
                          WHEN 'a' THEN 'NO ACTION' WHEN 'd' THEN 'SET DEFAULT' END AS on_delete
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
WHERE c.contype = 'f'
  AND c.conrelid::regclass::text IN (
    'preceptor_assignment_events', 'unit_placement_request_events',
    'cohort_unit_response_target_events', 'support_checkin_events',
    'preceptor_mirror_repair_audit', 'preceptor_projection_backfill_audit',
    'conversation_events', 'ngrp_audit_events', 'ngrp_preceptor_feedback_access_events',
    'portal_invitation_events', 'shift_log_reviews', 'student_shift_log_edits',
    'keith_requests', 'keith_skill_invocations', 'form_answer_corrections')
ORDER BY 1, 2;

-- ── PRE 4: the tables this file deliberately leaves out, for the record ──────
-- Read-only, informational. student_activity_completions cascades from students (a
-- trigger would break student deletion), activity_logs is a pre-existing table whose
-- foreign keys the repository cannot state, and program_events has update and delete
-- paths. Expect rows for whichever of the three exist; note the on_delete of any
-- students or cohorts key. Nothing to STOP on. This is the input to a follow-up.
SELECT c.conrelid::regclass  AS child_table,
       a.attname             AS child_column,
       c.confrelid::regclass AS parent_table,
       CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'r' THEN 'RESTRICT'
                          WHEN 'a' THEN 'NO ACTION' WHEN 'd' THEN 'SET DEFAULT' END AS on_delete,
       has_table_privilege('service_role', c.conrelid, 'UPDATE') AS svc_update,
       has_table_privilege('service_role', c.conrelid, 'DELETE') AS svc_delete
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
WHERE c.contype = 'f'
  AND c.conrelid::regclass::text IN ('student_activity_completions', 'activity_logs', 'program_events')
ORDER BY 1, 2;

-- ═════════════════════════════════════════════════════════════════════════════
-- APPLY supabase/migrations/20261006000000_s23_append_only_event_tables.sql
-- as ONE block. Expected: "Success. No rows returned." (the fifteen NOTICE lines are
-- informational; the editor may not show them).
-- ═════════════════════════════════════════════════════════════════════════════

-- ── POST 1: every covered table carries both triggers ────────────────────────
-- Expect 15 rows. Fourteen tables show exactly
--   trg_<table>_append_only, trg_<table>_no_truncate
-- and form_answer_corrections shows
--   trg_form_answer_corrections_append_only, trg_form_answer_corrections_no_truncate.
-- update_delete_trigger and truncate_trigger are both true on every row.
-- STOP if either is false anywhere.
WITH covered(tbl) AS (VALUES
  ('preceptor_assignment_events'), ('unit_placement_request_events'),
  ('cohort_unit_response_target_events'), ('support_checkin_events'),
  ('preceptor_mirror_repair_audit'), ('preceptor_projection_backfill_audit'),
  ('conversation_events'), ('ngrp_audit_events'), ('ngrp_preceptor_feedback_access_events'),
  ('portal_invitation_events'), ('shift_log_reviews'), ('student_shift_log_edits'),
  ('keith_requests'), ('keith_skill_invocations'), ('form_answer_corrections'))
SELECT c.tbl,
       (SELECT string_agg(t.tgname, ', ' ORDER BY t.tgname)
          FROM pg_trigger t
         WHERE t.tgrelid = to_regclass('public.' || c.tbl) AND NOT t.tgisinternal) AS trigger_names,
       EXISTS (SELECT 1 FROM pg_trigger t
                WHERE t.tgrelid = to_regclass('public.' || c.tbl) AND NOT t.tgisinternal
                  AND t.tgname = 'trg_' || c.tbl || '_append_only'
                  AND (t.tgtype & 2) = 2                       -- BEFORE
                  AND (t.tgtype & 16) = 16 AND (t.tgtype & 8) = 8  -- UPDATE and DELETE
                  AND (t.tgtype & 1) = 1) AS update_delete_trigger,  -- FOR EACH ROW
       EXISTS (SELECT 1 FROM pg_trigger t
                WHERE t.tgrelid = to_regclass('public.' || c.tbl) AND NOT t.tgisinternal
                  AND t.tgname = 'trg_' || c.tbl || '_no_truncate'
                  AND (t.tgtype & 2) = 2 AND (t.tgtype & 32) = 32) AS truncate_trigger  -- BEFORE TRUNCATE
FROM covered c
ORDER BY c.tbl;

-- ── POST 2: no role may UPDATE, DELETE or TRUNCATE any covered table ─────────
-- Expect: no rows. A row is a role that still holds one of the three on one table.
WITH covered(tbl) AS (VALUES
  ('preceptor_assignment_events'), ('unit_placement_request_events'),
  ('cohort_unit_response_target_events'), ('support_checkin_events'),
  ('preceptor_mirror_repair_audit'), ('preceptor_projection_backfill_audit'),
  ('conversation_events'), ('ngrp_audit_events'), ('ngrp_preceptor_feedback_access_events'),
  ('portal_invitation_events'), ('shift_log_reviews'), ('student_shift_log_edits'),
  ('keith_requests'), ('keith_skill_invocations'), ('form_answer_corrections'))
SELECT c.tbl, r.rolname, p.priv
FROM covered c
CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
CROSS JOIN (VALUES ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
WHERE has_table_privilege(r.rolname, 'public.' || c.tbl, p.priv)
ORDER BY 1, 2, 3;

-- ── POST 3: UPDATE, DELETE and TRUNCATE are refused on the live tables ────────
-- On each covered table this tries an UPDATE of one existing row (setting a column to
-- its own value), a DELETE of one existing row, and a TRUNCATE, and records the outcome.
-- The block ends with RAISE EXCEPTION, so the transaction is rolled back and NOTHING it
-- did survives, even in the impossible case that a statement went through. The report
-- is the error message. A refusal is insufficient_privilege (this file's function) or
-- check_violation (form_answer_corrections' own function from 20260929000000); the first
-- run on 2026-09-25 classified the latter as an error and read FAIL for that one cell.
-- Expect the message to begin "S-23 POST 3 PASS" and to list every table as
-- update=refused delete=refused truncate=refused, except that a table with no rows yet
-- reads update=no-rows delete=no-rows (a row trigger cannot fire on nothing).
-- STOP if it begins "S-23 POST 3 FAIL": the table it names still accepts a write.
DO $post3$
DECLARE
  tables text[] := ARRAY[
    'preceptor_assignment_events', 'unit_placement_request_events',
    'cohort_unit_response_target_events', 'support_checkin_events',
    'preceptor_mirror_repair_audit', 'preceptor_projection_backfill_audit',
    'conversation_events', 'ngrp_audit_events', 'ngrp_preceptor_feedback_access_events',
    'portal_invitation_events', 'shift_log_reviews', 'student_shift_log_edits',
    'keith_requests', 'keith_skill_invocations', 'form_answer_corrections'];
  t text;
  col text;
  n bigint;
  upd text; del text; trunc text;
  report text := '';
  failed boolean := false;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    SELECT column_name INTO col FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t AND is_identity = 'NO' AND is_generated = 'NEVER'
     ORDER BY ordinal_position LIMIT 1;

    IF n = 0 THEN
      upd := 'no-rows'; del := 'no-rows';
    ELSE
      BEGIN
        EXECUTE format('UPDATE public.%I SET %I = %I WHERE ctid = (SELECT ctid FROM public.%I LIMIT 1)', t, col, col, t);
        upd := 'WENT THROUGH'; failed := true;
      EXCEPTION WHEN insufficient_privilege OR check_violation THEN upd := 'refused';
               WHEN OTHERS THEN upd := 'error ' || SQLSTATE; failed := true;
      END;
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE ctid = (SELECT ctid FROM public.%I LIMIT 1)', t, t);
        del := 'WENT THROUGH'; failed := true;
      EXCEPTION WHEN insufficient_privilege OR check_violation THEN del := 'refused';
               WHEN OTHERS THEN del := 'error ' || SQLSTATE; failed := true;
      END;
    END IF;
    BEGIN
      EXECUTE format('TRUNCATE public.%I', t);
      trunc := 'WENT THROUGH'; failed := true;
    EXCEPTION WHEN insufficient_privilege OR check_violation THEN trunc := 'refused';
             WHEN OTHERS THEN trunc := 'error ' || SQLSTATE; failed := true;
    END;
    report := report || format('%s (%s rows): update=%s delete=%s truncate=%s; ', t, n, upd, del, trunc);
  END LOOP;
  RAISE EXCEPTION 'S-23 POST 3 % (rolled back on purpose): %',
    CASE WHEN failed THEN 'FAIL' ELSE 'PASS' END, report;
END
$post3$;

-- ── POST 4: an INSERT still succeeds, and the inserted row is itself frozen ──
-- Inserts one throwaway row into each of the four covered tables that have no foreign
-- keys (so no real record is referenced), then tries to UPDATE and DELETE that very row.
-- Ends with RAISE EXCEPTION: the four rows are rolled back and never exist.
-- Expect the message to begin "S-23 POST 4 PASS" with inserted=4 and, for each table,
-- update=refused delete=refused. STOP on "S-23 POST 4 FAIL".
DO $post4$
DECLARE
  report text := '';
  failed boolean := false;
  inserted int := 0;
  rid text;
  upd text; del text;
BEGIN
  -- ngrp_audit_events
  INSERT INTO public.ngrp_audit_events (event_type, actor_kind, metadata)
    VALUES ('cycle_created', 'system', '{"s23_post4": true}'::jsonb) RETURNING id::text INTO rid;
  inserted := inserted + 1;
  BEGIN UPDATE public.ngrp_audit_events SET actor_kind = 'system' WHERE id::text = rid; upd := 'WENT THROUGH'; failed := true;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN upd := 'refused'; WHEN OTHERS THEN upd := 'error ' || SQLSTATE; failed := true; END;
  BEGIN DELETE FROM public.ngrp_audit_events WHERE id::text = rid; del := 'WENT THROUGH'; failed := true;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN del := 'refused'; WHEN OTHERS THEN del := 'error ' || SQLSTATE; failed := true; END;
  report := report || format('ngrp_audit_events: update=%s delete=%s; ', upd, del);

  -- ngrp_preceptor_feedback_access_events
  INSERT INTO public.ngrp_preceptor_feedback_access_events (request_id, candidate_id, student_id, actor_profile_id, event_type, response_count)
    VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'viewed', 0) RETURNING id::text INTO rid;
  inserted := inserted + 1;
  BEGIN UPDATE public.ngrp_preceptor_feedback_access_events SET response_count = 0 WHERE id::text = rid; upd := 'WENT THROUGH'; failed := true;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN upd := 'refused'; WHEN OTHERS THEN upd := 'error ' || SQLSTATE; failed := true; END;
  BEGIN DELETE FROM public.ngrp_preceptor_feedback_access_events WHERE id::text = rid; del := 'WENT THROUGH'; failed := true;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN del := 'refused'; WHEN OTHERS THEN del := 'error ' || SQLSTATE; failed := true; END;
  report := report || format('ngrp_preceptor_feedback_access_events: update=%s delete=%s; ', upd, del);

  -- preceptor_mirror_repair_audit
  INSERT INTO public.preceptor_mirror_repair_audit (batch, entity, ref_id, col, old_value)
    VALUES ('S-23 POST 4 (rolled back)', 'students', gen_random_uuid(), 's23_post4', NULL) RETURNING id::text INTO rid;
  inserted := inserted + 1;
  BEGIN UPDATE public.preceptor_mirror_repair_audit SET col = 's23_post4' WHERE id::text = rid; upd := 'WENT THROUGH'; failed := true;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN upd := 'refused'; WHEN OTHERS THEN upd := 'error ' || SQLSTATE; failed := true; END;
  BEGIN DELETE FROM public.preceptor_mirror_repair_audit WHERE id::text = rid; del := 'WENT THROUGH'; failed := true;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN del := 'refused'; WHEN OTHERS THEN del := 'error ' || SQLSTATE; failed := true; END;
  report := report || format('preceptor_mirror_repair_audit: update=%s delete=%s; ', upd, del);

  -- preceptor_projection_backfill_audit
  INSERT INTO public.preceptor_projection_backfill_audit (batch, scope, student_id)
    VALUES ('S-23 POST 4 (rolled back)', 'student', gen_random_uuid()) RETURNING id::text INTO rid;
  inserted := inserted + 1;
  BEGIN UPDATE public.preceptor_projection_backfill_audit SET scope = 'student' WHERE id::text = rid; upd := 'WENT THROUGH'; failed := true;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN upd := 'refused'; WHEN OTHERS THEN upd := 'error ' || SQLSTATE; failed := true; END;
  BEGIN DELETE FROM public.preceptor_projection_backfill_audit WHERE id::text = rid; del := 'WENT THROUGH'; failed := true;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN del := 'refused'; WHEN OTHERS THEN del := 'error ' || SQLSTATE; failed := true; END;
  report := report || format('preceptor_projection_backfill_audit: update=%s delete=%s; ', upd, del);

  RAISE EXCEPTION 'S-23 POST 4 % (rolled back on purpose): inserted=% %',
    CASE WHEN failed THEN 'FAIL' ELSE 'PASS' END, inserted, report;
END
$post4$;

-- ── POST 5: SELECT and INSERT grants are exactly what PRE 2 showed ───────────
-- Expect 15 rows whose svc_select and svc_insert match PRE 2 row for row, and whose
-- svc_update, svc_delete, svc_truncate, auth_update, auth_delete and anon_update are all
-- false. The migration removed three privileges and granted none.
WITH covered(tbl) AS (VALUES
  ('preceptor_assignment_events'), ('unit_placement_request_events'),
  ('cohort_unit_response_target_events'), ('support_checkin_events'),
  ('preceptor_mirror_repair_audit'), ('preceptor_projection_backfill_audit'),
  ('conversation_events'), ('ngrp_audit_events'), ('ngrp_preceptor_feedback_access_events'),
  ('portal_invitation_events'), ('shift_log_reviews'), ('student_shift_log_edits'),
  ('keith_requests'), ('keith_skill_invocations'), ('form_answer_corrections'))
SELECT tbl,
       has_table_privilege('service_role',  'public.' || tbl, 'SELECT')   AS svc_select,
       has_table_privilege('service_role',  'public.' || tbl, 'INSERT')   AS svc_insert,
       has_table_privilege('service_role',  'public.' || tbl, 'UPDATE')   AS svc_update,
       has_table_privilege('service_role',  'public.' || tbl, 'DELETE')   AS svc_delete,
       has_table_privilege('service_role',  'public.' || tbl, 'TRUNCATE') AS svc_truncate,
       has_table_privilege('authenticated', 'public.' || tbl, 'UPDATE')   AS auth_update,
       has_table_privilege('authenticated', 'public.' || tbl, 'DELETE')   AS auth_delete,
       has_table_privilege('anon',          'public.' || tbl, 'UPDATE')   AS anon_update
FROM covered
ORDER BY tbl;
