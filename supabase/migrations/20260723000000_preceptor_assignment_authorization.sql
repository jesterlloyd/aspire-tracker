-- ============================================================================
-- PHASE 2C: scoped preceptor-assignment authorization + backend (PROPOSED, NOT APPLIED)
-- ============================================================================
-- *** GATED. Depends on Phase 2B (20260722000000_preceptor_mirror_repair_and_sync.sql):    ***
-- *** apply 2B FIRST, then this, in one controlled maintenance window. Apply MANUALLY after  ***
-- *** the preflight, and deploy the compatible app changes + start the notification worker   ***
-- *** BEFORE enabling any Unit Leader assignment UI.                                          ***
--
-- LOCKED AUTHORITY MODEL
--   - Owner/Admin: may change Primary/Secondary/Coverage for any student, any active preceptor.
--   - Unit Leader: only for students in their ACTIVE unit scope; may pick ANY active preceptor
--     (cross-unit allowed); a UL-created preceptor's unit must be within the UL's scope.
--   - Interviewer / viewer / co_lead / other is_staff() roles: NOT allowed.
--   - Unit Leaders never get direct table-write permission; they act only through the RPCs.
--
-- TARGETED SECONDARY/COVERAGE (locked):
--   - add     : add ONE active secondary/coverage row; alter no existing assignment.
--   - replace : require p_assignment_id; lock+validate the selected ACTIVE assignment (belongs to
--               the student, role = p_role); end ONLY that assignment; add the new one; preserve
--               every other active assignment.
--   - end     : require p_assignment_id; lock+validate as above; end ONLY that assignment.
--   The actual old/new preceptor id AND name are recorded in the audit event, the in-app
--   notification, the queued email, and the RPC response. History is soft-ended, never deleted.
--
-- COMPLETED-ROTATION WINDOW (locked): a rotation is "completed" IFF students.status = 'Completed'
--   (the canonical source of truth api/lib/unitLeaderScopeRules.js lifecycleBucket; Declined /
--   Not Proceeding are off-ramps, NOT completed rotations). end date = COALESCE(rotation_completed_at,
--   rotation_end_date); NULL => beyond window (fail closed).
--   - Active, or completed within 90 days: normal authorization.
--   - Unit Leader beyond 90 days: DENIED (even with a force flag).
--   - Owner/Admin beyond 90 days: allowed ONLY with p_force = true AND p_confirm_override = true
--     AND a non-empty reason; the event and every notification are marked as a historical override.
--
-- IDEMPOTENCY (locked): every write RPC requires p_request_id and is idempotent on it via the
--   preceptor_assignment_requests ledger. Repeating the SAME request replays the stored result
--   with no second mutation and no second notification; the SAME request_id with DIFFERENT
--   parameters fails (MS409). Correlation ids are derived from p_request_id (stable, never
--   timestamp-based), so notification/email dedup is stable across retries.
--
-- NOTIFICATION (locked): every Unit Leader assignment change / UL-created preceptor, and every
--   Owner/Admin >90d override, writes a durable audit row AND fans out one durable
--   staff_notifications row per ACTIVE Owner/Admin except the acting user, in the SAME
--   transaction. That row carries BOTH the in-app state (read/unread) and the email queue state.
--   Destinations use REAL staff routes: a student notification links to /students?student=<id>
--   (the query form the Student Profiles tab reads; the /students/<id> path form does not route),
--   a preceptor-created notification links to /rotation/preceptors (the directory; there is no
--   per-preceptor detail route). A separate worker sends the emails; a send failure never rolls
--   back the committed assignment.
--
-- SECURITY: no RLS widened; no anon/authenticated write grant; new tables are owner/admin SELECT
--   (staff_notifications additionally lets a recipient read their own row) + service-role write.
--   Every function has a fixed search_path; the write RPCs are service-role only. Errors use the
--   established MS400/403/404/409 SQLSTATE convention.
-- ============================================================================

BEGIN;

-- ############################################################################
-- 1. Preceptor provenance (additive, nullable).
-- ############################################################################
ALTER TABLE public.preceptors
  ADD COLUMN IF NOT EXISTS created_by      uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_role text
    CONSTRAINT chk_preceptors_created_by_role CHECK (created_by_role IS NULL OR created_by_role IN ('owner_admin', 'unit_leader'));


-- ############################################################################
-- 2. preceptor_assignment_events -- audit OF RECORD (append-only). was_override flags a
--    completed-rotation historical override (>90 days) by an owner/admin.
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.preceptor_assignment_events (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  actor_role       text        NOT NULL CHECK (actor_role IN ('owner_admin', 'unit_leader')),
  action           text        NOT NULL CHECK (action IN (
                     'assign_primary', 'add_secondary', 'add_coverage',
                     'replace_secondary', 'replace_coverage', 'end_secondary', 'end_coverage',
                     'create_preceptor', 'matches_anomaly')),
  student_id       uuid        REFERENCES public.students(id)   ON DELETE SET NULL,
  preceptor_id     uuid        REFERENCES public.preceptors(id) ON DELETE SET NULL,
  cohort_id        uuid        REFERENCES public.cohorts(id)    ON DELETE SET NULL,
  unit_key         text,
  assignment_role  text        CHECK (assignment_role IS NULL OR assignment_role IN ('primary', 'secondary', 'coverage')),
  old_value        text,       -- human-readable old preceptor name (ids live in metadata)
  new_value        text,       -- human-readable new preceptor name (ids live in metadata)
  reason           text,
  was_override     boolean     NOT NULL DEFAULT false,
  correlation_id   text,
  request_id       text,
  metadata         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pae_student ON public.preceptor_assignment_events (student_id);
CREATE INDEX IF NOT EXISTS idx_pae_actor   ON public.preceptor_assignment_events (actor_profile_id);
CREATE INDEX IF NOT EXISTS idx_pae_created ON public.preceptor_assignment_events (created_at DESC);

ALTER TABLE public.preceptor_assignment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "preceptor_assignment_events_owner_admin_read"
  ON public.preceptor_assignment_events FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());
