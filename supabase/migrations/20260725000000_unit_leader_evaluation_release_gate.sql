-- 20260725000000_unit_leader_evaluation_release_gate.sql
-- ============================================================================
-- Unit Leader Evaluations: release/visibility gate + immutable attribution
-- snapshot + append-only lifecycle audit + database authorization functions.
-- ============================================================================
--
-- AUTHORED, NOT APPLIED. Jester applies this manually through the Owner SQL gate
-- (docs/security/OWNER_SQL_GATE.md) after review. Governing contract:
-- docs/security/UNIT_LEADER_EVALUATIONS_MIGRATION_CONTRACT.md.
--
-- This revision incorporates the Owner pre-apply review corrections (A-L). See the
-- contract for the point-by-point mapping. Summary of what changed vs. the first draft:
--   * A blocked moderation immediately hides a released response; every read also
--     requires moderation_state = 'cleared'.
--   * New append-only audit table evaluation_response_unit_release_events records every
--     moderate / release / revoke / re-release with prior+new state, actor, timestamp.
--   * Owner/Admin authorization uses the authoritative is_active_owner_or_admin() from
--     the caller's JWT (not a passed, spoofable actor id, and not a bespoke role read).
--   * Unit Leaders never receive raw response_id UUIDs: reads return an opaque
--     public_token; the exact id stays server-side.
--   * Quantitative exposure is an explicit per-instrument SECTION allowlist plus a
--     numeric-only leaf filter (no generic "all numeric values").
--   * Re-release is a separate, explicit, audited action; the ordinary release action
--     never silently re-releases and never clears revoked_at/by.
--   * Preceptor attribution uses the assignment/respondent relationship, never
--     students.preceptor_id.
--   * The response relationship is ON DELETE RESTRICT (audit-preserving), and the audit
--     table holds a durable response_id with no cascading FK.
--   * Reads carry defense-in-depth predicates (cleared moderation, quantitative
--     visibility, verified snapshot source, hidden free text, release state, eligibility,
--     non-revocation).
--
-- PREREQUISITES (already applied in production):
--   * 20260712000007_phase2_authz_foundation.sql  (user_role_grants, user_unit_scopes,
--     portal_profile_id(), has_active_role_grant(), my_unit_scope_keys())
--   * 20260716000000_messages_phase1_schema_foundation.sql  (is_active_owner_or_admin())
--   * 20260720000000_unit_leader_portal_foundation.sql
--     (students.rotation_end_date, students.rotation_completed_at)
--   * migration_evaluation_stage1_schema.sql  (evaluation_responses, evaluation_instruments)
--   * 20260613000001_ps2b_... / 20260616000000_sr2_...  (the two approved submit RPCs;
--     traced for the quantitative section allowlists and preceptor attribution)
--
-- APPROVED INSTRUMENTS (by slug; rows seeded manually in production, so this migration
-- keys on slug, never a hard-coded id):
--   student_preceptor_eval  (Preceptor & Unit Feedback)   -- student is respondent
--   preceptor_progress      (Preceptor Readiness Assessment) -- preceptor is respondent
-- Casey-Fink and post_rotation_evaluation are excluded.
--
-- LOCKED POLICY: unit-level only; free text hidden; no identity; no identifying
-- timestamps; Owner/Admin-only release; delayed release (rotation end + 7 days); NO
-- minimum-count suppression (n = 1 is displayed; the Owner accepts the contextual
-- re-identification risk; the UI must never claim a one-response result is anonymous).
--
-- Re-runnable: uses IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS / ON CONFLICT.
-- Full verification and rollback:
--   db/audit/unit_leader_evaluation_release_gate_verification.sql
--   db/audit/unit_leader_evaluation_release_gate_rollback.sql
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- (1) Release / visibility table (snapshot + lifecycle, 1:1 with a response)
--     ON DELETE RESTRICT preserves the gate/audit trail: a response with a release
--     row cannot be deleted out from under its history.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.evaluation_response_unit_release (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id              uuid NOT NULL UNIQUE
                           REFERENCES public.evaluation_responses(id) ON DELETE RESTRICT,
  -- Opaque handle returned to Unit Leaders instead of the raw response_id. Random and
  -- unrelated to any real record id, so it cannot be correlated with other tables.
  public_token             text NOT NULL UNIQUE
                           DEFAULT replace(gen_random_uuid()::text, '-', ''),
  assignment_id            uuid NOT NULL,
  instrument_id            uuid NOT NULL REFERENCES public.evaluation_instruments(id),
  instrument_slug          text NOT NULL,
  timepoint                text NOT NULL,

  -- Immutable historical attribution snapshot (captured once; guarded by trigger).
  hist_unit_id             uuid,
  hist_unit_key            text,          -- units.unit_name at capture = the scope key
  hist_preceptor_id        uuid,          -- audit only; never returned to a Unit Leader
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
  -- revoked_at/by are the LAST revocation record and are never cleared (history lives
  -- in the events table and here); reads gate on release_state, not revoked_at.
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
  -- First release hard-locks free text hidden. A future release drops this constraint.
  CONSTRAINT chk_ul_eval_free_text_hidden_first_release
    CHECK (free_text_visible = false),
  -- A released row must be quantitatively visible; a non-released row must not be.
  CONSTRAINT chk_ul_eval_released_visibility
    CHECK ((release_state = 'released') = (quantitative_visible = true))
);

