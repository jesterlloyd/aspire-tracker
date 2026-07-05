-- ============================================================
-- ASPIRE Intelligence - Phase 2B.1 Disposition Foundation
-- ============================================================
--
-- Creates the database schema for the student disposition workflow.
-- Schema only - no UI changes in this migration.
--
-- SAFETY:
--   Safe to run on production with zero current 'Declined' rows.
--   Does NOT touch any existing table schema, column, or data.
--   Existing StudentSidePanel decline modal flow (decline_reason) is
--   preserved as-is. Phase 2B.2 will deprecate it.
--
-- DEPENDS ON:
--   update_updated_at_column() - installed by migration_concurrency_protections.sql
--   user_profiles table with auth_user_id, role, is_owner columns
--   students, cohorts tables
--
-- HOW TO RUN: Paste into Supabase SQL Editor and execute.
-- Wrapped in BEGIN/COMMIT for atomicity.
--
-- ============================================================

BEGIN;


-- ────────────────────────────────────────────────────────────────────────────
-- PART A: student_dispositions table
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS student_dispositions (
  id                        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id                UUID NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
  cohort_id                 UUID NOT NULL REFERENCES cohorts(id)   ON DELETE CASCADE,

  -- Controlled vocabulary (validated by CHECK constraint)
  disposition_type          TEXT NOT NULL CHECK (disposition_type IN (
    'not_selected',
    'student_declined_offer',
    'application_withdrawn',
    'ineligible',
    'placement_cancelled',
    'student_withdrew_after_placement',
    'rotation_discontinued',
    'removed_from_program'
  )),

  stage_at_disposition      TEXT NOT NULL CHECK (stage_at_disposition IN (
    'pre_interview',
    'post_interview',
    'pre_placement',
    'post_placement',
    'active_rotation'
  )),

  decision_origin           TEXT NOT NULL CHECK (decision_origin IN (
    'interview_review',
    'student_profile',
    'rotation_management',
    'auto_rubric',
    'legacy_migration',
    'system_correction'
  )),

  -- reason_category validated by trigger (allowed values depend on disposition_type)
  reason_category           TEXT NOT NULL DEFAULT 'other',

  -- Audit and identity
  effective_date            DATE         DEFAULT CURRENT_DATE,
  decided_by_name           TEXT         DEFAULT '',
  recorded_by_user_id       UUID         DEFAULT NULL,
  recorded_by_name          TEXT         DEFAULT '',

  -- Active vs superseded (only one is_active=TRUE per student/cohort enforced by partial unique)
  is_active                 BOOLEAN      NOT NULL DEFAULT TRUE,
  supersedes_id             UUID         DEFAULT NULL REFERENCES student_dispositions(id) ON DELETE SET NULL,
  superseded_by_id          UUID         DEFAULT NULL REFERENCES student_dispositions(id) ON DELETE SET NULL,

  -- Legacy migration provenance (NULL for all new records created via record_student_disposition)
  legacy_status             TEXT         DEFAULT NULL,
  legacy_decline_reason     TEXT         DEFAULT NULL,
  migration_source          TEXT         DEFAULT NULL,
  migrated_at               TIMESTAMPTZ  DEFAULT NULL,
  manual_review_required    BOOLEAN      NOT NULL DEFAULT FALSE,

  created_at                TIMESTAMPTZ  DEFAULT NOW(),
  updated_at                TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispositions_student
  ON student_dispositions(student_id);
CREATE INDEX IF NOT EXISTS idx_dispositions_cohort
  ON student_dispositions(cohort_id);
CREATE INDEX IF NOT EXISTS idx_dispositions_type
  ON student_dispositions(disposition_type);
CREATE INDEX IF NOT EXISTS idx_dispositions_created
  ON student_dispositions(created_at);
CREATE INDEX IF NOT EXISTS idx_dispositions_review
  ON student_dispositions(cohort_id)
  WHERE manual_review_required = TRUE;

-- Partial UNIQUE: only one active disposition per student per cohort at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_active_disposition
  ON student_dispositions(student_id, cohort_id)
  WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS set_updated_at_student_dispositions ON student_dispositions;
CREATE TRIGGER set_updated_at_student_dispositions
  BEFORE UPDATE ON student_dispositions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ────────────────────────────────────────────────────────────────────────────
-- PART B: reason_category validation trigger
-- ────────────────────────────────────────────────────────────────────────────
-- Enforces that reason_category is valid for the given disposition_type.
-- This logic cannot be expressed as a simple CHECK constraint because the
-- allowed values depend on another column.

CREATE OR REPLACE FUNCTION validate_disposition_reason_category()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT (
    (NEW.disposition_type = 'not_selected' AND NEW.reason_category IN (
      'program_pathway_alignment',
      'interview_review_decision',
      'placement_capacity_limitation',
      'eligibility_requirement_not_met',
      'unable_to_accommodate_requested_placement',
      'other'
    ))
    OR (NEW.disposition_type = 'student_declined_offer' AND NEW.reason_category IN (
      'accepted_other_offer',
      'personal_circumstances',
      'declined_specific_placement',
      'no_reason_provided',
      'other'
    ))
    OR (NEW.disposition_type = 'application_withdrawn' AND NEW.reason_category IN (
      'student_initiated_withdrawal',
      'non_responsive',
      'documentation_incomplete',
      'other'
    ))
    OR (NEW.disposition_type = 'ineligible' AND NEW.reason_category IN (
      'gpa_below_threshold',
      'documentation_not_met',
      'school_affiliation_issue',
      'timing_or_scheduling_conflict',
      'other'
    ))
    OR (NEW.disposition_type = 'placement_cancelled' AND NEW.reason_category IN (
      'unit_capacity_change',
      'unit_operational_issue',
      'preceptor_unavailable',
      'administrative_decision',
      'other'
    ))
    OR (NEW.disposition_type = 'student_withdrew_after_placement' AND NEW.reason_category IN (
      'personal_circumstances',
      'placement_concerns',
      'health_or_family',
      'other'
    ))
    OR (NEW.disposition_type = 'rotation_discontinued' AND NEW.reason_category IN (
      'performance_concerns',
      'student_initiated',
      'unit_initiated',
      'health_or_family',
      'other'
    ))
    OR (NEW.disposition_type = 'removed_from_program' AND NEW.reason_category IN (
      'safety_concern',
      'professional_conduct',
      'documentation_or_compliance',
      'leadership_decision',
      'other'
    ))
  ) THEN
    RAISE EXCEPTION 'Invalid reason_category "%" for disposition_type "%"',
      NEW.reason_category, NEW.disposition_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_disposition_reason ON student_dispositions;
CREATE TRIGGER trg_validate_disposition_reason
  BEFORE INSERT OR UPDATE ON student_dispositions
  FOR EACH ROW EXECUTE FUNCTION validate_disposition_reason_category();


-- ────────────────────────────────────────────────────────────────────────────
-- PART C: student_disposition_private_notes table
-- ────────────────────────────────────────────────────────────────────────────
-- Sensitive internal notes stored separately from the main disposition row
-- so they can have more restrictive RLS without exposing them via the view.

CREATE TABLE IF NOT EXISTS student_disposition_private_notes (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  disposition_id        UUID NOT NULL REFERENCES student_dispositions(id) ON DELETE CASCADE,
  internal_note         TEXT NOT NULL DEFAULT '',
  created_by_user_id    UUID DEFAULT NULL,
  created_by_name       TEXT DEFAULT '',
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disposition_notes_disposition
  ON student_disposition_private_notes(disposition_id);

DROP TRIGGER IF EXISTS set_updated_at_disposition_notes ON student_disposition_private_notes;
CREATE TRIGGER set_updated_at_disposition_notes
  BEFORE UPDATE ON student_disposition_private_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ────────────────────────────────────────────────────────────────────────────
-- PART D: student_disposition_followups table
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS student_disposition_followups (
  id                        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  disposition_id            UUID NOT NULL REFERENCES student_dispositions(id) ON DELETE CASCADE,
  student_id                UUID NOT NULL REFERENCES students(id)             ON DELETE CASCADE,
  cohort_id                 UUID NOT NULL REFERENCES cohorts(id)              ON DELETE CASCADE,

  followup_type             TEXT NOT NULL CHECK (followup_type IN (
    'notify_student',
    'notify_school_coordinator',
    'notify_unit_leader',
    'reopen_placement_slot',
    'leadership_review',
    'documentation_review'
  )),

  status                    TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'completed',
    'waived',
    'not_applicable',
    'cancelled'
  )),

  assigned_to               TEXT         DEFAULT '',
  due_at                    TIMESTAMPTZ  DEFAULT NULL,
  completed_at              TIMESTAMPTZ  DEFAULT NULL,
  completed_by_user_id      UUID         DEFAULT NULL,
  completed_by_name         TEXT         DEFAULT '',
  note                      TEXT         DEFAULT '',

  -- Future ASPIRE Connect linkage (nullable)
  related_communication_id  UUID         DEFAULT NULL,

  created_at                TIMESTAMPTZ  DEFAULT NOW(),
  updated_at                TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_followups_disposition
  ON student_disposition_followups(disposition_id);
CREATE INDEX IF NOT EXISTS idx_followups_student
  ON student_disposition_followups(student_id);
CREATE INDEX IF NOT EXISTS idx_followups_cohort
  ON student_disposition_followups(cohort_id);
CREATE INDEX IF NOT EXISTS idx_followups_pending
  ON student_disposition_followups(cohort_id, status)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS set_updated_at_followups ON student_disposition_followups;
CREATE TRIGGER set_updated_at_followups
  BEFORE UPDATE ON student_disposition_followups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ────────────────────────────────────────────────────────────────────────────
-- PART E: RLS policies
-- ────────────────────────────────────────────────────────────────────────────

-- student_dispositions - Pattern A (broad authenticated access, matches app convention)
ALTER TABLE student_dispositions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_student_dispositions" ON student_dispositions;
CREATE POLICY "authenticated_all_student_dispositions" ON student_dispositions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- student_disposition_followups - Pattern A (broad authenticated access)
ALTER TABLE student_disposition_followups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all_disposition_followups" ON student_disposition_followups;
CREATE POLICY "authenticated_all_disposition_followups" ON student_disposition_followups
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- student_disposition_private_notes - Pattern B (owner/admin only, mirrors preceptor_cohort_participation)
ALTER TABLE student_disposition_private_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owners_read_disposition_notes" ON student_disposition_private_notes;
CREATE POLICY "owners_read_disposition_notes" ON student_disposition_private_notes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid()
        AND (is_owner = true OR role = 'admin')
    )
  );

