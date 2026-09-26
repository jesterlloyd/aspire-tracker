-- Checks for supabase/migrations/20261008000000_s28_s29_constraints_and_activity_logs.sql
-- READ ONLY except POST 5, a DO block that ENDS WITH RAISE EXCEPTION on purpose, so
-- everything it did is rolled back and its report is the error message. No names or
-- emails are selected; only catalog facts, counts and ids.
--
-- Run each numbered section on its own in the Supabase SQL editor, in this order:
--   PRE 1 to 5, then the migration as ONE block, then POST 1 to 5.
-- STOP before the migration unless PRE 2 and PRE 3 both return NO rows and S28-2 (the
-- commit that ships this file) is live in production.

-- ── PRE 1: the prerequisites exist ────────────────────────────────────────────
-- Expect 1 row, every column true. append_only_refuse comes from 20261006000000
-- (applied 2026-09-25); the student-side index from 20260822020000.
SELECT to_regclass('public.evaluation_assignment_tokens') IS NOT NULL AS tokens_table,
       to_regclass('public.interview_sessions')          IS NOT NULL AS sessions_table,
       to_regclass('public.activity_logs')               IS NOT NULL AS activity_logs_table,
       to_regprocedure('public.append_only_refuse()')    IS NOT NULL AS append_only_refuse,
       to_regclass('public.uq_interview_slots_one_booking_per_student') IS NOT NULL AS student_side_index,
       to_regclass('public.uq_eval_tokens_one_active')            IS NULL AS s29_index_absent,
       to_regclass('public.uq_interview_sessions_one_per_slot')   IS NULL AS s28_index_absent;

-- ── PRE 2: S-29 violations today ──────────────────────────────────────────────
-- Expect: no rows. A row is an assignment holding more than one active token (not
-- revoked, not used). STOP if any: paste the rows and the extras will be revoked by
-- id in a separate, Owner-gated statement before this file is applied.
SELECT assignment_id, count(*) AS active_tokens,
       string_agg(id::text, ', ' ORDER BY id) AS token_ids
FROM public.evaluation_assignment_tokens
WHERE revoked_at IS NULL AND used_at IS NULL
GROUP BY assignment_id
HAVING count(*) > 1
ORDER BY active_tokens DESC;

-- ── PRE 3: S-28 violations today ──────────────────────────────────────────────
-- Expect: no rows. A row is a slot that more than one session points at, which is
-- exactly the stale pointer cancel_booking used to leave behind (S28-2 fixes the
-- cause). STOP if any: paste the rows; the stale session(s) get slot_id cleared in a
-- separate, Owner-gated statement before this file is applied.
SELECT s.slot_id, count(*) AS sessions,
       string_agg(s.id::text || CASE WHEN sl.booked_by_student_id = s.student_id THEN ' (current booking)' ELSE ' (stale)' END, ', ' ORDER BY s.id) AS session_ids
FROM public.interview_sessions s
LEFT JOIN public.interview_slots sl ON sl.id = s.slot_id
WHERE s.slot_id IS NOT NULL
GROUP BY s.slot_id
HAVING count(*) > 1
ORDER BY sessions DESC;

-- ── PRE 4: activity_logs today ────────────────────────────────────────────────
-- Expect 1 row: trigger_names NULL, svc_update true, svc_delete true, svc_truncate
-- true (what this file removes), auth_update false, rows a positive count.
SELECT (SELECT string_agg(t.tgname, ', ' ORDER BY t.tgname) FROM pg_trigger t
         WHERE t.tgrelid = 'public.activity_logs'::regclass AND NOT t.tgisinternal) AS trigger_names,
       has_table_privilege('service_role',  'public.activity_logs', 'UPDATE')   AS svc_update,
       has_table_privilege('service_role',  'public.activity_logs', 'DELETE')   AS svc_delete,
       has_table_privilege('service_role',  'public.activity_logs', 'TRUNCATE') AS svc_truncate,
       has_table_privilege('service_role',  'public.activity_logs', 'INSERT')   AS svc_insert,
       has_table_privilege('authenticated', 'public.activity_logs', 'UPDATE')   AS auth_update,
       has_table_privilege('authenticated', 'public.activity_logs', 'INSERT')   AS auth_insert,
       (SELECT count(*) FROM public.activity_logs) AS rows;