COMMENT ON TABLE public.evaluation_response_unit_release IS
  'Unit Leader evaluation release gate. One row per approved-instrument evaluation_response, holding an immutable submission-time attribution snapshot (hist_*) and a mutable Owner/Admin-controlled release lifecycle. Unit Leaders never read this table directly (RLS owner/admin only) and never receive the raw response_id (they get public_token); they read shaped, scoped, quantitative-only data through the ul_eval_* functions. Free text and identity are never exposed. No minimum-count suppression: n = 1 is displayed, an Owner-accepted contextual re-identification risk.';
COMMENT ON COLUMN public.evaluation_response_unit_release.public_token IS
  'Opaque, random handle returned to Unit Leaders instead of response_id. The exact response_id never leaves the server. ul_eval_response_detail accepts this token, never a response id.';
COMMENT ON COLUMN public.evaluation_response_unit_release.hist_preceptor_id IS
  'Immutable evaluated-preceptor attribution for AUDIT ONLY. For preceptor_progress this is the assignment respondent_preceptor_id (the responding preceptor); for student_preceptor_eval it is NULL (the evaluated preceptor is carried in responses.evaluated_target, and students.preceptor_id is NOT authoritative). No Unit Leader read function returns preceptor identity or preceptor-grouped data.';
COMMENT ON COLUMN public.evaluation_response_unit_release.revoked_at IS
  'Most recent revocation timestamp. NEVER cleared (history is preserved here and in the events table). Visibility is governed by release_state, not by this column.';

CREATE INDEX IF NOT EXISTS idx_ul_eval_release_scope
  ON public.evaluation_response_unit_release (hist_unit_key, instrument_slug, timepoint)
  WHERE release_state = 'released';
CREATE INDEX IF NOT EXISTS idx_ul_eval_release_state
  ON public.evaluation_response_unit_release (release_state);
CREATE INDEX IF NOT EXISTS idx_ul_eval_release_eligible
  ON public.evaluation_response_unit_release (unit_leader_eligible_at);
CREATE INDEX IF NOT EXISTS idx_ul_eval_release_instrument
  ON public.evaluation_response_unit_release (instrument_id);

-- Privilege posture: same shape as the other evaluation tables. Unit Leaders (authenticated,
-- not owner/admin) get ZERO rows via direct access; they must use the ul_eval_* functions.
ALTER TABLE public.evaluation_response_unit_release ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.evaluation_response_unit_release FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.evaluation_response_unit_release TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.evaluation_response_unit_release TO service_role;
DROP POLICY IF EXISTS "owner_admin_select_ul_eval_release"
  ON public.evaluation_response_unit_release;
CREATE POLICY "owner_admin_select_ul_eval_release"
  ON public.evaluation_response_unit_release FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());

-- ────────────────────────────────────────────────────────────────
-- (2) Append-only lifecycle audit table. Every moderation, release, revocation, and
--     re-release is recorded with prior+new state, the exact response, the actor, the
--     timestamp, and the decision. Prior history is never overwritten or erased.
--     response_id is a DURABLE reference (no FK), so audit survives anything.
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
  'Append-only audit log of every Unit Leader evaluation lifecycle action (moderate, release, revoke, re_release). Records prior and new release/moderation state, the exact response, the acting Owner/Admin profile, the timestamp, and the moderation decision. Enforced append-only by trigger: UPDATE and DELETE raise. Nothing here is ever overwritten or erased.';

CREATE INDEX IF NOT EXISTS idx_ul_eval_events_response
  ON public.evaluation_response_unit_release_events (response_id, created_at);

