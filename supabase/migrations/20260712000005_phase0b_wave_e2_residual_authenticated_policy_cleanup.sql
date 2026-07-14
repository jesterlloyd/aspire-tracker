-- ============================================================================
-- PHASE 0B, WAVE E-2: remove the RESIDUAL broad authenticated policies that
-- Wave E missed because of a policy-name mismatch
-- ============================================================================
-- Context (root cause):
--   Wave E (20260712000004_phase0b_wave_e_staff_rescope.sql) re-scoped the
--   broad "authenticated" policies to is_staff(). Its DROP statements used the
--   REPOSITORY-ASSUMED names ("authenticated_all_<table>", from
--   migration_authenticated_rls_audit_v2.sql and the Phase 0A audit). On 14
--   tables the LIVE broad policy was created through the Supabase dashboard
--   under a DIFFERENT, human-readable name:
--     - 13 tables: "Authenticated full access on <table>"  (FOR ALL, true/true)
--     - activity_logs: "Authenticated users can insert logs" (INSERT, WITH CHECK true)
--   DROP POLICY IF EXISTS on a non-matching name is a silent no-op, so those
--   permissive policies survived while Wave E's CREATE statements succeeded.
--   Because PostgreSQL combines permissive policies with OR, the residual
--   USING true / WITH CHECK true policies defeat the new is_staff() checks.
--
--   Repository precedent for dropping a dashboard-named policy:
--   migration_preceptor_schema_v2.sql (drops "Authenticated full access on
--   preceptors"). That is why preceptors was already clean and is NOT listed
--   here. The exact residual names below were confirmed against live
--   pg_policies during Wave E production verification.
--
-- Scope:
--   This migration ONLY drops the residual broad policies. It creates nothing,
--   changes no grants, does not touch anon, service_role, the three-identity
--   model, read-receipt mappings, or portal access. The Wave E staff /
--   self-service / owner-admin policies remain in place, so every target table
--   keeps a policy (staff access is preserved; non-staff stays blocked).
--
-- Prerequisite: Wave E (its staff_* / self / owner-admin policies must already
--   exist). Waves A through D applied. Idempotent and safely rerunnable.
--
-- Findings: completes F6 (broad authenticated_all_* removal) and the F5 INSERT
--   portion on activity_logs, both of which Wave E intended to close.
-- Revert: db/audit/phase0b_reverts.sql, section Wave E-2.
-- ============================================================================

BEGIN;

-- ── 1. Residual dashboard-created broad policies (exact live names) ──────────
-- 13 x FOR ALL (USING true / WITH CHECK true):
DROP POLICY IF EXISTS "Authenticated full access on students"                      ON public.students;
DROP POLICY IF EXISTS "Authenticated full access on cohorts"                       ON public.cohorts;
DROP POLICY IF EXISTS "Authenticated full access on communications"                ON public.communications;
DROP POLICY IF EXISTS "Authenticated full access on units"                         ON public.units;
DROP POLICY IF EXISTS "Authenticated full access on matches"                       ON public.matches;
DROP POLICY IF EXISTS "Authenticated full access on interview_sessions"            ON public.interview_sessions;
DROP POLICY IF EXISTS "Authenticated full access on program_events"                ON public.program_events;
DROP POLICY IF EXISTS "Authenticated full access on interview_availability_blocks" ON public.interview_availability_blocks;
DROP POLICY IF EXISTS "Authenticated full access on interview_slots"               ON public.interview_slots;
DROP POLICY IF EXISTS "Authenticated full access on student_shift_logs"            ON public.student_shift_logs;
DROP POLICY IF EXISTS "Authenticated full access on ngrp_outcomes"                 ON public.ngrp_outcomes;
DROP POLICY IF EXISTS "Authenticated full access on cohort_snapshots"              ON public.cohort_snapshots;
DROP POLICY IF EXISTS "Authenticated full access on interview_rubrics"             ON public.interview_rubrics;

-- 1 x INSERT (WITH CHECK true) on the audit trail (the residual F5 insert gap):
DROP POLICY IF EXISTS "Authenticated users can insert logs"                        ON public.activity_logs;

-- ── 2. Defensive: also drop the repository-assumed variant names ─────────────
-- Wave E already dropped these in production; re-dropping is a safe no-op and
-- mirrors migration_preceptor_schema_v2.sql, which defensively drops BOTH the
-- "authenticated_all_*" and the "Authenticated full access on *" name forms.
-- This guarantees fail-closed cleanup regardless of which variant an
-- environment happens to carry. No table is left policy-less: the Wave E
-- staff_* / self / owner-admin policies remain.
DROP POLICY IF EXISTS "authenticated_all_students"             ON public.students;
DROP POLICY IF EXISTS "authenticated_all_cohorts"              ON public.cohorts;
DROP POLICY IF EXISTS "authenticated_all_communications"       ON public.communications;
DROP POLICY IF EXISTS "authenticated_all_units"               ON public.units;
DROP POLICY IF EXISTS "authenticated_all_matches"             ON public.matches;
DROP POLICY IF EXISTS "authenticated_all_interview_sessions"  ON public.interview_sessions;
DROP POLICY IF EXISTS "authenticated_all_program_events"      ON public.program_events;
DROP POLICY IF EXISTS "authenticated_all_availability_blocks" ON public.interview_availability_blocks;
DROP POLICY IF EXISTS "authenticated_all_interview_slots"     ON public.interview_slots;
DROP POLICY IF EXISTS "authenticated_all_student_shift_logs"  ON public.student_shift_logs;
DROP POLICY IF EXISTS "authenticated_all_ngrp_outcomes"       ON public.ngrp_outcomes;
DROP POLICY IF EXISTS "authenticated_all_cohort_snapshots"    ON public.cohort_snapshots;
DROP POLICY IF EXISTS "authenticated_all_rubrics"             ON public.interview_rubrics;
DROP POLICY IF EXISTS "authenticated_all_activity_logs"       ON public.activity_logs;

COMMIT;

-- ============================================================================
-- Verification (run after; both queries are read-only).
--
-- V1. Expected: ZERO rows. No authenticated policy with a permissive true
--     qualifier (USING true OR WITH CHECK true) remains on the Wave E target
--     tables. cohort_school_rotations is intentionally excluded (its anon and
--     authenticated SELECT are documented in the audit, deferred to Phase 3).
--
--   SELECT tablename, policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND 'authenticated' = ANY(roles)
--     AND (qual = 'true' OR with_check = 'true')
--     AND tablename IN ('students','cohorts','communications','units','matches',
--       'interview_sessions','program_events','interview_availability_blocks',
--       'interview_slots','student_shift_logs','ngrp_outcomes','cohort_snapshots',
--       'interview_rubrics','activity_logs');
--
-- V2. Expected: all present. The Wave E staff policies are untouched.
--
--   SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname = 'public'
--     AND policyname LIKE 'staff_%'
--   ORDER BY tablename, policyname;
--
-- Post-wave smoke test (as each staff role, especially viewer and interviewer):
-- log in, open /students, /rotation/matrix, /interviews, /evaluation, /connect;
-- confirm the roster, a student profile, and an interviewer rubric session all
-- still load, and that logging activity still works.
-- ============================================================================
