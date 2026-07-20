-- ============================================================================
-- UNIT LEADER PORTAL: read-only PREFLIGHT and VERIFICATION
-- ============================================================================
-- Run each block SEPARATELY in the Supabase SQL editor. Every query here is READ
-- ONLY. Run PREFLIGHT before applying
-- supabase/migrations/20260720000000_unit_leader_portal_foundation.sql,
-- and VERIFICATION after. No query exposes a secret or a signed token.
--
-- STOP CONDITIONS (do not apply if any of these appear):
--   - preflight 2 shows any conversation with more than one active participant
--     (the Phase 1 invariant is already broken; investigate before widening it)
--   - preflight 3 shows an existing unit_leader participant row (none should exist)
--   - preflight 4b shows weak_match_candidates > 1 for any row. The table carries
--     UNIQUE (cohort_id, school_name), so a value above 1 means that schema
--     assumption is violated. HARD STOP.
--   - preflight 5 shows a name collision that would make the new tables ambiguous
--   - preflight 6 returns any row. The new student columns already exist, which
--     means a PARTIAL APPLICATION. Investigate and reconcile before migrating.
--   - preflight 7 shows delivery event_type values outside the Phase 1 set
--
-- REVIEW, not an automatic stop:
--   - preflight 4b rows with reason 'cohort_or_school_mismatch'. Review and
--     reconcile any that affect a student you expect a Unit Leader to see: the
--     rotation link has drifted and its dates can no longer be trusted, so the
--     student will have no rotation_end_date and will never appear in a completed
--     bucket.
--
-- Preflight 4 is informational and sets the expected count for VERIFY 2.
-- ============================================================================


-- ############################################################################
-- PREFLIGHT (run BEFORE the migration)
-- ############################################################################

-- ── PREFLIGHT 1: the assignment model this build reuses ─────────────────────
-- Confirms user_unit_scopes is populated and how many Unit Leaders are live.
-- Expected: active_scopes > 0 if any Unit Leader is meant to see anything today.
-- Record these numbers: VERIFY 6 confirms the migration did not change them.
SELECT
  count(*)                                                              AS scope_rows_total,
  count(*) FILTER (WHERE revoked_at IS NULL
                     AND starts_at <= now()
                     AND (expires_at IS NULL OR expires_at > now()))     AS active_scopes,
  count(DISTINCT user_profile_id) FILTER (WHERE revoked_at IS NULL)      AS profiles_with_scopes,
  count(DISTINCT unit_key) FILTER (WHERE revoked_at IS NULL)             AS distinct_units
FROM public.user_unit_scopes;

-- ── PREFLIGHT 2: the single-active-participant invariant, before widening ───
-- Section 7a replaces the unique index that enforces this. Confirm nothing already
-- violates it, so the replacement is a widening and not a repair.
-- Expected: 0 rows.
SELECT conversation_id, count(*) AS active_participants
FROM public.conversation_participants
WHERE removed_at IS NULL
GROUP BY conversation_id
HAVING count(*) > 1
ORDER BY active_participants DESC;

-- ── PREFLIGHT 3: existing participant role distribution ─────────────────────
-- Expected: only 'student' / 'student'. Any unit_leader row already present would
-- mean an earlier partial rollout: STOP and reconcile.
SELECT participant_role, scope_kind,
       count(*) AS rows,
       count(*) FILTER (WHERE removed_at IS NULL) AS active_rows,
       count(*) FILTER (WHERE scope_student_id IS NOT NULL) AS with_student_scope,
       count(*) FILTER (WHERE scope_unit_key IS NOT NULL)   AS with_unit_scope
FROM public.conversation_participants
GROUP BY 1, 2
ORDER BY 1, 2;

