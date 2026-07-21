-- ============================================================================
-- UNIT LEADER: transactional integrity follow-up, PREFLIGHT and VERIFICATION
-- ============================================================================
-- Run each block SEPARATELY in the Supabase SQL editor. Every query is READ ONLY.
-- PREFLIGHT before applying
-- supabase/migrations/20260720000001_unit_leader_transactional_integrity.sql,
-- VERIFICATION after. No query exposes a secret or a signed token.
--
-- Every introspection predicate below matches EXECUTABLE syntax (a FROM clause, a
-- call site, a projected key), never a bare identifier. A plain substring test on
-- prosrc also matches the explanatory comments inside these functions, which is how
-- the earlier VERIFY 7c produced a false positive.
--
-- STOP CONDITIONS:
--   - preflight 1 shows the foundation migration was not applied
--   - preflight 2 shows either new function name already exists
--   - preflight 3 shows either audit column already exists
--   - preflight 5 shows a capacity row already superseded AND reviewed, which
--     would mean the pre-RPC compensating-delete path left inconsistent history
--   - VERIFY 4b shows authenticated_can_execute = false on the thread RPC. That
--     grant is intentional and load bearing; losing it breaks the Student Portal.
-- ============================================================================


-- ############################################################################
-- PREFLIGHT (run BEFORE the migration)
-- ############################################################################

-- ── PREFLIGHT 1: the foundation this builds on is present ───────────────────
-- Expected: 6 rows for the tables, and 3 rows for the read/send split functions.
-- STOP if anything is missing: apply 20260720000000 first.
SELECT 'table' AS kind, c.relname AS name
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN (
  'unit_placement_requests', 'unit_placement_request_events',
  'unit_capacity_submissions', 'unit_student_milestones',
  'unit_preceptor_nominations', 'unit_leader_notification_prefs')
UNION ALL
SELECT 'function', p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN (
  'message_profile_is_active', 'message_participant_can_read', 'message_participant_can_send')
ORDER BY kind, name;

-- ── PREFLIGHT 2: the new RPC names are free ─────────────────────────────────
-- Expected: 0 rows. Any row means a partial or repeated application.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('unit_placement_respond', 'unit_capacity_submit')
ORDER BY p.proname;

-- ── PREFLIGHT 3: the audit columns do not exist yet ─────────────────────────
-- Expected: 0 rows. Non-zero means a partial application.
SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'unit_student_milestones'     AND column_name = 'confirmed_by_role')
    OR (table_name = 'unit_preceptor_nominations' AND column_name = 'nominated_by_role')
  )
ORDER BY table_name;

-- ── PREFLIGHT 4: the author projection is still the old binary ──────────────
-- Expected: is_binary_projection = true, is_three_way = false. This is the state
-- the migration replaces. Run alone.
SELECT
  (p.prosrc ~* 'CASE WHEN p\.author_role = ''staff'' THEN ''staff'' ELSE ''me'' END') AS is_binary_projection,
  (p.prosrc ~* 'p\.author_profile_id = public\.portal_profile_id\(\)')                AS is_three_way
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_portal_get_thread_v2';

-- ── PREFLIGHT 5: capacity history is consistent before the RPC takes over ───
-- The pre-RPC path inserted then superseded with a compensating delete. This shows
-- any row that is BOTH superseded and reviewed, which that path could not produce
-- cleanly. Expected: 0 rows. Also reports live duplicates, which uq_ucs_live should
-- already make impossible. Run alone.
SELECT
  count(*) FILTER (WHERE superseded_at IS NOT NULL AND review_status <> 'submitted') AS superseded_and_reviewed,
  count(*) FILTER (WHERE superseded_at IS NULL)                                       AS live_rows,
  count(*)                                                                            AS total_rows
FROM public.unit_capacity_submissions;

-- ── PREFLIGHT 6: placement responses that have no history row ───────────────
-- Detects the exact defect this migration closes: a response recorded on the
-- request with no matching append-only event. Expected: 0 rows on a fresh install.
-- Any row is pre-existing damage from the non-atomic path and should be recorded
-- before the RPC makes it impossible going forward. Run alone.
SELECT r.id AS request_id, r.unit_key, r.unit_response, r.responded_at
FROM public.unit_placement_requests r
WHERE r.unit_response <> 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM public.unit_placement_request_events e
    WHERE e.request_id = r.id AND e.event_type = 'unit_response')
ORDER BY r.responded_at;


-- ############################################################################
-- VERIFICATION (run AFTER the migration)
-- ############################################################################

-- ── VERIFY 1: both RPCs exist, SECURITY DEFINER, service_role only ──────────
-- PASS: 2 rows, each security_definer = true, service_role_can_execute = true,
-- authenticated_can_execute = false. STOP on any other combination.
SELECT
  p.proname,
  p.prosecdef                                              AS security_definer,
  pg_get_function_identity_arguments(p.oid)                AS args,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('unit_placement_respond', 'unit_capacity_submit')
ORDER BY p.proname;

