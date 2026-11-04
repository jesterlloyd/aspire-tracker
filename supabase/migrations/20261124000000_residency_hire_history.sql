-- 20261124000000_residency_hire_history.sql
-- HIRE-HISTORY-1 (Owner, 2026-11-04): what a hire record says about the person, beyond the date
-- and the unit. The Owner asked to see, per alumnus, what they were hired as (Clinical Nurse I or
-- Graduate Nurse Tech), whether they applied before passing the NCLEX, when they passed, what
-- their title is now and what it was, and whether they are still at Cedars-Sinai; and, per school
-- and per ASPIRE cohort, how many interns became residents and how many stayed.
--
-- 1. ngrp_residency_outcomes gains six nullable columns:
--      hired_as                 'Clinical Nurse I' | 'Graduate Nurse Tech' | 'Other'
--      hired_as_other           the title when hired_as is Other
--      licensed_at_application  true when they held a California RN license when they applied
--                               (filled from the Transition Form's licensure answer; editable)
--      nclex_passed_on          the day they passed, if staff know it
--      license_issued_on        the day the license was issued
--      backfilled               true when the hire was recorded after the fact, from the team's
--                               spreadsheet, for a residency cohort that ran before the app held
--                               it (Record past hires). Such a hire has no offer dates of its own:
--                               both offer timestamps are set to the hire date to satisfy the
--                               existing CHECKs, and this flag says so.
--    position_title stays the CURRENT title, as RESIDENTS-1 defined it.
-- 2. public.ngrp_resident_titles: the title history. One row per change, append-only (no UPDATE or
--    DELETE grant, as the audit log), with the day it took effect. The current title is the
--    latest row, and position_title mirrors it so every reader of the outcome row keeps working.
-- 3. ngrp_audit_events accepts hire_backfilled and title_changed. The CHECK is rebuilt with every
--    type the live constraint holds (the list 20261120000000 left) plus these two.
--    lib/server/ngrpAudit.js lists the same set; an event has to pass both.
--
-- NOT CHANGED. No existing column, policy or grant. The retention rule (hired minus separated) is
-- unchanged. EITHER DEPLOY ORDER: before this runs, the Hiring sheet saves what it always did and
-- says the new fields are not switched on; Record past hires is refused with that reason.
-- CHECKS: db/audit/residency_hire_history_checks.sql (PRE 1-2, POST 1-3).

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.ngrp_residency_outcomes') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: ngrp_residency_outcomes is missing';
  END IF;
  IF to_regclass('public.ngrp_candidates') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK FAILED: ngrp_candidates is missing';
  END IF;
END
$pre$;

ALTER TABLE public.ngrp_residency_outcomes
  ADD COLUMN IF NOT EXISTS hired_as text
    CHECK (hired_as IS NULL OR hired_as IN ('Clinical Nurse I', 'Graduate Nurse Tech', 'Other')),
  ADD COLUMN IF NOT EXISTS hired_as_other text
    CHECK (hired_as_other IS NULL OR (btrim(hired_as_other) <> '' AND char_length(hired_as_other) <= 120)),
  ADD COLUMN IF NOT EXISTS licensed_at_application boolean,
  ADD COLUMN IF NOT EXISTS nclex_passed_on date,
  ADD COLUMN IF NOT EXISTS license_issued_on date,
  ADD COLUMN IF NOT EXISTS backfilled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ngrp_residency_outcomes.hired_as IS
  'HIRE-HISTORY-1: the position they were hired into: Clinical Nurse I, Graduate Nurse Tech, or Other (see hired_as_other).';
COMMENT ON COLUMN public.ngrp_residency_outcomes.hired_as_other IS
  'HIRE-HISTORY-1: the hired-as title when hired_as is Other.';
COMMENT ON COLUMN public.ngrp_residency_outcomes.licensed_at_application IS
  'HIRE-HISTORY-1: held a California RN license when they applied. Filled from the Transition Form, editable by staff.';
COMMENT ON COLUMN public.ngrp_residency_outcomes.nclex_passed_on IS
  'HIRE-HISTORY-1: the day they passed the NCLEX-RN, when staff know it.';
COMMENT ON COLUMN public.ngrp_residency_outcomes.license_issued_on IS
  'HIRE-HISTORY-1: the day the California RN license was issued.';
COMMENT ON COLUMN public.ngrp_residency_outcomes.backfilled IS
  'HIRE-HISTORY-1: recorded after the fact from the team''s records (Record past hires); the offer timestamps equal the hire date and are not real offer dates.';

CREATE TABLE IF NOT EXISTS public.ngrp_resident_titles (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id            uuid        NOT NULL REFERENCES public.ngrp_candidates(id) ON DELETE RESTRICT,
  title                   text        NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 120),
  effective_on            date        NOT NULL,
  recorded_by_profile_id  uuid        REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at              timestamptz NOT NULL DEFAULT now(),
  is_demo                 boolean     NOT NULL DEFAULT false
);

COMMENT ON TABLE public.ngrp_resident_titles IS
  'HIRE-HISTORY-1: a resident''s title history, one row per change, append-only. The latest row is the current title; ngrp_residency_outcomes.position_title mirrors it. Server-only.';

CREATE INDEX IF NOT EXISTS idx_ngrp_resident_titles_candidate
  ON public.ngrp_resident_titles (candidate_id, effective_on DESC, created_at DESC);

-- A title row is demo when its candidate is (the same inheritance the outcome row has).
DROP TRIGGER IF EXISTS aspire_demo_inherit_trg ON public.ngrp_resident_titles;
CREATE TRIGGER aspire_demo_inherit_trg
  BEFORE INSERT ON public.ngrp_resident_titles
  FOR EACH ROW EXECUTE FUNCTION public.aspire_demo_inherit('ngrp_candidates', 'candidate_id');

ALTER TABLE public.ngrp_resident_titles ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.ngrp_resident_titles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.ngrp_resident_titles TO service_role;

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
      'alumnus_added','alumnus_removed','alumnus_invited',
      'form_deadline_extended',
      -- HIRE-HISTORY-1
      'hire_backfilled','title_changed'));

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (only while no past hire has been recorded and no title has been changed):
--   DELETE FROM public.ngrp_audit_events WHERE event_type IN ('hire_backfilled','title_changed');
--   then restore the CHECK from 20261120000000, and
--   DROP TABLE public.ngrp_resident_titles;
--   ALTER TABLE public.ngrp_residency_outcomes
--     DROP COLUMN IF EXISTS hired_as, DROP COLUMN IF EXISTS hired_as_other,
--     DROP COLUMN IF EXISTS licensed_at_application, DROP COLUMN IF EXISTS nclex_passed_on,
--     DROP COLUMN IF EXISTS license_issued_on, DROP COLUMN IF EXISTS backfilled;
