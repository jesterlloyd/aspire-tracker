-- Track B v1a: Secure completion RPC for disposition follow-ups.
-- Apply this file FIRST, before deploying the frontend that calls complete_disposition_followup().
-- Do NOT combine with v1b (the RLS restriction). Apply and verify each file separately.
--
-- Contains:
--   PART A: is_owner_or_admin()              — reusable SECURITY DEFINER helper for RLS policies
--   PART B: complete_disposition_followup()  — Owner/Admin-only atomic completion RPC
--
-- Deployment sequence:
--   1. Apply this file (v1a) in Supabase SQL editor.
--   2. Deploy the frontend build that replaces the direct .update() with supabase.rpc().
--   3. Verify completion works end-to-end for an Owner/Admin user.
--   4. Then apply migration_track_b_v1b_restrict_followup_rls.sql.

-- ── PART A: is_owner_or_admin() ────────────────────────────────────────────────
-- Returns TRUE when the calling authenticated user has role 'owner' or 'admin'.
-- Role check mirrors record_student_disposition() (role NOT IN ('owner','admin'))
-- and matches frontend canEdit (['owner','admin'].includes(role)).
-- auth.uid() is available inside SECURITY DEFINER functions in Supabase because
-- it reads the JWT session context, not the DB role.

CREATE OR REPLACE FUNCTION public.is_owner_or_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE auth_user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION public.is_owner_or_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_owner_or_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_owner_or_admin() TO authenticated;

-- ── PART B: complete_disposition_followup() ────────────────────────────────────
-- Marks a pending disposition follow-up as completed.
-- Owner/Admin only — enforced inside the function (authorization is not deferred to RLS).
--
-- Identity model: resolves auth.uid() → user_profiles.id and writes that UUID into
-- completed_by_user_id. This matches the existing frontend convention where
-- userProfile.id = user_profiles.id (NOT auth.users.id / auth_user_id).
-- Confirmed by P0.4: matches_user_profiles_id = true for all existing completed rows.
--
-- Returns json with non-private completion fields only:
--   id, followup_type, status, completion_method, completed_at, completed_by_name, note
--
-- Type rules:
--   notify_student, notify_school_coordinator, notify_unit_leader:
--     p_completion_method required (email | phone | in_person | other)
--     p_note required (non-empty)
--   leadership_review, documentation_review:
--     p_completion_method must be NULL
--     p_note required (non-empty)
--   reopen_placement_slot:
--     always raises exception — must be handled manually through the Units page

-- DROP before CREATE OR REPLACE so a return-type change (void → json) applies cleanly
-- if v1a was ever partially applied with the prior signature.
DROP FUNCTION IF EXISTS public.complete_disposition_followup(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.complete_disposition_followup(
  p_followup_id       UUID,
  p_completion_method TEXT DEFAULT NULL,
  p_note              TEXT DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor_uid        UUID;
  v_actor_profile_id UUID;
  v_actor_name       TEXT;
  v_followup_type    TEXT;
  v_status           TEXT;
  v_result           json;
BEGIN
  -- Resolve caller identity
  v_actor_uid := auth.uid();
  IF v_actor_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, full_name
  INTO v_actor_profile_id, v_actor_name
  FROM public.user_profiles
  WHERE auth_user_id = v_actor_uid;

  IF v_actor_profile_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  -- Authorization: Owner or Admin only (identical to is_owner_or_admin() and frontend canEdit)
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE auth_user_id = v_actor_uid
      AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Permission denied: Owner or Admin role required';
  END IF;

  -- Load target row
  SELECT followup_type, status
  INTO v_followup_type, v_status
  FROM public.student_disposition_followups
  WHERE id = p_followup_id;

  IF v_followup_type IS NULL THEN
    RAISE EXCEPTION 'Follow-up not found: %', p_followup_id;
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'Follow-up is not pending (current status: %)', v_status;
  END IF;

  -- Type-specific validation
  IF v_followup_type IN ('notify_student', 'notify_school_coordinator', 'notify_unit_leader') THEN
    IF p_completion_method IS NULL OR p_completion_method NOT IN ('email', 'phone', 'in_person', 'other') THEN
      RAISE EXCEPTION 'completion_method required for notification follow-ups (email, phone, in_person, or other)';
    END IF;
    IF p_note IS NULL OR trim(p_note) = '' THEN
      RAISE EXCEPTION 'note required for notification follow-ups';
    END IF;

  ELSIF v_followup_type IN ('leadership_review', 'documentation_review') THEN
    IF p_completion_method IS NOT NULL THEN
      RAISE EXCEPTION 'completion_method must be NULL for review follow-ups';
    END IF;
    IF p_note IS NULL OR trim(p_note) = '' THEN
      RAISE EXCEPTION 'note required for review follow-ups';
    END IF;

  ELSIF v_followup_type = 'reopen_placement_slot' THEN
    RAISE EXCEPTION 'reopen_placement_slot must be handled manually through the Units page';

  ELSE
    RAISE EXCEPTION 'Unsupported follow-up type: %', v_followup_type;
  END IF;

  -- Apply completion
  UPDATE public.student_disposition_followups
  SET
    status               = 'completed',
    completed_at         = now(),
    completed_by_user_id = v_actor_profile_id,
    completed_by_name    = v_actor_name,
    completion_method    = p_completion_method,
    note                 = CASE WHEN p_note IS NOT NULL THEN trim(p_note) ELSE NULL END
  WHERE id = p_followup_id;

  -- Return non-private completion fields only (no student_id, disposition_id, or private notes)
  SELECT json_build_object(
    'id',                id,
    'followup_type',     followup_type,
    'status',            status,
    'completion_method', completion_method,
    'completed_at',      completed_at,
    'completed_by_name', completed_by_name,
    'note',              note
  )
  INTO v_result
  FROM public.student_disposition_followups
  WHERE id = p_followup_id;

  RETURN v_result;

END;
$$;

REVOKE ALL ON FUNCTION public.complete_disposition_followup(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_disposition_followup(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_disposition_followup(UUID, TEXT, TEXT) TO authenticated;
