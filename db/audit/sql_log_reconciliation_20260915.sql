-- SQL-LOG-RECONCILE-1 (2026-09-15): confirm the applied state of the 23 migrations that
-- docs/security/OWNER_SQL_GATE.md still lists as "UNKNOWN pending confirmation"
-- (section "Migrations added since 2026-08-02").
--
-- READ-ONLY. One query, one row per migration. Run it once in the Supabase SQL editor.
--
--   applied  = true only when EVERY piece of evidence for that migration is true
--   evidence = each check by name, so a partly applied migration shows what is missing
--
-- Schema migrations are checked by the objects they create (tables, columns, functions,
-- triggers, constraints, policies, views). The three data-only migrations are checked by
-- the rows they wrote:
--   20260830 -> a Winter 2027 rotation row for West Coast University North Hollywood
--   20260831 -> WCU Anaheim's rotation row is in Winter 2027 and no longer in Fall 2026
--   20260901 -> Winter 2027 has units, and Juliana Pilla has a Winter 2027 student row
--               (matched by the school email on her Fall 2026 row)
-- 20260814 widened a CHECK that started with exactly one kind (manual_direct_email), so it
-- is applied when the live definition lists more than one kind.

WITH checks(migration, evidence) AS (
  SELECT '20260803000000_phase2d_clear_primary_preceptor', jsonb_build_object(
    'function clear_primary_preceptor', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'clear_primary_preceptor'))
  UNION ALL
  SELECT '20260804000000_portal_invitation_events', jsonb_build_object(
    'table portal_invitation_events', to_regclass('public.portal_invitation_events') IS NOT NULL,
    'policy portal_invitation_events_owner_admin_read', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'portal_invitation_events' AND policyname = 'portal_invitation_events_owner_admin_read'))
  UNION ALL
  SELECT '20260805000001_keith_p0_foundations_and_skills', jsonb_build_object(
    'table keith_requests', to_regclass('public.keith_requests') IS NOT NULL,
    'table keith_skills', to_regclass('public.keith_skills') IS NOT NULL,
    'table keith_skill_invocations', to_regclass('public.keith_skill_invocations') IS NOT NULL,
    'function keith_activate_skill', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'keith_activate_skill'),
    'trigger trg_keith_skills_updated_at', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_keith_skills_updated_at' AND NOT tgisinternal))
  UNION ALL
  SELECT '20260805000002_program_events_rls_lockdown', jsonb_build_object(
    'table program_events_rls_lockdown_runs', to_regclass('public.program_events_rls_lockdown_runs') IS NOT NULL,
    'function is_staff_event_writer', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_staff_event_writer'),
    'policy staff_select_program_events', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'program_events' AND policyname = 'staff_select_program_events'))
  UNION ALL
  SELECT '20260807000001_knowledge_vault_markdown', jsonb_build_object(
    'column knowledge_entries.body_format', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'knowledge_entries' AND column_name = 'body_format'),
    'column knowledge_entries.superseded_by', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'knowledge_entries' AND column_name = 'superseded_by'),
    'table knowledge_links', to_regclass('public.knowledge_links') IS NOT NULL,
    'function governance_restore_knowledge_version', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'governance_restore_knowledge_version'))
  UNION ALL
  SELECT '20260811000000_preceptor_certificate_foundation', jsonb_build_object(
    'table preceptor_certificates', to_regclass('public.preceptor_certificates') IS NOT NULL,
    'table preceptor_certificate_sequences', to_regclass('public.preceptor_certificate_sequences') IS NOT NULL,
    'function issue_preceptor_certificate', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'issue_preceptor_certificate'))
  UNION ALL
  SELECT '20260814000000_message_archive_content_kinds', jsonb_build_object(
    'check chk_message_archive_content_kind lists more than one kind', EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'chk_message_archive_content_kind'
         AND (length(pg_get_constraintdef(oid)) - length(replace(pg_get_constraintdef(oid), '::text', ''))) / length('::text') > 1))
  UNION ALL
  SELECT '20260815000000_evaluation_reminder_deliveries', jsonb_build_object(
    'table evaluation_reminder_deliveries', to_regclass('public.evaluation_reminder_deliveries') IS NOT NULL,
    'function claim_evaluation_reminders', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'claim_evaluation_reminders'))
  UNION ALL
  SELECT '20260816000000_student_unit_assignments', jsonb_build_object(
    'table student_unit_assignments', to_regclass('public.student_unit_assignments') IS NOT NULL,
    'trigger trg_sua_enforce_unit_identity', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sua_enforce_unit_identity' AND NOT tgisinternal),
    'policy student_unit_assignments_owner_admin_read', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_unit_assignments' AND policyname = 'student_unit_assignments_owner_admin_read'))
  UNION ALL
  SELECT '20260817000000_student_unit_assignment_sync', jsonb_build_object(
    'function set_primary_unit_assignment', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'set_primary_unit_assignment'),
    'function sua_sync_ready', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'sua_sync_ready'),
    'trigger trg_sync_assignments_from_matched_unit', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_assignments_from_matched_unit' AND NOT tgisinternal),
    'trigger trg_sync_matched_unit_from_assignments', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_matched_unit_from_assignments' AND NOT tgisinternal))
  UNION ALL
  SELECT '20260818000000_shift_log_review', jsonb_build_object(
    'table shift_log_reviews', to_regclass('public.shift_log_reviews') IS NOT NULL,
    'function review_shift_log', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'review_shift_log'),
    'function submit_past_shift_log', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'submit_past_shift_log'),
    'policy staff_select_students', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'students' AND policyname = 'staff_select_students'))
  UNION ALL
  SELECT '20260819000000_student_shift_log_self_service', jsonb_build_object(
    'table student_shift_log_edits', to_regclass('public.student_shift_log_edits') IS NOT NULL,
    'function student_edit_shift_log', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'student_edit_shift_log'),
    'function student_void_shift_log', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'student_void_shift_log'),
    'view portal_my_shift_logs', to_regclass('public.portal_my_shift_logs') IS NOT NULL,
    'check chk_ssl_lifecycle_state', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ssl_lifecycle_state'))
  UNION ALL
  SELECT '20260820000000_preceptor_shift_projection', jsonb_build_object(
    'function preceptor_projected_shift', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'preceptor_projected_shift'),
    'table preceptor_projection_backfill_audit', to_regclass('public.preceptor_projection_backfill_audit') IS NOT NULL,
    'trigger trg_sync_students_from_preceptor_record', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_students_from_preceptor_record' AND NOT tgisinternal))
  UNION ALL
  SELECT '20260821130000_automatic_student_completion', jsonb_build_object(
    'function reconcile_student_completions', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'reconcile_student_completions'),
    'trigger reconcile_students_after_cohort_completion', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'reconcile_students_after_cohort_completion' AND NOT tgisinternal),
    'trigger reconcile_student_after_completion_input', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'reconcile_student_after_completion_input' AND NOT tgisinternal),
    'trigger reconcile_students_after_rotation_date', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'reconcile_students_after_rotation_date' AND NOT tgisinternal))
  UNION ALL
  SELECT '20260822000000_student_activity_completions', jsonb_build_object(
    'table student_activity_completions', to_regclass('public.student_activity_completions') IS NOT NULL,
    'policy sac_owner_admin_read', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_activity_completions' AND policyname = 'sac_owner_admin_read'))
  UNION ALL
  SELECT '20260824000000_nursing_academics_portal_foundation', jsonb_build_object(
    'role check allows nursing_academic', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_role_grants_role_check' AND pg_get_constraintdef(oid) LIKE '%nursing_academic%'),
    'table community_benefit_rates', to_regclass('public.community_benefit_rates') IS NOT NULL,
    'table community_benefit_capstone_hours', to_regclass('public.community_benefit_capstone_hours') IS NOT NULL,
    'function set_community_benefit_rate', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'set_community_benefit_rate'),
    'column students.course_type', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'course_type'))
  UNION ALL
  SELECT '20260825000000_nursing_academic_contacts_editor', jsonb_build_object(
    'column user_role_grants.contacts_access', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_role_grants' AND column_name = 'contacts_access'),
    'check user_role_grants_contacts_access_check', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_role_grants_contacts_access_check'))
  UNION ALL
  SELECT '20260826000000_contacts_canonicalization', jsonb_build_object(
    'check chk_contacts_category', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_contacts_category'),
    'column contacts.services', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'services'),
    'column contacts.preferred_contact_method dropped', NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'preferred_contact_method'))
  UNION ALL
  SELECT '20260827000000_cohort_completed_at', jsonb_build_object(
    'column cohorts.completed_at', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cohorts' AND column_name = 'completed_at'),
    'function stamp_cohort_completed_at', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'stamp_cohort_completed_at'),
    'trigger stamp_cohort_completed_at', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'stamp_cohort_completed_at' AND NOT tgisinternal))
  UNION ALL
  SELECT '20260828000000_enable_nursing_academic_portal_utilities', jsonb_build_object(
    'function na_portal_utilities_capability', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'na_portal_utilities_capability'),
    'function messages_start_general_team_conversation_na', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'messages_start_general_team_conversation_na'),
    'function submit_portal_feedback_report', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'submit_portal_feedback_report'),
    'check chk_portal_feedback_role allows nursing_academic', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_portal_feedback_role' AND pg_get_constraintdef(oid) LIKE '%nursing_academic%'))
  UNION ALL
  SELECT '20260830000000_wcu_noho_fall2_split_repair', jsonb_build_object(
    'Winter 2027 rotation row for WCU North Hollywood', EXISTS (
      SELECT 1 FROM public.cohort_school_rotations r JOIN public.cohorts c ON c.id = r.cohort_id
       WHERE c.name = 'Winter 2027' AND r.school_name = 'West Coast University North Hollywood'))
  UNION ALL
  SELECT '20260831000000_wcu_anaheim_move_to_winter_2027', jsonb_build_object(
    'WCU Anaheim rotation row in Winter 2027', EXISTS (
      SELECT 1 FROM public.cohort_school_rotations r JOIN public.cohorts c ON c.id = r.cohort_id
       WHERE c.name = 'Winter 2027' AND r.school_name = 'West Coast University Anaheim'),
    'no WCU Anaheim rotation row left in Fall 2026', NOT EXISTS (
      SELECT 1 FROM public.cohort_school_rotations r JOIN public.cohorts c ON c.id = r.cohort_id
       WHERE c.name = 'Fall 2026' AND r.school_name = 'West Coast University Anaheim'))
  UNION ALL
  SELECT '20260901000000_winter_2027_unit_carryover_and_juliana', jsonb_build_object(
    'Winter 2027 has units', EXISTS (
      SELECT 1 FROM public.units u JOIN public.cohorts c ON c.id = u.cohort_id WHERE c.name = 'Winter 2027'),
    'Juliana Pilla has a Winter 2027 student row', EXISTS (
      SELECT 1 FROM public.students w
        JOIN public.students f ON lower(btrim(w.school_email)) = lower(btrim(f.school_email))
        JOIN public.cohorts c ON c.id = w.cohort_id
       WHERE f.id = 'd6ff6ac4-94c0-4818-935a-e5bde2c07c00' AND c.name = 'Winter 2027'))
)
SELECT migration,
       NOT EXISTS (SELECT 1 FROM jsonb_each(evidence) e WHERE e.value <> 'true'::jsonb) AS applied,
       evidence
  FROM checks
 ORDER BY migration;
