-- Backfill: promote students with shift logs from 'Placed' → 'Active Rotation'
--
-- Affected cohort: 7f4e0a67-ccef-498c-80f5-1e5c7c681bd1
-- Affected students confirmed via query: Wonsang Yun, Dylan Cline
--
-- Going forward, ShiftLogPage.jsx auto-promotes on the first approved shift.
-- This one-shot migration brings existing data into alignment.
--
-- Run in Supabase SQL Editor. Safe to re-run (CTE returns 0 rows if already updated).

WITH promoted AS (
  UPDATE students
  SET
    status     = 'Active Rotation',
    updated_at = NOW()
  WHERE id IN (
    SELECT DISTINCT student_id
    FROM student_shift_logs
    WHERE cohort_id = '7f4e0a67-ccef-498c-80f5-1e5c7c681bd1'
  )
  AND status     = 'Placed'
  AND cohort_id  = '7f4e0a67-ccef-498c-80f5-1e5c7c681bd1'
  RETURNING id, cohort_id
)
INSERT INTO program_events (student_id, cohort_id, event_type, event_date, notes, created_by)
SELECT
  id,
  cohort_id,
  'status_change_active_rotation',
  CURRENT_DATE,
  '[Auto-logged] Status backfilled from Placed to Active Rotation. Trigger: shift logs already existed before auto-promotion code was deployed.',
  'system'
FROM promoted;

-- Verification:
-- SELECT id, first_name, last_name, status
-- FROM students
-- WHERE cohort_id = '7f4e0a67-ccef-498c-80f5-1e5c7c681bd1'
-- AND status = 'Active Rotation';
