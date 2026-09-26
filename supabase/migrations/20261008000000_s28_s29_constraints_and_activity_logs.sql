-- supabase/migrations/20261008000000_s28_s29_constraints_and_activity_logs.sql
--
-- Three database rules the code has kept by convention, now kept by the database
-- (FINDINGS_REGISTER S-29, S-28 and the activity_logs follow-up from S-23).
--
-- 1. S-29, one active token per evaluation assignment. "Active" is what every reader
--    means by it: not revoked and not used (revoked_at IS NULL AND used_at IS NULL; the
--    time-based expires_at cannot be in an index predicate). Every issuing path already
--    revokes or reuses the assignment's other tokens before it writes a new one
--    (api/evaluation-create-invitation.js, lib/server/evaluation/assignmentReissue.js, the
--    two release endpoints), so the partial unique index uq_eval_tokens_one_active only
--    forbids what no path does on purpose.
--
-- 2. S-28, one booking per interview slot. A booking is an interview_sessions row with a
--    slot_id (api/interview-book.js writes it; move_booking carries it to the new slot).
--    The student side is already unique (uq_interview_slots_one_booking_per_student,
--    20260822020000); this is the slot side: uq_interview_sessions_one_per_slot, a partial
--    unique index on interview_sessions(slot_id) WHERE slot_id IS NOT NULL.
--    READ BEFORE APPLYING. Until S28-2 (the same commit as this file), cancel_booking kept
--    a rubric-bearing session pointing at the slot it released, so a later booking of that
--    slot by another student would have been refused by this index. S28-2 clears slot_id
--    on the kept session. Apply this file only after S28-2 is live; PRE 3 lists any slot
--    two sessions already share, and the guard below refuses to run while one exists.
--
-- 3. activity_logs, append-only by trigger. The S-23 template pair through
--    public.append_only_refuse() (20261006000000, applied 2026-09-25), plus the revoke of
--    UPDATE, DELETE and TRUNCATE that S-23 gave the other ledgers. Every writer inserts:
--    fourteen server files, src/lib/logActivity.js, and the KT and Keith governance RPCs.
--    PRE 4 of the S-23 checks showed only SET NULL foreign keys, so no cascade is affected.
--
-- Each constraint is preceded by a guard that names the violating rows (ids only) and
-- refuses the whole file, so nothing is applied on top of bad data. Owner-gated. Apply as
-- ONE block. Checks, one section at a time, are in
-- db/audit/s28_s29_constraints_and_activity_logs_checks.sql: PRE 1 to 5, then this file,
-- then POST 1 to 5. Rollback (inert until run) at the end.

BEGIN;

DO $guard$
DECLARE
  bad text;
BEGIN
  IF to_regclass('public.evaluation_assignment_tokens') IS NULL
     OR to_regclass('public.interview_sessions') IS NULL
     OR to_regclass('public.activity_logs') IS NULL THEN
    RAISE EXCEPTION 'S-28/S-29: a covered table is missing; nothing was applied';
  END IF;
  IF to_regprocedure('public.append_only_refuse()') IS NULL THEN
    RAISE EXCEPTION 'S-23 template missing: public.append_only_refuse() must exist (apply 20261006000000 first); nothing was applied';
  END IF;

  -- S-29 guard: assignments holding more than one active token.
  SELECT string_agg(assignment_id::text || ' (' || n || ' active)', ', ')
    INTO bad
    FROM (SELECT assignment_id, count(*) AS n
            FROM public.evaluation_assignment_tokens
           WHERE revoked_at IS NULL AND used_at IS NULL
           GROUP BY assignment_id HAVING count(*) > 1) v;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'S-29: more than one active token on assignment(s) %; revoke the extras (revoked_at = now()) before applying; nothing was applied', bad;
  END IF;

  -- S-28 guard: slots shared by more than one session.
  SELECT string_agg(slot_id::text || ' (' || n || ' sessions)', ', ')
    INTO bad
    FROM (SELECT slot_id, count(*) AS n
            FROM public.interview_sessions
           WHERE slot_id IS NOT NULL
           GROUP BY slot_id HAVING count(*) > 1) v;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'S-28: more than one session on slot(s) %; clear slot_id on the stale session(s) before applying; nothing was applied', bad;
  END IF;
END
$guard$;

-- S-29
CREATE UNIQUE INDEX IF NOT EXISTS uq_eval_tokens_one_active
  ON public.evaluation_assignment_tokens (assignment_id)
  WHERE revoked_at IS NULL AND used_at IS NULL;
COMMENT ON INDEX public.uq_eval_tokens_one_active IS
  'S-29: at most one active (not revoked, not used) token per evaluation assignment.';

-- S-28
CREATE UNIQUE INDEX IF NOT EXISTS uq_interview_sessions_one_per_slot
  ON public.interview_sessions (slot_id)
  WHERE slot_id IS NOT NULL;
COMMENT ON INDEX public.uq_interview_sessions_one_per_slot IS
  'S-28: one interview session per booked slot; the student side is uq_interview_slots_one_booking_per_student.';

-- activity_logs
DROP TRIGGER IF EXISTS trg_activity_logs_append_only ON public.activity_logs;
CREATE TRIGGER trg_activity_logs_append_only BEFORE UPDATE OR DELETE ON public.activity_logs
  FOR EACH ROW EXECUTE FUNCTION public.append_only_refuse();
DROP TRIGGER IF EXISTS trg_activity_logs_no_truncate ON public.activity_logs;
CREATE TRIGGER trg_activity_logs_no_truncate BEFORE TRUNCATE ON public.activity_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.append_only_refuse();
REVOKE UPDATE, DELETE, TRUNCATE ON public.activity_logs FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback (Owner-gated, one block; inert until run). Removes the two indexes and the
-- two triggers and returns UPDATE, DELETE and TRUNCATE on activity_logs to service_role
-- (the only role that held them before this file).
--
--   BEGIN;
--   DROP INDEX IF EXISTS public.uq_eval_tokens_one_active;
--   DROP INDEX IF EXISTS public.uq_interview_sessions_one_per_slot;
--   DROP TRIGGER IF EXISTS trg_activity_logs_append_only ON public.activity_logs;
--   DROP TRIGGER IF EXISTS trg_activity_logs_no_truncate ON public.activity_logs;
--   GRANT UPDATE, DELETE, TRUNCATE ON public.activity_logs TO service_role;
--   COMMIT;
-- ─────────────────────────────────────────────────────────────────────────────
