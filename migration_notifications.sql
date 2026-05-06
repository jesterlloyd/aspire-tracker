-- Notification tracking migration
-- Adds notification fields to matches and contact_email to units.
-- Run in Supabase SQL Editor.

ALTER TABLE matches
ADD COLUMN IF NOT EXISTS notification_sent BOOLEAN    DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS notified_at       TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE units
ADD COLUMN IF NOT EXISTS contact_email TEXT DEFAULT '';
