-- Adds match_quality_summary JSONB column to cohorts table.
-- The summary is computed and written client-side whenever a match is created or removed.
-- Schema: { total_matched, top_choice_count, second_choice_count, other_count,
--           top_choice_percentage, second_choice_percentage }
-- Run this in the Supabase SQL Editor before deploying.

ALTER TABLE cohorts
  ADD COLUMN IF NOT EXISTS match_quality_summary JSONB DEFAULT NULL;
