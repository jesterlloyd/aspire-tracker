-- 20261125000000_hire_gnt_interim_permit.sql
-- HIRE-HISTORY-2 (Owner, 2026-11-04): two corrections to the hire record HIRE-HISTORY-1 added.
--
-- 1. GNT is Graduate Nurse TRAINEE, not Tech. hired_as's CHECK now allows 'Graduate Nurse
--    Trainee' in place of 'Graduate Nurse Tech'. Any row that stored the old spelling is renamed
--    first (none did on 2026-11-04: every outcome row had hired_as NULL).
-- 2. ngrp_residency_outcomes.interim_permit_issued boolean: an interim permit was issued. The
--    Owner tracks the license issue date and this box; nclex_passed_on is no longer written or
--    shown (the column stays, unread, rather than drop a column the day after it shipped).
--
-- NOT CHANGED. No other column, policy, grant or audit type. APPLY BEFORE THE DEPLOY: the new
-- build writes 'Graduate Nurse Trainee' and interim_permit_issued, which the old CHECK and the
-- old table refuse. No hire row held hired_as on 2026-11-04, so nothing waits on the order.
-- CHECKS: db/audit/hire_gnt_interim_permit_checks.sql (PRE 1, POST 1-2).

BEGIN;

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'ngrp_residency_outcomes' AND column_name = 'hired_as') THEN
    RAISE EXCEPTION 'PRECHECK FAILED: hired_as is missing (apply 20261124000000 first)';
  END IF;
END
$pre$;

ALTER TABLE public.ngrp_residency_outcomes DROP CONSTRAINT IF EXISTS ngrp_residency_outcomes_hired_as_check;

UPDATE public.ngrp_residency_outcomes SET hired_as = 'Graduate Nurse Trainee' WHERE hired_as = 'Graduate Nurse Tech';

ALTER TABLE public.ngrp_residency_outcomes
  ADD CONSTRAINT ngrp_residency_outcomes_hired_as_check
    CHECK (hired_as IS NULL OR hired_as IN ('Clinical Nurse I', 'Graduate Nurse Trainee', 'Other')),
  ADD COLUMN IF NOT EXISTS interim_permit_issued boolean;

COMMENT ON COLUMN public.ngrp_residency_outcomes.hired_as IS
  'HIRE-HISTORY-2: the position they were hired into: Clinical Nurse I (CN I), Graduate Nurse Trainee (GNT), or Other (see hired_as_other).';
COMMENT ON COLUMN public.ngrp_residency_outcomes.interim_permit_issued IS
  'HIRE-HISTORY-2: an interim permit was issued. NULL is not recorded.';
COMMENT ON COLUMN public.ngrp_residency_outcomes.nclex_passed_on IS
  'HIRE-HISTORY-2: no longer written or shown; license_issued_on is the licensure date the Owner tracks.';

COMMIT;

-- UNDO (only if no row stores 'Graduate Nurse Trainee' or a permit answer worth keeping):
--   ALTER TABLE public.ngrp_residency_outcomes DROP CONSTRAINT ngrp_residency_outcomes_hired_as_check;
--   UPDATE public.ngrp_residency_outcomes SET hired_as = 'Graduate Nurse Tech' WHERE hired_as = 'Graduate Nurse Trainee';
--   ALTER TABLE public.ngrp_residency_outcomes ADD CONSTRAINT ngrp_residency_outcomes_hired_as_check
--     CHECK (hired_as IS NULL OR hired_as IN ('Clinical Nurse I', 'Graduate Nurse Tech', 'Other')),
--     DROP COLUMN IF EXISTS interim_permit_issued;
