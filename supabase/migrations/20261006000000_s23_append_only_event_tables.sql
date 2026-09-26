-- supabase/migrations/20261006000000_s23_append_only_event_tables.sql
--
-- S-23 (FINDINGS_REGISTER): tables documented as append-only event, audit or history
-- ledgers are made append-only BY THE DATABASE, not by a comment. Until now three of them
-- (preceptor_assignment_events, cohort_unit_response_target_events, support_checkin_events)
-- and preceptor_mirror_repair_audit carried GRANT ALL for service_role with nothing that
-- blocked a rewrite, unit_placement_request_events had only the default privileges, and the
-- rest relied on grants alone, which a table owner, a SECURITY DEFINER routine or a
-- superuser session are not bound by. A trigger binds everyone.
--
-- The template is the one already on sig_events (20260927000000), form_answer_corrections
-- (20260929000000) and evaluation_response_unit_release_events (20260725000000): a BEFORE
-- UPDATE OR DELETE row trigger and a BEFORE TRUNCATE statement trigger that raise, so the
-- statement fails whatever role issued it. This file adds the same pair to every documented
-- append-only table that lacks it, through ONE shared function, and trims each table's
-- grants to the template's shape (no UPDATE, DELETE or TRUNCATE for any browser or server
-- role). Reads and INSERTs do not change for anyone.
--
-- Tables covered (fifteen, each verified at S23-1 to have NO update or delete path in code
-- or in any SQL routine):
--   preceptor_assignment_events          audit of record for preceptor assignment changes
--   unit_placement_request_events        placement request history (Unit Leader portal)
--   cohort_unit_response_target_events   target lifecycle audit, written by trigger
--   support_checkin_events               Action Center support check-in history
--   preceptor_mirror_repair_audit        Phase 2B repair snapshots
--   preceptor_projection_backfill_audit  projection backfill snapshots
--   conversation_events                  Messages lifecycle log
--   ngrp_audit_events                    NGRP workflow audit trail
--   ngrp_preceptor_feedback_access_events  who requested, decided and viewed feedback
--   portal_invitation_events             invitation and activation diagnostics
--   shift_log_reviews                    staff review ledger, deletion-durable
--   student_shift_log_edits              student edit ledger, deletion-durable
--   keith_requests                       Keith metering, append-only
--   keith_skill_invocations              Keith skill audit, append-only
--   form_answer_corrections              already refuses UPDATE and DELETE; gains the
--                                        TRUNCATE trigger it lacked (its own function stays)
--
-- Foreign keys. The template does not special-case ON DELETE CASCADE: a cascade is a DELETE
-- on the child and the trigger refuses it, so the parent delete fails too (this is how
-- form_answer_corrections already behaves toward catalog_forms). Two covered tables cascade
-- from a parent, unit_placement_request_events from unit_placement_requests and
-- cohort_unit_response_target_events from cohort_unit_response_targets; nothing in the code
-- or the SQL routines deletes either parent (targets are deactivated, never deleted), so
-- the audit rows now also keep their parents. student_activity_completions is deliberately
-- NOT covered: it cascades from students, and students are deleted by the staff app, so the
-- trigger would break student deletion. It stays grant-enforced (UPDATE and DELETE were
-- already revoked from every role in 20260822000000).
--
-- Owner-gated. Apply as ONE block. Checks, one section at a time, are in
-- db/audit/s23_append_only_event_tables_checks.sql: PRE 1 to 4, then this file, then
-- POST 1 to 5. Rollback (inert until run) at the end.

BEGIN;

-- One function for every covered table. ERRCODE 42501 (insufficient_privilege) like
-- sig_events, so a PostgREST caller sees a permission refusal, not a server error.
CREATE OR REPLACE FUNCTION public.append_only_refuse()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % refused', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.append_only_refuse() FROM PUBLIC, anon, authenticated;

DO $s23$
DECLARE
  t text;
  tables text[] := ARRAY[
    'preceptor_assignment_events',
    'unit_placement_request_events',
    'cohort_unit_response_target_events',
    'support_checkin_events',
    'preceptor_mirror_repair_audit',
    'preceptor_projection_backfill_audit',
    'conversation_events',
    'ngrp_audit_events',
    'ngrp_preceptor_feedback_access_events',
    'portal_invitation_events',
    'shift_log_reviews',
    'student_shift_log_edits',
    'keith_requests',
    'keith_skill_invocations'
  ];
BEGIN
  -- Every covered table must exist; a missing one means this database is not the one the
  -- file was written for, and nothing is applied.
  FOREACH t IN ARRAY tables || ARRAY['form_answer_corrections'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'S-23: public.% does not exist; nothing was applied', t;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY tables LOOP
    -- Idempotent: this file's own trigger names are dropped before they are created.
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_append_only', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_no_truncate', t);

    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.append_only_refuse()',
      'trg_' || t || '_append_only', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_refuse()',
      'trg_' || t || '_no_truncate', t);

    -- The template's grant shape: no role may UPDATE, DELETE or TRUNCATE. SELECT and INSERT
    -- grants are left exactly as each table's own migration set them.
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);

    RAISE NOTICE 'S-23: append-only triggers on public.%', t;
  END LOOP;

  -- form_answer_corrections keeps trg_form_answer_corrections_append_only and its own
  -- function (20260929000000); only the TRUNCATE trigger was missing.
  DROP TRIGGER IF EXISTS trg_form_answer_corrections_no_truncate ON public.form_answer_corrections;
  CREATE TRIGGER trg_form_answer_corrections_no_truncate BEFORE TRUNCATE ON public.form_answer_corrections
    FOR EACH STATEMENT EXECUTE FUNCTION public.form_answer_corrections_append_only();
  REVOKE UPDATE, DELETE, TRUNCATE ON public.form_answer_corrections FROM PUBLIC, anon, authenticated, service_role;
  RAISE NOTICE 'S-23: no-truncate trigger on public.form_answer_corrections';
END
$s23$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (Owner-gated, one block; inert until run). Removes the triggers this file
-- added and restores UPDATE, DELETE and TRUNCATE to service_role on the tables that
-- carried GRANT ALL before it. It does not touch sig_events, the release events table or
-- the corrections table's own UPDATE/DELETE trigger, none of which this file created.
--
--   BEGIN;
--   DO $$
--   DECLARE t text;
--   BEGIN
--     FOREACH t IN ARRAY ARRAY['preceptor_assignment_events','unit_placement_request_events',
--         'cohort_unit_response_target_events','support_checkin_events','preceptor_mirror_repair_audit',
--         'preceptor_projection_backfill_audit','conversation_events','ngrp_audit_events',
--         'ngrp_preceptor_feedback_access_events','portal_invitation_events','shift_log_reviews',
--         'student_shift_log_edits','keith_requests','keith_skill_invocations'] LOOP
--       EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_append_only', t);
--       EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || t || '_no_truncate', t);
--     END LOOP;
--     DROP TRIGGER IF EXISTS trg_form_answer_corrections_no_truncate ON public.form_answer_corrections;
--     FOREACH t IN ARRAY ARRAY['preceptor_assignment_events','unit_placement_request_events',
--         'cohort_unit_response_target_events','support_checkin_events','preceptor_mirror_repair_audit',
--         'form_answer_corrections'] LOOP
--       EXECUTE format('GRANT UPDATE, DELETE, TRUNCATE ON public.%I TO service_role', t);
--     END LOOP;
--   END $$;
--   DROP FUNCTION IF EXISTS public.append_only_refuse();
--   COMMIT;
-- ─────────────────────────────────────────────────────────────────────────────