ALTER TABLE public.evaluation_response_unit_release_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.evaluation_response_unit_release_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.evaluation_response_unit_release_events TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.evaluation_response_unit_release_events TO service_role;
DROP POLICY IF EXISTS "owner_admin_select_ul_eval_events"
  ON public.evaluation_response_unit_release_events;
CREATE POLICY "owner_admin_select_ul_eval_events"
  ON public.evaluation_response_unit_release_events FOR SELECT TO authenticated
  USING (public.is_active_owner_or_admin());

-- Append-only enforcement: block UPDATE and DELETE for everyone, including service_role.
CREATE OR REPLACE FUNCTION public._ul_eval_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION
    'evaluation_response_unit_release_events is append-only (% is not permitted)', TG_OP
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_ul_eval_events_append_only
  ON public.evaluation_response_unit_release_events;
CREATE TRIGGER trg_ul_eval_events_append_only
  BEFORE UPDATE OR DELETE ON public.evaluation_response_unit_release_events
  FOR EACH ROW EXECUTE FUNCTION public._ul_eval_events_append_only();

-- ────────────────────────────────────────────────────────────────
-- (3) Snapshot immutability guard (BEFORE UPDATE) on the release table.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ul_eval_guard_snapshot_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.response_id             IS DISTINCT FROM OLD.response_id
     OR NEW.public_token         IS DISTINCT FROM OLD.public_token
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
-- (4) Snapshot capture at submission (AFTER INSERT on evaluation_responses).
--     Preceptor attribution comes from the assignment/respondent relationship, NOT
--     students.preceptor_id: preceptor_progress -> respondent_preceptor_id;
--     student_preceptor_eval -> NULL (evaluated target lives in responses.evaluated_target).
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ul_eval_capture_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_slug            text;
  v_resp_type       text;
  v_resp_preceptor  uuid;
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

  -- Only the two approved Unit-Leader instruments get a release row.
  IF v_slug IS NULL OR v_slug NOT IN ('student_preceptor_eval', 'preceptor_progress') THEN
    RETURN NEW;
  END IF;

  -- Assignment/respondent relationship (authoritative for preceptor attribution).
  SELECT a.respondent_type, a.respondent_preceptor_id
    INTO v_resp_type, v_resp_preceptor
    FROM public.evaluation_assignments a
    WHERE a.id = NEW.assignment_id;

  -- Unit / rotation from the student (matched_unit_id is the canonical unit link).
  SELECT s.matched_unit_id,
         s.cohort_school_rotation_id,
         COALESCE(s.rotation_completed_at, s.rotation_end_date::timestamptz)
    INTO v_unit_id, v_rotation_id, v_rotation_end
    FROM public.students s
    WHERE s.id = NEW.student_id;

  -- Preceptor attribution: the responding preceptor for preceptor_progress; unknown
  -- (NULL) for student_preceptor_eval, whose evaluated target is in the response JSON.
  IF v_slug = 'preceptor_progress' THEN
    v_preceptor_id := v_resp_preceptor;
  ELSE
    v_preceptor_id := NULL;
  END IF;

  SELECT u.unit_name INTO v_unit_key        FROM public.units u      WHERE u.id = v_unit_id;
  SELECT c.name      INTO v_cohort_label    FROM public.cohorts c    WHERE c.id = NEW.cohort_id;
  IF v_preceptor_id IS NOT NULL THEN
    SELECT p.full_name INTO v_preceptor_label FROM public.preceptors p WHERE p.id = v_preceptor_id;
  END IF;

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
-- (5) Legacy backfill: existing approved-instrument responses.
--     Quarantined as ineligible / backfill_unverified. Never releasable without a
--     future audited pathway. Preceptor attribution uses the assignment respondent.
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
  CASE WHEN i.slug = 'preceptor_progress' THEN a.respondent_preceptor_id ELSE NULL END,
  CASE WHEN i.slug = 'preceptor_progress' THEN pr.full_name ELSE NULL END,
  r.cohort_id, c.name, s.cohort_school_rotation_id,
  COALESCE(s.rotation_completed_at, s.rotation_end_date::timestamptz),
  NULL,                       -- eligibility withheld: legacy rows are quarantined
  'backfill_unverified', 'ineligible'
