-- Add match_quality column to matches and students tables.
-- Values: 'top_choice' | 'second_choice' | 'other'
-- Run this in the Supabase SQL Editor before deploying the updated app.

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS match_quality TEXT;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS match_quality TEXT;