REVOKE ALL PRIVILEGES ON TABLE public.preceptor_assignment_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.preceptor_assignment_events TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.preceptor_assignment_events TO service_role;


-- ############################################################################
-- 3. staff_notifications -- unified, durable, per-recipient IN-APP + EMAIL row. One row per
--    (correlation_id, recipient owner/admin). in_app_read_at drives read/unread; the email
--    queue columns (queue_status/attempts/next_attempt_at/...) mirror message_notification_deliveries.
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.staff_notifications (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id       text        NOT NULL,           -- stable event key (shared across recipients)
  recipient_profile_id uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  recipient_email      text        NOT NULL,
  event_type           text        NOT NULL,
  -- Rendered content for the in-app card and the email.
  actor_profile_id     uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  actor_name           text,
  actor_role           text,
  student_id           uuid        REFERENCES public.students(id)   ON DELETE SET NULL,
  preceptor_id         uuid        REFERENCES public.preceptors(id) ON DELETE SET NULL,
  unit_key             text,
  assignment_role      text,
  old_value            text,       -- human-readable old preceptor name
  new_value            text,       -- human-readable new preceptor name
  reason               text,
  was_override         boolean     NOT NULL DEFAULT false,
  subject              text        NOT NULL,
  dest_url             text,
  -- In-app read state.
  in_app_read_at       timestamptz,
  -- Email queue state (mirrors message_notification_deliveries).
  queue_status         text        NOT NULL DEFAULT 'queued'
                         CHECK (queue_status IN ('queued', 'processing', 'retry_wait', 'sent', 'failed', 'suppressed')),
  attempts             int         NOT NULL DEFAULT 0,
  max_attempts         int         NOT NULL DEFAULT 5,
  next_attempt_at      timestamptz,
  last_attempt_at      timestamptz,
  locked_at            timestamptz,
  locked_by            text,
  resend_email_id      text,
  notification_log_id  uuid,
  error_code           text,
  error_detail         text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- One notification per event per recipient: idempotent fan-out and no double email.
  CONSTRAINT uq_staff_notifications_event_recipient UNIQUE (correlation_id, recipient_profile_id)
);
CREATE INDEX IF NOT EXISTS idx_sn_recipient_unread
  ON public.staff_notifications (recipient_profile_id, created_at DESC)
  WHERE in_app_read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sn_email_due
  ON public.staff_notifications (next_attempt_at)
  WHERE queue_status IN ('queued', 'retry_wait');

ALTER TABLE public.staff_notifications ENABLE ROW LEVEL SECURITY;
-- A recipient reads their OWN notifications; owner/admin may read all. NO client write policy:
-- an RLS UPDATE policy is row-level, not column-level, so it could not stop a recipient from
-- tampering with the email-queue columns. Read state is changed only through the scoped
-- mark_staff_notifications_read RPC below (which touches in_app_read_at and nothing else).
CREATE POLICY "staff_notifications_read_own_or_admin"
  ON public.staff_notifications FOR SELECT TO authenticated
  USING (
    recipient_profile_id = public.portal_profile_id()
    OR public.is_active_owner_or_admin()
  );
REVOKE ALL PRIVILEGES ON TABLE public.staff_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.staff_notifications TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.staff_notifications TO service_role;


-- ############################################################################
-- 3b. preceptor_assignment_requests -- idempotency ledger. One row per p_request_id. A repeat of
--     the SAME request (same fingerprint) replays the stored result with no second mutation and no
--     second notification; the SAME request_id with a DIFFERENT fingerprint is a conflict (MS409).
--     The claim is row-first (INSERT ... ON CONFLICT DO NOTHING), so two concurrent identical
--     requests serialize on the primary key and only one mutates. Owner/admin SELECT only.
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.preceptor_assignment_requests (
  request_id       text        PRIMARY KEY,
  actor_profile_id uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  rpc              text        NOT NULL,
  fingerprint      text        NOT NULL,
  result           jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);
ALTER TABLE public.preceptor_assignment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "preceptor_assignment_requests_owner_admin_read"
  ON public.preceptor_assignment_requests FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());
REVOKE ALL PRIVILEGES ON TABLE public.preceptor_assignment_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.preceptor_assignment_requests TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.preceptor_assignment_requests TO service_role;