FROM public.evaluation_responses r
JOIN public.evaluation_instruments i ON i.id = r.instrument_id
LEFT JOIN public.evaluation_assignments a ON a.id = r.assignment_id
LEFT JOIN public.preceptors pr ON pr.id = a.respondent_preceptor_id
LEFT JOIN public.students   s ON s.id = r.student_id
LEFT JOIN public.units      u ON u.id = s.matched_unit_id
LEFT JOIN public.cohorts    c ON c.id = r.cohort_id
WHERE i.slug IN ('student_preceptor_eval', 'preceptor_progress')
ON CONFLICT (response_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────
-- (6) Explicit per-instrument quantitative allowlist. Returns a flat jsonb of
--     'section.item' -> number, taking ONLY numeric leaves from the allowlisted
--     quantitative sections of each instrument. Every free-text section
--     (narrative, confidential_team_comments), the identifying evaluated_target, and
--     attestation are excluded by omission; any string leaf inside an allowed section is
--     dropped by the numeric-only filter. Pure function of its inputs.
--
--     NOTE: the section allowlist is authoritative; the exact numeric LEAF item codes
--     are defined in the instruments' private content and are refined (narrowed further)
--     in the follow-on API branch. Numeric-only extraction guarantees no free text can
--     leak regardless.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ul_eval_safe_quantitative(p_slug text, p_responses jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    jsonb_object_agg(section_key || '.' || item_key, item_val),
    '{}'::jsonb)
  FROM (
    SELECT sec.key AS section_key, it.key AS item_key, it.value AS item_val
    FROM jsonb_each(p_responses) sec
    CROSS JOIN LATERAL jsonb_each(sec.value) it
    WHERE jsonb_typeof(sec.value) = 'object'
      AND jsonb_typeof(it.value) = 'number'
      AND (
        (p_slug = 'student_preceptor_eval'
          AND sec.key IN ('preceptor_support', 'learning_environment',
                          'psychological_safety', 'overall_experience'))
        OR
        (p_slug = 'preceptor_progress'
          AND sec.key IN ('developmental_feedback', 'readiness_endorsement'))
      )
  ) q;
$$;

-- ────────────────────────────────────────────────────────────────
-- (7) Owner/Admin lifecycle functions. Authorization is the authoritative
--     is_active_owner_or_admin() evaluated against the CALLER's JWT (not a passed actor
--     id and not a bespoke user_profiles read). The acting profile is portal_profile_id().
--     Every action writes an append-only audit event. EXECUTE is granted to
--     authenticated; the internal gate denies anyone who is not an active Owner/Admin.
-- ────────────────────────────────────────────────────────────────

-- moderate: cleared advances a pending row to 'moderated'; blocked immediately hides a
-- released response (demotes it and clears quantitative visibility).
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
  SELECT * INTO v_row FROM public.evaluation_response_unit_release WHERE response_id = p_response_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF p_decision = 'cleared' THEN
    v_new_release := CASE WHEN v_row.release_state = 'pending' THEN 'moderated'
                         ELSE v_row.release_state END;
    v_new_visible := v_row.quantitative_visible;
  ELSE
    -- blocked: a released response becomes invisible immediately.
    v_new_release := CASE WHEN v_row.release_state = 'released' THEN 'moderated'
                         ELSE v_row.release_state END;
    v_new_visible := false;
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

-- release: enforce every gate, then make the response quantitatively visible. Never
-- re-releases a revoked row (that is a separate explicit action) and never clears
-- revoked_at/by.
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
  SELECT * INTO v_row FROM public.evaluation_response_unit_release WHERE response_id = p_response_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_row.release_state = 'revoked' THEN
    -- Ordinary release never silently re-releases. Use ul_eval_rerelease_response.
    RETURN jsonb_build_object('status', 'revoked_requires_explicit_rerelease');
  END IF;
  IF v_row.release_state = 'released' THEN
    RETURN jsonb_build_object('status', 'already_released');
  END IF;
  IF v_row.instrument_slug NOT IN ('student_preceptor_eval', 'preceptor_progress') THEN
    RETURN jsonb_build_object('status', 'instrument_not_approved');
  END IF;
  IF v_row.snapshot_source NOT IN ('submission_trigger', 'backfill_verified') THEN
    RETURN jsonb_build_object('status', 'snapshot_unverified');
  END IF;
  IF v_row.hist_unit_key IS NULL OR v_row.unit_leader_eligible_at IS NULL THEN
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

