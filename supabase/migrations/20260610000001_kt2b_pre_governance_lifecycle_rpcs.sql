-- =============================================================================
-- ASPIRE Intelligence: KT-2b-pre Governance Lifecycle RPC Functions
-- Migration: 20260610000001_kt2b_pre_governance_lifecycle_rpcs
-- =============================================================================
--
-- PURPOSE
-- Define the Postgres transaction functions that KT-2b endpoints will call for
-- every governance lifecycle/versioning action against the KT-1 tables. Each
-- function performs ALL of its writes (version snapshot, parent update, revision
-- delete where applicable, and the activity_logs audit row) inside one plpgsql
-- function body, which is inherently atomic: any unhandled exception rolls back
-- the entire call. This replaces the rejected ordered partial-failure model.
--
-- ELEVEN purpose-specific functions (no generic mutator):
--   Knowledge:  governance_activate_knowledge_entry
--               governance_apply_knowledge_revision
--               governance_restore_knowledge_version
--               governance_change_knowledge_state
--   Templates:  governance_activate_template
--               governance_apply_template_revision
--               governance_restore_template_version
--               governance_change_template_state
--   Partials:   governance_activate_template_partial
--               governance_restore_template_partial_version
--               governance_change_template_partial_state
--
-- HOUSE PRECEDENT (mirrored): supabase/migrations/20260607000002_shift_log_check_out_rpc.sql
--   - LANGUAGE plpgsql, SECURITY INVOKER (caller is service_role via the endpoint)
--   - SET search_path = pg_catalog, public  (the established precedent; applied
--     identically to all eleven functions -- no mixed style)
--   - Lock-then-verify: SELECT ... FOR UPDATE the parent, then re-check every
--     precondition in-function regardless of endpoint-side checks
--   - Typed exceptions: RAISE EXCEPTION '<token>' USING ERRCODE='P0xxx'
--   - REVOKE ALL FROM PUBLIC/anon/authenticated; GRANT EXECUTE TO service_role
--   DEVIATION FROM PRECEDENT (binding per KT-2b-pre): the precedent uses
--   CREATE OR REPLACE FUNCTION for idempotency; this migration uses CREATE
--   FUNCTION only (no replace/alter/overwrite of any object). The pre-apply
--   collision check confirmed none of the eleven names exist.
--
-- GOVERNANCE EXCEPTION TAXONOMY (distinct P0101-P0107 block; clear of the
-- shift-log P0001-P0009 range). KT-2b endpoints map by code/token:
--   P0101 governance_target_not_found         -> 404
--   P0102 governance_revision_not_found        -> 404
--   P0103 governance_version_not_found         -> 404
--   P0104 governance_invalid_transition        -> 409
--   P0105 governance_archived_terminal         -> 409
--   P0106 governance_invalid_version_sequence  -> 409
--   P0107 governance_invalid_actor             -> 400
--
-- ACTOR DOMAIN: p_actor_profile_id is a user_profiles.id. Each function resolves
-- user_name/user_role from user_profiles INSIDE the transaction; a missing
-- profile raises P0107. auth.users.id never appears anywhere in this migration.
--
-- VERSION HISTORY IS FORWARD-ONLY: new snapshots are inserted at
-- current_version + 1; existing version rows are never updated or deleted.
--
-- updated_at on parent tables is maintained by the KT-1 set_updated_at_* BEFORE
-- UPDATE triggers; the functions set updated_by and let the trigger set
-- updated_at (house convention).
--
-- STATE VOCABULARY: draft | active | deprecated | archived. change_state handles
-- ONLY: active->deprecated, deprecated->active, deprecated->archived,
-- draft->archived. draft->active is exclusively the activate functions.
-- archived->anything raises P0105. Any other pair raises P0104.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute.
-- Additive: CREATE FUNCTION + REVOKE/GRANT only. No table/trigger/RLS/data change.
-- =============================================================================


