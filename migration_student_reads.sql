-- Per-user read tracking for student profiles
-- Run this in the Supabase SQL Editor before deploying the unread badge feature.

create table if not exists student_reads (
  user_id    uuid not null references user_profiles(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  last_viewed_at timestamptz not null default now(),
  primary key (user_id, student_id)
);

create index if not exists idx_student_reads_user    on student_reads(user_id);
create index if not exists idx_student_reads_student on student_reads(student_id);

alter table student_reads enable row level security;

-- Users can read their own read-state
create policy "users_read_own_reads" on student_reads
  for select using (
    user_id = (select id from user_profiles where auth_user_id = auth.uid())
  );

-- Users can insert their own read-state
create policy "users_insert_own_reads" on student_reads
  for insert with check (
    user_id = (select id from user_profiles where auth_user_id = auth.uid())
  );

-- Users can update their own read-state
create policy "users_update_own_reads" on student_reads
  for update using (
    user_id = (select id from user_profiles where auth_user_id = auth.uid())
  );