-- ── PREFLIGHT 4: how many students the 90-day backfill can actually date ────
-- Informational. `backfillable` is the expected value of VERIFY 2's
-- with_rotation_end_date, so the predicate below MIRRORS THE MIGRATION EXACTLY:
--   explicit cohort_school_rotation_id resolves to a row
--   rotation_end_date IS NOT NULL
--   rotation_end_date <> '1900-01-01'   (the sentinel means "pending admin review")
--   linked cohort_id   = the student's cohort_id
--   linked school_name = the student's school
--
-- NULL SEMANTICS, deliberately matched to the migration: the migration uses plain
-- `=` for cohort and school, so if either side is NULL the comparison yields NULL
-- and the row is NOT backfilled. This query uses `=` for the same reason. Using
-- IS NOT DISTINCT FROM here would count a NULL-versus-NULL pair as backfillable and
-- would then disagree with VERIFY 2.
--
-- Students that fail any condition keep a NULL rotation_end_date and are therefore
-- never shown in a Unit Leader completed bucket. Every skip is fail closed.
SELECT
  count(*)                                                                    AS students_total,
  count(*) FILTER (WHERE s.cohort_school_rotation_id IS NOT NULL)              AS with_rotation_link,
  count(*) FILTER (WHERE r.id IS NOT NULL
                     AND r.rotation_end_date IS NOT NULL
                     AND r.rotation_end_date <> DATE '1900-01-01'
                     AND r.cohort_id   = s.cohort_id
                     AND r.school_name = s.school)                             AS backfillable,
  count(*) FILTER (WHERE r.rotation_end_date = DATE '1900-01-01')              AS sentinel_pending_admin,
  count(*) FILTER (WHERE r.id IS NOT NULL
                     AND r.rotation_end_date IS NOT NULL
                     AND r.rotation_end_date <> DATE '1900-01-01'
                     AND (r.cohort_id = s.cohort_id
                          AND r.school_name = s.school) IS NOT TRUE)           AS cohort_or_school_mismatch,
  count(*) FILTER (WHERE s.status = 'Completed')                               AS status_completed,
  count(*) FILTER (WHERE s.status = 'Completed'
                     AND (r.id IS NULL
                          OR r.rotation_end_date IS NULL
                          OR r.rotation_end_date = DATE '1900-01-01'
                          OR (r.cohort_id = s.cohort_id
                              AND r.school_name = s.school) IS NOT TRUE))      AS completed_but_undatable
FROM public.students s
LEFT JOIN public.cohort_school_rotations r ON r.id = s.cohort_school_rotation_id;
-- backfillable  MUST equal VERIFY 2's with_rotation_end_date. Record it.
-- completed_but_undatable is every completed student the migration will leave
-- without a trusted date, INCLUDING cohort or school mismatch. Those students will
-- not appear in a Unit Leader completed bucket until their rotation data is fixed.

-- ── PREFLIGHT 4b: rotation-date sources that are NOT confidently determined ──
-- Returns ONLY students the migration will skip. A row here means the student keeps
-- a NULL rotation_end_date and is therefore invisible in a Unit Leader completed
-- bucket, so every row is a fail-closed skip. Rows the migration WILL backfill are
-- excluded, so an empty result means every in-scope student got a trusted date.
--
-- The WHERE clause is the exact complement of the migration predicate, including
-- its `=` NULL semantics: `(a = b) IS NOT TRUE` is true when the comparison is
-- false OR NULL, which is precisely when the migration declines to backfill.
--
-- EXPLICIT REVIEW RESULT, not an automatic stop: a non-empty result is expected in
-- a live database. Review and reconcile any reason = 'cohort_or_school_mismatch'
-- that affects a student you expect a Unit Leader to see, because that indicates
-- the rotation link drifted and its dates can no longer be trusted.
--
-- Ambiguity is structurally impossible for the FK path: cohort_school_rotations.id
-- is the primary key, so s.cohort_school_rotation_id = r.id matches at most one row.
-- weak_match_candidates therefore reports on the WEAKER (cohort, school) match,
-- purely to confirm that path would also have been unique had it been used.
SELECT
  s.id AS student_id, s.status, s.school,
  CASE
    WHEN s.cohort_school_rotation_id IS NULL              THEN 'no_rotation_link'
    WHEN r.id IS NULL                                     THEN 'rotation_row_missing'
    WHEN r.rotation_end_date IS NULL                      THEN 'null_end_date'
    WHEN r.rotation_end_date = DATE '1900-01-01'          THEN 'sentinel_pending_admin'
    ELSE 'cohort_or_school_mismatch'
  END AS reason,
  (SELECT count(*) FROM public.cohort_school_rotations r2
    WHERE r2.cohort_id = s.cohort_id AND r2.school_name = s.school) AS weak_match_candidates
