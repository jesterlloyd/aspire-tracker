-- ############################################################################
-- Add recurrence to public.aspire_events
--
-- Owner-gated. NOT auto-applied by this branch. Adds the smallest canonical recurring-event model to
-- the ASPIRE calendar events table: one parent row plus two explicit fields. Occurrences are expanded
-- at read/render time by the application (eventOnDate) -- there are NO materialized occurrence rows.
--
-- NOTE: public.aspire_events was created out-of-band (there is no CREATE TABLE migration in the repo),
-- so this migration only ADDs columns / constraints / one function and is written idempotently
-- (ADD COLUMN IF NOT EXISTS; DROP CONSTRAINT IF EXISTS + ADD; CREATE OR REPLACE FUNCTION) so it is safe
-- to apply once and harmless to re-run. Existing rows are NOT rewritten: they simply read as the new
-- column default recurrence = 'none' (a one-time event, exactly as today) with recurrence_end = NULL.
--
-- CANONICAL START FIELD: public.aspire_events.start_at (timestamptz). The API stores it as
-- new Date(start_at).toISOString() (UTC) and derives the start calendar date as
-- toISOString().slice(0,10). The recurrence_end consistency constraint below compares against
-- (start_at AT TIME ZONE 'UTC')::date, which is IMMUTABLE and equals that exact UTC-date contract --
-- it does NOT depend on the session TimeZone.
--
-- Recurrence stays FAIL-CLOSED until BOTH the Owner applies this migration (creating the capability
-- sentinel) AND the server release flag ASPIRE_EVENT_RECURRENCE_ENABLED is set to the exact string
-- 'true'. See api/aspire-events.js (recurrenceReleaseEnabled + isRecurrenceReady): a missing function,
-- a failed probe, or an unset/!= 'true' flag all keep recurrence disabled. One-time event creation is
-- unaffected in every case; a recurring create/update returns 503 while disabled.
-- ############################################################################

BEGIN;

