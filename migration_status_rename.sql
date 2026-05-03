-- Rename "Form Returned" → "Pending Outreach" for all existing student records.
-- Run this in the Supabase SQL Editor before deploying the updated app.

UPDATE students
SET status = 'Pending Outreach'
WHERE status = 'Form Returned';