FROM public.students s
LEFT JOIN public.cohort_school_rotations r ON r.id = s.cohort_school_rotation_id
WHERE s.status IN ('Placed', 'Active Rotation', 'Completed')
  AND (
    s.cohort_school_rotation_id IS NULL
    OR r.id IS NULL
    OR r.rotation_end_date IS NULL
    OR r.rotation_end_date = DATE '1900-01-01'
    OR (r.cohort_id = s.cohort_id AND r.school_name = s.school) IS NOT TRUE
  )
ORDER BY reason, s.school;
-- HARD STOP: weak_match_candidates > 1 for any row means the (cohort, school) path
-- is ambiguous. The table carries UNIQUE (cohort_id, school_name), so this must be
-- 0 or 1 everywhere. Any value above 1 means that schema assumption is violated.

-- ── PREFLIGHT 5: name collisions for the new tables ─────────────────────────
-- Expected: 0 rows. Any row means an object of that name already exists.
SELECT c.relname AS existing_object, c.relkind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'unit_placement_requests', 'unit_placement_request_events',
    'unit_capacity_submissions', 'unit_student_milestones',
    'unit_preceptor_nominations', 'unit_leader_notification_prefs')
ORDER BY c.relname;

-- ── PREFLIGHT 6: does students already have the new columns? ────────────────
-- Expected: 0 rows (the migration adds them). Non-zero means a partial apply.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'students'
  AND column_name IN ('rotation_end_date', 'rotation_completed_at')
ORDER BY column_name;

-- ── PREFLIGHT 7: current delivery event types in use ────────────────────────
-- Section 7d widens the CHECK. Confirm every existing value is inside the Phase 1
-- set, so the widening only adds. Expected: only new_conversation, portal_reply,
-- staff_reply.
SELECT event_type, count(*) AS rows
FROM public.message_notification_deliveries
GROUP BY 1
ORDER BY 1;

-- ── PREFLIGHT 8: the unit-key join this build depends on ────────────────────
-- The corrected roster scopes students by matched_unit_id -> units.unit_name.
-- This shows how many placed students each scoped unit key will actually resolve,
-- and confirms the defect: students.unit is empty for effectively everyone.
-- Expected: students_via_matched_unit > 0, students_via_legacy_unit_column = 0.
SELECT
  count(*) FILTER (WHERE s.matched_unit_id IS NOT NULL)                        AS students_via_matched_unit,
  count(*) FILTER (WHERE COALESCE(btrim(s.unit), '') <> '')                    AS students_via_legacy_unit_column,
  count(DISTINCT u.unit_name) FILTER (WHERE s.matched_unit_id IS NOT NULL)     AS distinct_matched_unit_names
FROM public.students s
LEFT JOIN public.units u ON u.id = s.matched_unit_id;

-- ── PREFLIGHT 9: scoped unit keys that resolve to no real unit ──────────────
-- user_unit_scopes.unit_key is free text validated only against the JS catalog.
-- Any key here that matches no units.unit_name will silently show an empty roster.
-- Expected: 0 rows. Non-zero is a data-quality item, not a blocker.
SELECT DISTINCT s.unit_key
FROM public.user_unit_scopes s
WHERE s.revoked_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.units u WHERE u.unit_name = s.unit_key)
ORDER BY s.unit_key;


-- ############################################################################
-- VERIFICATION (run AFTER the migration)
-- ############################################################################

