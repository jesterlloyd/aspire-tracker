-- Teams invite tracking migration
-- NOTE: teams_meeting_booked already exists on interview_sessions and is used by
-- the IR badge counter (irBadge = sessions where self_scheduled && !teams_meeting_booked).
-- This migration only adds performance indexes and optional additional columns.
-- Run in Supabase SQL Editor.

-- Index for the "pending Teams invites" query used by Today's Priorities
create index if not exists idx_sessions_teams_pending
  on interview_sessions(cohort_id, teams_meeting_booked)
  where teams_meeting_booked = false;

-- Index for self-scheduled sessions (drives the IR badge)
create index if not exists idx_sessions_self_scheduled
  on interview_sessions(cohort_id, self_scheduled)
  where self_scheduled = true;

-- Optional: track who sent the invite and when (additive, non-breaking)
alter table interview_sessions
  add column if not exists teams_invite_sent_at timestamptz,
  add column if not exists teams_invite_sent_by uuid references user_profiles(id);

-- Verification: check all sessions that have slot_id set (should correspond to self-scheduled bookings)
select
  count(*) filter (where self_scheduled = true)  as self_scheduled,
  count(*) filter (where self_scheduled = true and teams_meeting_booked = false) as pending_invite,
  count(*) filter (where self_scheduled = true and teams_meeting_booked = true)  as invite_sent
from interview_sessions;
