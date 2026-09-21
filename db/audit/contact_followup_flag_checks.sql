-- contact_followup_flag_checks.sql
-- Read-only checks for supabase/migrations/20260925000000_contact_followup_flag.sql
-- (CONTACTS-BOOK-3). Run ONE section at a time in the Supabase SQL editor, PRE before
-- applying, POST after. Every section is ONE query, because the editor shows only the
-- last statement's result.

-- ── PRE 1: the column is absent, and staff can read contacts ─────────────────────────
-- Expect: column_exists false, staff_select_policy true, contacts = your contact count.
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'flagged_for_followup'
  ) AS column_exists,
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'contacts' AND cmd = 'SELECT'
  ) AS staff_select_policy,
  (SELECT count(*) FROM public.contacts) AS contacts;

-- ── POST 1: the column ──────────────────────────────────────────────────────────────
-- Expect one row: flagged_for_followup | boolean | NO | false
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'contacts' AND column_name = 'flagged_for_followup';

-- ── POST 2: nothing is flagged yet, and nothing is NULL ─────────────────────────────
-- Run right after applying. Expect flagged = 0 and unset = 0, contacts unchanged from PRE 1.
-- (flagged may be above 0 later: that is someone pulling a ribbon, which is the point.)
SELECT
  count(*) FILTER (WHERE flagged_for_followup) AS flagged,
  count(*) FILTER (WHERE flagged_for_followup IS NULL) AS unset,
  count(*) AS contacts
FROM public.contacts;

-- ── POST 3: the policies on contacts are exactly what they were ─────────────────────
-- Expect the same policy names PRE-existing: the staff SELECT policy and the writer
-- INSERT / UPDATE / DELETE policies. This migration adds none and changes none.
SELECT string_agg(policyname || ' (' || cmd || ')', ', ' ORDER BY policyname) AS contacts_policies
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'contacts';
