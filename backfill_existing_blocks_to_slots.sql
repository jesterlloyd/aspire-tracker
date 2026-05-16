-- Backfill slot rows for any interview_availability_blocks that have no slots.
--
-- Context: api/availability.js create_block already generates slot rows, so
-- any block created through the app should already have slots. This script
-- handles blocks created before the slot system existed or via direct DB inserts.
--
-- The existing table uses:
--   block_id       (not parent_block_id)
--   slot_time      (HH:MM start time, not separate start_time/end_time columns)
--   is_booked      (boolean, not status — run migration_slot_level_management.sql first)
--
-- Run AFTER migration_slot_level_management.sql so the status column exists.
-- Run in the Supabase SQL Editor.

-- ── Step 1: Preview blocks that have no slots ─────────────────────────────────
select
  b.id,
  b.block_date,
  b.start_time,
  b.end_time,
  b.duration_minutes,
  b.interviewer_name,
  count(s.id) as existing_slot_count
from interview_availability_blocks b
left join interview_slots s on s.block_id = b.id
where b.is_active = true
group by b.id, b.block_date, b.start_time, b.end_time, b.duration_minutes, b.interviewer_name
having count(s.id) = 0
order by b.block_date, b.start_time;

-- ── Step 2: Generate missing slots ───────────────────────────────────────────
-- Uses the same slot-generation logic as api/availability.js create_block.
-- slot_time is the start time of each individual slot (HH:MM format).
-- Each slot spans duration_minutes minutes.
do $$
declare
  blk         record;
  cursor_min  integer;
  end_min     integer;
  slot_h      text;
  slot_m      text;
  slot_time   text;
begin
  for blk in
    -- Only process active blocks that currently have zero slots
    select b.*
    from interview_availability_blocks b
    left join interview_slots s on s.block_id = b.id
    where b.is_active = true
    group by b.id
    having count(s.id) = 0
  loop
    -- Parse start/end times into minutes-since-midnight
    cursor_min := (split_part(blk.start_time, ':', 1)::integer) * 60
               + (split_part(blk.start_time, ':', 2)::integer);
    end_min    := (split_part(blk.end_time,   ':', 1)::integer) * 60
               + (split_part(blk.end_time,   ':', 2)::integer);

    -- Walk the time range in duration_minutes steps
    while cursor_min + blk.duration_minutes <= end_min loop
      slot_h    := lpad((cursor_min / 60)::text, 2, '0');
      slot_m    := lpad((cursor_min % 60)::text, 2, '0');
      slot_time := slot_h || ':' || slot_m;

      insert into interview_slots (
        block_id,
        cohort_id,
        slot_date,
        slot_time,
        duration_minutes,
        interviewer_name,
        is_booked,
        status
      ) values (
        blk.id,
        blk.cohort_id,
        blk.block_date,
        slot_time,
        blk.duration_minutes,
        blk.interviewer_name,
        false,
        'available'
      )
      on conflict do nothing;

      cursor_min := cursor_min + blk.duration_minutes;
    end loop;

    raise notice 'Backfilled block %: % % – %', blk.id, blk.block_date, blk.start_time, blk.end_time;
  end loop;
end $$;

-- ── Step 3: Verification ─────────────────────────────────────────────────────
-- Should now return zero rows (no active block without slots):
select count(*) as blocks_with_no_slots
from interview_availability_blocks b
left join interview_slots s on s.block_id = b.id
where b.is_active = true
group by b.id
having count(s.id) = 0;

-- Slot count summary:
select
  slot_date,
  count(*) filter (where status = 'available') as available,
  count(*) filter (where status = 'booked')    as booked,
  count(*) filter (where status = 'blocked')   as blocked
from interview_slots
group by slot_date
order by slot_date desc
limit 20;
