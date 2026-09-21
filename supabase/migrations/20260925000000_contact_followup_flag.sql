-- 20260925000000_contact_followup_flag.sql
-- CONTACTS-BOOK-3 (Owner, 2026-09-20): the follow-up flag on a contact.
--
-- WHY. The Contacts address book gains the app's canonical ribbon (FlagRibbon, the same
-- one the Interview Rubric and the Student Chart pull). On a contact it means "come back
-- to this person", it is one shared flag every staff member sees, and it reaches the
-- address book and nothing else: the ribbon on the record, a mark on the list entry,
-- and the "Flagged only" filter. Like the other two ribbons it carries NO note.
--
-- WHAT. One boolean, NOT NULL DEFAULT false, so every existing contact reads unflagged.
-- On Postgres 11+ a constant default is metadata-only: no table rewrite.
--
-- NOT CHANGED. No policy, no grant, no backfill, no function. contacts' existing
-- table-level staff policies already govern every column, and the only writer is the
-- service-role status path in /api/contacts-upsert (api/lib/contactStatusUpdate.js).
--
-- EITHER DEPLOY ORDER. Before this runs, the app reads the absent column as "not
-- enabled": the ribbon renders inert and says so, and a pull answers 409 not_enabled
-- instead of an opaque 500. The app selects contacts with '*', so applying this switches
-- the ribbon on with no redeploy.
--
-- CHECKS: db/audit/contact_followup_flag_checks.sql (PRE 1, POST 1-3).
-- ROLLBACK: at the end of this file.

BEGIN;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS flagged_for_followup boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.contacts.flagged_for_followup IS
  'CONTACTS-BOOK-3: staff follow-up flag, set by the ribbon in the Contacts address book. '
  'Shared by every staff member; carries no note.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (only if the flag is withdrawn; drops every flag with it, and the ribbon
-- goes back to inert with no redeploy):
--   ALTER TABLE public.contacts DROP COLUMN IF EXISTS flagged_for_followup;
--   NOTIFY pgrst, 'reload schema';
