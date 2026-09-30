-- BUDGET-TRACKER-1 follow-up (Owner, 2026-09-30): Program Budget is now called Budget Tracker, and two
-- Keith skills still say the old name. OWNER-GATED: do not apply from a session.
--
-- An active skill cannot be edited in Settings > Keith > Skills (only a draft can), so this makes the
-- change the way Activate does: each skill whose description or instructions mention the old name gets
-- the new name, a NEW version (version + 1) with a snapshot in keith_skill_versions and a change note,
-- credited to the Owner, and a line in activity_logs. Status, Enabled, roles and everything else stay.
--
-- Skills: read-receipt (Read Receipt) and prepare-concur (Prepare for Concur). A skill that no longer
-- mentions the old name is left alone, so a re-run changes nothing.
-- Check (read-only):
--   SELECT slug, version, status, enabled, position('Program Budget' IN description || instruction_body) AS old_name
--   FROM public.keith_skills WHERE slug IN ('read-receipt', 'prepare-concur');
--   Expect each version one higher than before, status and enabled unchanged, old_name 0.

BEGIN;

DO $rename$
DECLARE
  v_owner uuid := (SELECT id FROM public.user_profiles WHERE is_owner = true ORDER BY created_at LIMIT 1);
  v_skill public.keith_skills%ROWTYPE;
  v_next  integer;
  v_note  text := 'Renamed Program Budget to Budget Tracker (Owner, 2026-09-30).';
BEGIN
  FOR v_skill IN
    SELECT * FROM public.keith_skills
    WHERE slug IN ('read-receipt', 'prepare-concur')
      AND position('Program Budget' IN coalesce(description, '') || coalesce(instruction_body, '')) > 0
    FOR UPDATE
  LOOP
    v_next := coalesce(v_skill.version, 0) + 1;
    UPDATE public.keith_skills
       SET description      = replace(description, 'Program Budget', 'Budget Tracker'),
           instruction_body = replace(instruction_body, 'Program Budget', 'Budget Tracker'),
           version          = v_next,
           updated_by       = v_owner
     WHERE id = v_skill.id
     RETURNING * INTO v_skill;

    INSERT INTO public.keith_skill_versions (
      skill_id, version_number, display_name, description, allowed_roles, required_tools,
      required_data, trigger_phrases, data_classification, model_route, io_contract,
      instruction_body, change_note, editor_id
    ) VALUES (
      v_skill.id, v_next, v_skill.display_name, v_skill.description, v_skill.allowed_roles,
      v_skill.required_tools, v_skill.required_data, v_skill.trigger_phrases,
      v_skill.data_classification, v_skill.model_route, v_skill.io_contract,
      v_skill.instruction_body, v_note, v_owner
    );

    INSERT INTO public.activity_logs (user_id, user_name, user_role, action_type, entity_type, entity_id, description, metadata)
    VALUES (v_owner, NULL, NULL, 'keith_skill_update', 'keith_skill', v_skill.id::text,
            format('Renamed Program Budget to Budget Tracker in Keith skill %s (version %s)', v_skill.slug, v_next),
            jsonb_build_object('slug', v_skill.slug, 'version', v_next));
  END LOOP;
END
$rename$;

COMMIT;

NOTIFY pgrst, 'reload schema';
