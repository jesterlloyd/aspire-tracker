-- Notification log table — queryable history of every email sent through ASPIRE Intelligence.
-- Supports Keith AI communication awareness, delivery tracking, and future webhook ingestion.
-- Run in Supabase SQL Editor.

create table if not exists notification_log (
  id uuid primary key default gen_random_uuid(),

  notification_type text not null,   -- e.g. 'form_received', 'interview_booked', 'teams_reminder'
  audience          text not null,   -- e.g. 'student', 'internal_team', 'school_coordinator'

  recipient_email text not null,
  recipient_role  text,
  recipient_name  text,

  student_id uuid references students(id) on delete set null,
  cohort_id  uuid references cohorts(id)  on delete set null,

  subject         text not null,
  resend_email_id text,              -- Resend message ID for delivery event correlation

  status text not null default 'queued',  -- queued | sent | failed | delivered | opened | bounced | complained

  sent_at       timestamptz default now(),
  delivered_at  timestamptz,
  opened_at     timestamptz,
  clicked_at    timestamptz,
  bounced_at    timestamptz,
  complained_at timestamptz,

  error_message text,
  metadata      jsonb default '{}'::jsonb,

  created_at timestamptz default now()
);

create index if not exists idx_notification_log_type      on notification_log(notification_type);
create index if not exists idx_notification_log_student   on notification_log(student_id);
create index if not exists idx_notification_log_cohort    on notification_log(cohort_id);
create index if not exists idx_notification_log_status    on notification_log(status);
create index if not exists idx_notification_log_resend_id on notification_log(resend_email_id);
create index if not exists idx_notification_log_sent_at   on notification_log(sent_at desc);

alter table notification_log enable row level security;

-- Service role has full access (API endpoints use service role)
create policy "service_role_full_access" on notification_log
  for all to service_role using (true) with check (true);

-- Owners, admins, and co-leads can read the log (for Keith AI awareness and reporting)
create policy "owners_admins_read" on notification_log
  for select to authenticated
  using (
    exists (
      select 1 from user_profiles
      where auth_user_id = auth.uid()
        and (is_owner = true or role in ('admin', 'co_lead', 'co-lead'))
    )
  );

-- Verification
select count(*) from notification_log;
