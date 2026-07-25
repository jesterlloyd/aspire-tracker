-- 20260725000000_unit_leader_evaluation_release_gate.sql
-- ============================================================================
-- Unit Leader Evaluations: release/visibility gate + immutable attribution
-- snapshot + append-only lifecycle audit + exact quantitative allowlist +
-- database authorization functions.
-- ============================================================================
--
-- AUTHORED, NOT APPLIED. Jester applies this manually through the Owner SQL gate
-- (docs/security/OWNER_SQL_GATE.md) after review. Governing contract:
-- docs/security/UNIT_LEADER_EVALUATIONS_MIGRATION_CONTRACT.md.
--
-- This revision incorporates the SECOND Owner pre-apply review (six blockers):
--   1. Table privileges: the events table denies UPDATE/DELETE/TRUNCATE (including to
--      service_role); the release table allows only SELECT/INSERT/UPDATE and denies
--      DELETE/TRUNCATE. Row triggers cannot block TRUNCATE, so statement-level BEFORE
--      TRUNCATE triggers back the grants up.
--   2. Evaluated-preceptor attribution is captured exactly: preceptor_progress from the
--      assignment respondent; student_preceptor_eval from responses.evaluated_target
--      .preceptor_id (validated against preceptors). If it cannot be resolved, the
--      snapshot is incomplete (hist_preceptor_id NULL) and release is refused.
--   3. Lifecycle functions take FOR UPDATE row locks and enforce expected-state
--      predicates, so concurrent actions cannot produce inaccurate transitions/audit.
--   4. Quantitative exposure is an EXACT per-instrument path allowlist held in a
--      controlled table (evaluation_unit_quantitative_keys); only allowlisted numeric
--      paths are returned. Unknown keys default to hidden.
--   5. No stable response identifier is returned to Unit Leaders (public_token removed;
--      no by-token detail RPC). Short-lived/context-bound tokens are deferred to the
--      follow-on server API branch; response identifiers stay internal.
--   6. Verification corrected/expanded (see the verification script), including the
--      SECURITY DEFINER expectation for the pure allowlist helper.
--
-- AUTHORIZATION NOTE (surfaced for the Owner): Owner/Admin authority uses the repo's
-- canonical is_active_owner_or_admin(), whose exact live definition is:
--     SELECT EXISTS (SELECT 1 FROM public.user_profiles
--                    WHERE auth_user_id = auth.uid()
--                      AND role IN ('owner','admin')
--                      AND COALESCE(is_active, true) = true);
-- It validates role + active profile from the caller's JWT. It does NOT consult
-- user_role_grants, because owner/admin are not represented there (that table's CHECK
-- allows only student/unit_leader/academic_partner). For staff, "revocation" is
-- is_active = false; grant expiration does not apply to staff roles. The Unit Leader
-- READ side does use the active role-grant model (has_active_role_grant('unit_leader'),
-- which honors revocation and expiration). If the Owner wants staff authority tied to a
-- grant/expiry model, that is a separate global change to is_active_owner_or_admin and
-- the authz foundation, out of scope for this migration.
--
-- PREREQUISITES (already applied in production):
--   * 20260712000007_phase2_authz_foundation.sql  (user_role_grants, user_unit_scopes,
--     portal_profile_id(), has_active_role_grant(), my_unit_scope_keys())
--   * 20260716000000_messages_phase1_schema_foundation.sql  (is_active_owner_or_admin())
--   * 20260720000000_unit_leader_portal_foundation.sql
--     (students.rotation_end_date, students.rotation_completed_at)
--   * migration_evaluation_stage1_schema.sql  (evaluation_responses, evaluation_instruments)
--   * 20260613000001_ps2b_... / 20260616000000_sr2_...  (the two approved submit RPCs;
--     traced for the response shape, the evaluated_target, and the quantitative paths)
--
-- APPROVED INSTRUMENTS (by slug):
--   student_preceptor_eval  (Preceptor & Unit Feedback)   -- student is respondent
--   preceptor_progress      (Preceptor Readiness Assessment) -- preceptor is respondent
--
-- LOCKED POLICY: unit-level only; free text hidden; no identity; no identifying
-- timestamps; Owner/Admin-only release; delayed release (rotation end + 7 days); NO
-- minimum-count suppression (n = 1 is displayed; Owner-accepted contextual
-- re-identification risk; the UI must never claim a one-response result is anonymous).
--
-- Full verification and rollback:
--   db/audit/unit_leader_evaluation_release_gate_verification.sql
--   db/audit/unit_leader_evaluation_release_gate_rollback.sql
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- (0) Shared write-blocker (used to deny DELETE/TRUNCATE, and UPDATE where noted).
--     Statement-level TRUNCATE triggers are required because row triggers do not fire
--     on TRUNCATE.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ul_eval_block_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION '% on % is not permitted (audit-preserving gate)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

