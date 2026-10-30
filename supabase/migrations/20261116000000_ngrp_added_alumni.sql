-- 20261116000000_ngrp_added_alumni.sql
-- ADD-ALUMNUS-1 (Owner, 2026-10-29): Residency > Profiles & Interest > Add alumnus. A residency
-- cohort's roster has been "every Completed student in its participating ASPIRE cohorts". The
-- Owner also needs alumni from cohorts that are not participating, including alumni from before
-- the app existed who reapply, added one by one. Owner and Admin only.
--
-- 1. public.ngrp_cycle_added_alumni: one row per alumnus added to one residency cohort, with
--    who added them and when. Removing someone sets removed_at; the row is never deleted, so
--    the roster can say who was added, by whom, and who took them off again. At most one live
--    row per cohort and student. Server-only, like every other ngrp_* table.
-- 2. ngrp_audit_events accepts three new types for Settings > Residency Activity:
--    alumnus_added, alumnus_removed, alumnus_invited. The CHECK is rebuilt with every type the
--    live constraint holds (the list 20261111000000 left) plus these three.
--    lib/server/ngrpAudit.js lists the same set; an event has to pass both.
--
-- NOT CHANGED. No existing table, column, policy or grant. New alumni records use the existing
-- students and cohorts tables; portal invitations use the existing portal access system.
-- EITHER DEPLOY ORDER. Before this runs, Add alumnus says it is not switched on yet and the
-- roster reads exactly as it does today.
-- CHECKS: db/audit/ngrp_added_alumni_checks.sql (PRE 1-2, POST 1-4).

BEGIN;

CREATE TABLE IF NOT EXISTS public.ngrp_cycle_added_alumni (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id               uuid        NOT NULL REFERENCES public.ngrp_cycles(id) ON DELETE RESTRICT,
  student_id             uuid        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  added_by_profile_id    uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  added_at               timestamptz NOT NULL DEFAULT now(),
  removed_by_profile_id  uuid        REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  removed_at             timestamptz,
  CONSTRAINT chk_ngrp_added_alumni_removal
    CHECK ((removed_at IS NULL) = (removed_by_profile_id IS NULL))
);

COMMENT ON TABLE public.ngrp_cycle_added_alumni IS
  'ADD-ALUMNUS-1: alumni added to a residency cohort''s roster outside its participating ASPIRE cohorts. removed_at hides a row; rows are never deleted. Server-only.';

-- One live membership per residency cohort and student; a removed row can be followed by a new one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ngrp_added_alumni_live
  ON public.ngrp_cycle_added_alumni (cycle_id, student_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ngrp_added_alumni_student
  ON public.ngrp_cycle_added_alumni (student_id);

ALTER TABLE public.ngrp_cycle_added_alumni ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.ngrp_cycle_added_alumni FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ngrp_cycle_added_alumni TO service_role;

ALTER TABLE public.ngrp_audit_events
  DROP CONSTRAINT IF EXISTS ngrp_audit_events_event_type_check;
ALTER TABLE public.ngrp_audit_events
  ADD CONSTRAINT ngrp_audit_events_event_type_check
    CHECK (event_type IN (
      'cycle_created','cycle_updated','cycle_activated',
      'source_cohorts_changed','units_changed',
      'form_sent','form_opened','form_submitted','form_revised',
      'token_revoked','token_resent',
      'eligibility_calculated','eligibility_overridden',
      'application_confirmed','application_withdrawn',
      'unit_assigned','unit_assignment_cleared',
      'interview_recorded','offer_extended','offer_accepted','hire_recorded',
      'not_proceeding_recorded','application_reinstated',
      'unit_preferences_set','offer_declined','not_selected',
      'reflection_started','reflection_sent','reflection_opened',
      'reflection_submitted','reflection_stopped',
      'support_logged','support_voided','followup_flagged','followup_unflagged',
      'document_uploaded','resume_scored',
      'packet_downloaded',
      'interview_rubric_completed','interview_rubric_reopened',
      'interview_times_opened','interview_times_removed',
      'interview_slot_blocked','interview_slot_unblocked',
      'interview_booked','interview_booking_cancelled',
      -- ADD-ALUMNUS-1
      'alumnus_added','alumnus_removed','alumnus_invited'));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK:
--   DELETE FROM public.ngrp_audit_events WHERE event_type IN ('alumnus_added','alumnus_removed','alumnus_invited');
--   then restore the CHECK from 20261111000000, and
--   DROP TABLE public.ngrp_cycle_added_alumni;  (only if no alumnus has been added)
