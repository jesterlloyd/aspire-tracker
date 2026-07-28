-- ############################################################################
-- Add recurrence to public.aspire_events
--
-- Owner-gated. NOT auto-applied by this branch. Adds the smallest canonical recurring-event model to
-- the ASPIRE calendar events table: one parent row plus two explicit fields. Occurrences are expanded
-- at read/render time by the application (eventOnDate) -- there are NO materialized occurrence rows.
--
-- NOTE: public.aspire_events was created out-of-band (there is no CREATE TABLE migration in the repo),
-- so this migration only ADDs columns and is written idempotently (ADD COLUMN IF NOT EXISTS + a guarded
-- CHECK) so it is safe to apply once and harmless to re-run. It changes no existing row's behavior: the
-- default recurrence is 'none' (a one-time event, exactly as today).
--
-- Until the Owner applies this migration, recurrence is FAIL-CLOSED in the API: a runtime readiness
-- probe (a bounded select of the recurrence column) gates it, one-time event creation is unaffected,
-- and any attempt to create/update a RECURRING event returns 503 rather than erroring on a missing
-- column. See api/aspire-events.js (isRecurrenceReady).
-- ############################################################################

BEGIN;

-- The repeat cadence. 'none' is a one-time event (the default, matching today's behavior).
ALTER TABLE public.aspire_events
  ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none';

-- Optional recurrence end (date-only). NULL = repeats indefinitely ("Never").
ALTER TABLE public.aspire_events
  ADD COLUMN IF NOT EXISTS recurrence_end date;

-- Constrain the cadence to the canonical set. Guarded so re-running does not error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_aspire_events_recurrence'
      AND conrelid = 'public.aspire_events'::regclass
  ) THEN
    ALTER TABLE public.aspire_events
      ADD CONSTRAINT chk_aspire_events_recurrence
      CHECK (recurrence IN ('none', 'weekly', 'monthly', 'annually'));
  END IF;
END $$;

COMMENT ON COLUMN public.aspire_events.recurrence IS
  'Repeat cadence: none | weekly | monthly | annually. Occurrences are expanded at read time by the app (no materialized rows). Interval is always 1 (no custom recurrence). weekly=same weekday; monthly=same day-of-month (months lacking that day are skipped); annually=same month+day (Feb 29 -> Feb 28 in non-leap years).';
COMMENT ON COLUMN public.aspire_events.recurrence_end IS
  'Optional inclusive last date a recurring event may occur (date-only, local). NULL = no end. Must be >= the event start date (enforced in the API).';

COMMIT;

-- ############################################################################
-- Verification (run AFTER applying; OUTSIDE the transaction)
-- ############################################################################
--   SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='aspire_events'
--     AND column_name IN ('recurrence','recurrence_end');
--   -- Expect recurrence text NOT NULL default 'none'; recurrence_end date NULLABLE.
--   SELECT conname FROM pg_constraint WHERE conrelid='public.aspire_events'::regclass
--     AND conname='chk_aspire_events_recurrence';   -- expect one row.
--   -- Existing rows are unaffected (all default to 'none' = one-time).

-- ############################################################################
-- Rollback considerations
-- ############################################################################
-- Additive, no backfill. To revert:
--   ALTER TABLE public.aspire_events DROP CONSTRAINT IF EXISTS chk_aspire_events_recurrence;
--   ALTER TABLE public.aspire_events DROP COLUMN IF EXISTS recurrence_end;
--   ALTER TABLE public.aspire_events DROP COLUMN IF EXISTS recurrence;
-- Operational disable WITHOUT SQL: the API's readiness probe fails closed if the column is absent, so
-- dropping the columns returns the feature to one-time-only automatically.
