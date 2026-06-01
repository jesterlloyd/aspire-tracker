-- =============================================================================
-- ASPIRE Connect Phase 1B: Contact profile column additions
-- Migration: 20260601000000_contacts_phase1b_columns
-- =============================================================================
--
-- Adds three nullable TEXT columns to the contacts table to support future
-- Add/Edit Contact, LinkedIn URL, preferred contact method, and avatar
-- features.
--
-- No data backfill, no RLS changes, no triggers, no indexes, no defaults.
-- Idempotent: all DDL uses ADD COLUMN IF NOT EXISTS.
--
-- HOW TO RUN: paste into the Supabase SQL Editor and execute.
-- =============================================================================

-- linkedin_url: stores a contact's LinkedIn profile URL.
-- Regex validation is intentionally deferred to the future mutation endpoint.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT;

-- preferred_contact_method: stores preferred communication channel.
-- Expected future values: 'email', 'phone', 'text', 'teams', 'no_preference'.
-- A CHECK constraint is intentionally omitted to allow flexible evolution;
-- allowed-value validation will be enforced in the future contacts mutation endpoint.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS preferred_contact_method TEXT;

-- avatar_url: placeholder for future profile photo/avatar support.
-- Storage bucket creation and upload UI are out of scope for this migration.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Reload PostgREST schema cache so new columns are immediately queryable via the API.
NOTIFY pgrst, 'reload schema';