DROP POLICY IF EXISTS "owners_write_disposition_notes" ON student_disposition_private_notes;
CREATE POLICY "owners_write_disposition_notes" ON student_disposition_private_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid()
        AND (is_owner = true OR role = 'admin')
    )
  );

DROP POLICY IF EXISTS "owners_update_disposition_notes" ON student_disposition_private_notes;
CREATE POLICY "owners_update_disposition_notes" ON student_disposition_private_notes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid()
        AND (is_owner = true OR role = 'admin')
    )
  );

DROP POLICY IF EXISTS "owners_delete_disposition_notes" ON student_disposition_private_notes;
CREATE POLICY "owners_delete_disposition_notes" ON student_disposition_private_notes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE auth_user_id = auth.uid()
        AND (is_owner = true OR role = 'admin')
    )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- PART F: student_active_disposition view
-- ────────────────────────────────────────────────────────────────────────────
-- Safe read view: returns one active disposition per student/cohort.
-- Excludes private notes entirely (they live in a separate table with
-- restrictive RLS). Inherits Pattern A RLS from the underlying table.

CREATE OR REPLACE VIEW student_active_disposition AS
SELECT
  id,
  student_id,
  cohort_id,
  disposition_type,
  stage_at_disposition,
  decision_origin,
  reason_category,
  effective_date,
  decided_by_name,
  recorded_by_user_id,
  recorded_by_name,
  created_at,
  updated_at