-- ────────────────────────────────────────────────────────────────
-- (1) Release / visibility table (snapshot + lifecycle, 1:1 with a response).
--     No public token: no stable response identifier is exposed to Unit Leaders.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.evaluation_response_unit_release (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id              uuid NOT NULL UNIQUE
                           REFERENCES public.evaluation_responses(id) ON DELETE RESTRICT,
  assignment_id            uuid NOT NULL,
  instrument_id            uuid NOT NULL REFERENCES public.evaluation_instruments(id),
  instrument_slug          text NOT NULL,
  timepoint                text NOT NULL,

  -- Immutable historical attribution snapshot (captured once; guarded by trigger).
  hist_unit_id             uuid,
  hist_unit_key            text,          -- units.unit_name at capture = the scope key
  hist_preceptor_id        uuid,          -- evaluated preceptor; audit only; NULL = unresolved
  hist_preceptor_label     text,          -- audit only
  hist_cohort_id           uuid,
  hist_cohort_label        text,
  hist_rotation_id         uuid,
  hist_rotation_end        timestamptz,   -- COALESCE(rotation_completed_at, rotation_end_date)
  unit_leader_eligible_at  timestamptz,   -- hist_rotation_end + 7 days; NULL = never eligible
  snapshot_source          text NOT NULL DEFAULT 'submission_trigger'
                           CHECK (snapshot_source IN
                             ('submission_trigger', 'backfill_verified', 'backfill_unverified')),
  snapshot_captured_at     timestamptz NOT NULL DEFAULT now(),

  -- Mutable release lifecycle. release_state is the authoritative visibility state.
  -- revoked_at/by are the LAST revocation record and are never cleared; reads gate on
  -- release_state, not revoked_at.
  release_state            text NOT NULL DEFAULT 'pending'
                           CHECK (release_state IN
                             ('pending', 'moderated', 'released', 'revoked', 'ineligible')),
  moderation_state         text NOT NULL DEFAULT 'pending'
                           CHECK (moderation_state IN ('pending', 'cleared', 'blocked')),
  quantitative_visible     boolean NOT NULL DEFAULT false,
  free_text_visible        boolean NOT NULL DEFAULT false,
  released_at              timestamptz,
  released_by              uuid REFERENCES public.user_profiles(id),
  moderated_at             timestamptz,
  moderated_by             uuid REFERENCES public.user_profiles(id),
  revoked_at               timestamptz,
  revoked_by               uuid REFERENCES public.user_profiles(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_ul_eval_release_instrument_approved
    CHECK (instrument_slug IN ('student_preceptor_eval', 'preceptor_progress')),
  CONSTRAINT chk_ul_eval_free_text_hidden_first_release
    CHECK (free_text_visible = false),
  CONSTRAINT chk_ul_eval_released_visibility
    CHECK ((release_state = 'released') = (quantitative_visible = true))
);

COMMENT ON TABLE public.evaluation_response_unit_release IS
  'Unit Leader evaluation release gate. One row per approved-instrument evaluation_response, holding an immutable submission-time attribution snapshot (hist_*) and a mutable Owner/Admin-controlled release lifecycle. Unit Leaders never read this table directly (RLS owner/admin only) and never receive any stable response identifier; they read shaped, scoped, quantitative-only data through the ul_eval_* functions. Free text and identity are never exposed. hist_preceptor_id NULL means the evaluated preceptor could not be resolved: the snapshot is incomplete and the row cannot be released. No minimum-count suppression.';
COMMENT ON COLUMN public.evaluation_response_unit_release.hist_preceptor_id IS
  'Immutable evaluated-preceptor attribution for AUDIT ONLY. preceptor_progress: the assignment respondent_preceptor_id. student_preceptor_eval: responses.evaluated_target.preceptor_id, validated against preceptors. NULL = unresolved => snapshot incomplete => not releasable. Never returned to a Unit Leader.';

CREATE INDEX IF NOT EXISTS idx_ul_eval_release_scope
  ON public.evaluation_response_unit_release (hist_unit_key, instrument_slug, timepoint)
  WHERE release_state = 'released';
CREATE INDEX IF NOT EXISTS idx_ul_eval_release_state
  ON public.evaluation_response_unit_release (release_state);
CREATE INDEX IF NOT EXISTS idx_ul_eval_release_eligible
  ON public.evaluation_response_unit_release (unit_leader_eligible_at);
CREATE INDEX IF NOT EXISTS idx_ul_eval_release_instrument
  ON public.evaluation_response_unit_release (instrument_id);

-- Privileges: least privilege. service_role may SELECT/INSERT/UPDATE but NOT DELETE or
-- TRUNCATE. authenticated gets SELECT only (owner/admin via RLS). The SECURITY DEFINER
-- functions run as the table owner, so they operate regardless of these role grants.
ALTER TABLE public.evaluation_response_unit_release ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.evaluation_response_unit_release FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.evaluation_response_unit_release TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.evaluation_response_unit_release TO service_role;
DROP POLICY IF EXISTS "owner_admin_select_ul_eval_release"
  ON public.evaluation_response_unit_release;
CREATE POLICY "owner_admin_select_ul_eval_release"
  ON public.evaluation_response_unit_release FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());

-- Deny DELETE (row) and TRUNCATE (statement) on the release table. UPDATE stays allowed
-- and is governed by the snapshot-immutability guard below.
DROP TRIGGER IF EXISTS trg_ul_eval_release_no_delete ON public.evaluation_response_unit_release;
CREATE TRIGGER trg_ul_eval_release_no_delete
  BEFORE DELETE ON public.evaluation_response_unit_release
  FOR EACH ROW EXECUTE FUNCTION public._ul_eval_block_write();