-- ── VERIFY 1: all six new tables exist, RLS on, no client write policy ──────
-- PASS: 6 rows, every one rls_enabled = true, write_policies = 0, and
-- select_policies = 1 (the active Owner/Admin oversight policy).
SELECT
  c.relname                                                    AS table_name,
  c.relrowsecurity                                             AS rls_enabled,
  (SELECT count(*) FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = c.relname
      AND p.cmd = 'SELECT')                                    AS select_policies,
  (SELECT count(*) FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = c.relname
      AND p.cmd <> 'SELECT')                                   AS write_policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'unit_placement_requests', 'unit_placement_request_events',
    'unit_capacity_submissions', 'unit_student_milestones',
    'unit_preceptor_nominations', 'unit_leader_notification_prefs')
ORDER BY c.relname;

-- ── VERIFY 1b: anon and authenticated hold no write privilege on the new tables ──
-- PASS: 0 rows. authenticated may hold SELECT only; anon nothing at all.
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'unit_placement_requests', 'unit_placement_request_events',
    'unit_capacity_submissions', 'unit_student_milestones',
    'unit_preceptor_nominations', 'unit_leader_notification_prefs')
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
  AND privilege_type <> 'SELECT'
ORDER BY table_name, grantee;

-- ── VERIFY 2: the 90-day backfill dated exactly the backfillable students ───
-- PASS: with_rotation_end_date equals PREFLIGHT 4's backfillable, and
-- sentinel_dated = 0 (the sentinel was never copied).
SELECT
  count(*) FILTER (WHERE s.rotation_end_date IS NOT NULL)                      AS with_rotation_end_date,
  count(*) FILTER (WHERE s.rotation_end_date = DATE '1900-01-01')              AS sentinel_dated,
  count(*) FILTER (WHERE s.rotation_completed_at IS NOT NULL)                  AS with_completed_at
FROM public.students s;

-- ── VERIFY 3: the participant index was widened, not removed ───────────────
-- PASS: exactly one row, indexdef contains BOTH conversation_id and
-- participant_profile_id, and still carries the removed_at IS NULL predicate.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'conversation_participants'
  AND indexname = 'uq_conversation_participants_active';

-- ── VERIFY 4: the two-participant cap trigger is installed ─────────────────
-- PASS: one row, tgenabled = 'O' (enabled).
SELECT t.tgname, t.tgenabled, p.proname AS function_name
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.conversation_participants'::regclass
  AND NOT t.tgisinternal
ORDER BY t.tgname;

-- ── VERIFY 5: the role/scope CHECK admits a unit_leader with a student ─────
-- PASS: the unit_leader branch no longer contains "scope_student_id IS NULL",
-- and the student / preceptor / academic_partner branches are unchanged.
SELECT pg_get_constraintdef(oid) AS chk_participant_role_scope
FROM pg_constraint
WHERE conrelid = 'public.conversation_participants'::regclass
  AND conname = 'chk_participant_role_scope';

-- ── VERIFY 5b: delivery event types were widened, not replaced ─────────────
-- PASS: the definition contains all five values.
SELECT pg_get_constraintdef(oid) AS chk_mnd_event_type
FROM pg_constraint
WHERE conrelid = 'public.message_notification_deliveries'::regclass
  AND conname = 'chk_mnd_event_type';

-- ── VERIFY 6: the authorization model was NOT modified ────────────────────
-- PASS: identical to PREFLIGHT 1. This migration reuses user_unit_scopes and must
-- never have written to it.
SELECT
  count(*)                                                              AS scope_rows_total,
  count(*) FILTER (WHERE revoked_at IS NULL
                     AND starts_at <= now()
                     AND (expires_at IS NULL OR expires_at > now()))     AS active_scopes,
  count(DISTINCT user_profile_id) FILTER (WHERE revoked_at IS NULL)      AS profiles_with_scopes,
  count(DISTINCT unit_key) FILTER (WHERE revoked_at IS NULL)             AS distinct_units
FROM public.user_unit_scopes;

