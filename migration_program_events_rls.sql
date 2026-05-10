-- Enable RLS (already enabled via Supabase UI, this ensures it)
ALTER TABLE program_events ENABLE ROW LEVEL SECURITY;

-- Allow the service role full access (used by server-side operations)
CREATE POLICY "Service role full access on program_events"
ON program_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Allow anon key to read program_events
-- (needed for Keith context queries and Gantt chart)
CREATE POLICY "Anon read access on program_events"
ON program_events
FOR SELECT
TO anon
USING (true);

-- Allow anon key to insert program_events
-- (needed for logging events from the app)
CREATE POLICY "Anon insert access on program_events"
ON program_events
FOR INSERT
TO anon
WITH CHECK (true);

-- Allow anon key to update program_events
-- (needed for editing logged events)
CREATE POLICY "Anon update access on program_events"
ON program_events
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

-- Allow anon key to delete program_events
-- (needed for removing incorrectly logged events)
CREATE POLICY "Anon delete access on program_events"
ON program_events
FOR DELETE
TO anon
USING (true);
