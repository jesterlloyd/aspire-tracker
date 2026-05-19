-- Add preferred_name column to unit_leaders
-- Run in Supabase SQL editor, then verify with the SELECT at the bottom.

ALTER TABLE unit_leaders ADD COLUMN IF NOT EXISTS preferred_name text;

UPDATE unit_leaders
SET preferred_name = 'Luba'
WHERE full_name = 'Lyubov Tashlyk';

UPDATE unit_leaders
SET preferred_name = 'Lori'
WHERE full_name = 'Lorraine Sheffield';

-- Verification — expected: two rows (Luba for 5 SCCT, Lori for 7 SCCT)
SELECT unit_name, full_name, preferred_name, email, role
FROM unit_leaders
WHERE preferred_name IS NOT NULL;