-- ── VERIFY 1b: no defaulted parameter precedes a required one ───────────────
-- PASS: 2 rows, each trailing_defaults = true. PostgreSQL would have rejected the
-- declaration otherwise, so a row here also proves the function actually created.
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  (p.pronargdefaults > 0
     AND p.pronargs - p.pronargdefaults >= 0) AS trailing_defaults,
  p.pronargs,
  p.pronargdefaults
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('unit_placement_respond', 'unit_capacity_submit')
ORDER BY p.proname;

-- ── VERIFY 2: the placement RPC is atomic and re-derives authorization ──────
-- PASS: every column true. locks_row proves FOR UPDATE serializes concurrent
-- responses; writes_history proves the event insert is in the same function body;
-- checks_grant and checks_scope prove the API cannot pass an unauthorized request
-- id; guards_aspire proves a response cannot land after ASPIRE decided.
SELECT
  (prosrc ~* 'FOR UPDATE')                                       AS locks_row,
  (prosrc ~* 'INSERT INTO public\.unit_placement_request_events') AS writes_history,
  (prosrc ~* 'FROM public\.user_role_grants')                    AS checks_grant,
  (prosrc ~* 'FROM public\.user_unit_scopes')                    AS checks_scope,
  (prosrc ~* 'v_row\.aspire_status <> ''open''')                 AS guards_aspire,
  (prosrc ~* 'UPDATE public\.unit_placement_requests')           AS updates_request
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'unit_placement_respond';

-- ── VERIFY 2b: the placement RPC never writes an ASPIRE decision column ─────
-- PASS: all three false.
SELECT
  (prosrc ~* 'SET[[:space:]]+aspire_status')            AS writes_aspire_status,
  (prosrc ~* 'aspire_decided_by_profile_id[[:space:]]*=') AS writes_aspire_actor,
  (prosrc ~* 'aspire_decided_at[[:space:]]*=')          AS writes_aspire_time
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'unit_placement_respond';

-- ── VERIFY 3: the capacity RPC is atomic and race safe ──────────────────────
-- PASS: every column true. locks_prior is the concurrency guarantee; the two stale
-- guards are the stale-write protection; supersedes and inserts prove both writes
-- live in one function body.
SELECT
  (prosrc ~* 'FOR UPDATE')                                        AS locks_prior,
  (prosrc ~* 'v_prior\.superseded_at IS NOT NULL')                AS guards_already_superseded,
  (prosrc ~* 'v_prior\.review_status <> ''submitted''')           AS guards_already_reviewed,
  (prosrc ~* 'UPDATE public\.unit_capacity_submissions')          AS supersedes_prior,
  (prosrc ~* 'INSERT INTO public\.unit_capacity_submissions')     AS inserts_replacement,
  (prosrc ~* 'FROM public\.user_unit_scopes')                     AS checks_scope
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'unit_capacity_submit';

-- ── VERIFY 3b: the capacity RPC never sets its own review status ────────────
-- PASS: both false. ASPIRE review stays authoritative.
SELECT
  (prosrc ~* 'review_status[[:space:]]*=[[:space:]]*''')  AS assigns_review_status,
  (prosrc ~* 'reviewed_by_profile_id[[:space:]]*=')       AS assigns_reviewer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'unit_capacity_submit';

-- ── VERIFY 3c: exactly one live submission per unit, cohort, period, shift ──
-- PASS: 0 rows. The partial unique index is the backstop behind the RPC.
SELECT unit_key, cohort_id, period_label, shift, count(*) AS live_rows
FROM public.unit_capacity_submissions
WHERE superseded_at IS NULL
GROUP BY 1, 2, 3, 4
HAVING count(*) > 1
ORDER BY live_rows DESC;

