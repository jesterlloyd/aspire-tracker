-- ============================================================================
-- PHASE 2C: scoped preceptor-assignment authorization + backend (PROPOSED, NOT APPLIED)
-- ============================================================================
-- *** GATED. Depends on Phase 2B (20260722000000_preceptor_mirror_repair_and_sync.sql):    ***
-- *** apply 2B FIRST, then this. The 2C RPCs set students.preceptor_id and rely on the 2B  ***
-- *** trigger to synchronize the Primary mirror. Apply MANUALLY in one transaction, after  ***
-- *** the preflight, and deploy the compatible app changes in the SAME maintenance window.  ***
--
-- LOCKED AUTHORITY MODEL
--   - Owner/Admin: may change Primary for any student.
--   - Unit Leader: may change Primary only for students within their ACTIVE unit scope.
--   - Interviewer / viewer / co_lead / any other is_staff() role: NOT allowed to change
--     Primary merely by satisfying is_staff().
--   - Unit Leaders never get direct table-write permission; they act only through the RPCs.
--
-- WHAT THIS MIGRATION ADDS
--   1. Provenance columns on preceptors (created_by, created_by_role).
--   2. preceptor_assignment_events  -- durable audit of record (mirrors unit_placement_request_events).
--   3. staff_notification_queue     -- durable, transactional Owner/Admin notification queue
--                                      (mirrors the message_notification_deliveries DESIGN,
--                                       decoupled from the conversations model; see the doc).
--   4. A BEFORE UPDATE OF preceptor_id guard on students that fails closed.
--   5. Scoped SECURITY DEFINER RPCs: assign_primary_preceptor, set_secondary_coverage_preceptor,
--      create_unit_preceptor, plus a shared authorization helper.
--
-- SECURITY: no RLS is widened; no anon/authenticated write grant is added; every new object
--   is owner/admin SELECT + service-role write, exactly like the existing UL portal tables.
--   Every function is SECURITY DEFINER with a fixed search_path and is granted to service_role
--   only. Errors use the established MS4xx SQLSTATE convention.
-- ============================================================================

BEGIN;

-- ############################################################################
-- 1. Preceptor provenance (new columns; additive, nullable).
-- ############################################################################
ALTER TABLE public.preceptors
  ADD COLUMN IF NOT EXISTS created_by      uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_role text
    CONSTRAINT chk_preceptors_created_by_role CHECK (created_by_role IS NULL OR created_by_role IN ('owner_admin', 'unit_leader'));
COMMENT ON COLUMN public.preceptors.created_by IS
  'Phase 2C: the user_profiles.id that created this preceptor (NULL for pre-2C rows).';
COMMENT ON COLUMN public.preceptors.created_by_role IS
  'Phase 2C: owner_admin | unit_leader; provenance for Unit-Leader-created preceptors.';


-- ############################################################################
-- 2. preceptor_assignment_events -- the audit OF RECORD (append-only).
--    Mirrors public.unit_placement_request_events: actor + role + unit + from/to + reason.
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.preceptor_assignment_events (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_profile_id uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  actor_role       text        NOT NULL CHECK (actor_role IN ('owner_admin', 'unit_leader')),
  action           text        NOT NULL CHECK (action IN (
                     'assign_primary', 'add_secondary', 'add_coverage',
                     'replace_secondary', 'replace_coverage', 'end_secondary', 'end_coverage',
                     'create_preceptor', 'matches_anomaly')),
  student_id       uuid        REFERENCES public.students(id)   ON DELETE SET NULL,  -- NULL for create_preceptor
  preceptor_id     uuid        REFERENCES public.preceptors(id) ON DELETE SET NULL,
  cohort_id        uuid        REFERENCES public.cohorts(id)    ON DELETE SET NULL,
  unit_key         text,
  assignment_role  text        CHECK (assignment_role IS NULL OR assignment_role IN ('primary', 'secondary', 'coverage')),
  old_value        text,       -- prior preceptor_id (text) or NULL
  new_value        text,       -- new preceptor_id (text) or NULL
  reason           text,
  request_id       text,       -- correlation id from the API layer (log-only convention, persisted here)
  metadata         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pae_student ON public.preceptor_assignment_events (student_id);
CREATE INDEX IF NOT EXISTS idx_pae_actor   ON public.preceptor_assignment_events (actor_profile_id);
CREATE INDEX IF NOT EXISTS idx_pae_created ON public.preceptor_assignment_events (created_at DESC);

ALTER TABLE public.preceptor_assignment_events ENABLE ROW LEVEL SECURITY;
-- SELECT for active owner/admin only; NO write policy (service-role / definer writes only),
-- exactly like student_preceptor_assignments and the UL portal tables.
CREATE POLICY "preceptor_assignment_events_owner_admin_read"
  ON public.preceptor_assignment_events FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());