FROM student_dispositions
WHERE is_active = TRUE;


-- ────────────────────────────────────────────────────────────────────────────
-- PART G: record_student_disposition() - atomic SECURITY DEFINER function
-- ────────────────────────────────────────────────────────────────────────────
-- Atomically records a disposition, supersedes any existing active disposition,
-- updates students.status to 'Not Proceeding', creates requested follow-ups,
-- optionally stores a private note, and logs a program_events entry.
--
-- Caller must have role = 'owner' or 'admin' in user_profiles;
-- the function enforces this before writing anything.
-- auth.uid() is available inside SECURITY DEFINER functions in Supabase.

CREATE OR REPLACE FUNCTION record_student_disposition(
  p_student_id           UUID,
  p_cohort_id            UUID,
  p_disposition_type     TEXT,
  p_stage_at_disposition TEXT,
  p_decision_origin      TEXT,
  p_reason_category      TEXT,
  p_decided_by_name      TEXT     DEFAULT '',
  p_effective_date       DATE     DEFAULT NULL,
  p_followup_types       TEXT[]   DEFAULT ARRAY[]::TEXT[],
  p_private_note         TEXT     DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor_id      UUID := auth.uid();
  v_actor_name    TEXT := '';
  v_actor_role    TEXT := '';
  v_existing_id   UUID;
  v_new_id        UUID;
  v_followup_type TEXT;
  v_event_type    TEXT;
BEGIN
  -- Authorization: caller must be owner or admin
  SELECT up.full_name, up.role
    INTO v_actor_name, v_actor_role
  FROM user_profiles up
  WHERE up.auth_user_id = v_actor_id;

  IF v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Insufficient permissions: only Owner or Admin may record dispositions';
  END IF;

  -- Find existing active disposition for this student/cohort (if any)
  SELECT id INTO v_existing_id
  FROM student_dispositions
  WHERE student_id = p_student_id
    AND cohort_id  = p_cohort_id
    AND is_active  = TRUE;

  -- Insert the new active disposition
  INSERT INTO student_dispositions (
    student_id,            cohort_id,
    disposition_type,      stage_at_disposition,   decision_origin,
    reason_category,       decided_by_name,        effective_date,
    recorded_by_user_id,   recorded_by_name,
    is_active,             supersedes_id
  ) VALUES (
    p_student_id,          p_cohort_id,
    p_disposition_type,    p_stage_at_disposition, p_decision_origin,
    p_reason_category,     p_decided_by_name,      COALESCE(p_effective_date, CURRENT_DATE),
    v_actor_id,            v_actor_name,
    TRUE,                  v_existing_id
  )
  RETURNING id INTO v_new_id;

  -- Supersede the previous active disposition (if one existed)
  IF v_existing_id IS NOT NULL THEN
    UPDATE student_dispositions
       SET is_active        = FALSE,
           superseded_by_id = v_new_id,
           updated_at       = NOW()
     WHERE id = v_existing_id;
  END IF;

  -- Update the student's ASPIRE status
  UPDATE students
     SET status     = 'Not Proceeding',
         updated_at = NOW()
   WHERE id = p_student_id;

  -- Insert requested follow-up tasks
  IF array_length(p_followup_types, 1) > 0 THEN
    FOREACH v_followup_type IN ARRAY p_followup_types LOOP
      INSERT INTO student_disposition_followups (
        disposition_id, student_id, cohort_id, followup_type, status
      ) VALUES (
        v_new_id, p_student_id, p_cohort_id, v_followup_type, 'pending'
      );
    END LOOP;
  END IF;

  -- Store private note (if provided)
  IF p_private_note IS NOT NULL AND length(trim(p_private_note)) > 0 THEN
    INSERT INTO student_disposition_private_notes (
      disposition_id, internal_note, created_by_user_id, created_by_name
    ) VALUES (
      v_new_id, p_private_note, v_actor_id, v_actor_name
    );
  END IF;

  -- Log program event (event_type is free-form TEXT per existing app convention)
  v_event_type := 'disposition_' || p_disposition_type;
  INSERT INTO program_events (
    student_id, cohort_id, event_type, event_date, notes, created_by
  ) VALUES (
    p_student_id, p_cohort_id, v_event_type, CURRENT_DATE,
    'Disposition recorded: ' || p_disposition_type || ' (' || p_reason_category || ')',
    v_actor_name
  );

  RETURN v_new_id;
END;
$$;

-- Grant execute to authenticated role (authorization enforced inside the function body)
GRANT EXECUTE ON FUNCTION record_student_disposition TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- Reload PostgREST schema cache
-- ────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


COMMIT;
