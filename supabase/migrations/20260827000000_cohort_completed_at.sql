-- 20260827000000_cohort_completed_at.sql
--
-- COHORT-ACCESS-RETIREMENT-1: record WHEN a cohort is marked Completed.
--
-- The cohort picker has always saved the status VALUE (Planning / Active /
-- Completed / Archived) but never the moment it changed, and updated_at moves
-- on any cohort edit, so nothing could anchor the access-retirement email's
-- send date. This adds cohorts.completed_at, stamped by a trigger on the
-- status transition so EVERY writer (the app today, anything else tomorrow)
-- stamps it identically:
--
--   * -> Completed : completed_at := now()
--   Completed -> * : completed_at := NULL   (an accidental completion that is
--                    reverted leaves no stamp; re-completing restamps, and the
--                    cron's ledger keys on sent_at >= completed_at, so a
--                    genuine re-completion sends again)
--
-- NO BACKFILL, deliberately: cohorts already sitting at Completed keep a NULL
-- completed_at and are never picked up by the cron, so shipping this cannot
-- retroactively email about long-finished cohorts.
--
-- Copy ONLY the BEGIN..COMMIT block below into the SQL editor. The rollback
-- block further down is commented out - do not run it as part of the apply.

BEGIN;

ALTER TABLE public.cohorts
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

COMMENT ON COLUMN public.cohorts.completed_at IS
  'When status last transitioned TO Completed (trigger-stamped). NULL when the cohort has never been completed since this column shipped, or when the status has moved away from Completed. Anchors the CS-Link access-retirement email.';

CREATE OR REPLACE FUNCTION public.stamp_cohort_completed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'Completed' AND OLD.status IS DISTINCT FROM 'Completed' THEN
    NEW.completed_at := now();
  ELSIF NEW.status IS DISTINCT FROM 'Completed' AND OLD.status = 'Completed' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_cohort_completed_at ON public.cohorts;
CREATE TRIGGER stamp_cohort_completed_at
BEFORE UPDATE OF status ON public.cohorts
FOR EACH ROW
EXECUTE FUNCTION public.stamp_cohort_completed_at();

COMMIT;

-- ── Verification (run separately; each should return rows) ──────────────────
--
-- V1: the column exists.
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'cohorts' AND column_name = 'completed_at';
--
-- V2: the trigger exists.
-- SELECT tgname FROM pg_trigger
-- WHERE tgrelid = 'public.cohorts'::regclass AND tgname = 'stamp_cohort_completed_at';
--
-- V3: no pre-existing Completed cohort was stamped (expect completed_at NULL for all).
-- SELECT id, name, status, completed_at FROM public.cohorts WHERE status = 'Completed';

-- ── Rollback (commented; run ONLY to undo) ──────────────────────────────────
-- BEGIN;
-- DROP TRIGGER IF EXISTS stamp_cohort_completed_at ON public.cohorts;
-- DROP FUNCTION IF EXISTS public.stamp_cohort_completed_at();
-- ALTER TABLE public.cohorts DROP COLUMN IF EXISTS completed_at;
-- COMMIT;