-- ############################################################################
-- 3. staff_notification_queue -- durable, transactional Owner/Admin notification queue.
--    Mirrors the message_notification_deliveries design (enqueue-before-send, UNIQUE
--    idempotency, queue_status, retry columns) WITHOUT the conversations/messages coupling.
-- ############################################################################
CREATE TABLE IF NOT EXISTS public.staff_notification_queue (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type             text        NOT NULL,
  recipient_kind         text        NOT NULL DEFAULT 'shared_inbox' CHECK (recipient_kind IN ('shared_inbox')),
  recipient_email        text        NOT NULL,
  triggered_by_profile_id uuid       REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  subject                text,
  body                   text,
  payload                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key        text        NOT NULL,
  queue_status           text        NOT NULL DEFAULT 'queued'
                           CHECK (queue_status IN ('queued', 'processing', 'sent', 'failed', 'suppressed')),
  attempts               int         NOT NULL DEFAULT 0,
  max_attempts           int         NOT NULL DEFAULT 5,
  next_attempt_at        timestamptz NOT NULL DEFAULT now(),
  locked_at              timestamptz,
  locked_by              text,
  resend_email_id        text,
  error_detail           text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_snq_idempotency UNIQUE (idempotency_key)
);
-- Due-row index for a future drain worker (mirrors idx_mnd_due).
CREATE INDEX IF NOT EXISTS idx_snq_due
  ON public.staff_notification_queue (next_attempt_at)
  WHERE queue_status = 'queued';

ALTER TABLE public.staff_notification_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_notification_queue_owner_admin_read"
  ON public.staff_notification_queue FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());


-- ############################################################################
-- 4. Guard: only owner/admin (direct staff path) or an authorized RPC may change
--    students.preceptor_id. Fails closed. Fixed search_path.
--
-- HOW THE RPC IS PERMITTED WITHOUT A GENERAL BYPASS:
--   The guard allows a change only when BOTH (a) a transaction-local marker
--   app.preceptor_change_authorized is set to the acting profile id AND (b) current_user is a
--   privileged (non-client) role. The scoped RPCs set the marker right before their UPDATE.
--     - A CLIENT (role authenticated/anon) can never satisfy (b), and cannot set the marker
--       through PostgREST (no raw SQL), so the marker is NOT a sole gate -> requirement met.
--     - A DIFFERENT SECURITY DEFINER function that does NOT set the marker fails (a), so there
--       is no general definer bypass.
--   Separately, the existing owner/admin STAFF PATH (a direct client UPDATE by an active
--   owner/admin) is allowed, as the locked model requires.
-- ############################################################################
-- SECURITY INVOKER is REQUIRED here (not DEFINER): the guard must observe the REAL execution
-- role via current_user. A direct client update runs as 'authenticated'; an update inside a
-- SECURITY DEFINER RPC runs as the RPC owner (a privileged role). A DEFINER guard would always
-- see its own owner and could never tell the two apart. Fixed search_path keeps it safe.
CREATE OR REPLACE FUNCTION public.guard_students_preceptor_id_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $guard$
DECLARE
  v_marker      text := current_setting('app.preceptor_change_authorized', true);
  v_privileged  boolean := current_user NOT IN ('authenticated', 'anon');
BEGIN
  IF NEW.preceptor_id IS NOT DISTINCT FROM OLD.preceptor_id THEN
    RETURN NEW;  -- not a preceptor change; nothing to guard
  END IF;

  -- (A) Authorized RPC / trusted server path: marker set AND running as a privileged role.
  IF v_marker IS NOT NULL AND length(v_marker) > 0 AND v_privileged THEN
    RETURN NEW;
  END IF;

  -- (B) Existing owner/admin staff path: a direct client update by an active owner/admin.
  IF public.is_active_owner_or_admin() THEN
    RETURN NEW;
  END IF;

  -- Everything else (interviewer/viewer/co_lead/unit_leader direct, or an unmarked context)
  -- is denied, fail closed.
  RAISE EXCEPTION 'preceptor_id may only be changed by an owner/admin or an authorized assignment RPC'
    USING ERRCODE = 'MS403';