-- ── VERIFY 4: the author projection is now identity-based and three-way ─────
-- PASS: is_three_way = true, has_participant_branch = true, projects_role = true,
-- is_binary_projection = FALSE. STOP if is_binary_projection is still true: a
-- student would see a Unit Leader's message attributed to themselves.
SELECT
  (prosrc ~* 'p\.author_profile_id = public\.portal_profile_id\(\)')                  AS is_three_way,
  (prosrc ~* '''participant''')                                                       AS has_participant_branch,
  (prosrc ~* '''author_role'', p\.author_role')                                       AS projects_role,
  (prosrc ~* 'CASE WHEN p\.author_role = ''staff'' THEN ''staff'' ELSE ''me'' END')   AS is_binary_projection
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_portal_get_thread_v2';

-- ── VERIFY 4b: the thread RPC signature and ACL are UNCHANGED ──────────────
-- PASS: exactly one row, args = 'uuid, integer, timestamptz, uuid',
-- service_role_can_execute = TRUE, authenticated_can_execute = TRUE,
-- anon_can_execute = FALSE.
--
-- authenticated EXECUTE IS INTENTIONAL AND LOAD BEARING. Do not revoke it.
-- It was granted deliberately by 20260716000006 lines 178-181:
--   REVOKE ALL ... FROM PUBLIC, anon;
--   GRANT EXECUTE ... TO authenticated, service_role;
-- with the preceding comment "so the caller is resolved from their own JWT".
--
-- The reason is structural. This function is SECURITY DEFINER but resolves the
-- VIEWER through public.portal_profile_id(), which reads auth.uid(). The sole
-- production caller, api/portal/messages-thread.js:32, uses getUserScopedDb(req):
-- an anon-key client carrying the signed-in student's JWT, so the statement runs
-- as authenticated and auth.uid() is that student. Under service_role there is no
-- auth.uid(), portal_profile_id() would resolve nothing, and the thread would come
-- back empty. Revoking authenticated EXECUTE breaks the Student Portal thread view.
--
-- Direct authenticated execution is safe because the function authorizes itself:
-- it gates every row through my_message_conversation_ids(), which requires an
-- active participant row plus the live grant and scope predicates. A caller cannot
-- pass a profile id, so holding EXECUTE grants no access to another person's thread.
-- anon is explicitly revoked, so an unauthenticated caller has nothing.
--
-- CREATE OR REPLACE preserves the ACL, so this block asserts the ACL was PRESERVED,
-- not that it was tightened. STOP if authenticated_can_execute is false: something
-- revoked it and the Student Portal is broken. STOP if anon_can_execute is true, or
-- if more than one row is returned, which would mean an accidental overload.
--
-- Contrast VERIFY 1: the two NEW RPCs correctly deny authenticated, because they
-- take p_actor_profile_id as a PARAMETER and trust it. They must only ever be
-- reachable through the service-role client after the API has verified the caller.
SELECT
  pg_get_function_identity_arguments(p.oid)                AS args,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_portal_get_thread_v2';

-- ── VERIFY 4c: no author email is projected, for any author ────────────────
-- PASS: false. The projection uses user_profiles.full_name only.
SELECT (prosrc ~* 'up\.email') AS projects_an_email
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'messages_portal_get_thread_v2';

-- ── VERIFY 5: the audit columns exist with the right default and CHECK ──────
-- PASS: 2 rows, each default 'unit_leader', each with a CHECK over
-- ('unit_leader', 'staff').
SELECT c.table_name, c.column_name, c.is_nullable, c.column_default,
       (SELECT pg_get_constraintdef(con.oid)
          FROM pg_constraint con
         WHERE con.conrelid = (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass
           AND con.conname IN ('chk_usm_confirmed_by_role', 'chk_upn_nominated_by_role')
         LIMIT 1) AS check_definition
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND ((c.table_name = 'unit_student_milestones'     AND c.column_name = 'confirmed_by_role')
    OR (c.table_name = 'unit_preceptor_nominations'  AND c.column_name = 'nominated_by_role'))
ORDER BY c.table_name;

-- ── VERIFY 6: every placement response now has its history row ─────────────
-- PASS: 0 rows, and it stays 0 permanently because the RPC writes both in one
-- transaction. Compare against PREFLIGHT 6.
SELECT r.id AS request_id, r.unit_key, r.unit_response, r.responded_at
FROM public.unit_placement_requests r
WHERE r.unit_response <> 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM public.unit_placement_request_events e
    WHERE e.request_id = r.id AND e.event_type = 'unit_response')
ORDER BY r.responded_at;

-- ── VERIFY 7: the read/send split is untouched ────────────────────────────
-- PASS: identical to the foundation VERIFY 7c. can_read must still NOT query
-- user_unit_scopes and can_send must still query it.
SELECT
  p.proname,
  (p.prosrc ~* 'FROM[[:space:]]+public\.user_unit_scopes')  AS requires_active_unit_scope,
  (p.prosrc ~* 'message_profile_is_active[[:space:]]*\(')    AS checks_account_active
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('message_participant_can_read', 'message_participant_can_send')
ORDER BY p.proname;

-- ── VERIFY 8: Wave F-2 privacy is untouched ───────────────────────────────
-- PASS: bucket_public = false, student_files_policies = 0, public_urls_remaining = 0.
SELECT
  (SELECT public FROM storage.buckets WHERE id = 'student-files')            AS bucket_public,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (COALESCE(qual,'') LIKE '%student-files%'
         OR COALESCE(with_check,'') LIKE '%student-files%'))                 AS student_files_policies,
  (SELECT count(*) FROM public.students
     WHERE resume_url   LIKE '%/object/public/student-files/%'
        OR headshot_url LIKE '%/object/public/student-files/%')              AS public_urls_remaining;

-- ── VERIFY 9: no Messages or student data was altered ─────────────────────
-- PASS: conversations 2, messages 3, participants 2, and rotation dates 36 / 0,
-- matching the post-foundation baseline. This migration changes functions and adds
-- two columns; it must move no data.
SELECT
  (SELECT count(*) FROM public.conversations)                                        AS conversations,
  (SELECT count(*) FROM public.messages)                                             AS messages,
  (SELECT count(*) FROM public.conversation_participants)                            AS participants,
  (SELECT count(*) FROM public.students WHERE rotation_end_date IS NOT NULL)         AS with_rotation_end_date,
  (SELECT count(*) FROM public.students WHERE rotation_completed_at IS NOT NULL)     AS with_completed_at;