-- revoke: immediately remove Unit Leader visibility. Idempotent. Keeps revoked_at/by.
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
  SELECT * INTO v_row FROM public.evaluation_response_unit_release WHERE response_id = p_response_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
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
-- audited (event_type = 're_release'). Re-checks every release gate. Does NOT clear
-- revoked_at/by; the revocation stays in the history.
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
  SELECT * INTO v_row FROM public.evaluation_response_unit_release WHERE response_id = p_response_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_row.release_state <> 'revoked' THEN
    RETURN jsonb_build_object('status', 'not_revoked');
  END IF;
  IF v_row.snapshot_source NOT IN ('submission_trigger', 'backfill_verified') THEN
    RETURN jsonb_build_object('status', 'snapshot_unverified');
  END IF;
  IF v_row.hist_unit_key IS NULL OR v_row.unit_leader_eligible_at IS NULL THEN
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
-- (8) Unit Leader read functions. Scope is derived from the caller's JWT via
--     my_unit_scope_keys() and has_active_role_grant('unit_leader'); a parameter can only
--     NARROW. Returns the opaque public_token (never response_id), and quantitative data
--     via the explicit per-instrument allowlist (never free text, identity, timestamps,
--     or preceptor grouping). Defense-in-depth predicates on every read. No suppression.
-- ────────────────────────────────────────────────────────────────

-- Shared visibility predicate is inlined into each function (SQL functions cannot share
-- a WHERE clause); all three enforce the identical gate.

CREATE OR REPLACE FUNCTION public.ul_eval_dashboard_summary(
  p_instrument_slug text, p_timepoint text DEFAULT NULL, p_unit_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  WITH scoped AS (
    SELECT rel.public_token,
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

CREATE OR REPLACE FUNCTION public.ul_eval_response_list(
  p_instrument_slug text, p_timepoint text DEFAULT NULL, p_unit_key text DEFAULT NULL
) RETURNS TABLE (
  anon_label      text,
  response_token  text,
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
    'Response ' || row_number() OVER (ORDER BY rel.released_at, rel.public_token) AS anon_label,
    rel.public_token AS response_token,
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

-- Detail by OPAQUE TOKEN only (never a response id). Re-checks scope + release for that
-- exact token, never trusting a prior list result as authorization.
CREATE OR REPLACE FUNCTION public.ul_eval_response_detail(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'response_token', rel.public_token,
    'instrument_slug', rel.instrument_slug,
    'timepoint', rel.timepoint,
    'unit_key', rel.hist_unit_key,
    'quantitative', public._ul_eval_safe_quantitative(rel.instrument_slug, r.responses)
  )
  FROM public.evaluation_response_unit_release rel
  JOIN public.evaluation_responses r ON r.id = rel.response_id
  WHERE rel.public_token = p_token
    AND public.has_active_role_grant('unit_leader')
    AND rel.instrument_slug IN ('student_preceptor_eval', 'preceptor_progress')
    AND rel.release_state = 'released'
    AND rel.release_state <> 'revoked'
    AND rel.moderation_state = 'cleared'
    AND rel.quantitative_visible = true
    AND rel.free_text_visible = false
    AND rel.snapshot_source IN ('submission_trigger', 'backfill_verified')
    AND rel.unit_leader_eligible_at IS NOT NULL
    AND now() >= rel.unit_leader_eligible_at
    AND EXISTS (
      SELECT 1 FROM public.my_unit_scope_keys() s
      WHERE s.unit_key = rel.hist_unit_key
        AND (s.cohort_id IS NULL OR s.cohort_id = rel.hist_cohort_id)
    );
$$;

-- ────────────────────────────────────────────────────────────────
-- (9) Function privileges (least privilege).
-- ────────────────────────────────────────────────────────────────
-- Trigger / pure helper functions: no client execute needed (called by definers).
REVOKE ALL ON FUNCTION public._ul_eval_guard_snapshot_immutable()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ul_eval_capture_snapshot()           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ul_eval_events_append_only()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ul_eval_safe_quantitative(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._ul_eval_safe_quantitative(text, jsonb) TO authenticated;

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
REVOKE ALL ON FUNCTION public.ul_eval_response_detail(text)               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ul_eval_dashboard_summary(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ul_eval_response_list(text, text, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.ul_eval_response_detail(text)               TO authenticated;

COMMIT;

-- PostgREST schema cache reload (new tables + functions).
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICATION and ROLLBACK: full scripts in
--   db/audit/unit_leader_evaluation_release_gate_verification.sql
--   db/audit/unit_leader_evaluation_release_gate_rollback.sql
-- ============================================================================