-- The repeat cadence. 'none' is a one-time event (the default, matching today's behavior).
ALTER TABLE public.aspire_events
  ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none';

-- Optional recurrence end (date-only). NULL = repeats indefinitely ("Never").
ALTER TABLE public.aspire_events
  ADD COLUMN IF NOT EXISTS recurrence_end date;

-- Cadence allow-list. Idempotent REPLACE (drop-if-exists + add) so re-running always converges to the
-- expected definition rather than trusting a bare name check.
ALTER TABLE public.aspire_events
  DROP CONSTRAINT IF EXISTS chk_aspire_events_recurrence;
ALTER TABLE public.aspire_events
  ADD CONSTRAINT chk_aspire_events_recurrence
  CHECK (recurrence IN ('none', 'weekly', 'monthly', 'annually'));

-- Recurrence_end consistency, enforced at the DATABASE level (not only in the API):
--   recurrence = 'none'  => recurrence_end IS NULL            (a one-time event cannot carry an end)
--   recurrence <> 'none' => recurrence_end IS NULL            (indefinite series), OR
--                           recurrence_end >= the start date  (bounded series, end on/after start)
-- The start date is the IMMUTABLE UTC calendar date of start_at, matching the API contract exactly.
-- Idempotent REPLACE. Existing rows (recurrence 'none', recurrence_end NULL) already satisfy this.
ALTER TABLE public.aspire_events
  DROP CONSTRAINT IF EXISTS chk_aspire_events_recurrence_end;
ALTER TABLE public.aspire_events
  ADD CONSTRAINT chk_aspire_events_recurrence_end
  CHECK (
    (recurrence = 'none' AND recurrence_end IS NULL)
    OR (recurrence <> 'none' AND (
          recurrence_end IS NULL
          OR recurrence_end >= (start_at AT TIME ZONE 'UTC')::date
       ))
  );

COMMENT ON COLUMN public.aspire_events.recurrence IS
  'Repeat cadence: none | weekly | monthly | annually. Occurrences are expanded at read time by the app (no materialized rows). Interval is always 1 (no custom recurrence). weekly=same weekday; monthly=same day-of-month (months lacking that day are skipped); annually=same month+day (Feb 29 -> Feb 28 in non-leap years).';
COMMENT ON COLUMN public.aspire_events.recurrence_end IS
  'Optional inclusive last date a recurring event may occur (date-only). NULL = no end. For a one-time event (recurrence = none) it must be NULL; for a recurring event it must be NULL or >= the UTC start date. Enforced by chk_aspire_events_recurrence_end.';

-- ----------------------------------------------------------------------------
-- Recurrence capability sentinel. Created LAST inside this atomic migration, AFTER both columns, all
-- constraints, and all comments, so its mere existence proves the full recurrence schema landed (not
-- just one column). The API probes it with the SERVICE-ROLE client as its readiness signal; a missing
-- function or a failed probe keeps recurrence fail-closed. It is NOT granted to PUBLIC / anon /
-- authenticated, so the browser can neither call it nor spoof readiness.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aspire_event_recurrence_capability()
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SECURITY INVOKER
  SET search_path = ''
AS $$ SELECT true $$;

COMMENT ON FUNCTION public.aspire_event_recurrence_capability() IS
  'Recurrence readiness sentinel. Returns true only when this migration (columns + constraints) has been applied. Probed by api/aspire-events.js with the service-role client; EXECUTE is service_role-only.';

-- Least privilege: strip the default PUBLIC grant and the Supabase client roles explicitly, then grant
-- EXECUTE to service_role only. Idempotent (revoke/grant always converge on re-run).
REVOKE ALL ON FUNCTION public.aspire_event_recurrence_capability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aspire_event_recurrence_capability() FROM anon;
REVOKE ALL ON FUNCTION public.aspire_event_recurrence_capability() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.aspire_event_recurrence_capability() TO service_role;

COMMIT;

-- ############################################################################
-- Verification (run AFTER applying; OUTSIDE the transaction)
-- ############################################################################
--   SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='aspire_events'
--     AND column_name IN ('recurrence','recurrence_end');
--   -- Expect recurrence text NOT NULL default 'none'; recurrence_end date NULLABLE.
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid='public.aspire_events'::regclass
--     AND conname IN ('chk_aspire_events_recurrence','chk_aspire_events_recurrence_end');  -- expect two rows.
--   -- Existing rows are unaffected (all default to 'none' = one-time, recurrence_end NULL).

-- ############################################################################
-- Rollback considerations
-- ############################################################################
-- Additive, no backfill: existing rows are not rewritten; the new default simply makes them read as
-- recurrence = 'none' with recurrence_end = NULL.
--
-- OPERATIONAL rollback (safe, non-destructive, no SQL): unset ASPIRE_EVENT_RECURRENCE_ENABLED (or set
-- it to anything other than 'true') and redeploy. Recurrence returns to one-time-only immediately; the
-- columns and any stored recurrence settings are PRESERVED.
--
-- STRUCTURAL rollback (DESTRUCTIVE): dropping the columns discards every event's recurrence settings.
-- Do this ONLY before any live recurring data exists, or after an explicit export.
--   ALTER TABLE public.aspire_events DROP CONSTRAINT IF EXISTS chk_aspire_events_recurrence_end;
--   ALTER TABLE public.aspire_events DROP CONSTRAINT IF EXISTS chk_aspire_events_recurrence;
--   ALTER TABLE public.aspire_events DROP COLUMN IF EXISTS recurrence_end;   -- loses bounded-series ends
--   ALTER TABLE public.aspire_events DROP COLUMN IF EXISTS recurrence;       -- loses all cadences
--
-- RLS policies and existing grants on public.aspire_events are UNCHANGED by this migration. Occurrences
-- remain read-time expansions only (this migration materializes no occurrence rows).
