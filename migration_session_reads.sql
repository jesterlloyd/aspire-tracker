-- Per-user read tracking for interview sessions
-- Mirrors the student_reads pattern used for the Student Profiles unread badge.
-- Run in Supabase SQL Editor before deploying the session-reads feature.

create table if not exists session_reads (
  user_id    uuid not null references user_profiles(id) on delete cascade,
  session_id uuid not null references interview_sessions(id) on delete cascade,
  last_viewed_at timestamptz not null default now(),
  primary key (user_id, session_id)
);

create index if not exists idx_session_reads_user    on session_reads(user_id);
create index if not exists idx_session_reads_session on session_reads(session_id);

alter table session_reads enable row level security;

create policy "users_read_own_session_reads" on session_reads
  for select using (
    user_id = (select id from user_profiles where auth_user_id = auth.uid())
  );

create policy "users_insert_own_session_reads" on session_reads
  for insert with check (
    user_id = (select id from user_profiles where auth_user_id = auth.uid())
  );

create policy "users_update_own_session_reads" on session_reads
  for update using (
    user_id = (select id from user_profiles where auth_user_id = auth.uid())
  );

-- Verification
select count(*) from session_reads;