-- ── PRE 5: the populations the indexes will cover ─────────────────────────────
-- Expect 1 row of counts; informational, for the record beside POST 1.
SELECT (SELECT count(*) FROM public.evaluation_assignment_tokens) AS tokens_total,
       (SELECT count(*) FROM public.evaluation_assignment_tokens WHERE revoked_at IS NULL AND used_at IS NULL) AS tokens_active,
       (SELECT count(DISTINCT assignment_id) FROM public.evaluation_assignment_tokens WHERE revoked_at IS NULL AND used_at IS NULL) AS assignments_with_active,
       (SELECT count(*) FROM public.interview_sessions) AS sessions_total,
       (SELECT count(*) FROM public.interview_sessions WHERE slot_id IS NOT NULL) AS sessions_with_slot,
       (SELECT count(DISTINCT slot_id) FROM public.interview_sessions WHERE slot_id IS NOT NULL) AS distinct_slots;

-- ═════════════════════════════════════════════════════════════════════════════
-- APPLY supabase/migrations/20261008000000_s28_s29_constraints_and_activity_logs.sql
-- as ONE block, only after S28-2 is live. Expected: "Success. No rows returned."
-- If it raises "S-29: more than one active token" or "S-28: more than one session",
-- nothing was applied: go back to PRE 2 or PRE 3.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── POST 1: both indexes exist, unique, partial, on the right predicate ───────
-- Expect 2 rows: uq_eval_tokens_one_active (evaluation_assignment_tokens, unique true,
-- definition containing "WHERE ((revoked_at IS NULL) AND (used_at IS NULL))") and
-- uq_interview_sessions_one_per_slot (interview_sessions, unique true, definition
-- containing "WHERE (slot_id IS NOT NULL)").
SELECT i.indexname, i.tablename, x.indisunique AS unique_index, i.indexdef
FROM pg_indexes i
JOIN pg_class c ON c.relname = i.indexname
JOIN pg_index x ON x.indexrelid = c.oid
WHERE i.schemaname = 'public'
  AND i.indexname IN ('uq_eval_tokens_one_active', 'uq_interview_sessions_one_per_slot')
ORDER BY i.indexname;

-- ── POST 2: S-29 still holds ──────────────────────────────────────────────────
-- Expect: no rows (same query as PRE 2; the index now guarantees it).
SELECT assignment_id, count(*) AS active_tokens
FROM public.evaluation_assignment_tokens
WHERE revoked_at IS NULL AND used_at IS NULL
GROUP BY assignment_id HAVING count(*) > 1;

-- ── POST 3: S-28 still holds ──────────────────────────────────────────────────
-- Expect: no rows (same query as PRE 3).
SELECT slot_id, count(*) AS sessions
FROM public.interview_sessions
WHERE slot_id IS NOT NULL
GROUP BY slot_id HAVING count(*) > 1;

-- ── POST 4: activity_logs carries both triggers and no role may rewrite it ────
-- Expect 1 row: trigger_names "trg_activity_logs_append_only, trg_activity_logs_no_truncate",
-- svc_update false, svc_delete false, svc_truncate false, svc_insert true (unchanged),
-- auth_insert unchanged from PRE 4, rows equal to PRE 4.
SELECT (SELECT string_agg(t.tgname, ', ' ORDER BY t.tgname) FROM pg_trigger t
         WHERE t.tgrelid = 'public.activity_logs'::regclass AND NOT t.tgisinternal) AS trigger_names,
       has_table_privilege('service_role',  'public.activity_logs', 'UPDATE')   AS svc_update,
       has_table_privilege('service_role',  'public.activity_logs', 'DELETE')   AS svc_delete,
       has_table_privilege('service_role',  'public.activity_logs', 'TRUNCATE') AS svc_truncate,
       has_table_privilege('service_role',  'public.activity_logs', 'INSERT')   AS svc_insert,
       has_table_privilege('authenticated', 'public.activity_logs', 'UPDATE')   AS auth_update,
       has_table_privilege('authenticated', 'public.activity_logs', 'INSERT')   AS auth_insert,
       (SELECT count(*) FROM public.activity_logs) AS rows;