-- ============================================================
-- 1. governance_activate_knowledge_entry
-- ============================================================
CREATE FUNCTION public.governance_activate_knowledge_entry(
  p_entry_id uuid,
  p_actor_profile_id uuid,
  p_change_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_entry public.knowledge_entries%ROWTYPE;
  v_actor_name text;
  v_actor_role text;
  v_next integer;
BEGIN
  SELECT full_name, role INTO v_actor_name, v_actor_role
  FROM public.user_profiles WHERE id = p_actor_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_invalid_actor' USING ERRCODE = 'P0107';
  END IF;

  SELECT * INTO v_entry FROM public.knowledge_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_target_not_found' USING ERRCODE = 'P0101';
  END IF;
  IF v_entry.state <> 'draft' THEN
    RAISE EXCEPTION 'governance_invalid_transition' USING ERRCODE = 'P0104';
  END IF;

  v_next := v_entry.current_version + 1;

  BEGIN
    INSERT INTO public.knowledge_entry_versions
      (entry_id, version_number, title, category, body, source_attribution, precedence_rank, change_note, editor_id)
    VALUES
      (v_entry.id, v_next, v_entry.title, v_entry.category, v_entry.body, v_entry.source_attribution, v_entry.precedence_rank, p_change_note, p_actor_profile_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'governance_invalid_version_sequence' USING ERRCODE = 'P0106';
  END;

  UPDATE public.knowledge_entries
    SET state = 'active', current_version = v_next, updated_by = p_actor_profile_id
    WHERE id = v_entry.id;

  INSERT INTO public.activity_logs
    (user_id, user_name, user_role, action_type, entity_type, entity_id, cohort_id, description, metadata)
  VALUES
    (p_actor_profile_id, v_actor_name, v_actor_role, 'knowledge_entry_activated', 'knowledge_entry', v_entry.id::text, NULL,
     'Activated knowledge entry',
     jsonb_build_object('from_state', 'draft', 'to_state', 'active', 'to_version', v_next, 'change_note', p_change_note));

  RETURN jsonb_build_object('entry_id', v_entry.id, 'state', 'active', 'current_version', v_next);
END;
$$;


-- ============================================================
-- 2. governance_apply_knowledge_revision
-- ============================================================
CREATE FUNCTION public.governance_apply_knowledge_revision(
  p_entry_id uuid,
  p_actor_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_entry public.knowledge_entries%ROWTYPE;
  v_rev public.knowledge_revisions%ROWTYPE;
  v_actor_name text;
  v_actor_role text;
  v_next integer;
BEGIN
  SELECT full_name, role INTO v_actor_name, v_actor_role
  FROM public.user_profiles WHERE id = p_actor_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_invalid_actor' USING ERRCODE = 'P0107';
  END IF;

  SELECT * INTO v_entry FROM public.knowledge_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_target_not_found' USING ERRCODE = 'P0101';
  END IF;
  IF v_entry.state <> 'active' THEN
    RAISE EXCEPTION 'governance_invalid_transition' USING ERRCODE = 'P0104';
  END IF;

  SELECT * INTO v_rev FROM public.knowledge_revisions WHERE entry_id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_revision_not_found' USING ERRCODE = 'P0102';
  END IF;

  v_next := v_entry.current_version + 1;

  BEGIN
    INSERT INTO public.knowledge_entry_versions
      (entry_id, version_number, title, category, body, source_attribution, precedence_rank, change_note, editor_id)
    VALUES
      (v_entry.id, v_next, v_rev.title, v_rev.category, v_rev.body, v_rev.source_attribution, v_rev.precedence_rank, v_rev.change_note, p_actor_profile_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'governance_invalid_version_sequence' USING ERRCODE = 'P0106';
  END;

  UPDATE public.knowledge_entries
    SET title = v_rev.title, category = v_rev.category, body = v_rev.body,
        source_attribution = v_rev.source_attribution, precedence_rank = v_rev.precedence_rank,
        current_version = v_next, updated_by = p_actor_profile_id
    WHERE id = v_entry.id;

  DELETE FROM public.knowledge_revisions WHERE id = v_rev.id;

  INSERT INTO public.activity_logs
    (user_id, user_name, user_role, action_type, entity_type, entity_id, cohort_id, description, metadata)
  VALUES
    (p_actor_profile_id, v_actor_name, v_actor_role, 'knowledge_revision_applied', 'knowledge_entry', v_entry.id::text, NULL,
     'Applied knowledge revision',
     jsonb_build_object('revision_id', v_rev.id, 'to_version', v_next, 'change_note', v_rev.change_note));

  RETURN jsonb_build_object('entry_id', v_entry.id, 'state', 'active', 'current_version', v_next, 'applied_revision_id', v_rev.id);
END;
$$;


-- ============================================================
-- 3. governance_restore_knowledge_version
-- ============================================================
CREATE FUNCTION public.governance_restore_knowledge_version(
  p_entry_id uuid,
  p_version_number integer,
  p_actor_profile_id uuid,
  p_change_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_entry public.knowledge_entries%ROWTYPE;
  v_ver public.knowledge_entry_versions%ROWTYPE;
  v_actor_name text;
  v_actor_role text;
  v_next integer;
BEGIN
  SELECT full_name, role INTO v_actor_name, v_actor_role
  FROM public.user_profiles WHERE id = p_actor_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_invalid_actor' USING ERRCODE = 'P0107';
  END IF;

  SELECT * INTO v_entry FROM public.knowledge_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_target_not_found' USING ERRCODE = 'P0101';
  END IF;
  IF v_entry.state <> 'active' THEN
    RAISE EXCEPTION 'governance_invalid_transition' USING ERRCODE = 'P0104';
  END IF;

  SELECT * INTO v_ver FROM public.knowledge_entry_versions
    WHERE entry_id = p_entry_id AND version_number = p_version_number;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_version_not_found' USING ERRCODE = 'P0103';
  END IF;

  v_next := v_entry.current_version + 1;

  BEGIN
    INSERT INTO public.knowledge_entry_versions
      (entry_id, version_number, title, category, body, source_attribution, precedence_rank, change_note, editor_id)
    VALUES
      (v_entry.id, v_next, v_ver.title, v_ver.category, v_ver.body, v_ver.source_attribution, v_ver.precedence_rank, p_change_note, p_actor_profile_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'governance_invalid_version_sequence' USING ERRCODE = 'P0106';
  END;

  UPDATE public.knowledge_entries
    SET title = v_ver.title, category = v_ver.category, body = v_ver.body,
        source_attribution = v_ver.source_attribution, precedence_rank = v_ver.precedence_rank,
        current_version = v_next, updated_by = p_actor_profile_id
    WHERE id = v_entry.id;

  INSERT INTO public.activity_logs
    (user_id, user_name, user_role, action_type, entity_type, entity_id, cohort_id, description, metadata)
  VALUES
    (p_actor_profile_id, v_actor_name, v_actor_role, 'knowledge_entry_version_restored', 'knowledge_entry', v_entry.id::text, NULL,
     'Restored knowledge entry version',
     jsonb_build_object('from_version', p_version_number, 'to_version', v_next, 'change_note', p_change_note));

  RETURN jsonb_build_object('entry_id', v_entry.id, 'state', v_entry.state, 'current_version', v_next, 'restored_from_version', p_version_number);
END;
$$;


-- ============================================================
-- 4. governance_change_knowledge_state
-- ============================================================
CREATE FUNCTION public.governance_change_knowledge_state(
  p_entry_id uuid,
  p_target_state text,
  p_actor_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_entry public.knowledge_entries%ROWTYPE;
  v_actor_name text;
  v_actor_role text;
BEGIN
  SELECT full_name, role INTO v_actor_name, v_actor_role
  FROM public.user_profiles WHERE id = p_actor_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_invalid_actor' USING ERRCODE = 'P0107';
  END IF;

  IF p_target_state IS NULL OR p_target_state NOT IN ('draft', 'active', 'deprecated', 'archived') THEN
    RAISE EXCEPTION 'governance_invalid_transition' USING ERRCODE = 'P0104';
  END IF;

  SELECT * INTO v_entry FROM public.knowledge_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_target_not_found' USING ERRCODE = 'P0101';
  END IF;

  IF v_entry.state = 'archived' THEN
    RAISE EXCEPTION 'governance_archived_terminal' USING ERRCODE = 'P0105';
  END IF;

  IF NOT (
    (v_entry.state = 'active'     AND p_target_state = 'deprecated') OR
    (v_entry.state = 'deprecated' AND p_target_state = 'active') OR
    (v_entry.state = 'deprecated' AND p_target_state = 'archived') OR
    (v_entry.state = 'draft'      AND p_target_state = 'archived')
  ) THEN
    RAISE EXCEPTION 'governance_invalid_transition' USING ERRCODE = 'P0104';
  END IF;

  UPDATE public.knowledge_entries
    SET state = p_target_state, updated_by = p_actor_profile_id
    WHERE id = v_entry.id;

  INSERT INTO public.activity_logs
    (user_id, user_name, user_role, action_type, entity_type, entity_id, cohort_id, description, metadata)
  VALUES
    (p_actor_profile_id, v_actor_name, v_actor_role, 'knowledge_entry_state_changed', 'knowledge_entry', v_entry.id::text, NULL,
     'Changed knowledge entry state',
     jsonb_build_object('from_state', v_entry.state, 'to_state', p_target_state));

  RETURN jsonb_build_object('entry_id', v_entry.id, 'state', p_target_state, 'current_version', v_entry.current_version);
END;
$$;


-- ============================================================
-- 5. governance_activate_template
-- ============================================================
CREATE FUNCTION public.governance_activate_template(
  p_template_id uuid,
  p_actor_profile_id uuid,
  p_change_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tpl public.templates%ROWTYPE;
  v_actor_name text;
  v_actor_role text;
  v_next integer;
BEGIN
  SELECT full_name, role INTO v_actor_name, v_actor_role
  FROM public.user_profiles WHERE id = p_actor_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_invalid_actor' USING ERRCODE = 'P0107';
  END IF;

  SELECT * INTO v_tpl FROM public.templates WHERE id = p_template_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_target_not_found' USING ERRCODE = 'P0101';
  END IF;
  IF v_tpl.state <> 'draft' THEN
    RAISE EXCEPTION 'governance_invalid_transition' USING ERRCODE = 'P0104';
  END IF;

  v_next := v_tpl.current_version + 1;

  BEGIN
    INSERT INTO public.template_versions
      (template_id, version_number, title, purpose, audience, channel, subject_pattern, body, placeholder_schema, change_note, editor_id)
    VALUES
      (v_tpl.id, v_next, v_tpl.title, v_tpl.purpose, v_tpl.audience, v_tpl.channel, v_tpl.subject_pattern, v_tpl.body, v_tpl.placeholder_schema, p_change_note, p_actor_profile_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'governance_invalid_version_sequence' USING ERRCODE = 'P0106';
  END;

  UPDATE public.templates
    SET state = 'active', current_version = v_next, updated_by = p_actor_profile_id
    WHERE id = v_tpl.id;

  INSERT INTO public.activity_logs
    (user_id, user_name, user_role, action_type, entity_type, entity_id, cohort_id, description, metadata)
  VALUES
    (p_actor_profile_id, v_actor_name, v_actor_role, 'template_activated', 'template', v_tpl.id::text, NULL,
     'Activated template',
     jsonb_build_object('from_state', 'draft', 'to_state', 'active', 'to_version', v_next, 'change_note', p_change_note));

  RETURN jsonb_build_object('template_id', v_tpl.id, 'state', 'active', 'current_version', v_next);
END;
$$;


-- ============================================================
-- 6. governance_apply_template_revision
-- ============================================================
CREATE FUNCTION public.governance_apply_template_revision(
  p_template_id uuid,
  p_actor_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tpl public.templates%ROWTYPE;
  v_rev public.template_revisions%ROWTYPE;
  v_actor_name text;
  v_actor_role text;
  v_next integer;
BEGIN
  SELECT full_name, role INTO v_actor_name, v_actor_role
  FROM public.user_profiles WHERE id = p_actor_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_invalid_actor' USING ERRCODE = 'P0107';
  END IF;

  SELECT * INTO v_tpl FROM public.templates WHERE id = p_template_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_target_not_found' USING ERRCODE = 'P0101';
  END IF;
  IF v_tpl.state <> 'active' THEN
    RAISE EXCEPTION 'governance_invalid_transition' USING ERRCODE = 'P0104';
  END IF;

  SELECT * INTO v_rev FROM public.template_revisions WHERE template_id = p_template_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_revision_not_found' USING ERRCODE = 'P0102';
  END IF;

  v_next := v_tpl.current_version + 1;

  BEGIN
    INSERT INTO public.template_versions
      (template_id, version_number, title, purpose, audience, channel, subject_pattern, body, placeholder_schema, change_note, editor_id)
    VALUES
      (v_tpl.id, v_next, v_rev.title, v_rev.purpose, v_rev.audience, v_rev.channel, v_rev.subject_pattern, v_rev.body, v_rev.placeholder_schema, v_rev.change_note, p_actor_profile_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'governance_invalid_version_sequence' USING ERRCODE = 'P0106';
  END;

  UPDATE public.templates
    SET title = v_rev.title, purpose = v_rev.purpose, audience = v_rev.audience, channel = v_rev.channel,
        subject_pattern = v_rev.subject_pattern, body = v_rev.body, placeholder_schema = v_rev.placeholder_schema,
        current_version = v_next, updated_by = p_actor_profile_id
    WHERE id = v_tpl.id;

  DELETE FROM public.template_revisions WHERE id = v_rev.id;

  INSERT INTO public.activity_logs
    (user_id, user_name, user_role, action_type, entity_type, entity_id, cohort_id, description, metadata)
  VALUES
    (p_actor_profile_id, v_actor_name, v_actor_role, 'template_revision_applied', 'template', v_tpl.id::text, NULL,
     'Applied template revision',
     jsonb_build_object('revision_id', v_rev.id, 'to_version', v_next, 'change_note', v_rev.change_note));

  RETURN jsonb_build_object('template_id', v_tpl.id, 'state', 'active', 'current_version', v_next, 'applied_revision_id', v_rev.id);
END;
$$;


-- ============================================================
-- 7. governance_restore_template_version
-- ============================================================
CREATE FUNCTION public.governance_restore_template_version(
  p_template_id uuid,
  p_version_number integer,
  p_actor_profile_id uuid,
  p_change_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tpl public.templates%ROWTYPE;
  v_ver public.template_versions%ROWTYPE;
  v_actor_name text;
  v_actor_role text;
  v_next integer;
BEGIN
  SELECT full_name, role INTO v_actor_name, v_actor_role
  FROM public.user_profiles WHERE id = p_actor_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_invalid_actor' USING ERRCODE = 'P0107';
  END IF;

  SELECT * INTO v_tpl FROM public.templates WHERE id = p_template_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_target_not_found' USING ERRCODE = 'P0101';
  END IF;
  IF v_tpl.state <> 'active' THEN
    RAISE EXCEPTION 'governance_invalid_transition' USING ERRCODE = 'P0104';
  END IF;

  SELECT * INTO v_ver FROM public.template_versions
    WHERE template_id = p_template_id AND version_number = p_version_number;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_version_not_found' USING ERRCODE = 'P0103';
  END IF;

  v_next := v_tpl.current_version + 1;

  BEGIN
    INSERT INTO public.template_versions
      (template_id, version_number, title, purpose, audience, channel, subject_pattern, body, placeholder_schema, change_note, editor_id)
    VALUES
      (v_tpl.id, v_next, v_ver.title, v_ver.purpose, v_ver.audience, v_ver.channel, v_ver.subject_pattern, v_ver.body, v_ver.placeholder_schema, p_change_note, p_actor_profile_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'governance_invalid_version_sequence' USING ERRCODE = 'P0106';
  END;

  UPDATE public.templates
    SET title = v_ver.title, purpose = v_ver.purpose, audience = v_ver.audience, channel = v_ver.channel,
        subject_pattern = v_ver.subject_pattern, body = v_ver.body, placeholder_schema = v_ver.placeholder_schema,
        current_version = v_next, updated_by = p_actor_profile_id
    WHERE id = v_tpl.id;

  INSERT INTO public.activity_logs
    (user_id, user_name, user_role, action_type, entity_type, entity_id, cohort_id, description, metadata)
  VALUES
    (p_actor_profile_id, v_actor_name, v_actor_role, 'template_version_restored', 'template', v_tpl.id::text, NULL,
     'Restored template version',
     jsonb_build_object('from_version', p_version_number, 'to_version', v_next, 'change_note', p_change_note));

  RETURN jsonb_build_object('template_id', v_tpl.id, 'state', v_tpl.state, 'current_version', v_next, 'restored_from_version', p_version_number);
END;
$$;


-- ============================================================
-- 8. governance_change_template_state
-- ============================================================
CREATE FUNCTION public.governance_change_template_state(
  p_template_id uuid,
  p_target_state text,
  p_actor_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tpl public.templates%ROWTYPE;
  v_actor_name text;
  v_actor_role text;
BEGIN
  SELECT full_name, role INTO v_actor_name, v_actor_role
  FROM public.user_profiles WHERE id = p_actor_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_invalid_actor' USING ERRCODE = 'P0107';
  END IF;

  IF p_target_state IS NULL OR p_target_state NOT IN ('draft', 'active', 'deprecated', 'archived') THEN
    RAISE EXCEPTION 'governance_invalid_transition' USING ERRCODE = 'P0104';
  END IF;

  SELECT * INTO v_tpl FROM public.templates WHERE id = p_template_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_target_not_found' USING ERRCODE = 'P0101';
  END IF;

  IF v_tpl.state = 'archived' THEN
    RAISE EXCEPTION 'governance_archived_terminal' USING ERRCODE = 'P0105';
  END IF;

  IF NOT (
    (v_tpl.state = 'active'     AND p_target_state = 'deprecated') OR
    (v_tpl.state = 'deprecated' AND p_target_state = 'active') OR
    (v_tpl.state = 'deprecated' AND p_target_state = 'archived') OR
    (v_tpl.state = 'draft'      AND p_target_state = 'archived')
  ) THEN
    RAISE EXCEPTION 'governance_invalid_transition' USING ERRCODE = 'P0104';
  END IF;

  UPDATE public.templates
    SET state = p_target_state, updated_by = p_actor_profile_id
    WHERE id = v_tpl.id;

  INSERT INTO public.activity_logs
    (user_id, user_name, user_role, action_type, entity_type, entity_id, cohort_id, description, metadata)
  VALUES
    (p_actor_profile_id, v_actor_name, v_actor_role, 'template_state_changed', 'template', v_tpl.id::text, NULL,
     'Changed template state',
     jsonb_build_object('from_state', v_tpl.state, 'to_state', p_target_state));

  RETURN jsonb_build_object('template_id', v_tpl.id, 'state', p_target_state, 'current_version', v_tpl.current_version);
END;
$$;


-- ============================================================
-- 9. governance_activate_template_partial
-- ============================================================
CREATE FUNCTION public.governance_activate_template_partial(
  p_partial_id uuid,
  p_actor_profile_id uuid,
  p_change_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_partial public.template_partials%ROWTYPE;
  v_actor_name text;
  v_actor_role text;
  v_next integer;
BEGIN
  SELECT full_name, role INTO v_actor_name, v_actor_role
  FROM public.user_profiles WHERE id = p_actor_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_invalid_actor' USING ERRCODE = 'P0107';
  END IF;

  SELECT * INTO v_partial FROM public.template_partials WHERE id = p_partial_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_target_not_found' USING ERRCODE = 'P0101';
  END IF;
  IF v_partial.state <> 'draft' THEN
    RAISE EXCEPTION 'governance_invalid_transition' USING ERRCODE = 'P0104';
  END IF;

  v_next := v_partial.current_version + 1;

  BEGIN
    INSERT INTO public.template_partial_versions
      (partial_id, version_number, name, description, body, change_note, editor_id)
    VALUES
      (v_partial.id, v_next, v_partial.name, v_partial.description, v_partial.body, p_change_note, p_actor_profile_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'governance_invalid_version_sequence' USING ERRCODE = 'P0106';
  END;

  UPDATE public.template_partials
    SET state = 'active', current_version = v_next, updated_by = p_actor_profile_id
    WHERE id = v_partial.id;

  INSERT INTO public.activity_logs
    (user_id, user_name, user_role, action_type, entity_type, entity_id, cohort_id, description, metadata)
  VALUES
    (p_actor_profile_id, v_actor_name, v_actor_role, 'template_partial_activated', 'template_partial', v_partial.id::text, NULL,
     'Activated template partial',
     jsonb_build_object('from_state', 'draft', 'to_state', 'active', 'to_version', v_next, 'change_note', p_change_note));

  RETURN jsonb_build_object('partial_id', v_partial.id, 'state', 'active', 'current_version', v_next);
END;
$$;


-- ============================================================
-- 10. governance_restore_template_partial_version
-- ============================================================
CREATE FUNCTION public.governance_restore_template_partial_version(
  p_partial_id uuid,
  p_version_number integer,
  p_actor_profile_id uuid,
  p_change_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_partial public.template_partials%ROWTYPE;
  v_ver public.template_partial_versions%ROWTYPE;
  v_actor_name text;
  v_actor_role text;
  v_next integer;
BEGIN
  SELECT full_name, role INTO v_actor_name, v_actor_role
  FROM public.user_profiles WHERE id = p_actor_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_invalid_actor' USING ERRCODE = 'P0107';
  END IF;

  SELECT * INTO v_partial FROM public.template_partials WHERE id = p_partial_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_target_not_found' USING ERRCODE = 'P0101';
  END IF;
  IF v_partial.state <> 'active' THEN
    RAISE EXCEPTION 'governance_invalid_transition' USING ERRCODE = 'P0104';
  END IF;

  SELECT * INTO v_ver FROM public.template_partial_versions
    WHERE partial_id = p_partial_id AND version_number = p_version_number;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_version_not_found' USING ERRCODE = 'P0103';
  END IF;

  v_next := v_partial.current_version + 1;

  BEGIN
    INSERT INTO public.template_partial_versions
      (partial_id, version_number, name, description, body, change_note, editor_id)
    VALUES
      (v_partial.id, v_next, v_ver.name, v_ver.description, v_ver.body, p_change_note, p_actor_profile_id);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'governance_invalid_version_sequence' USING ERRCODE = 'P0106';
  END;

  UPDATE public.template_partials
    SET name = v_ver.name, description = v_ver.description, body = v_ver.body,
        current_version = v_next, updated_by = p_actor_profile_id
    WHERE id = v_partial.id;

  INSERT INTO public.activity_logs
    (user_id, user_name, user_role, action_type, entity_type, entity_id, cohort_id, description, metadata)
  VALUES
    (p_actor_profile_id, v_actor_name, v_actor_role, 'template_partial_version_restored', 'template_partial', v_partial.id::text, NULL,
     'Restored template partial version',
     jsonb_build_object('from_version', p_version_number, 'to_version', v_next, 'change_note', p_change_note));

  RETURN jsonb_build_object('partial_id', v_partial.id, 'state', v_partial.state, 'current_version', v_next, 'restored_from_version', p_version_number);
END;
$$;


-- ============================================================
-- 11. governance_change_template_partial_state
-- ============================================================
CREATE FUNCTION public.governance_change_template_partial_state(
  p_partial_id uuid,
  p_target_state text,
  p_actor_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_partial public.template_partials%ROWTYPE;
  v_actor_name text;
  v_actor_role text;
BEGIN
  SELECT full_name, role INTO v_actor_name, v_actor_role
  FROM public.user_profiles WHERE id = p_actor_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_invalid_actor' USING ERRCODE = 'P0107';
  END IF;

  IF p_target_state IS NULL OR p_target_state NOT IN ('draft', 'active', 'deprecated', 'archived') THEN
    RAISE EXCEPTION 'governance_invalid_transition' USING ERRCODE = 'P0104';
  END IF;

  SELECT * INTO v_partial FROM public.template_partials WHERE id = p_partial_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'governance_target_not_found' USING ERRCODE = 'P0101';
  END IF;

  IF v_partial.state = 'archived' THEN
    RAISE EXCEPTION 'governance_archived_terminal' USING ERRCODE = 'P0105';
  END IF;

  IF NOT (
    (v_partial.state = 'active'     AND p_target_state = 'deprecated') OR
    (v_partial.state = 'deprecated' AND p_target_state = 'active') OR
    (v_partial.state = 'deprecated' AND p_target_state = 'archived') OR
    (v_partial.state = 'draft'      AND p_target_state = 'archived')
  ) THEN
    RAISE EXCEPTION 'governance_invalid_transition' USING ERRCODE = 'P0104';
  END IF;

  UPDATE public.template_partials
    SET state = p_target_state, updated_by = p_actor_profile_id
    WHERE id = v_partial.id;

  INSERT INTO public.activity_logs
    (user_id, user_name, user_role, action_type, entity_type, entity_id, cohort_id, description, metadata)
  VALUES
    (p_actor_profile_id, v_actor_name, v_actor_role, 'template_partial_state_changed', 'template_partial', v_partial.id::text, NULL,
     'Changed template partial state',
     jsonb_build_object('from_state', v_partial.state, 'to_state', p_target_state));

  RETURN jsonb_build_object('partial_id', v_partial.id, 'state', p_target_state, 'current_version', v_partial.current_version);
END;
$$;


-- ============================================================
-- 12. EXECUTE HARDENING (service_role only)
-- ============================================================
-- PostgREST exposes public-schema functions to .rpc(); without revocation an
-- authenticated browser client could call lifecycle actions directly, bypassing
-- the endpoint authorization layer. REVOKE ALL from PUBLIC/anon/authenticated;
-- GRANT EXECUTE to service_role only (mirrors the shift-log RPC precedent).

REVOKE ALL ON FUNCTION public.governance_activate_knowledge_entry(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.governance_activate_knowledge_entry(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.governance_activate_knowledge_entry(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.governance_activate_knowledge_entry(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.governance_apply_knowledge_revision(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.governance_apply_knowledge_revision(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.governance_apply_knowledge_revision(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.governance_apply_knowledge_revision(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.governance_restore_knowledge_version(uuid, integer, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.governance_restore_knowledge_version(uuid, integer, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.governance_restore_knowledge_version(uuid, integer, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.governance_restore_knowledge_version(uuid, integer, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.governance_change_knowledge_state(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.governance_change_knowledge_state(uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.governance_change_knowledge_state(uuid, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.governance_change_knowledge_state(uuid, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.governance_activate_template(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.governance_activate_template(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.governance_activate_template(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.governance_activate_template(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.governance_apply_template_revision(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.governance_apply_template_revision(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.governance_apply_template_revision(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.governance_apply_template_revision(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.governance_restore_template_version(uuid, integer, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.governance_restore_template_version(uuid, integer, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.governance_restore_template_version(uuid, integer, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.governance_restore_template_version(uuid, integer, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.governance_change_template_state(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.governance_change_template_state(uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.governance_change_template_state(uuid, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.governance_change_template_state(uuid, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.governance_activate_template_partial(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.governance_activate_template_partial(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.governance_activate_template_partial(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.governance_activate_template_partial(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.governance_restore_template_partial_version(uuid, integer, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.governance_restore_template_partial_version(uuid, integer, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.governance_restore_template_partial_version(uuid, integer, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.governance_restore_template_partial_version(uuid, integer, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.governance_change_template_partial_state(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.governance_change_template_partial_state(uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.governance_change_template_partial_state(uuid, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.governance_change_template_partial_state(uuid, text, uuid) TO service_role;


-- ============================================================
-- 13. RELOAD SCHEMA CACHE
-- ============================================================

NOTIFY pgrst, 'reload schema';
