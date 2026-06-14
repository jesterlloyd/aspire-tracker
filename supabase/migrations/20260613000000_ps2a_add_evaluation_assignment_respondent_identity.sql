-- =============================================================================
-- PS-2a: Evaluation assignment respondent identity
-- Migration: 20260613000000_ps2a_add_evaluation_assignment_respondent_identity
-- =============================================================================
--
-- Records the additive respondent-identity schema change that was designed in PS-2a,
-- manually applied in the Supabase SQL Editor, and Owner-verified. This file brings the
-- repo migration history in sync with Production; the SQL is idempotent and safe to
-- re-run (it will no-op where the columns/constraints already exist).
--
-- Intent:
--   - public.evaluation_assignments.student_id remains the required SUBJECT.
--   - respondent_* fields model WHO completes the evaluation.
--   - Existing Casey-Fink / student rows default to respondent_type = 'student'
--     (28 rows confirmed unchanged at apply time).
--   - Future Preceptor Student Progress & Readiness Feedback Survey rows will set
--     respondent_type = 'preceptor'.
--
-- Scope guardrails (PS-2a only):
--   - Additive only. No backfill beyond the respondent_type default.
--   - No RLS changes. No evaluation_responses changes. No token-table changes.
--   - No idempotency index (deferred to PS-2b API design).
--   - No survey instruments, invitations, emails, or PS-2b implementation logic.
--   - No rollback SQL in this migration body.
--
-- HOW TO RUN: already applied manually in Production. Idempotent if re-run.
-- =============================================================================

ALTER TABLE public.evaluation_assignments
  ADD COLUMN IF NOT EXISTS respondent_type         text NOT NULL DEFAULT 'student',
  ADD COLUMN IF NOT EXISTS respondent_preceptor_id uuid,
  ADD COLUMN IF NOT EXISTS respondent_email        text,
  ADD COLUMN IF NOT EXISTS respondent_name         text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_assignment_respondent_type'
      AND conrelid = 'public.evaluation_assignments'::regclass
  ) THEN
    ALTER TABLE public.evaluation_assignments
      ADD CONSTRAINT chk_assignment_respondent_type
      CHECK (respondent_type IN ('student', 'preceptor'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_assignment_respondent_preceptor'
      AND conrelid = 'public.evaluation_assignments'::regclass
  ) THEN
    ALTER TABLE public.evaluation_assignments
      ADD CONSTRAINT fk_assignment_respondent_preceptor
      FOREIGN KEY (respondent_preceptor_id)
      REFERENCES public.preceptors(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.evaluation_assignments.respondent_type IS
  'Who completes this assignment: student (existing Casey-Fink self-report, default) or preceptor (preceptor-of-student feedback). student_id remains the subject in both cases.';

COMMENT ON COLUMN public.evaluation_assignments.respondent_preceptor_id IS
  'preceptors.id of the responding preceptor when respondent_type = preceptor; NULL for student rows. ON DELETE SET NULL preserves the assignment and the email/name snapshot.';

COMMENT ON COLUMN public.evaluation_assignments.respondent_email IS
  'Snapshot of the respondent email used for invitation delivery/idempotency at send time. NULL for student rows (student email resolved from the student record).';

COMMENT ON COLUMN public.evaluation_assignments.respondent_name IS
  'Snapshot of the respondent display name at send time. NULL for student rows.';

NOTIFY pgrst, 'reload schema';
