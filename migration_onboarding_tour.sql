-- migration_onboarding_tour.sql
-- Adds onboarding tour state columns to user_profiles.
-- Run in Supabase SQL Editor before deploying the React Joyride tour feature.

alter table user_profiles
  add column if not exists onboarding_tour_completed   boolean     default false,
  add column if not exists onboarding_tour_completed_at timestamptz default null,
  add column if not exists onboarding_tour_version     text        default 'v1',
  add column if not exists onboarding_tour_dismissed   boolean     default false;

-- Reload PostgREST schema cache so the new columns are immediately usable
notify pgrst, 'reload schema';