-- ── VERIFY 7: the three replaced functions still exist with grants intact ──
-- PASS: 3 rows, each security_definer = true. CREATE OR REPLACE preserves grants;
-- this confirms none was accidentally dropped and recreated.
SELECT p.proname,
       p.prosecdef                       AS security_definer,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'my_message_conversation_ids',
    'message_recipient_has_active_access',
    'messages_portal_unread_count')
ORDER BY p.proname;

-- ── VERIFY 7b: the unread count no longer keys on author_role = 'staff' ────
-- PASS: the body contains "author_profile_id <> public.portal_profile_id()" and
-- does NOT contain "author_role = 'staff'".
SELECT
  (prosrc LIKE '%author_profile_id <> public.portal_profile_id()%') AS counts_others_messages,
  (prosrc LIKE '%author_role = ''staff''%')                          AS still_staff_only
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_portal_unread_count';

-- ── VERIFY 7c: read and send are SEPARATE predicates ──────────────────────
-- PASS: 3 rows. can_read must NOT mention user_unit_scopes (that is what preserves
-- history after an assignment ends); can_send MUST mention it (that is what freezes
-- the thread); message_profile_is_active must check is_active.
SELECT
  p.proname,
  (p.prosrc LIKE '%user_unit_scopes%')            AS requires_active_unit_scope,
  (p.prosrc LIKE '%message_profile_is_active%')   AS checks_account_active
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('message_profile_is_active',
                    'message_participant_can_read',
                    'message_participant_can_send')
ORDER BY p.proname;
-- Expected exactly:
--   message_profile_is_active      requires_active_unit_scope = false
--   message_participant_can_read   requires_active_unit_scope = FALSE, checks_account_active = true
--   message_participant_can_send   requires_active_unit_scope = TRUE
-- STOP if can_read reports requires_active_unit_scope = true: history would be lost
-- on revocation. STOP if can_send reports false: a former Unit Leader could still send.

-- ── VERIFY 7d: the reply RPC gates portal actors on SEND, staff on READ ────
-- PASS: gates_portal_on_send = true and gates_staff_target_on_read = true.
SELECT
  (prosrc LIKE '%message_participant_can_send(p_conversation_id, p_actor_profile_id)%') AS gates_portal_on_send,
  (prosrc LIKE '%message_participant_can_read(p_conversation_id, v_participant)%')      AS gates_staff_target_on_read
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_post_reply';

-- ── VERIFY 7e: exactly ONE messages_start_conversation, with grants ────────
-- PASS: one row, 9 arguments ending in "jsonb, text", and service_role holds
-- EXECUTE. The 8-argument form must be gone, otherwise every existing call fails
-- with "function is not unique".
SELECT
  pg_get_function_identity_arguments(p.oid) AS args,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_start_conversation';
-- STOP if more than one row is returned, or if authenticated_can_execute is true.

-- ── VERIFY 8: Wave F-2 privacy is untouched ───────────────────────────────
-- PASS: bucket_public = false, student_files_policies = 0, canonical_paths = 57,
-- remaining_http_values = 0. This migration must not have moved any of them.
SELECT
  (SELECT public FROM storage.buckets WHERE id = 'student-files')                       AS bucket_public,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (COALESCE(qual,'') LIKE '%student-files%'
         OR COALESCE(with_check,'') LIKE '%student-files%'))                            AS student_files_policies,
  (SELECT count(*) FROM public.students
     WHERE resume_url   LIKE '%/object/public/student-files/%'
        OR headshot_url LIKE '%/object/public/student-files/%')                          AS public_urls_remaining;

-- ── VERIFY 9: no existing conversation was altered ────────────────────────
-- PASS: matches the pre-migration counts. This migration changes structure, never
-- message or conversation data.
SELECT
  (SELECT count(*) FROM public.conversations)              AS conversations,
  (SELECT count(*) FROM public.messages)                   AS messages,
  (SELECT count(*) FROM public.conversation_participants)  AS participants;
