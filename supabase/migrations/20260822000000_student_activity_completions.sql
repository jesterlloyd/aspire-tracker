-- =============================================================================
-- POST-ROTATION-SEQUENCED-RELEASE-1
-- Append-only ledger of required ASPIRE program activity completions.
--
-- *** APPLY MANUALLY (Owner/Jester). Claude Code has applied NOTHING. ***
--
-- WHY THIS TABLE HAS TO EXIST. The ASPIRE Post-Rotation Evaluation must not be
-- released until the student has completed the required program activities
-- (Town Hall, Interview Bootcamp, Resume Review). A full audit found NO
-- student-level evidence for any of them:
--
--   * aspire_events carries cohort_id and NO student_id. 'town_hall' is a
--     CALENDAR TYPE there, so the table records that an event was scheduled -
--     never who attended it.
--   * 'interview_bootcamp' and 'resume_review' have no representation anywhere
--     in the repository.
--   * students.resume_url / resume_on_file record that a FILE exists. A file is
--     not a review.
--   * The only "attendance" in the codebase is shift-derived clinical hours.
--
-- WHY APPEND-ONLY (revised). Staff need to correct an entry recorded in error.
-- A mutable row would let a correction overwrite the original actor and date,
-- destroying the audit trail - so this is an EVENT ledger instead: every action
-- is a new row, nothing is ever updated or deleted, and the effective state of
-- an activity is simply its most recent event.
--
--   action = 'complete' -> the student completed it (completed_at required)
--   action = 'reverse'  -> a previous completion was recorded in error
--                          (reason required, completed_at must be NULL)
--
-- So a mistake is corrected by APPENDING a reversal, and the original row - with
-- its original actor and timestamp - stays exactly as it was written. Recording
-- a completion again after a reversal is allowed and simply appends again.
--
-- IDEMPOTENCY. Two identical 'complete' events produce the SAME effective state,
-- so a repeated action is idempotent in effect. The endpoint additionally reads
-- the current state first and no-ops rather than appending a redundant row.
--
-- DELIBERATELY SMALL. This answers exactly one question. Evaluation completion
-- continues to come from evaluation_assignments (completed_at / status), never
-- from here, and nothing in this table can release or send anything.
--
-- cohort_id is intentionally ABSENT. It would duplicate students.cohort_id and
-- could drift; every consumer resolves the cohort through the student, and the
-- management endpoint verifies cohort membership server-side on every write.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS student_activity_completions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  student_id       uuid        NOT NULL REFERENCES students(id) ON DELETE CASCADE,

  -- Allowlisted so a typo can never create a fourth "required" activity that the
  -- release gate then waits on forever.
  activity_key     text        NOT NULL,

  -- What this row records. There is no UPDATE path: correction is a new row.
  action           text        NOT NULL DEFAULT 'complete',

  -- When the student completed it. Required for 'complete', absent for 'reverse'.
  completed_at     timestamptz,

  -- Why a completion was reversed. Required for 'reverse' so a correction can
  -- never be silent.
  reason           text,

  source           text        NOT NULL DEFAULT 'staff_confirmed',

  -- Who recorded it. SET NULL so removing a staff account never destroys the
  -- record; the display name below preserves the attribution regardless.
  recorded_by      uuid        REFERENCES user_profiles(id) ON DELETE SET NULL,
  recorded_by_name text,

  notes            text,

  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_sac_activity_key CHECK (activity_key IN (
    'town_hall',
    'interview_bootcamp',
    'resume_review'
  )),

  CONSTRAINT chk_sac_action CHECK (action IN ('complete', 'reverse')),

  CONSTRAINT chk_sac_source CHECK (source IN (
    'staff_confirmed',
    'import',
    'correction'
  )),

  -- The shape rule: a completion carries a date and no reason; a reversal
  -- carries a reason and no date. Neither can masquerade as the other.
  CONSTRAINT chk_sac_action_shape CHECK (
    (action = 'complete' AND completed_at IS NOT NULL AND reason IS NULL)
    OR
    (action = 'reverse'  AND completed_at IS NULL     AND reason IS NOT NULL)
  )
);

-- Effective state is "most recent event per (student, activity)", so reads are
-- always ordered by this pair plus time.
CREATE INDEX IF NOT EXISTS idx_sac_student_activity_time
  ON student_activity_completions (student_id, activity_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sac_student ON student_activity_completions (student_id);

-- ── Append-only enforcement ──────────────────────────────────────────────────
-- The ledger is written by a service-role endpoint. Removing UPDATE and DELETE
-- from that role makes "append-only" a property of the database, not a promise
-- in application code: no endpoint, however written, can rewrite history.
REVOKE UPDATE, DELETE ON student_activity_completions FROM service_role;
REVOKE UPDATE, DELETE ON student_activity_completions FROM authenticated;
REVOKE UPDATE, DELETE ON student_activity_completions FROM anon;

ALTER TABLE student_activity_completions ENABLE ROW LEVEL SECURITY;

-- Owner/Admin read, so the Review & Release panels can show the checklist and
-- its history through the existing RLS SELECT path. All WRITES go through the
-- service-role endpoint, which verifies Owner/Admin and cohort membership; no
-- policy grants the authenticated role INSERT.
DROP POLICY IF EXISTS "sac_owner_admin_read" ON student_activity_completions;
CREATE POLICY "sac_owner_admin_read"
  ON student_activity_completions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Verification (ONE row; run after applying) ───────────────────────────────
-- SELECT
--   (SELECT count(*) FROM information_schema.tables
--     WHERE table_name = 'student_activity_completions')                  AS table_created,
--   (SELECT relrowsecurity FROM pg_class
--     WHERE relname = 'student_activity_completions')                     AS rls_enabled,
--   (SELECT count(*) FROM pg_policies
--     WHERE tablename = 'student_activity_completions')                   AS policy_count,
--   (SELECT count(*) FROM information_schema.check_constraints
--     WHERE constraint_name LIKE 'chk_sac_%')                             AS check_constraints,
--   (SELECT has_table_privilege('service_role','student_activity_completions','INSERT'))  AS svc_can_insert,
--   (SELECT has_table_privilege('service_role','student_activity_completions','UPDATE'))  AS svc_can_update,
--   (SELECT has_table_privilege('service_role','student_activity_completions','DELETE'))  AS svc_can_delete,
--   (SELECT count(*) FROM student_activity_completions)                   AS existing_rows;
-- Expected: table_created=1, rls_enabled=true, policy_count=1,
--           check_constraints=4, svc_can_insert=true,
--           svc_can_update=false, svc_can_delete=false, existing_rows=0.

-- ── Rollback ─────────────────────────────────────────────────────────────────
-- BEGIN;
--   DROP TABLE IF EXISTS student_activity_completions;
-- COMMIT;