-- ############################################################################
-- 4. Guard: only owner/admin (direct staff path) or an authorized RPC may change
--    students.preceptor_id. Fails closed. SECURITY INVOKER (see note). Fixed search_path.
--
-- HARDENED MARKER (pooling + nested-definer safe): the authorized RPC sets a TRANSACTION-LOCAL
-- marker app.preceptor_change_authorized to the SPECIFIC student id it is changing, and the guard
-- requires the marker to equal NEW.id AND current_user to be a privileged (non-client) role.
--   - Transaction-local (set_config is_local = true) resets at COMMIT/ROLLBACK, so it never leaks
--     across pooled transactions (transaction-pooling reuses a backend only between transactions).
--   - Scoping the marker to the exact student id means an unrelated nested write to a DIFFERENT
--     student's preceptor_id is NOT covered by the marker (it would have to equal that row's id),
--     closing the mid-transaction window.
--   - A client (authenticated/anon) can neither assume a privileged role nor set the marker
--     (PostgREST exposes no raw-SQL channel), so the marker is never a sole gate.
--   - A bare SECURITY DEFINER function that does not set the per-row marker fails the check, so
--     there is no general definer bypass.
-- INVOKER is required so the guard observes the REAL current_user (a client update runs as
-- 'authenticated'; the RPC's update runs as the RPC owner). A DEFINER guard would always see its
-- own owner and could not tell them apart.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.guard_students_preceptor_id_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $guard$
DECLARE
  v_marker     text    := current_setting('app.preceptor_change_authorized', true);
  v_privileged boolean := current_user NOT IN ('authenticated', 'anon');
BEGIN
  IF NEW.preceptor_id IS NOT DISTINCT FROM OLD.preceptor_id THEN
    RETURN NEW;  -- not a preceptor change
  END IF;

  -- (A) Authorized RPC path: per-student marker set to THIS row AND a privileged role.
  IF v_marker IS NOT NULL AND v_marker = NEW.id::text AND v_privileged THEN
    RETURN NEW;
  END IF;

  -- (B) Existing owner/admin staff path: a direct client update by an active owner/admin.
  IF public.is_active_owner_or_admin() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'preceptor_id may only be changed by an owner/admin or an authorized assignment RPC'
    USING ERRCODE = 'MS403';
END;
$guard$;

DROP TRIGGER IF EXISTS trg_guard_students_preceptor_id ON public.students;
CREATE TRIGGER trg_guard_students_preceptor_id
  BEFORE UPDATE OF preceptor_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.guard_students_preceptor_id_change();

REVOKE ALL ON FUNCTION public.guard_students_preceptor_id_change() FROM PUBLIC, anon, authenticated;


-- ############################################################################
-- 5a. Shared authorization helper. Returns jsonb { role, was_override, unit_key, cohort_id } for
--     the actor against the student, or RAISES MS4xx. Enforces the completed-rotation window and
--     the override rule. Completed <=> students.status = 'Completed' (see header).
-- ############################################################################
CREATE OR REPLACE FUNCTION public._preceptor_assert_actor_for_student(
  p_actor_profile_id uuid,
  p_student_id       uuid,
  p_reason           text,
  p_force            boolean,
  p_confirm_override boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_now        timestamptz := now();
  v_stu        record;
  v_unit_key   text;
  v_role       text;
  v_end        timestamptz;
  v_completed  boolean;
  v_within_90  boolean;
BEGIN
  SELECT s.id, s.cohort_id, s.matched_unit_id, s.status,
         s.rotation_completed_at, s.rotation_end_date
    INTO v_stu
  FROM public.students s WHERE s.id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'MS404';
  END IF;

  SELECT u.unit_name INTO v_unit_key FROM public.units u WHERE u.id = v_stu.matched_unit_id;

  -- Actor role. Active owner/admin (role or is_owner) acts globally.
  IF EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id = p_actor_profile_id AND COALESCE(p.is_active, true) = true
      AND (p.role IN ('owner', 'admin') OR p.is_owner IS TRUE)
  ) THEN
    v_role := 'owner_admin';
  ELSIF EXISTS (
    SELECT 1 FROM public.user_role_grants g
    WHERE g.user_profile_id = p_actor_profile_id AND g.role = 'unit_leader'
      AND g.revoked_at IS NULL AND g.starts_at <= v_now AND (g.expires_at IS NULL OR g.expires_at > v_now)
  ) AND v_unit_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_unit_scopes s
    WHERE s.user_profile_id = p_actor_profile_id AND s.unit_key = v_unit_key
      AND (s.cohort_id IS NULL OR s.cohort_id = v_stu.cohort_id)
      AND s.revoked_at IS NULL AND s.starts_at <= v_now AND (s.expires_at IS NULL OR s.expires_at > v_now)
  ) THEN
    v_role := 'unit_leader';
  ELSE
    RAISE EXCEPTION 'not found' USING ERRCODE = 'MS404';  -- non-enumerating
  END IF;

  -- Completed-rotation window. Completed <=> status = 'Completed' (canonical, per header). end
  -- date = COALESCE(rotation_completed_at, rotation_end_date); NULL for a completed student =>
  -- treated as beyond window (fail closed).
  v_completed := (v_stu.status = 'Completed');
  v_end := COALESCE(v_stu.rotation_completed_at, v_stu.rotation_end_date::timestamptz);
  v_within_90 := v_completed AND v_end IS NOT NULL AND v_end >= v_now - INTERVAL '90 days';

  IF v_completed AND NOT v_within_90 THEN
    -- Beyond the 90-day window.
    IF v_role = 'unit_leader' THEN
      RAISE EXCEPTION 'completed rotation is outside the 90-day window' USING ERRCODE = 'MS403';
    END IF;
    -- Owner/Admin override: force + explicit confirmation + reason, all required.
    IF p_force IS NOT TRUE OR p_confirm_override IS NOT TRUE THEN
      RAISE EXCEPTION 'a completed rotation beyond 90 days requires force and explicit confirmation'
        USING ERRCODE = 'MS403';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
      RAISE EXCEPTION 'a reason is required for a historical override' USING ERRCODE = 'MS400';
    END IF;
    RETURN jsonb_build_object('role', v_role, 'was_override', true, 'unit_key', v_unit_key, 'cohort_id', v_stu.cohort_id);
  END IF;

  -- Active or within 90 days: normal authorization (no forced reason).
  RETURN jsonb_build_object('role', v_role, 'was_override', false, 'unit_key', v_unit_key, 'cohort_id', v_stu.cohort_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public._preceptor_assert_actor_for_student(uuid, uuid, text, boolean, boolean) FROM PUBLIC, anon, authenticated;


-- ############################################################################
-- 5a2. Idempotency helpers. _preceptor_begin_request claims a request row (or detects a replay /
--      a conflicting reuse); _preceptor_finish_request stores the result. Internal (owner-only);
--      called only by the write RPCs below, which run as the definer owner.
-- ############################################################################
CREATE OR REPLACE FUNCTION public._preceptor_begin_request(
  p_request_id       text,
  p_actor_profile_id uuid,
  p_rpc              text,
  p_fingerprint      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_inserted int;
  v_actor    uuid;
  v_rpc      text;
  v_fp       text;
  v_res      jsonb;
BEGIN
  IF p_request_id IS NULL OR btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'a request id is required' USING ERRCODE = 'MS400';
  END IF;

  INSERT INTO public.preceptor_assignment_requests (request_id, actor_profile_id, rpc, fingerprint)
  VALUES (p_request_id, p_actor_profile_id, p_rpc, p_fingerprint)
  ON CONFLICT (request_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 1 THEN
    RETURN jsonb_build_object('claimed', true);   -- first time: caller proceeds and finishes
  END IF;

  -- A row already exists: replay or conflicting reuse. Lock it (serializes with any in-flight txn;
  -- by the time this returns, that txn has committed a result or rolled back the claim entirely).
  SELECT actor_profile_id, rpc, fingerprint, result INTO v_actor, v_rpc, v_fp, v_res
  FROM public.preceptor_assignment_requests WHERE request_id = p_request_id FOR UPDATE;

  IF v_actor IS DISTINCT FROM p_actor_profile_id
     OR v_rpc IS DISTINCT FROM p_rpc
     OR v_fp IS DISTINCT FROM p_fingerprint THEN
    RAISE EXCEPTION 'this request id was already used with different parameters' USING ERRCODE = 'MS409';
  END IF;
  IF v_res IS NULL THEN
    -- Same fingerprint, no stored result: a concurrent attempt is still in flight (a committed
    -- single-transaction RPC always stores its result before COMMIT). Refuse to double-run.
    RAISE EXCEPTION 'this request is already in progress' USING ERRCODE = 'MS409';
  END IF;
  RETURN jsonb_build_object('claimed', false, 'result', v_res);  -- idempotent replay
END;
$fn$;
REVOKE ALL ON FUNCTION public._preceptor_begin_request(text, uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._preceptor_finish_request(p_request_id text, p_result jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
BEGIN
  UPDATE public.preceptor_assignment_requests
     SET result = p_result, completed_at = now()
   WHERE request_id = p_request_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public._preceptor_finish_request(text, jsonb) FROM PUBLIC, anon, authenticated;


-- ############################################################################
-- 5b. _emit_staff_notifications -- fan out one durable in-app + email row to every ACTIVE
--     owner/admin EXCEPT the actor, idempotent on (correlation_id, recipient). Runs inside the
--     RPC transaction; a duplicate fan-out is a no-op, and no recipient is emailed twice.
-- ############################################################################
CREATE OR REPLACE FUNCTION public._emit_staff_notifications(
  p_correlation_id   text,
  p_event_type       text,
  p_actor_profile_id uuid,
  p_actor_role       text,
  p_subject          text,
  p_student_id       uuid,
  p_preceptor_id     uuid,
  p_unit_key         text,
  p_assignment_role  text,
  p_old_value        text,
  p_new_value        text,
  p_reason           text,
  p_was_override     boolean,
  p_dest_url         text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_actor_name text;
  v_count      int;
BEGIN
  SELECT full_name INTO v_actor_name FROM public.user_profiles WHERE id = p_actor_profile_id;

  INSERT INTO public.staff_notifications
    (correlation_id, recipient_profile_id, recipient_email, event_type, actor_profile_id, actor_name,
     actor_role, student_id, preceptor_id, unit_key, assignment_role, old_value, new_value, reason,
     was_override, subject, dest_url, queue_status, next_attempt_at)
  SELECT p_correlation_id, up.id, up.email, p_event_type, p_actor_profile_id, v_actor_name,
         p_actor_role, p_student_id, p_preceptor_id, p_unit_key, p_assignment_role, p_old_value, p_new_value,
         p_reason, COALESCE(p_was_override, false), p_subject, p_dest_url, 'queued', now()
  FROM public.user_profiles up
  WHERE (up.role IN ('owner', 'admin') OR up.is_owner IS TRUE)
    AND COALESCE(up.is_active, true) = true
    AND up.id <> p_actor_profile_id
    AND up.email IS NOT NULL AND btrim(up.email) <> ''
  ON CONFLICT (correlation_id, recipient_profile_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public._emit_staff_notifications(text, text, uuid, text, text, uuid, uuid, text, text, text, text, text, boolean, text) FROM PUBLIC, anon, authenticated;


-- ############################################################################
-- 5c. assign_primary_preceptor -- change/assign the Primary. Sets students.preceptor_id and lets
--     the Phase 2B trigger synchronize the Primary mirror. Idempotent on p_request_id.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.assign_primary_preceptor(
  p_actor_profile_id uuid,
  p_student_id       uuid,
  p_preceptor_id     uuid,
  p_reason           text    DEFAULT NULL,
  p_force            boolean DEFAULT false,
  p_confirm_override boolean DEFAULT false,
  p_request_id       text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_fp        text;
  v_claim     jsonb;
  v_authz     jsonb;
  v_role      text;
  v_override  boolean;
  v_cohort    uuid;
  v_unit_key  text;
  v_old       uuid;
  v_old_name  text;
  v_new_name  text;
  v_match_ct  int;
  v_corr      text;
  v_result    jsonb;
BEGIN
  IF p_actor_profile_id IS NULL OR p_student_id IS NULL OR p_preceptor_id IS NULL THEN
    RAISE EXCEPTION 'missing required argument' USING ERRCODE = 'MS400';
  END IF;

  -- Idempotency: claim (or replay) BEFORE any mutation. A failed run rolls the claim back with it.
  v_fp := jsonb_build_object(
    'rpc', 'assign_primary_preceptor',
    'actor_profile_id', p_actor_profile_id,
    'action', 'assign',
    'student_id', p_student_id,
    'assignment_id', NULL,
    'preceptor_id', p_preceptor_id,
    'role', 'primary',
    'reason', p_reason,
    'notes', NULL,
    'force', COALESCE(p_force, false),
    'confirm_override', COALESCE(p_confirm_override, false)
  )::text;
  v_claim := public._preceptor_begin_request(p_request_id, p_actor_profile_id, 'assign_primary_preceptor', v_fp);
  IF NOT (v_claim->>'claimed')::boolean THEN
    RETURN v_claim->'result';
  END IF;

  v_authz := public._preceptor_assert_actor_for_student(p_actor_profile_id, p_student_id, p_reason, p_force, p_confirm_override);
  v_role     := v_authz->>'role';
  v_override := (v_authz->>'was_override')::boolean;
  v_unit_key := v_authz->>'unit_key';
  v_cohort   := (v_authz->>'cohort_id')::uuid;

  SELECT s.preceptor_id INTO v_old FROM public.students s WHERE s.id = p_student_id;

  -- Cross-unit assignment is allowed: only inactivity blocks the preceptor.
  IF NOT EXISTS (SELECT 1 FROM public.preceptors p WHERE p.id = p_preceptor_id AND p.is_active IS TRUE) THEN
    RAISE EXCEPTION 'preceptor is inactive or does not exist' USING ERRCODE = 'MS400';
  END IF;
  IF v_old IS NOT DISTINCT FROM p_preceptor_id THEN
    RAISE EXCEPTION 'that preceptor is already the primary' USING ERRCODE = 'MS409';
  END IF;

  -- Per-student marker authorizes THIS one row change to the guard; the 2B trigger then mirrors.
  PERFORM set_config('app.preceptor_change_authorized', p_student_id::text, true);
  UPDATE public.students SET preceptor_id = p_preceptor_id WHERE id = p_student_id;
  PERFORM set_config('app.preceptor_change_authorized', '', true);

  IF v_old IS NOT NULL THEN SELECT full_name INTO v_old_name FROM public.preceptors WHERE id = v_old; END IF;
  SELECT full_name INTO v_new_name FROM public.preceptors WHERE id = p_preceptor_id;

  v_corr := 'preceptor_primary:' || p_request_id;

  INSERT INTO public.preceptor_assignment_events
    (actor_profile_id, actor_role, action, student_id, preceptor_id, cohort_id, unit_key,
     assignment_role, old_value, new_value, reason, was_override, correlation_id, request_id, metadata)
  VALUES
    (p_actor_profile_id, v_role, 'assign_primary', p_student_id, p_preceptor_id, v_cohort, v_unit_key,
     'primary', v_old_name, v_new_name, p_reason, v_override, v_corr, p_request_id,
     jsonb_build_object('old_preceptor_id', v_old, 'old_preceptor_name', v_old_name,
                        'new_preceptor_id', p_preceptor_id, 'new_preceptor_name', v_new_name));

  PERFORM public._emit_staff_notifications(
    v_corr, 'preceptor_primary_changed', p_actor_profile_id, v_role,
    (CASE WHEN v_override THEN 'Primary preceptor changed (historical override)' ELSE 'Primary preceptor changed' END),
    p_student_id, p_preceptor_id, v_unit_key, 'primary', v_old_name, v_new_name, p_reason, v_override,
    '/students?student=' || p_student_id::text);

  -- matches anomaly: >1 same-cohort match rows => 2B trigger left the match FK unsynced. Record a
  -- structured event AND notify, without failing the assignment.
  SELECT count(*) INTO v_match_ct FROM public.matches m
  WHERE m.student_id = p_student_id AND m.cohort_id = v_cohort;
  IF v_match_ct > 1 THEN
    INSERT INTO public.preceptor_assignment_events
      (actor_profile_id, actor_role, action, student_id, preceptor_id, cohort_id, unit_key,
       assignment_role, old_value, new_value, reason, correlation_id, request_id, metadata)
    VALUES
      (p_actor_profile_id, v_role, 'matches_anomaly', p_student_id, p_preceptor_id, v_cohort, v_unit_key,
       'primary', v_old_name, v_new_name, p_reason, v_corr || ':anomaly', p_request_id,
       jsonb_build_object('same_cohort_match_rows', v_match_ct));
    PERFORM public._emit_staff_notifications(
      v_corr || ':anomaly', 'preceptor_match_anomaly', p_actor_profile_id, v_role,
      'Match record needs review (multiple same-cohort matches)',
      p_student_id, p_preceptor_id, v_unit_key, 'primary', v_old_name, v_new_name, NULL, false,
      '/students?student=' || p_student_id::text);
  END IF;

  v_result := jsonb_build_object('ok', true, 'student_id', p_student_id,
                            'old_preceptor_id', v_old, 'old_preceptor_name', v_old_name,
                            'new_preceptor_id', p_preceptor_id, 'new_preceptor_name', v_new_name,
                            'actor_role', v_role, 'was_override', v_override);
  PERFORM public._preceptor_finish_request(p_request_id, v_result);
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.assign_primary_preceptor(uuid, uuid, uuid, text, boolean, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_primary_preceptor(uuid, uuid, uuid, text, boolean, boolean, text) TO service_role;


-- ############################################################################
-- 5d. set_secondary_coverage_preceptor -- TARGETED add / replace / end of Secondary or Coverage
--     through the canonical student_preceptor_assignments. Replace/End act on the ONE assignment
--     named by p_assignment_id (locked + validated); all other active rows are preserved. Never
--     touches Primary. Cross-unit allowed. Idempotent on p_request_id.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.set_secondary_coverage_preceptor(
  p_actor_profile_id uuid,
  p_student_id       uuid,
  p_role             text,
  p_action           text,               -- 'add' | 'replace' | 'end'
  p_preceptor_id     uuid    DEFAULT NULL,
  p_assignment_id    uuid    DEFAULT NULL,
  p_reason           text    DEFAULT NULL,
  p_notes            text    DEFAULT NULL,
  p_force            boolean DEFAULT false,
  p_confirm_override boolean DEFAULT false,
  p_request_id       text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_fp       text;
  v_claim    jsonb;
  v_authz    jsonb;
  v_role     text;
  v_override boolean;
  v_cohort   uuid;
  v_unit_key text;
  v_target   record;
  v_old_id   uuid;
  v_old_name text;
  v_new_name text;
  v_new_id   uuid;
  v_lbl      text;
  v_corr     text;
  v_result   jsonb;
BEGIN
  IF p_role NOT IN ('secondary', 'coverage') THEN
    RAISE EXCEPTION 'role must be secondary or coverage' USING ERRCODE = 'MS400';
  END IF;
  IF p_action NOT IN ('add', 'replace', 'end') THEN
    RAISE EXCEPTION 'action must be add, replace, or end' USING ERRCODE = 'MS400';
  END IF;

  v_fp := jsonb_build_object(
    'rpc', 'set_secondary_coverage_preceptor',
    'actor_profile_id', p_actor_profile_id,
    'action', p_action,
    'student_id', p_student_id,
    'assignment_id', p_assignment_id,
    'preceptor_id', p_preceptor_id,
    'role', p_role,
    'reason', p_reason,
    'notes', p_notes,
    'force', COALESCE(p_force, false),
    'confirm_override', COALESCE(p_confirm_override, false)
  )::text;
  v_claim := public._preceptor_begin_request(p_request_id, p_actor_profile_id, 'set_secondary_coverage_preceptor', v_fp);
  IF NOT (v_claim->>'claimed')::boolean THEN
    RETURN v_claim->'result';
  END IF;

  v_authz    := public._preceptor_assert_actor_for_student(p_actor_profile_id, p_student_id, p_reason, p_force, p_confirm_override);
  v_role     := v_authz->>'role';
  v_override := (v_authz->>'was_override')::boolean;
  v_unit_key := v_authz->>'unit_key';
  v_cohort   := (v_authz->>'cohort_id')::uuid;

  -- Replace and End both target ONE existing assignment: lock it, validate ownership + role, and
  -- end ONLY that row. Every other active assignment is left untouched.
  IF p_action IN ('replace', 'end') THEN
    IF p_assignment_id IS NULL THEN
      RAISE EXCEPTION 'assignment id is required to replace or end' USING ERRCODE = 'MS400';
    END IF;
    SELECT a.id, a.preceptor_id, a.role, a.student_id, a.status
      INTO v_target
      FROM public.student_preceptor_assignments a
     WHERE a.id = p_assignment_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'assignment not found' USING ERRCODE = 'MS404';
    END IF;
    IF v_target.student_id <> p_student_id THEN
      RAISE EXCEPTION 'assignment does not belong to this student' USING ERRCODE = 'MS404';
    END IF;
    IF v_target.role <> p_role THEN
      RAISE EXCEPTION 'assignment role does not match' USING ERRCODE = 'MS409';
    END IF;
    IF v_target.status <> 'active' THEN
      RAISE EXCEPTION 'assignment is not active' USING ERRCODE = 'MS409';
    END IF;
    v_old_id := v_target.preceptor_id;

    UPDATE public.student_preceptor_assignments
       SET status = 'ended', end_date = current_date, updated_at = now()
     WHERE id = p_assignment_id;
  END IF;

  -- Add and Replace both insert exactly ONE new active assignment.
  IF p_action IN ('add', 'replace') THEN
    IF p_preceptor_id IS NULL THEN
      RAISE EXCEPTION 'preceptor id is required to add or replace' USING ERRCODE = 'MS400';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.preceptors p WHERE p.id = p_preceptor_id AND p.is_active IS TRUE) THEN
      RAISE EXCEPTION 'preceptor is inactive or does not exist' USING ERRCODE = 'MS400';
    END IF;
    BEGIN
      INSERT INTO public.student_preceptor_assignments
        (student_id, preceptor_id, cohort_id, role, status, notes, assigned_by)
      VALUES
        (p_student_id, p_preceptor_id, v_cohort, p_role, 'active',
         NULLIF(btrim(coalesce(p_notes, '')), ''), p_actor_profile_id)
      RETURNING id INTO v_new_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'that preceptor already has an active assignment for this student' USING ERRCODE = 'MS409';
    END;
  END IF;

  v_lbl := (CASE p_action WHEN 'add' THEN 'add_' WHEN 'replace' THEN 'replace_' ELSE 'end_' END) || p_role;

  IF v_old_id IS NOT NULL THEN SELECT full_name INTO v_old_name FROM public.preceptors WHERE id = v_old_id; END IF;
  IF p_preceptor_id IS NOT NULL THEN SELECT full_name INTO v_new_name FROM public.preceptors WHERE id = p_preceptor_id; END IF;

  v_corr := 'preceptor_' || v_lbl || ':' || p_request_id;

  INSERT INTO public.preceptor_assignment_events
    (actor_profile_id, actor_role, action, student_id, preceptor_id, cohort_id, unit_key,
     assignment_role, old_value, new_value, reason, was_override, correlation_id, request_id, metadata)
  VALUES
    (p_actor_profile_id, v_role, v_lbl, p_student_id, p_preceptor_id, v_cohort, v_unit_key,
     p_role, v_old_name, v_new_name, p_reason, v_override, v_corr, p_request_id,
     jsonb_build_object('assignment_id', COALESCE(v_new_id, p_assignment_id),
                        'ended_assignment_id', CASE WHEN p_action IN ('replace', 'end') THEN p_assignment_id ELSE NULL END,
                        'old_preceptor_id', v_old_id, 'old_preceptor_name', v_old_name,
                        'new_preceptor_id', p_preceptor_id, 'new_preceptor_name', v_new_name));

  PERFORM public._emit_staff_notifications(
    v_corr, 'preceptor_' || v_lbl, p_actor_profile_id, v_role, 'Preceptor assignment updated',
    p_student_id, p_preceptor_id, v_unit_key, p_role, v_old_name, v_new_name, p_reason, v_override,
    '/students?student=' || p_student_id::text);

  v_result := jsonb_build_object('ok', true, 'action', v_lbl,
     'assignment_id', COALESCE(v_new_id, p_assignment_id),
     'ended_assignment_id', CASE WHEN p_action IN ('replace', 'end') THEN p_assignment_id ELSE NULL END,
     'old_preceptor_id', v_old_id, 'old_preceptor_name', v_old_name,
     'new_preceptor_id', p_preceptor_id, 'new_preceptor_name', v_new_name);
  PERFORM public._preceptor_finish_request(p_request_id, v_result);
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_secondary_coverage_preceptor(uuid, uuid, text, text, uuid, uuid, text, text, boolean, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_secondary_coverage_preceptor(uuid, uuid, text, text, uuid, uuid, text, text, boolean, boolean, text) TO service_role;


-- ############################################################################
-- 5e. create_unit_preceptor -- canonical Preceptor Directory record. A Unit Leader may only
--     create under a unit in their active scope. Dedups by normalized email; records provenance.
--     Idempotent on p_request_id. Notification links to the preceptor directory (no detail route).
-- ############################################################################
CREATE OR REPLACE FUNCTION public.create_unit_preceptor(
  p_actor_profile_id uuid,
  p_full_name        text,
  p_email            text,
  p_unit_key         text,
  p_shift            text,
  p_phone            text DEFAULT NULL,
  p_request_id       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_now     timestamptz := now();
  v_fp      text;
  v_claim   jsonb;
  v_role    text;
  v_unit_id uuid;
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_new_id  uuid;
  v_corr    text;
  v_result  jsonb;
BEGIN
  IF btrim(coalesce(p_full_name, '')) = '' THEN RAISE EXCEPTION 'full name is required' USING ERRCODE = 'MS400'; END IF;
  IF v_email = '' OR position('@' in v_email) = 0 THEN RAISE EXCEPTION 'a valid email is required' USING ERRCODE = 'MS400'; END IF;
  IF p_shift NOT IN ('Day', 'Night', 'Mid', 'Variable') THEN RAISE EXCEPTION 'shift must be Day, Night, Mid, or Variable' USING ERRCODE = 'MS400'; END IF;

  v_fp := jsonb_build_object(
    'rpc', 'create_unit_preceptor',
    'actor_profile_id', p_actor_profile_id,
    'action', 'create',
    'full_name', btrim(p_full_name),
    'email', v_email,
    'unit_key', p_unit_key,
    'shift', p_shift,
    'phone', NULLIF(btrim(coalesce(p_phone, '')), '')
  )::text;
  v_claim := public._preceptor_begin_request(p_request_id, p_actor_profile_id, 'create_unit_preceptor', v_fp);
  IF NOT (v_claim->>'claimed')::boolean THEN
    RETURN v_claim->'result';
  END IF;

  SELECT u.id INTO v_unit_id FROM public.units u WHERE u.unit_name = p_unit_key LIMIT 1;
  IF v_unit_id IS NULL THEN RAISE EXCEPTION 'unit not found' USING ERRCODE = 'MS400'; END IF;

  -- Owner/admin global; a UL must have an active scope for THIS unit (creation is unit-scoped).
  IF EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id = p_actor_profile_id AND COALESCE(p.is_active, true) = true
      AND (p.role IN ('owner', 'admin') OR p.is_owner IS TRUE)
  ) THEN
    v_role := 'owner_admin';
  ELSIF EXISTS (
    SELECT 1 FROM public.user_role_grants g
    WHERE g.user_profile_id = p_actor_profile_id AND g.role = 'unit_leader'
      AND g.revoked_at IS NULL AND g.starts_at <= v_now AND (g.expires_at IS NULL OR g.expires_at > v_now)
  ) AND EXISTS (
    SELECT 1 FROM public.user_unit_scopes s
    WHERE s.user_profile_id = p_actor_profile_id AND s.unit_key = p_unit_key
      AND s.revoked_at IS NULL AND s.starts_at <= v_now AND (s.expires_at IS NULL OR s.expires_at > v_now)
  ) THEN
    v_role := 'unit_leader';
  ELSE
    RAISE EXCEPTION 'not found' USING ERRCODE = 'MS404';
  END IF;

  IF EXISTS (SELECT 1 FROM public.preceptors p WHERE lower(btrim(p.email)) = v_email AND btrim(p.email) <> '') THEN
    RAISE EXCEPTION 'a preceptor with this email already exists' USING ERRCODE = 'MS409';
  END IF;

  BEGIN
    INSERT INTO public.preceptors
      (full_name, email, phone, unit_id, unit_name, shift_type, is_active, created_by, created_by_role)
    VALUES
      (btrim(p_full_name), v_email, NULLIF(btrim(coalesce(p_phone, '')), ''), v_unit_id, p_unit_key,
       p_shift, true, p_actor_profile_id, v_role)
    RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a preceptor with this email already exists' USING ERRCODE = 'MS409';
  END;

  v_corr := 'preceptor_created:' || p_request_id;

  INSERT INTO public.preceptor_assignment_events
    (actor_profile_id, actor_role, action, preceptor_id, unit_key, new_value, correlation_id, request_id, metadata)
  VALUES
    (p_actor_profile_id, v_role, 'create_preceptor', v_new_id, p_unit_key, btrim(p_full_name), v_corr, p_request_id,
     jsonb_build_object('preceptor_id', v_new_id, 'full_name', btrim(p_full_name), 'email', v_email, 'shift', p_shift));

  PERFORM public._emit_staff_notifications(
    v_corr, 'preceptor_created', p_actor_profile_id, v_role,
    'New preceptor created' || (CASE WHEN v_role = 'unit_leader' THEN ' by a Unit Leader (review)' ELSE '' END),
    NULL, v_new_id, p_unit_key, NULL, NULL, btrim(p_full_name), NULL, false, '/rotation/preceptors');

  v_result := jsonb_build_object('ok', true, 'preceptor_id', v_new_id, 'created_by_role', v_role);
  PERFORM public._preceptor_finish_request(p_request_id, v_result);
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.create_unit_preceptor(uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_unit_preceptor(uuid, text, text, text, text, text, text) TO service_role;


-- ############################################################################
-- 6. claim_due_staff_notifications -- the email worker's atomic claim (SKIP LOCKED), mirroring
--    claim_due_message_notification_deliveries. Recovers stale processing claims, claims a
--    bounded batch of due rows, marks them processing, returns them.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.claim_due_staff_notifications(
  p_worker        text,
  p_limit         integer DEFAULT 25,
  p_stale_seconds integer DEFAULT 300
)
RETURNS SETOF public.staff_notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF p_worker IS NULL OR length(btrim(p_worker)) = 0 THEN
    RAISE EXCEPTION 'p_worker must be non-null and non-empty';
  END IF;
  IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 100 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100';
  END IF;
  IF p_stale_seconds IS NULL OR p_stale_seconds <= 0 OR p_stale_seconds > 3600 THEN
    RAISE EXCEPTION 'p_stale_seconds must be between 1 and 3600';
  END IF;

  UPDATE public.staff_notifications d
  SET queue_status = 'retry_wait', next_attempt_at = v_now, locked_at = NULL, locked_by = NULL, updated_at = v_now
  WHERE d.queue_status = 'processing' AND d.locked_at IS NOT NULL
    AND d.locked_at < v_now - (p_stale_seconds || ' seconds')::interval
    AND d.attempts < d.max_attempts;

  RETURN QUERY
  WITH due AS (
    SELECT d.id FROM public.staff_notifications d
    WHERE d.queue_status IN ('queued', 'retry_wait')
      AND d.next_attempt_at IS NOT NULL AND d.next_attempt_at <= v_now
    ORDER BY d.next_attempt_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.staff_notifications d
  SET queue_status = 'processing', locked_at = v_now, locked_by = p_worker, updated_at = v_now
  FROM due WHERE d.id = due.id
  RETURNING d.*;
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_due_staff_notifications(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_staff_notifications(text, integer, integer) TO service_role;


-- ############################################################################
-- 7. mark_staff_notifications_read -- the ONLY way a recipient changes in-app read state. It sets
--    in_app_read_at (and nothing else) on the caller's OWN rows, resolved from auth.uid() via
--    portal_profile_id(). Granted to authenticated so the in-app client can call it with the user's
--    JWT; it cannot touch the email-queue columns or another user's rows.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.mark_staff_notifications_read(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_me    uuid := public.portal_profile_id();
  v_count int;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = 'MS403';
  END IF;
  UPDATE public.staff_notifications
     SET in_app_read_at = now(), updated_at = now()
   WHERE recipient_profile_id = v_me
     AND (p_ids IS NULL OR id = ANY(p_ids))
     AND in_app_read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.mark_staff_notifications_read(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_staff_notifications_read(uuid[]) TO authenticated, service_role;

COMMIT;
