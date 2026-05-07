-- Add CASCADE delete to interview_sessions.student_id so sessions are
-- automatically removed when the parent student record is deleted.
ALTER TABLE interview_sessions
DROP CONSTRAINT IF EXISTS interview_sessions_student_id_fkey;

ALTER TABLE interview_sessions
ADD CONSTRAINT interview_sessions_student_id_fkey
FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

-- Set booked_by_student_id to NULL (rather than cascade-deleting the slot)
-- when the student is deleted, preserving the slot's availability.
ALTER TABLE interview_slots
DROP CONSTRAINT IF EXISTS interview_slots_booked_by_student_id_fkey;

ALTER TABLE interview_slots
ADD CONSTRAINT interview_slots_booked_by_student_id_fkey
FOREIGN KEY (booked_by_student_id) REFERENCES students(id) ON DELETE SET NULL;
