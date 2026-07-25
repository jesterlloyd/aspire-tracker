-- 20260725000000_unit_leader_evaluation_release_gate.sql
-- ============================================================================
-- Unit Leader Evaluations: release/visibility gate + immutable attribution
-- snapshot + database authorization functions.
-- ============================================================================
--
-- AUTHORED, NOT APPLIED. Jester applies this manually through the Owner SQL gate
-- (docs/security/OWNER_SQL_GATE.md) after review. Governing contract:
-- docs/security/UNIT_LEADER_EVALUATIONS_MIGRATION_CONTRACT.md.
--
-- PREREQUISITES (already applied in production):
--   * 20260712000007_phase2_authz_foundation.sql  (user_role_grants, user_unit_scopes,
--     portal_profile_id(), has_active_role_grant(), my_unit_scope_keys())
--   * 20260720000000_unit_leader_portal_foundation.sql
--     (students.rotation_end_date, students.rotation_completed_at)
--   * migration_evaluation_stage1_schema.sql  (evaluation_responses, evaluation_instruments)
--
-- WHAT THIS DOES
--   1. Adds public.evaluation_response_unit_release: one row per approved-instrument
--      response, holding BOTH an immutable historical attribution snapshot AND the
--      mutable release lifecycle. The base evaluation tables are untouched.
--   2. A BEFORE UPDATE trigger makes the snapshot columns immutable; only lifecycle
--      columns may change (ordinary application writes cannot alter locked attribution).
--   3. An AFTER INSERT trigger on evaluation_responses captures the snapshot at
--      submission for the two approved instruments only. Because it fires at insert,
--      "current" student state IS the historical value; it is never recomputed.
--   4. A conservative legacy backfill: existing approved-instrument responses get a
--      snapshot row marked backfill_unverified / ineligible (audit only, never
--      releasable without a future audited pathway), because their true submission-time
--      unit cannot be reconstructed.
--   5. Owner/Admin-only, service_role-executed lifecycle functions: moderate, release,
--      revoke. Release is blocked before rotation end + 7 days, before moderation, and
--      for unverified/incomplete snapshots.
--   6. Unit-Leader read functions (authenticated; scope derived from the caller's JWT via
--      my_unit_scope_keys(), never from a parameter): dashboard summary, anonymous
--      response list, anonymous response detail. They return ONLY numeric response values
--      (all free text is a JSON string and is dropped), never identity, never identifying
--      timestamps, never preceptor-specific grouping. No minimum-count suppression.
--
-- APPROVED INSTRUMENTS (by slug; the rows are seeded manually in production, so this
-- migration keys on slug, never a hard-coded id):
--   student_preceptor_eval  (Preceptor & Unit Feedback)
--   preceptor_progress      (Preceptor Readiness Assessment)
-- Casey-Fink and post_rotation_evaluation are excluded.
--
-- LOCKED POLICY: unit-level only; free text hidden; no identity; no identifying
-- timestamps; Owner/Admin-only release; delayed release (rotation end + 7 days); NO
-- minimum-count suppression (n = 1 is displayed; the Owner accepts the contextual
-- re-identification risk; the UI must never claim a one-response result is anonymous).
--
-- Re-runnable: uses IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS / ON CONFLICT.
-- Verification and rollback are at the bottom (comments) and, in full, in
-- db/audit/unit_leader_evaluation_release_gate_verification.sql and _rollback.sql.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- (1) Release / visibility table (snapshot + lifecycle, 1:1 with a response)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.evaluation_response_unit_release (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id              uuid NOT NULL UNIQUE
                           REFERENCES public.evaluation_responses(id) ON DELETE CASCADE,
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

  -- Mutable release lifecycle.
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
  'Unit Leader evaluation release gate. One row per approved-instrument evaluation_response, holding an immutable submission-time attribution snapshot (hist_*) and a mutable Owner/Admin-controlled release lifecycle. Unit Leaders never read this table directly (RLS owner/admin only); they read shaped, scoped, quantitative-only data through the ul_eval_* SECURITY DEFINER functions. Free text and identity are never exposed. No minimum-count suppression: n = 1 is displayed, an Owner-accepted contextual re-identification risk.';
COMMENT ON COLUMN public.evaluation_response_unit_release.unit_leader_eligible_at IS
  'hist_rotation_end + 7 days. NULL when the rotation end was unknown at capture; such rows can never be released in the first release (release function blocks NULL eligibility).';
COMMENT ON COLUMN public.evaluation_response_unit_release.snapshot_source IS
  'submission_trigger: captured at submission (authoritative historical state). backfill_unverified: legacy row captured at migration time from CURRENT student state, which may not equal the submission-time unit; quarantined as ineligible and never releasable. backfill_verified: reserved for a future audited correction pathway.';
COMMENT ON COLUMN public.evaluation_response_unit_release.hist_preceptor_id IS
  'Immutable preceptor attribution for AUDIT ONLY. Unit-level reporting is the only first-release surface; no Unit Leader read function returns preceptor identity or preceptor-grouped data.';

CREATE INDEX IF NOT EXISTS idx_ul_eval_release_scope
  ON public.evaluation_response_unit_release (hist_unit_key, instrument_slug, timepoint)
  WHERE release_state = 'released' AND revoked_at IS NULL;
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
-- (2) Snapshot immutability guard (BEFORE UPDATE)
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
-- (3) Snapshot capture at submission (AFTER INSERT on evaluation_responses)
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ul_eval_capture_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_slug            text;
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

  -- Attribution from the student's state AT submission (fires at insert => historical).
  SELECT s.matched_unit_id,
         s.preceptor_id,
         s.cohort_school_rotation_id,
         COALESCE(s.rotation_completed_at, s.rotation_end_date::timestamptz)
    INTO v_unit_id, v_preceptor_id, v_rotation_id, v_rotation_end
    FROM public.students s
    WHERE s.id = NEW.student_id;

  SELECT u.unit_name  INTO v_unit_key        FROM public.units u       WHERE u.id = v_unit_id;
  SELECT p.full_name  INTO v_preceptor_label FROM public.preceptors p  WHERE p.id = v_preceptor_id;
  SELECT c.name       INTO v_cohort_label    FROM public.cohorts c     WHERE c.id = NEW.cohort_id;

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
-- (4) Legacy backfill: existing approved-instrument responses.
--     Quarantined as ineligible / backfill_unverified. Never releasable without a
--     future audited pathway, because the true submission-time unit is unknown.
-- ────────────────────────────────────────────────────────────────
INSERT INTO public.evaluation_response_unit_release (
  response_id, assignment_id, instrument_id, instrument_slug, timepoint,
  hist_unit_id, hist_unit_key, hist_preceptor_id, hist_preceptor_label,
  hist_cohort_id, hist_cohort_label, hist_rotation_id, hist_rotation_end,
  unit_leader_eligible_at, snapshot_source, release_state
)
SELECT
  r.id, r.assignment_id, r.instrument_id, i.slug, r.timepoint,
  s.matched_unit_id, u.unit_name, s.preceptor_id, p.full_name,
  r.cohort_id, c.name, s.cohort_school_rotation_id,
  COALESCE(s.rotation_completed_at, s.rotation_end_date::timestamptz),
  NULL,                       -- eligibility withheld: legacy rows are quarantined
  'backfill_unverified', 'ineligible'
FROM public.evaluation_responses r
JOIN public.evaluation_instruments i ON i.id = r.instrument_id
LEFT JOIN public.students   s ON s.id = r.student_id
LEFT JOIN public.units      u ON u.id = s.matched_unit_id
LEFT JOIN public.preceptors p ON p.id = s.preceptor_id
LEFT JOIN public.cohorts    c ON c.id = r.cohort_id
WHERE i.slug IN ('student_preceptor_eval', 'preceptor_progress')
ON CONFLICT (response_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────
-- (5) Owner/Admin actor check for service-role lifecycle functions.
--     auth.uid() is NULL under service_role, so authority is validated from the passed
--     actor profile id (never trusted from a Unit Leader; these functions are
--     service_role EXECUTE only).
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ul_eval_is_active_owner_admin(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = p_profile_id
      AND up.role IN ('owner', 'admin')
      AND COALESCE(up.is_active, true) = true
  );
$$;

-- moderate: cleared | blocked. Clearing a pending row advances it to 'moderated'.
CREATE OR REPLACE FUNCTION public.ul_eval_moderate_response(
  p_actor_profile_id uuid, p_response_id uuid, p_decision text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_row public.evaluation_response_unit_release%ROWTYPE;
BEGIN
  IF NOT public._ul_eval_is_active_owner_admin(p_actor_profile_id) THEN
    RETURN jsonb_build_object('status', 'not_authorized');
  END IF;
  IF p_decision NOT IN ('cleared', 'blocked') THEN
    RETURN jsonb_build_object('status', 'invalid_decision');
  END IF;
  SELECT * INTO v_row FROM public.evaluation_response_unit_release WHERE response_id = p_response_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  UPDATE public.evaluation_response_unit_release
    SET moderation_state = p_decision,
        moderated_at     = now(),
        moderated_by     = p_actor_profile_id,
        release_state    = CASE
                             WHEN p_decision = 'cleared' AND release_state = 'pending'
                               THEN 'moderated'
                             ELSE release_state
                           END
    WHERE response_id = p_response_id;
  RETURN jsonb_build_object('status', 'success', 'moderation_state', p_decision);
END;
$$;

-- release: enforce every gate, then make the response quantitatively visible.
CREATE OR REPLACE FUNCTION public.ul_eval_release_response(
  p_actor_profile_id uuid, p_response_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_row public.evaluation_response_unit_release%ROWTYPE;
BEGIN
  IF NOT public._ul_eval_is_active_owner_admin(p_actor_profile_id) THEN
    RETURN jsonb_build_object('status', 'not_authorized');
  END IF;
  SELECT * INTO v_row FROM public.evaluation_response_unit_release WHERE response_id = p_response_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_row.instrument_slug NOT IN ('student_preceptor_eval', 'preceptor_progress') THEN
    RETURN jsonb_build_object('status', 'instrument_not_approved');
  END IF;
  IF v_row.snapshot_source = 'backfill_unverified' THEN
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
        released_by          = p_actor_profile_id,
        revoked_at           = NULL,   -- a re-release after revoke clears the revocation
        revoked_by           = NULL
    WHERE response_id = p_response_id;
  RETURN jsonb_build_object('status', 'success');
END;
$$;

-- revoke: immediately remove Unit Leader visibility. Idempotent.
CREATE OR REPLACE FUNCTION public.ul_eval_revoke_response(
  p_actor_profile_id uuid, p_response_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_found boolean;
BEGIN
  IF NOT public._ul_eval_is_active_owner_admin(p_actor_profile_id) THEN
    RETURN jsonb_build_object('status', 'not_authorized');
  END IF;
  UPDATE public.evaluation_response_unit_release
    SET release_state        = 'revoked',
        quantitative_visible = false,
        revoked_at           = now(),
        revoked_by           = p_actor_profile_id
    WHERE response_id = p_response_id
    RETURNING true INTO v_found;
  IF v_found IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  RETURN jsonb_build_object('status', 'success');
END;
$$;

-- ────────────────────────────────────────────────────────────────
-- (6) Unit Leader read functions. Scope is derived from the caller's JWT via
--     my_unit_scope_keys() and has_active_role_grant('unit_leader'); a parameter can
--     only NARROW. Returned payload is numeric-only (all free text is a JSON string and
--     is dropped), with no identity, no timestamps, and no preceptor grouping. No
--     minimum-count suppression.
-- ────────────────────────────────────────────────────────────────

-- Unit-level quantitative summary for one instrument (+ optional timepoint / unit).
CREATE OR REPLACE FUNCTION public.ul_eval_dashboard_summary(
  p_instrument_slug text, p_timepoint text DEFAULT NULL, p_unit_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  WITH scoped AS (
    SELECT rel.response_id, r.responses
    FROM public.evaluation_response_unit_release rel
    JOIN public.evaluation_responses r ON r.id = rel.response_id
    WHERE public.has_active_role_grant('unit_leader')
      AND rel.instrument_slug = p_instrument_slug
      AND rel.instrument_slug IN ('student_preceptor_eval', 'preceptor_progress')
      AND rel.release_state = 'released'
      AND rel.revoked_at IS NULL
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
    -- #>> '{}' extracts a jsonb scalar as text, portable across PG versions (there is
    -- no universal direct jsonb->numeric cast); guarded by jsonb_typeof = 'number'.
    SELECT e.key, (e.value #>> '{}')::numeric AS val
    FROM scoped sc, jsonb_each(sc.responses) e
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

-- Anonymous released response list. anon_label is positional (ephemeral), not a stable
-- cross-context identifier; response_id is a fetch token the detail function re-authorizes.
CREATE OR REPLACE FUNCTION public.ul_eval_response_list(
  p_instrument_slug text, p_timepoint text DEFAULT NULL, p_unit_key text DEFAULT NULL
) RETURNS TABLE (
  anon_label      text,
  response_id     uuid,
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
    'Response ' || row_number() OVER (ORDER BY rel.released_at, rel.response_id) AS anon_label,
    rel.response_id,
    rel.instrument_slug,
    rel.timepoint,
    rel.hist_unit_key AS unit_key,
    COALESCE((
      SELECT jsonb_object_agg(e.key, e.value)
      FROM jsonb_each(r.responses) e
      WHERE jsonb_typeof(e.value) = 'number'
    ), '{}'::jsonb) AS quantitative
  FROM public.evaluation_response_unit_release rel
  JOIN public.evaluation_responses r ON r.id = rel.response_id
  WHERE public.has_active_role_grant('unit_leader')
    AND rel.instrument_slug = p_instrument_slug
    AND rel.instrument_slug IN ('student_preceptor_eval', 'preceptor_progress')
    AND rel.release_state = 'released'
    AND rel.revoked_at IS NULL
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

-- One anonymous response, re-checking scope + release for that exact id (never trusting
-- a prior list result as authorization).
CREATE OR REPLACE FUNCTION public.ul_eval_response_detail(p_response_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'response_id', rel.response_id,
    'instrument_slug', rel.instrument_slug,
    'timepoint', rel.timepoint,
    'unit_key', rel.hist_unit_key,
    'quantitative', COALESCE((
      SELECT jsonb_object_agg(e.key, e.value)
      FROM jsonb_each(r.responses) e
      WHERE jsonb_typeof(e.value) = 'number'
    ), '{}'::jsonb)
  )
  FROM public.evaluation_response_unit_release rel
  JOIN public.evaluation_responses r ON r.id = rel.response_id
  WHERE rel.response_id = p_response_id
    AND public.has_active_role_grant('unit_leader')
    AND rel.instrument_slug IN ('student_preceptor_eval', 'preceptor_progress')
    AND rel.release_state = 'released'
    AND rel.revoked_at IS NULL
    AND rel.unit_leader_eligible_at IS NOT NULL
    AND now() >= rel.unit_leader_eligible_at
    AND EXISTS (
      SELECT 1 FROM public.my_unit_scope_keys() s
      WHERE s.unit_key = rel.hist_unit_key
        AND (s.cohort_id IS NULL OR s.cohort_id = rel.hist_cohort_id)
    );
$$;

-- ────────────────────────────────────────────────────────────────
-- (7) Function privileges (least privilege).
-- ────────────────────────────────────────────────────────────────
-- Internal helpers / trigger functions: no client execute.
REVOKE ALL ON FUNCTION public._ul_eval_is_active_owner_admin(uuid)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ul_eval_is_active_owner_admin(uuid) TO service_role;
REVOKE ALL ON FUNCTION public._ul_eval_guard_snapshot_immutable()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ul_eval_capture_snapshot()           FROM PUBLIC, anon, authenticated;

-- Write/lifecycle functions: service_role ONLY. Unit Leaders (authenticated) cannot call.
REVOKE ALL ON FUNCTION public.ul_eval_moderate_response(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ul_eval_release_response(uuid, uuid)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ul_eval_revoke_response(uuid, uuid)         FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ul_eval_moderate_response(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ul_eval_release_response(uuid, uuid)        TO service_role;
GRANT EXECUTE ON FUNCTION public.ul_eval_revoke_response(uuid, uuid)         TO service_role;

-- Read functions: signed-in users only (scope from their JWT); never anon/public.
REVOKE ALL ON FUNCTION public.ul_eval_dashboard_summary(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ul_eval_response_list(text, text, text)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ul_eval_response_detail(uuid)               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ul_eval_dashboard_summary(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ul_eval_response_list(text, text, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.ul_eval_response_detail(uuid)               TO authenticated;

COMMIT;

-- PostgREST schema cache reload (new table + functions).
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICATION (run AFTER COMMIT; expects the described results). Full script:
--   db/audit/unit_leader_evaluation_release_gate_verification.sql
-- ----------------------------------------------------------------------------
-- 1) Table + RLS present:
--    SELECT relrowsecurity FROM pg_class WHERE relname = 'evaluation_response_unit_release';
--      -> t
-- 2) Functions with correct security + search_path:
--    SELECT proname, prosecdef, proconfig
--      FROM pg_proc WHERE proname LIKE 'ul_eval_%';
--      -> prosecdef = t, proconfig includes search_path=public, pg_catalog
-- 3) No authenticated EXECUTE on lifecycle functions:
--    SELECT has_function_privilege('authenticated',
--      'public.ul_eval_release_response(uuid,uuid)', 'EXECUTE');  -> f
-- 4) Backfill counts by source/state:
--    SELECT snapshot_source, release_state, count(*)
--      FROM public.evaluation_response_unit_release GROUP BY 1,2;
--      -> only ('backfill_unverified','ineligible') at apply time
-- 5) Snapshot immutability (expect ERROR):
--    UPDATE public.evaluation_response_unit_release SET hist_unit_key = 'x' WHERE true;
--
-- ROLLBACK (emergency = revoke read EXECUTE, preserving all data). Full script:
--   db/audit/unit_leader_evaluation_release_gate_rollback.sql
-- ============================================================================