-- ── POST 5: the three rules refuse a violation on the live tables ─────────────
-- Tries, in a block that rolls itself back: a second active token on an assignment
-- that has one; a second session on a slot that has one; an UPDATE, DELETE and
-- TRUNCATE of activity_logs. Each must be refused. Legs whose fixture is absent (no
-- active token, no booked session, no activity row) report skipped.
-- Expect the message to begin "S-28/S-29 POST 5 PASS" and read
--   token_dup=refused slot_dup=refused log_update=refused log_delete=refused log_truncate=refused
-- (or skipped where noted). STOP on "FAIL".
DO $post5$
DECLARE
  a_id uuid; s_id uuid; st_id uuid; c_id uuid;
  r_tok text; r_slot text; r_upd text; r_del text; r_trunc text;
  failed boolean := false;
BEGIN
  SELECT assignment_id INTO a_id FROM public.evaluation_assignment_tokens
   WHERE revoked_at IS NULL AND used_at IS NULL ORDER BY id LIMIT 1;
  IF a_id IS NULL THEN r_tok := 'skipped';
  ELSE
    BEGIN
      INSERT INTO public.evaluation_assignment_tokens (assignment_id, token_hash, token_hash_prefix, expires_at)
        VALUES (a_id, md5(random()::text || clock_timestamp()::text), 'post5', now() + interval '1 day');
      r_tok := 'WENT THROUGH'; failed := true;
    EXCEPTION WHEN unique_violation THEN r_tok := 'refused';
             WHEN OTHERS THEN r_tok := 'error ' || SQLSTATE; failed := true;
    END;
  END IF;

  SELECT slot_id, student_id INTO s_id, st_id FROM public.interview_sessions
   WHERE slot_id IS NOT NULL ORDER BY id LIMIT 1;
  IF s_id IS NULL THEN r_slot := 'skipped';
  ELSE
    BEGIN
      INSERT INTO public.interview_sessions (student_id, slot_id, session_number) VALUES (st_id, s_id, 99);
      r_slot := 'WENT THROUGH'; failed := true;
    EXCEPTION WHEN unique_violation THEN r_slot := 'refused';
             WHEN OTHERS THEN r_slot := 'error ' || SQLSTATE; failed := true;
    END;
  END IF;

  IF (SELECT count(*) FROM public.activity_logs) = 0 THEN r_upd := 'skipped'; r_del := 'skipped';
  ELSE
    BEGIN
      UPDATE public.activity_logs SET id = id WHERE ctid = (SELECT ctid FROM public.activity_logs LIMIT 1);
      r_upd := 'WENT THROUGH'; failed := true;
    EXCEPTION WHEN insufficient_privilege THEN r_upd := 'refused';
             WHEN OTHERS THEN r_upd := 'error ' || SQLSTATE; failed := true;
    END;
    BEGIN
      DELETE FROM public.activity_logs WHERE ctid = (SELECT ctid FROM public.activity_logs LIMIT 1);
      r_del := 'WENT THROUGH'; failed := true;
    EXCEPTION WHEN insufficient_privilege THEN r_del := 'refused';
             WHEN OTHERS THEN r_del := 'error ' || SQLSTATE; failed := true;
    END;
  END IF;
  BEGIN
    TRUNCATE public.activity_logs;
    r_trunc := 'WENT THROUGH'; failed := true;
  EXCEPTION WHEN insufficient_privilege THEN r_trunc := 'refused';
           WHEN OTHERS THEN r_trunc := 'error ' || SQLSTATE; failed := true;
  END;

  RAISE EXCEPTION 'S-28/S-29 POST 5 % (rolled back on purpose): token_dup=% slot_dup=% log_update=% log_delete=% log_truncate=%',
    CASE WHEN failed THEN 'FAIL' ELSE 'PASS' END, r_tok, r_slot, r_upd, r_del, r_trunc;
END
$post5$;
