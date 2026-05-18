-- Teams invite reminder tracking columns for interview_sessions.
-- Run in Supabase SQL Editor BEFORE deploying the teams-invite-reminders cron.

alter table interview_sessions
  add column if not exists teams_reminder_sent_at    timestamptz,
  add column if not exists teams_reminder_count      integer not null default 0,
  add column if not exists teams_reminder_escalated  boolean not null default false;

create index if not exists idx_interview_sessions_teams_reminder
  on interview_sessions(teams_invite_sent_at, teams_reminder_sent_at)
  where teams_invite_sent_at is null;

-- Verification
select
  count(*) as total_sessions,
  count(*) filter (where teams_invite_sent_at is null) as pending_invite,
  count(*) filter (where teams_reminder_count > 0)     as already_reminded
from interview_sessions;