END;
$guard$;

DROP TRIGGER IF EXISTS trg_guard_students_preceptor_id ON public.students;
CREATE TRIGGER trg_guard_students_preceptor_id
  BEFORE UPDATE OF preceptor_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.guard_students_preceptor_id_change();

REVOKE ALL ON FUNCTION public.guard_students_preceptor_id_change() FROM PUBLIC;


-- ############################################################################
-- 5a. Shared authorization helper. Returns the acting role ('owner_admin' | 'unit_leader')
--     for p_actor_profile_id against p_student_id, or RAISES MS404 (non-enumerating). Also
--     enforces the completed-rotation reason/window rule, mirroring completedStillVisible
--     (api/lib/unitLeaderScopeRules.js): completed within 90 days requires a reason; completed
--     beyond the window is denied.
-- ############################################################################
CREATE OR REPLACE FUNCTION public._preceptor_assert_actor_for_student(
  p_actor_profile_id uuid,
  p_student_id       uuid,
  p_reason           text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_now      timestamptz := now();
  v_stu      record;
  v_unit_key text;
  v_role     text;
BEGIN
  SELECT s.id, s.cohort_id, s.matched_unit_id, s.status,
         s.rotation_completed_at, s.rotation_end_date
    INTO v_stu
  FROM public.students s
  WHERE s.id = p_student_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'MS404';
  END IF;

  -- Canonical unit for the student: matched_unit_id -> units.unit_name (= scope unit_key).
  SELECT u.unit_name INTO v_unit_key
  FROM public.units u WHERE u.id = v_stu.matched_unit_id;

  -- Actor role. Active owner/admin (role or is_owner column) acts globally.
  IF EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.id = p_actor_profile_id
      AND COALESCE(p.is_active, true) = true
      AND (p.role IN ('owner', 'admin') OR p.is_owner IS TRUE)
  ) THEN
    v_role := 'owner_admin';
  ELSIF EXISTS (
    SELECT 1 FROM public.user_role_grants g
    WHERE g.user_profile_id = p_actor_profile_id
      AND g.role = 'unit_leader'
      AND g.revoked_at IS NULL
      AND g.starts_at <= v_now
      AND (g.expires_at IS NULL OR g.expires_at > v_now)
  ) AND v_unit_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_unit_scopes s
    WHERE s.user_profile_id = p_actor_profile_id
      AND s.unit_key = v_unit_key
      AND (s.cohort_id IS NULL OR s.cohort_id = v_stu.cohort_id)
      AND s.revoked_at IS NULL
      AND s.starts_at <= v_now
      AND (s.expires_at IS NULL OR s.expires_at > v_now)
  ) THEN
    v_role := 'unit_leader';
  ELSE
    RAISE EXCEPTION 'not found' USING ERRCODE = 'MS404';  -- non-enumerating: out-of-scope == not found
  END IF;

  -- Completed-rotation reason/window. Mirrors COALESCE(rotation_completed_at, rotation_end_date)
  -- with the 90-day inclusive window; fail closed when the date is unknown for a completed student.
  IF v_stu.status = 'Completed' THEN
    IF COALESCE(v_stu.rotation_completed_at, v_stu.rotation_end_date::timestamptz) IS NULL
       OR COALESCE(v_stu.rotation_completed_at, v_stu.rotation_end_date::timestamptz) < v_now - INTERVAL '90 days' THEN
      RAISE EXCEPTION 'completed rotation is outside the 90-day change window'
        USING ERRCODE = 'MS403';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
      RAISE EXCEPTION 'a reason is required to change an assignment for a completed rotation'
        USING ERRCODE = 'MS400';
    END IF;
  END IF;

  RETURN v_role;
END;
$fn$;
REVOKE ALL ON FUNCTION public._preceptor_assert_actor_for_student(uuid, uuid, text) FROM PUBLIC;


