-- Add email column to interviewers table (safe to run even if already exists)
ALTER TABLE interviewers
ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';

-- Pre-fill known interviewer emails
UPDATE interviewers SET email = 'JesterLloyd.Bautista@cshs.org'
WHERE name ILIKE '%jester%';

UPDATE interviewers SET email = 'Krystal.Rodriguez@cshs.org'
WHERE name ILIKE '%krystal%';

-- Remaining interviewers will have empty email fields —
-- fill them in via the Manage Interviewers modal in the app.