DROP TRIGGER IF EXISTS trg_ul_eval_release_no_truncate ON public.evaluation_response_unit_release;
CREATE TRIGGER trg_ul_eval_release_no_truncate
  BEFORE TRUNCATE ON public.evaluation_response_unit_release
  FOR EACH STATEMENT EXECUTE FUNCTION public._ul_eval_block_write();

-- ────────────────────────────────────────────────────────────────
-- (2) Append-only lifecycle audit table. UPDATE, DELETE, and TRUNCATE all denied
--     (grants + triggers), including to service_role. Nothing is ever overwritten.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.evaluation_response_unit_release_events (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id            uuid NOT NULL,   -- durable; intentionally NOT a cascading FK
  release_id             uuid,            -- the release row id at event time (informational)
  event_type             text NOT NULL
                         CHECK (event_type IN ('moderate', 'release', 'revoke', 're_release')),
  decision               text CHECK (decision IS NULL OR decision IN ('cleared', 'blocked')),
  prior_release_state    text,
  new_release_state      text,
  prior_moderation_state text,
  new_moderation_state   text,
  actor_profile_id       uuid NOT NULL REFERENCES public.user_profiles(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  notes                  text
);

COMMENT ON TABLE public.evaluation_response_unit_release_events IS
  'Append-only audit log of every Unit Leader evaluation lifecycle action. Records prior/new release+moderation state, the exact response, the acting Owner/Admin profile, the timestamp, and the moderation decision. INSERT-only: UPDATE/DELETE/TRUNCATE are denied by grants and triggers, including to service_role.';

CREATE INDEX IF NOT EXISTS idx_ul_eval_events_response
  ON public.evaluation_response_unit_release_events (response_id, created_at);

ALTER TABLE public.evaluation_response_unit_release_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.evaluation_response_unit_release_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.evaluation_response_unit_release_events TO authenticated;
GRANT SELECT, INSERT ON TABLE public.evaluation_response_unit_release_events TO service_role;
DROP POLICY IF EXISTS "owner_admin_select_ul_eval_events"
  ON public.evaluation_response_unit_release_events;
CREATE POLICY "owner_admin_select_ul_eval_events"
  ON public.evaluation_response_unit_release_events FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());

DROP TRIGGER IF EXISTS trg_ul_eval_events_no_update_delete
  ON public.evaluation_response_unit_release_events;
CREATE TRIGGER trg_ul_eval_events_no_update_delete
  BEFORE UPDATE OR DELETE ON public.evaluation_response_unit_release_events
  FOR EACH ROW EXECUTE FUNCTION public._ul_eval_block_write();
DROP TRIGGER IF EXISTS trg_ul_eval_events_no_truncate
  ON public.evaluation_response_unit_release_events;
CREATE TRIGGER trg_ul_eval_events_no_truncate
  BEFORE TRUNCATE ON public.evaluation_response_unit_release_events
  FOR EACH STATEMENT EXECUTE FUNCTION public._ul_eval_block_write();

-- ────────────────────────────────────────────────────────────────
-- (3) Exact per-instrument quantitative allowlist (controlled table). Each row is an
--     exact JSON path under responses whose numeric value MAY be exposed. Anything not
--     listed is hidden. The section CHECK prevents curating a free-text / identifying
--     section (narrative, evaluated_target, confidential_team_comments, attestation).
--
--     Seeded here with the fixed, repo-verifiable numeric paths. The per-item codes
--     (developmental_feedback.competency.<code>.rating, preceptor_support.<code>, ...)
--     live in the instruments' private content, so staff curate those exact paths into
--     this table before those metrics surface. Until curated, they are hidden.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.evaluation_unit_quantitative_keys (
  instrument_slug text   NOT NULL,
  json_path       text[] NOT NULL,     -- exact path under responses, e.g. {overall_experience, overall_rating}
  label           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instrument_slug, json_path),
  CONSTRAINT chk_uqk_instrument
    CHECK (instrument_slug IN ('student_preceptor_eval', 'preceptor_progress')),
  CONSTRAINT chk_uqk_safe_section CHECK (
    (instrument_slug = 'student_preceptor_eval'
       AND json_path[1] IN ('preceptor_support', 'learning_environment',
                            'psychological_safety', 'overall_experience'))
    OR
    (instrument_slug = 'preceptor_progress'
       AND json_path[1] IN ('developmental_feedback', 'readiness_endorsement'))
  )
);

COMMENT ON TABLE public.evaluation_unit_quantitative_keys IS
  'Exact per-instrument allowlist of quantitative JSON paths that MAY be exposed to Unit Leaders (numeric values only). Anything not listed is hidden. The section CHECK forbids allowlisting a free-text or identifying section. Staff curate the content-driven per-item paths here before those metrics surface.';

ALTER TABLE public.evaluation_unit_quantitative_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.evaluation_unit_quantitative_keys FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.evaluation_unit_quantitative_keys TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.evaluation_unit_quantitative_keys TO service_role;
DROP POLICY IF EXISTS "owner_admin_select_ul_eval_qkeys"
  ON public.evaluation_unit_quantitative_keys;
