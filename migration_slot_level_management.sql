-- Slot-level management migration
-- Adds status text enum and blocked_reason to the existing interview_slots table.
--
-- interview_slots already exists with columns:
--   id, block_id, cohort_id, slot_date, slot_time, duration_minutes,
--   interviewer_name, is_booked, booked_by_student_id, booked_at
--
-- This migration adds two columns and backfills status from the is_booked boolean.
-- Run in the Supabase SQL Editor BEFORE deploying application code that reads status.

-- ── Step 1: Add status column (available | booked | blocked) ─────────────────
alter table interview_slots
  add column if not exists status text not null default 'available';

-- ── Step 2: Add blocked_reason column (only meaningful when status = 'blocked') ─
alter table interview_slots
  add column if not exists blocked_reason text;

-- ── Step 3: Backfill status from the existing is_booked boolean ──────────────
-- Slots already booked → 'booked'; everything else → 'available'
update interview_slots
set status = 'booked'
where is_booked = true
  and status = 'available';

-- ── Step 4: Add indexes for common query patterns ────────────────────────────
create index if not exists idx_slots_status  on interview_slots(status);
create index if not exists idx_slots_date    on interview_slots(slot_date);
create index if not exists idx_slots_cohort  on interview_slots(cohort_id);
create index if not exists idx_slots_block   on interview_slots(block_id);

-- ── Step 5: Verification ─────────────────────────────────────────────────────
-- Run these selects to confirm the migration worked:

-- Should show columns status and blocked_reason present:
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_name = 'interview_slots'
order by ordinal_position;

-- Should return zero rows (every booked slot has status = 'booked'):
select count(*) as mismatch
from interview_slots
where is_booked = true and status != 'booked';

-- Status distribution:
select status, count(*) as cnt
from interview_slots
group by status
order by status;
