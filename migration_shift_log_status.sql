-- migration_shift_log_status.sql
-- Refines shift log status values to distinguish system auto-acceptance from manual approval.
-- Run in Supabase SQL Editor before deploying the corresponding code changes.

-- 1. Add new columns if not already present
alter table student_shift_logs
  add column if not exists review_reason  text,
  add column if not exists reviewed_by    text,
  add column if not exists reviewed_at    timestamptz;

-- 2. Migrate existing status values to the new canonical set
--    'approved'    → 'Auto-Accepted'  (system auto-approved; previously meant same thing)
--    'needs_review'→ 'Pending Review' (awaiting manual review)
--    'rejected'    → 'Rejected'       (capitalise for consistency)
update student_shift_logs set status = 'Auto-Accepted'  where status = 'approved';
update student_shift_logs set status = 'Pending Review' where status = 'needs_review';
update student_shift_logs set status = 'Rejected'       where status = 'rejected';

-- 3. Indexes for efficient queries
create index if not exists idx_shift_logs_status       on student_shift_logs(status);
create index if not exists idx_shift_logs_student_date on student_shift_logs(student_id, shift_date);

notify pgrst, 'reload schema';