CREATE POLICY "owner_admin_select_ul_eval_qkeys"
  ON public.evaluation_unit_quantitative_keys FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());

-- Seed the fixed, repo-verifiable numeric paths (surface only when the value is numeric).
INSERT INTO public.evaluation_unit_quantitative_keys (instrument_slug, json_path, label) VALUES
  ('student_preceptor_eval', ARRAY['overall_experience', 'overall_rating'], 'Overall experience rating'),
  ('preceptor_progress',     ARRAY['developmental_feedback', 'context', 'shifts_observed'], 'Shifts observed'),
  ('preceptor_progress',     ARRAY['readiness_endorsement', 'transition_readiness'], 'Transition readiness (if numeric)'),
  ('preceptor_progress',     ARRAY['readiness_endorsement', 'unit_endorsement_consideration'], 'Unit endorsement consideration (if numeric)'),
  ('preceptor_progress',     ARRAY['readiness_endorsement', 'cedars_consideration_recommendation'], 'Cedars consideration recommendation (if numeric)')
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────────
-- (4) Snapshot immutability guard (BEFORE UPDATE) on the release table.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ul_eval_guard_snapshot_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.response_id             IS DISTINCT FROM OLD.response_id
     OR NEW.assignment_id        IS DISTINCT FROM OLD.assignment_id
     OR NEW.instrument_id        IS DISTINCT FROM OLD.instrument_id
     OR NEW.instrument_slug      IS DISTINCT FROM OLD.instrument_slug
     OR NEW.timepoint            IS DISTINCT FROM OLD.timepoint
     OR NEW.hist_unit_id         IS DISTINCT FROM OLD.hist_unit_id
     OR NEW.hist_unit_key        IS DISTINCT FROM OLD.hist_unit_key
     OR NEW.hist_preceptor_id    IS DISTINCT FROM OLD.hist_preceptor_id
     OR NEW.hist_preceptor_label IS DISTINCT FROM OLD.hist_preceptor_label
     OR NEW.hist_cohort_id       IS DISTINCT FROM OLD.hist_cohort_id
     OR NEW.hist_cohort_label    IS DISTINCT FROM OLD.hist_cohort_label
     OR NEW.hist_rotation_id     IS DISTINCT FROM OLD.hist_rotation_id
     OR NEW.hist_rotation_end    IS DISTINCT FROM OLD.hist_rotation_end
     OR NEW.unit_leader_eligible_at IS DISTINCT FROM OLD.unit_leader_eligible_at
     OR NEW.snapshot_source      IS DISTINCT FROM OLD.snapshot_source
     OR NEW.snapshot_captured_at IS DISTINCT FROM OLD.snapshot_captured_at
     OR NEW.created_at           IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'evaluation_response_unit_release snapshot columns are immutable (response_id=%)',
      OLD.response_id
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ul_eval_guard_snapshot_immutable
  ON public.evaluation_response_unit_release;
CREATE TRIGGER trg_ul_eval_guard_snapshot_immutable
  BEFORE UPDATE ON public.evaluation_response_unit_release
  FOR EACH ROW EXECUTE FUNCTION public._ul_eval_guard_snapshot_immutable();

-- ────────────────────────────────────────────────────────────────
-- (5) Snapshot capture at submission (AFTER INSERT on evaluation_responses).
--     Evaluated-preceptor attribution resolved exactly and validated; unresolved =>
--     hist_preceptor_id NULL => not releasable.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ul_eval_capture_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_slug            text;
  v_resp_preceptor  uuid;
  v_cand_text       text;
  v_cand_preceptor  uuid;
  v_unit_id         uuid;
  v_unit_key        text;
  v_preceptor_id    uuid;
  v_preceptor_label text;
  v_cohort_label    text;
  v_rotation_id     uuid;
  v_rotation_end    timestamptz;
  v_eligible        timestamptz;