-- ############################################################################
-- 5b. assign_primary_preceptor -- change/assign the Primary. Sets students.preceptor_id and
--     lets the Phase 2B trigger synchronize the Primary mirror.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.assign_primary_preceptor(
  p_actor_profile_id uuid,
  p_student_id       uuid,
  p_preceptor_id     uuid,
  p_reason           text DEFAULT NULL,
  p_notify_email     text DEFAULT NULL,
  p_request_id       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_role      text;
  v_old       uuid;
  v_cohort    uuid;
  v_unit_key  text;
  v_match_ct  int;
BEGIN
  IF p_actor_profile_id IS NULL OR p_student_id IS NULL OR p_preceptor_id IS NULL THEN
    RAISE EXCEPTION 'missing required argument' USING ERRCODE = 'MS400';
  END IF;

  -- Authorize + completed-window (locks the student row).
  v_role := public._preceptor_assert_actor_for_student(p_actor_profile_id, p_student_id, p_reason);

  SELECT s.preceptor_id, s.cohort_id INTO v_old, v_cohort
  FROM public.students s WHERE s.id = p_student_id;
  SELECT u.unit_name INTO v_unit_key
  FROM public.students s JOIN public.units u ON u.id = s.matched_unit_id WHERE s.id = p_student_id;

  -- The new Primary must be an ACTIVE preceptor. Cross-unit assignment is permitted (the
  -- canonical model does not bind a student's preceptor to the student's unit); see the doc.
  IF NOT EXISTS (SELECT 1 FROM public.preceptors p WHERE p.id = p_preceptor_id AND p.is_active IS TRUE) THEN
    RAISE EXCEPTION 'preceptor is inactive or does not exist' USING ERRCODE = 'MS400';
  END IF;

  IF v_old IS NOT DISTINCT FROM p_preceptor_id THEN
    RAISE EXCEPTION 'that preceptor is already the primary' USING ERRCODE = 'MS409';
  END IF;

  -- Authorize this specific column change to the guard, then write. The 2B AFTER trigger
  -- ends the stale active-primary row, inserts the new one, and aligns the display + single
  -- current-cohort match mirror.
  PERFORM set_config('app.preceptor_change_authorized', p_actor_profile_id::text, true);
  UPDATE public.students SET preceptor_id = p_preceptor_id WHERE id = p_student_id;
  PERFORM set_config('app.preceptor_change_authorized', '', true);

  -- matches anomaly: if the student has >1 same-cohort match row, the 2B trigger left the
  -- match FK unsynced on purpose. Record a structured event for Owner/Admin review; the
  -- canonical Primary change and the normalized model stay correct.
  SELECT count(*) INTO v_match_ct FROM public.matches m
  WHERE m.student_id = p_student_id AND m.cohort_id = v_cohort;
  IF v_match_ct > 1 THEN
    INSERT INTO public.preceptor_assignment_events
      (actor_profile_id, actor_role, action, student_id, preceptor_id, cohort_id, unit_key,
       assignment_role, old_value, new_value, reason, request_id, metadata)
    VALUES
      (p_actor_profile_id, v_role, 'matches_anomaly', p_student_id, p_preceptor_id, v_cohort, v_unit_key,
       'primary', v_old::text, p_preceptor_id::text, p_reason, p_request_id,
       jsonb_build_object('same_cohort_match_rows', v_match_ct,
                          'note', 'match FK not auto-synced; multiple same-cohort match rows'));
  END IF;

  -- Audit of record.
  INSERT INTO public.preceptor_assignment_events
    (actor_profile_id, actor_role, action, student_id, preceptor_id, cohort_id, unit_key,
     assignment_role, old_value, new_value, reason, request_id)
  VALUES
    (p_actor_profile_id, v_role, 'assign_primary', p_student_id, p_preceptor_id, v_cohort, v_unit_key,
     'primary', v_old::text, p_preceptor_id::text, p_reason, p_request_id);

  -- Durable Owner/Admin notification, in this transaction.
  PERFORM public._enqueue_staff_notification(
    'preceptor_primary_changed',
    COALESCE(p_notify_email, 'aspire@cshs.org'),
    p_actor_profile_id,
    'Primary preceptor changed',
    jsonb_build_object('student_id', p_student_id, 'old_preceptor_id', v_old,
                       'new_preceptor_id', p_preceptor_id, 'actor_role', v_role,
                       'unit_key', v_unit_key, 'reason', p_reason),
    'preceptor_primary:' || p_student_id::text || ':' || p_preceptor_id::text || ':' || extract(epoch from now())::bigint::text);

  RETURN jsonb_build_object('ok', true, 'student_id', p_student_id,
                            'old_preceptor_id', v_old, 'new_preceptor_id', p_preceptor_id, 'actor_role', v_role);
END;
$fn$;
REVOKE ALL ON FUNCTION public.assign_primary_preceptor(uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_primary_preceptor(uuid, uuid, uuid, text, text, text) TO service_role;


-- ############################################################################
-- 5c. set_secondary_coverage_preceptor -- add / replace / end Secondary or Coverage through
--     the canonical student_preceptor_assignments. Never touches Primary.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.set_secondary_coverage_preceptor(
  p_actor_profile_id uuid,
  p_student_id       uuid,
  p_role             text,               -- 'secondary' | 'coverage'
  p_action           text,               -- 'add' | 'replace' | 'end'
  p_preceptor_id     uuid   DEFAULT NULL, -- required for add/replace
  p_assignment_id    uuid   DEFAULT NULL, -- required for end
  p_reason           text   DEFAULT NULL,
  p_notes            text   DEFAULT NULL,
  p_notify_email     text   DEFAULT NULL,
  p_request_id       text   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_role_actor text;
  v_cohort     uuid;
  v_unit_key   text;
  v_new_id     uuid;
  v_action_lbl text;
BEGIN
  IF p_role NOT IN ('secondary', 'coverage') THEN
    RAISE EXCEPTION 'role must be secondary or coverage' USING ERRCODE = 'MS400';
  END IF;
  IF p_action NOT IN ('add', 'replace', 'end') THEN
    RAISE EXCEPTION 'action must be add, replace, or end' USING ERRCODE = 'MS400';
  END IF;

  v_role_actor := public._preceptor_assert_actor_for_student(p_actor_profile_id, p_student_id, p_reason);
  SELECT s.cohort_id INTO v_cohort FROM public.students s WHERE s.id = p_student_id;
  SELECT u.unit_name INTO v_unit_key
  FROM public.students s JOIN public.units u ON u.id = s.matched_unit_id WHERE s.id = p_student_id;

  IF p_action = 'end' THEN
    IF p_assignment_id IS NULL THEN
      RAISE EXCEPTION 'assignment id is required to end an assignment' USING ERRCODE = 'MS400';
    END IF;
    UPDATE public.student_preceptor_assignments a
       SET status = 'ended', end_date = current_date, updated_at = now()
     WHERE a.id = p_assignment_id
       AND a.student_id = p_student_id
       AND a.role IN ('secondary', 'coverage')  -- never end a primary here
       AND a.status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'not found' USING ERRCODE = 'MS404';
    END IF;
    v_action_lbl := 'end_' || p_role;
  ELSE
    IF p_preceptor_id IS NULL THEN
      RAISE EXCEPTION 'preceptor id is required to add or replace' USING ERRCODE = 'MS400';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.preceptors p WHERE p.id = p_preceptor_id AND p.is_active IS TRUE) THEN
      RAISE EXCEPTION 'preceptor is inactive or does not exist' USING ERRCODE = 'MS400';
    END IF;

    -- Replace: end the existing active row of this role first (history preserved).
    IF p_action = 'replace' THEN
      UPDATE public.student_preceptor_assignments a
         SET status = 'ended', end_date = current_date, updated_at = now()
       WHERE a.student_id = p_student_id AND a.cohort_id = v_cohort
         AND a.role = p_role AND a.status = 'active';
    END IF;

    -- Insert the new active relationship. The ppm3 index rejects the same preceptor being
    -- active in two roles (incl. primary) for this student/cohort -> 23505 -> MS409.
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
    v_action_lbl := (CASE WHEN p_action = 'replace' THEN 'replace_' ELSE 'add_' END) || p_role;
  END IF;

  INSERT INTO public.preceptor_assignment_events
    (actor_profile_id, actor_role, action, student_id, preceptor_id, cohort_id, unit_key,
     assignment_role, old_value, new_value, reason, request_id)
  VALUES
    (p_actor_profile_id, v_role_actor, v_action_lbl, p_student_id, p_preceptor_id, v_cohort, v_unit_key,
     p_role, NULL, COALESCE(p_preceptor_id::text, p_assignment_id::text), p_reason, p_request_id);

  PERFORM public._enqueue_staff_notification(
    'preceptor_' || v_action_lbl,
    COALESCE(p_notify_email, 'aspire@cshs.org'),
    p_actor_profile_id,
    'Preceptor assignment updated',
    jsonb_build_object('student_id', p_student_id, 'role', p_role, 'action', p_action,
                       'preceptor_id', p_preceptor_id, 'assignment_id', p_assignment_id,
                       'actor_role', v_role_actor, 'unit_key', v_unit_key, 'reason', p_reason),
    'preceptor_' || v_action_lbl || ':' || p_student_id::text || ':' ||
      COALESCE(p_preceptor_id::text, p_assignment_id::text) || ':' || extract(epoch from now())::bigint::text);

  RETURN jsonb_build_object('ok', true, 'assignment_id', COALESCE(v_new_id, p_assignment_id), 'action', v_action_lbl);
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_secondary_coverage_preceptor(uuid, uuid, text, text, uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_secondary_coverage_preceptor(uuid, uuid, text, text, uuid, uuid, text, text, text, text) TO service_role;


-- ############################################################################
-- 5d. create_unit_preceptor -- canonical Preceptor Directory record, immediately assignable,
--     with provenance and normalized-email dedup.
-- ############################################################################
CREATE OR REPLACE FUNCTION public.create_unit_preceptor(
  p_actor_profile_id uuid,
  p_full_name        text,
  p_email            text,
  p_unit_key         text,
  p_shift            text,
  p_phone            text DEFAULT NULL,
  p_notify_email     text DEFAULT NULL,
  p_request_id       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_now       timestamptz := now();
  v_role      text;
  v_unit_id   uuid;
  v_email     text := lower(btrim(coalesce(p_email, '')));
  v_new_id    uuid;
BEGIN
  IF btrim(coalesce(p_full_name, '')) = '' THEN RAISE EXCEPTION 'full name is required' USING ERRCODE = 'MS400'; END IF;
  IF v_email = '' OR position('@' in v_email) = 0 THEN RAISE EXCEPTION 'a valid email is required' USING ERRCODE = 'MS400'; END IF;
  IF p_shift NOT IN ('Day', 'Night', 'Mid', 'Variable') THEN RAISE EXCEPTION 'shift must be Day, Night, Mid, or Variable' USING ERRCODE = 'MS400'; END IF;

  -- Unit required; resolve to a units row.
  SELECT u.id INTO v_unit_id FROM public.units u WHERE u.unit_name = p_unit_key LIMIT 1;
  IF v_unit_id IS NULL THEN RAISE EXCEPTION 'unit not found' USING ERRCODE = 'MS400'; END IF;

  -- Actor: active owner/admin (global) OR unit_leader with an active scope for this unit.
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

  -- Dedup by normalized email (matches preceptors_email_lower_unique_idx on lower(trim(email))).
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

  INSERT INTO public.preceptor_assignment_events
    (actor_profile_id, actor_role, action, preceptor_id, unit_key, new_value, request_id, metadata)
  VALUES
    (p_actor_profile_id, v_role, 'create_preceptor', v_new_id, p_unit_key, v_new_id::text, p_request_id,
     jsonb_build_object('full_name', btrim(p_full_name), 'email', v_email, 'shift', p_shift));

  -- Owner/Admin review notification (durable).
  PERFORM public._enqueue_staff_notification(
    'preceptor_created',
    COALESCE(p_notify_email, 'aspire@cshs.org'),
    p_actor_profile_id,
    'New preceptor created' || (CASE WHEN v_role = 'unit_leader' THEN ' by a Unit Leader (review)' ELSE '' END),
    jsonb_build_object('preceptor_id', v_new_id, 'full_name', btrim(p_full_name), 'email', v_email,
                       'unit_key', p_unit_key, 'shift', p_shift, 'created_by_role', v_role),
    'preceptor_created:' || v_new_id::text);

  RETURN jsonb_build_object('ok', true, 'preceptor_id', v_new_id, 'created_by_role', v_role);
END;
$fn$;
REVOKE ALL ON FUNCTION public.create_unit_preceptor(uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_unit_preceptor(uuid, text, text, text, text, text, text, text) TO service_role;


-- ############################################################################
-- 5e. _enqueue_staff_notification -- durable enqueue helper (no ON CONFLICT DO NOTHING: a
--     duplicate aborts the whole transaction rather than committing a change with no
--     notification, mirroring messages_start_conversation).
-- ############################################################################
CREATE OR REPLACE FUNCTION public._enqueue_staff_notification(
  p_event_type       text,
  p_recipient_email  text,
  p_triggered_by     uuid,
  p_subject          text,
  p_payload          jsonb,
  p_idempotency_key  text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.staff_notification_queue
    (event_type, recipient_kind, recipient_email, triggered_by_profile_id, subject, payload,
     idempotency_key, queue_status, next_attempt_at)
  VALUES
    (p_event_type, 'shared_inbox', p_recipient_email, p_triggered_by, p_subject, COALESCE(p_payload, '{}'::jsonb),
     p_idempotency_key, 'queued', now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public._enqueue_staff_notification(text, text, uuid, text, jsonb, text) FROM PUBLIC;

COMMIT;
