-- ############################################################################
-- Add 'birthday' to the public.aspire_events event-type allow-list
--
-- Owner-gated. NOT auto-applied by this branch. The application shipped a new 'birthday' event type
-- into both app allow-lists (src/lib/aspireEvents.js and api/aspire-events.js), but the production
-- database still enforces the pre-'birthday' allow-list via the CHECK constraint
-- aspire_events_event_type_chk, so inserting a Birthday event fails with a check violation (23514) that
-- the API collapses into the generic "Could not create the event."
--
-- This migration brings the DATABASE contract into parity with the application by adding ONLY
-- 'birthday'. It is additive and idempotent: it preserves the exact constraint NAME and every value
-- already accepted, changes no rows, and touches no RLS policy, grant, trigger, or enum. There is no
-- US Holiday event type (holidays remain a computed, system-only overlay).
--
-- public.aspire_events was created out-of-band (no CREATE TABLE in the repo), so this only DROPs and
-- re-adds the named CHECK. A guarded preflight aborts the whole transaction if any existing row holds
-- an event_type outside the final allow-list, so an unknown production value can never be silently
-- legitimized or locked out.
-- ############################################################################

BEGIN;

-- Preflight: refuse to proceed if any stored event_type is outside the intended final allow-list.
-- (Existing rows all use the pre-'birthday' set, which is a subset of the final list, so this passes;
-- if it does not, the RAISE rolls the transaction back and nothing changes.)
DO $$
DECLARE
  offending integer;
BEGIN
  SELECT count(*) INTO offending
  FROM public.aspire_events
  WHERE event_type NOT IN (
    'ngrp_open','ngrp_deadline','town_hall','interview_window','orientation',
    'milestone','deadline','rotation','reminder','custom','birthday'
  );
  IF offending > 0 THEN
    RAISE EXCEPTION
      'aspire_events has % row(s) with an event_type outside the target allow-list; aborting (no changes made).',
      offending;
  END IF;
END $$;

-- Replace the named CHECK with the final allow-list (idempotent drop-and-add). Only 'birthday' is new;
-- every prior value is preserved in the same order it shipped, with 'birthday' appended.
ALTER TABLE public.aspire_events
  DROP CONSTRAINT IF EXISTS aspire_events_event_type_chk;
ALTER TABLE public.aspire_events
  ADD CONSTRAINT aspire_events_event_type_chk
  CHECK (event_type IN (
    'ngrp_open','ngrp_deadline','town_hall','interview_window','orientation',
    'milestone','deadline','rotation','reminder','custom','birthday'
  ));

COMMENT ON CONSTRAINT aspire_events_event_type_chk ON public.aspire_events IS
  'Allowed custom ASPIRE event types. Must stay in parity with the application allow-list (src/lib/aspireEvents.js EVENT_TYPE_VALUES, mirrored in api/aspire-events.js EVENT_TYPES). US holidays are a computed system-only overlay and are NOT a selectable type.';

COMMIT;

-- ############################################################################
-- Verification (run AFTER applying; OUTSIDE the transaction)
-- ############################################################################
--   -- Exact constraint definition (expect the 11-value IN list including 'birthday'):
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'public.aspire_events'::regclass AND conname = 'aspire_events_event_type_chk';
--
--   -- Distinct stored event types (should all be within the allow-list; no surprises):
--   SELECT event_type, count(*) FROM public.aspire_events GROUP BY event_type ORDER BY event_type;
--
--   -- Confirm the contract now accepts 'birthday' (expect true, changes nothing):
--   SELECT 'birthday' IN (
--     'ngrp_open','ngrp_deadline','town_hall','interview_window','orientation',
--     'milestone','deadline','rotation','reminder','custom','birthday'
--   ) AS birthday_accepted;

-- ############################################################################
-- Rollback considerations
-- ############################################################################
-- Additive, no backfill, no row changes. To revert to the pre-'birthday' contract (destructive only if
-- a Birthday event has since been saved, which would then violate the reverted CHECK):
--   ALTER TABLE public.aspire_events DROP CONSTRAINT IF EXISTS aspire_events_event_type_chk;
--   ALTER TABLE public.aspire_events
--     ADD CONSTRAINT aspire_events_event_type_chk
--     CHECK (event_type IN (
--       'ngrp_open','ngrp_deadline','town_hall','interview_window','orientation',
--       'milestone','deadline','rotation','reminder','custom'
--     ));
-- RLS policies, grants, and triggers (incl. set_updated_at_aspire_events) are UNCHANGED by this migration.