BEGIN
  SELECT i.slug INTO v_slug
    FROM public.evaluation_instruments i
    WHERE i.id = NEW.instrument_id;

  IF v_slug IS NULL OR v_slug NOT IN ('student_preceptor_eval', 'preceptor_progress') THEN
    RETURN NEW;
  END IF;

  -- Candidate evaluated preceptor id, per instrument.
  IF v_slug = 'preceptor_progress' THEN
    SELECT a.respondent_preceptor_id INTO v_resp_preceptor
      FROM public.evaluation_assignments a WHERE a.id = NEW.assignment_id;
    v_cand_preceptor := v_resp_preceptor;
  ELSE
    -- student_preceptor_eval: the evaluated preceptor id is echoed into the response.
    v_cand_text := NULLIF(NEW.responses #>> '{evaluated_target,preceptor_id}', '');
    IF v_cand_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_cand_preceptor := v_cand_text::uuid;
    END IF;
  END IF;

  -- Resolve ONLY if the candidate is a real preceptor; otherwise leave NULL (unresolved).
  IF v_cand_preceptor IS NOT NULL THEN
    SELECT p.full_name INTO v_preceptor_label FROM public.preceptors p WHERE p.id = v_cand_preceptor;
    IF FOUND THEN
      v_preceptor_id := v_cand_preceptor;
    ELSE
      v_preceptor_label := NULL;
    END IF;
  END IF;

  -- Unit / rotation from the student (matched_unit_id is the canonical unit link).
  SELECT s.matched_unit_id,
         s.cohort_school_rotation_id,
         COALESCE(s.rotation_completed_at, s.rotation_end_date::timestamptz)
    INTO v_unit_id, v_rotation_id, v_rotation_end
    FROM public.students s
    WHERE s.id = NEW.student_id;

  SELECT u.unit_name INTO v_unit_key     FROM public.units u   WHERE u.id = v_unit_id;
  SELECT c.name      INTO v_cohort_label FROM public.cohorts c WHERE c.id = NEW.cohort_id;

  IF v_rotation_end IS NOT NULL THEN
    v_eligible := v_rotation_end + interval '7 days';
  END IF;

  INSERT INTO public.evaluation_response_unit_release (
    response_id, assignment_id, instrument_id, instrument_slug, timepoint,
    hist_unit_id, hist_unit_key, hist_preceptor_id, hist_preceptor_label,
    hist_cohort_id, hist_cohort_label, hist_rotation_id, hist_rotation_end,
    unit_leader_eligible_at, snapshot_source, release_state
  ) VALUES (
    NEW.id, NEW.assignment_id, NEW.instrument_id, v_slug, NEW.timepoint,
    v_unit_id, v_unit_key, v_preceptor_id, v_preceptor_label,
    NEW.cohort_id, v_cohort_label, v_rotation_id, v_rotation_end,
    v_eligible, 'submission_trigger', 'pending'
  )
  ON CONFLICT (response_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ul_eval_capture_snapshot ON public.evaluation_responses;
CREATE TRIGGER trg_ul_eval_capture_snapshot
  AFTER INSERT ON public.evaluation_responses
  FOR EACH ROW EXECUTE FUNCTION public._ul_eval_capture_snapshot();

-- ────────────────────────────────────────────────────────────────
-- (6) Legacy backfill: existing approved-instrument responses, quarantined ineligible /
--     backfill_unverified. Evaluated preceptor best-effort: preceptor_progress from the
--     assignment respondent; student_preceptor_eval from the response's evaluated_target
--     (validated). Legacy rows are never releasable regardless.
-- ────────────────────────────────────────────────────────────────
INSERT INTO public.evaluation_response_unit_release (
  response_id, assignment_id, instrument_id, instrument_slug, timepoint,
  hist_unit_id, hist_unit_key, hist_preceptor_id, hist_preceptor_label,
  hist_cohort_id, hist_cohort_label, hist_rotation_id, hist_rotation_end,
  unit_leader_eligible_at, snapshot_source, release_state
)
SELECT
  r.id, r.assignment_id, r.instrument_id, i.slug, r.timepoint,
  s.matched_unit_id, u.unit_name,
  ep.id, ep.full_name,
  r.cohort_id, c.name, s.cohort_school_rotation_id,
  COALESCE(s.rotation_completed_at, s.rotation_end_date::timestamptz),
  NULL,                       -- eligibility withheld: legacy rows are quarantined
  'backfill_unverified', 'ineligible'
FROM public.evaluation_responses r
JOIN public.evaluation_instruments i ON i.id = r.instrument_id
LEFT JOIN public.evaluation_assignments a ON a.id = r.assignment_id
LEFT JOIN public.students   s ON s.id = r.student_id
LEFT JOIN public.units      u ON u.id = s.matched_unit_id
LEFT JOIN public.cohorts    c ON c.id = r.cohort_id
LEFT JOIN LATERAL (
  SELECT p2.id, p2.full_name
  FROM public.preceptors p2
  WHERE p2.id = CASE
    WHEN i.slug = 'preceptor_progress' THEN a.respondent_preceptor_id
    WHEN i.slug = 'student_preceptor_eval'
         AND (r.responses #>> '{evaluated_target,preceptor_id}')
             ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (r.responses #>> '{evaluated_target,preceptor_id}')::uuid
    ELSE NULL END
) ep ON true
WHERE i.slug IN ('student_preceptor_eval', 'preceptor_progress')
ON CONFLICT (response_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────
-- (7) Exact quantitative extractor. Returns { 'path.dotted': number } for ONLY the
--     allowlisted numeric paths of the instrument. Reads the allowlist table, so it is
--     STABLE (not IMMUTABLE) and intentionally NOT SECURITY DEFINER: it is called only
--     inside the SECURITY DEFINER read functions (owner context), never granted to
--     clients.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ul_eval_safe_quantitative(p_slug text, p_responses jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    jsonb_object_agg(array_to_string(k.json_path, '.'), v.val),
    '{}'::jsonb)
  FROM public.evaluation_unit_quantitative_keys k
  CROSS JOIN LATERAL (SELECT p_responses #> k.json_path AS val) v
  WHERE k.instrument_slug = p_slug
    AND jsonb_typeof(v.val) = 'number';
$$;

-- ────────────────────────────────────────────────────────────────
-- (8) Owner/Admin lifecycle functions. Authorization is the authoritative
--     is_active_owner_or_admin() (caller JWT). The acting profile is portal_profile_id().
--     Each SELECTs the release row FOR UPDATE (serializing concurrent lifecycle actions),
--     enforces expected-state predicates, applies the change, and writes an append-only
--     audit event. EXECUTE granted to authenticated; the gate denies non-owner/admin.
-- ────────────────────────────────────────────────────────────────

-- moderate: cleared advances a pending row to 'moderated'; blocked immediately hides a
-- released response (demote + clear visibility).
CREATE OR REPLACE FUNCTION public.ul_eval_moderate_response(
  p_response_id uuid, p_decision text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row   public.evaluation_response_unit_release%ROWTYPE;
  v_actor uuid := public.portal_profile_id();
  v_new_release text;
  v_new_visible boolean;
BEGIN
  IF NOT public.is_active_owner_or_admin() THEN
    RETURN jsonb_build_object('status', 'not_authorized');
  END IF;
  IF p_decision NOT IN ('cleared', 'blocked') THEN
    RETURN jsonb_build_object('status', 'invalid_decision');
  END IF;
  SELECT * INTO v_row FROM public.evaluation_response_unit_release
    WHERE response_id = p_response_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF p_decision = 'cleared' THEN
    v_new_release := CASE WHEN v_row.release_state = 'pending' THEN 'moderated'
                         ELSE v_row.release_state END;
    v_new_visible := v_row.quantitative_visible;
  ELSE
    v_new_release := CASE WHEN v_row.release_state = 'released' THEN 'moderated'
                         ELSE v_row.release_state END;
    v_new_visible := false;
  END IF;

  -- No-op guard: nothing to change means no spurious audit event.
  IF v_row.moderation_state = p_decision
     AND v_row.release_state = v_new_release
     AND v_row.quantitative_visible = v_new_visible THEN
    RETURN jsonb_build_object('status', 'no_change', 'moderation_state', p_decision);
  END IF;

  UPDATE public.evaluation_response_unit_release
    SET moderation_state     = p_decision,
        release_state        = v_new_release,
        quantitative_visible = v_new_visible,
        moderated_at         = now(),
        moderated_by         = v_actor
    WHERE response_id = p_response_id;

  INSERT INTO public.evaluation_response_unit_release_events (
    response_id, release_id, event_type, decision,
    prior_release_state, new_release_state, prior_moderation_state, new_moderation_state,
    actor_profile_id
  ) VALUES (
    p_response_id, v_row.id, 'moderate', p_decision,
    v_row.release_state, v_new_release, v_row.moderation_state, p_decision,
    v_actor
  );

  RETURN jsonb_build_object('status', 'success', 'moderation_state', p_decision);
END;
$$;

-- release: enforce every gate, then make visible. Only from 'pending'/'moderated'.
CREATE OR REPLACE FUNCTION public.ul_eval_release_response(
  p_response_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row   public.evaluation_response_unit_release%ROWTYPE;
  v_actor uuid := public.portal_profile_id();
BEGIN
  IF NOT public.is_active_owner_or_admin() THEN
    RETURN jsonb_build_object('status', 'not_authorized');
  END IF;
  SELECT * INTO v_row FROM public.evaluation_response_unit_release
    WHERE response_id = p_response_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_row.release_state = 'revoked' THEN
    RETURN jsonb_build_object('status', 'revoked_requires_explicit_rerelease');
  END IF;
  IF v_row.release_state = 'released' THEN
    RETURN jsonb_build_object('status', 'already_released');
  END IF;
  -- Expected-state: releasable only from pending/moderated (never ineligible).
  IF v_row.release_state NOT IN ('pending', 'moderated') THEN
    RETURN jsonb_build_object('status', 'not_releasable_state', 'release_state', v_row.release_state);
  END IF;
  IF v_row.instrument_slug NOT IN ('student_preceptor_eval', 'preceptor_progress') THEN
    RETURN jsonb_build_object('status', 'instrument_not_approved');
  END IF;
  IF v_row.snapshot_source NOT IN ('submission_trigger', 'backfill_verified') THEN
    RETURN jsonb_build_object('status', 'snapshot_unverified');
  END IF;
  -- Snapshot completeness includes a resolved evaluated preceptor.
  IF v_row.hist_unit_key IS NULL
     OR v_row.hist_preceptor_id IS NULL
     OR v_row.unit_leader_eligible_at IS NULL THEN
    RETURN jsonb_build_object('status', 'snapshot_incomplete');
  END IF;
  IF now() < v_row.unit_leader_eligible_at THEN
    RETURN jsonb_build_object('status', 'not_yet_eligible',
                              'eligible_at', v_row.unit_leader_eligible_at);
  END IF;
  IF v_row.moderation_state <> 'cleared' THEN
    RETURN jsonb_build_object('status', 'not_moderated');
  END IF;

  UPDATE public.evaluation_response_unit_release
    SET release_state        = 'released',
        quantitative_visible = true,
        released_at          = now(),
        released_by          = v_actor
    WHERE response_id = p_response_id;

  INSERT INTO public.evaluation_response_unit_release_events (
    response_id, release_id, event_type,
    prior_release_state, new_release_state, prior_moderation_state, new_moderation_state,
    actor_profile_id
  ) VALUES (
    p_response_id, v_row.id, 'release',
    v_row.release_state, 'released', v_row.moderation_state, v_row.moderation_state,
    v_actor
  );

  RETURN jsonb_build_object('status', 'success');
END;
$$;

-- revoke: immediately remove visibility. Idempotent (revoking a revoked row is a no-op
-- with no spurious audit event). Keeps revoked_at/by history.
CREATE OR REPLACE FUNCTION public.ul_eval_revoke_response(
  p_response_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row   public.evaluation_response_unit_release%ROWTYPE;
  v_actor uuid := public.portal_profile_id();
BEGIN
  IF NOT public.is_active_owner_or_admin() THEN
    RETURN jsonb_build_object('status', 'not_authorized');
  END IF;
  SELECT * INTO v_row FROM public.evaluation_response_unit_release
    WHERE response_id = p_response_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_row.release_state = 'revoked' THEN
    RETURN jsonb_build_object('status', 'already_revoked');
  END IF;

  UPDATE public.evaluation_response_unit_release
    SET release_state        = 'revoked',
        quantitative_visible = false,
        revoked_at           = now(),
        revoked_by           = v_actor
    WHERE response_id = p_response_id;

  INSERT INTO public.evaluation_response_unit_release_events (
    response_id, release_id, event_type,
    prior_release_state, new_release_state, prior_moderation_state, new_moderation_state,
    actor_profile_id
  ) VALUES (
    p_response_id, v_row.id, 'revoke',
    v_row.release_state, 'revoked', v_row.moderation_state, v_row.moderation_state,
    v_actor
  );

  RETURN jsonb_build_object('status', 'success');
END;
$$;

-- re-release: the ONLY way to make a revoked response visible again. Explicit and
-- audited. Re-checks every gate. Only from 'revoked'. Does NOT clear revoked_at/by.
CREATE OR REPLACE FUNCTION public.ul_eval_rerelease_response(
  p_response_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row   public.evaluation_response_unit_release%ROWTYPE;
  v_actor uuid := public.portal_profile_id();
BEGIN
  IF NOT public.is_active_owner_or_admin() THEN
    RETURN jsonb_build_object('status', 'not_authorized');
  END IF;
  SELECT * INTO v_row FROM public.evaluation_response_unit_release
    WHERE response_id = p_response_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_row.release_state <> 'revoked' THEN
    RETURN jsonb_build_object('status', 'not_revoked');
  END IF;
  IF v_row.snapshot_source NOT IN ('submission_trigger', 'backfill_verified') THEN
    RETURN jsonb_build_object('status', 'snapshot_unverified');
  END IF;
  IF v_row.hist_unit_key IS NULL
     OR v_row.hist_preceptor_id IS NULL
     OR v_row.unit_leader_eligible_at IS NULL THEN
    RETURN jsonb_build_object('status', 'snapshot_incomplete');
  END IF;
  IF now() < v_row.unit_leader_eligible_at THEN
    RETURN jsonb_build_object('status', 'not_yet_eligible',
                              'eligible_at', v_row.unit_leader_eligible_at);
  END IF;
  IF v_row.moderation_state <> 'cleared' THEN
    RETURN jsonb_build_object('status', 'not_moderated');
  END IF;

  UPDATE public.evaluation_response_unit_release
    SET release_state        = 'released',
        quantitative_visible = true,
        released_at          = now(),
        released_by          = v_actor
    WHERE response_id = p_response_id;   -- revoked_at/by intentionally preserved

  INSERT INTO public.evaluation_response_unit_release_events (
    response_id, release_id, event_type,
    prior_release_state, new_release_state, prior_moderation_state, new_moderation_state,
    actor_profile_id, notes
  ) VALUES (
    p_response_id, v_row.id, 're_release',
    v_row.release_state, 'released', v_row.moderation_state, v_row.moderation_state,
    v_actor, 'explicit re-release of a previously revoked response'
  );

  RETURN jsonb_build_object('status', 'success');
END;
$$;

-- ────────────────────────────────────────────────────────────────
-- (9) Unit Leader read functions. Scope from the caller's JWT via
--     has_active_role_grant('unit_leader') + my_unit_scope_keys(); a parameter can only
--     NARROW. NO stable response identifier is returned. Quantitative data via the exact
--     allowlist only. Defense-in-depth predicates on every read. No suppression.
-- ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ul_eval_dashboard_summary(
  p_instrument_slug text, p_timepoint text DEFAULT NULL, p_unit_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  WITH scoped AS (
    SELECT rel.id,
           public._ul_eval_safe_quantitative(rel.instrument_slug, r.responses) AS q
    FROM public.evaluation_response_unit_release rel
    JOIN public.evaluation_responses r ON r.id = rel.response_id
    WHERE public.has_active_role_grant('unit_leader')
      AND rel.instrument_slug = p_instrument_slug
      AND rel.instrument_slug IN ('student_preceptor_eval', 'preceptor_progress')
      AND rel.release_state = 'released'
      AND rel.release_state <> 'revoked'
      AND rel.moderation_state = 'cleared'
      AND rel.quantitative_visible = true
      AND rel.free_text_visible = false
      AND rel.snapshot_source IN ('submission_trigger', 'backfill_verified')
      AND rel.hist_preceptor_id IS NOT NULL
      AND rel.unit_leader_eligible_at IS NOT NULL
      AND now() >= rel.unit_leader_eligible_at
      AND (p_timepoint IS NULL OR rel.timepoint = p_timepoint)
      AND (p_unit_key IS NULL OR rel.hist_unit_key = p_unit_key)
      AND EXISTS (
        SELECT 1 FROM public.my_unit_scope_keys() s
        WHERE s.unit_key = rel.hist_unit_key
          AND (s.cohort_id IS NULL OR s.cohort_id = rel.hist_cohort_id)
      )
  ),
  nums AS (
    SELECT e.key, (e.value #>> '{}')::numeric AS val
    FROM scoped sc, jsonb_each(sc.q) e
    WHERE jsonb_typeof(e.value) = 'number'
  ),
  per_key AS (
    SELECT key, round(avg(val), 3) AS avg_value, count(*) AS n
    FROM nums GROUP BY key
  )
  SELECT jsonb_build_object(
    'instrument_slug', p_instrument_slug,
    'timepoint', p_timepoint,
    'unit_key', p_unit_key,
    'released_response_count', (SELECT count(*) FROM scoped),
    'quantitative_averages', COALESCE(
      (SELECT jsonb_object_agg(key, jsonb_build_object('avg', avg_value, 'n', n)) FROM per_key),
      '{}'::jsonb)
  );
$$;

-- Anonymous released responses. Positional label only; NO stable identifier is returned.
CREATE OR REPLACE FUNCTION public.ul_eval_response_list(
  p_instrument_slug text, p_timepoint text DEFAULT NULL, p_unit_key text DEFAULT NULL
) RETURNS TABLE (
  anon_label      text,
  instrument_slug text,
  timepoint       text,
  unit_key        text,
  quantitative    jsonb
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    'Response ' || row_number() OVER (ORDER BY rel.released_at, rel.id) AS anon_label,
    rel.instrument_slug,
    rel.timepoint,
    rel.hist_unit_key AS unit_key,
    public._ul_eval_safe_quantitative(rel.instrument_slug, r.responses) AS quantitative
  FROM public.evaluation_response_unit_release rel
  JOIN public.evaluation_responses r ON r.id = rel.response_id
  WHERE public.has_active_role_grant('unit_leader')
    AND rel.instrument_slug = p_instrument_slug
    AND rel.instrument_slug IN ('student_preceptor_eval', 'preceptor_progress')
    AND rel.release_state = 'released'
    AND rel.release_state <> 'revoked'
    AND rel.moderation_state = 'cleared'
    AND rel.quantitative_visible = true
    AND rel.free_text_visible = false
    AND rel.snapshot_source IN ('submission_trigger', 'backfill_verified')
    AND rel.hist_preceptor_id IS NOT NULL
    AND rel.unit_leader_eligible_at IS NOT NULL
    AND now() >= rel.unit_leader_eligible_at
    AND (p_timepoint IS NULL OR rel.timepoint = p_timepoint)
    AND (p_unit_key IS NULL OR rel.hist_unit_key = p_unit_key)
    AND EXISTS (
      SELECT 1 FROM public.my_unit_scope_keys() s
      WHERE s.unit_key = rel.hist_unit_key
        AND (s.cohort_id IS NULL OR s.cohort_id = rel.hist_cohort_id)
    );
$$;

-- ────────────────────────────────────────────────────────────────
-- (10) Function privileges (least privilege).
-- ────────────────────────────────────────────────────────────────
-- Trigger / pure helper functions: no client execute (called by definers only).
REVOKE ALL ON FUNCTION public._ul_eval_block_write()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ul_eval_guard_snapshot_immutable()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ul_eval_capture_snapshot()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ul_eval_safe_quantitative(text, jsonb) FROM PUBLIC, anon, authenticated;

-- Owner/Admin lifecycle functions: authenticated EXECUTE, internal is_active_owner_or_admin()
-- gate denies everyone else. Never anon/public.
REVOKE ALL ON FUNCTION public.ul_eval_moderate_response(uuid, text)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ul_eval_release_response(uuid)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ul_eval_revoke_response(uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ul_eval_rerelease_response(uuid)       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ul_eval_moderate_response(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ul_eval_release_response(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.ul_eval_revoke_response(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.ul_eval_rerelease_response(uuid)      TO authenticated;

-- Read functions: signed-in users only (scope from their JWT); never anon/public.
REVOKE ALL ON FUNCTION public.ul_eval_dashboard_summary(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ul_eval_response_list(text, text, text)      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ul_eval_dashboard_summary(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ul_eval_response_list(text, text, text)      TO authenticated;

COMMIT;

-- PostgREST schema cache reload (new tables + functions).
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICATION and ROLLBACK: full scripts in
--   db/audit/unit_leader_evaluation_release_gate_verification.sql
--   db/audit/unit_leader_evaluation_release_gate_rollback.sql
-- ============================================================================
