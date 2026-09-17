-- PLACEMENT-BOARD-FELT-1 preflight: matches.match_quality gains 'third_choice'
--
-- READ-ONLY. Nothing here writes, and nothing here is a migration. Run it in the
-- Supabase SQL editor BEFORE the Placement Board release that starts storing a
-- 3rd-choice placement as 'third_choice' instead of 'other'.
--
-- WHY IT MATTERS. matches and students predate supabase/migrations, so the repo
-- does not know whether either match_quality column carries a CHECK constraint or
-- an enum type. If one exists and does not list 'third_choice', every 3rd-choice
-- placement would be REFUSED in production the moment the code ships. Section 1
-- answers that question; it is the release gate.
--
-- Run one section at a time and read the result before moving on.

-- ── Section 1 (RELEASE GATE). Does anything constrain match_quality? ─────────
-- Expected for a safe release: ZERO rows, or a constraint whose definition already
-- allows 'third_choice'. Any other result = DO NOT SHIP; the constraint has to be
-- widened first, through the Owner SQL gate.
SELECT c.conrelid::regclass AS table_name,
       c.conname            AS constraint_name,
       pg_get_constraintdef(c.oid) AS definition
FROM   pg_constraint c
JOIN   pg_attribute  a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
WHERE  c.conrelid IN ('public.matches'::regclass, 'public.students'::regclass)
  AND  a.attname = 'match_quality';

-- Column types: both should be text/varchar, not a USER-DEFINED enum. An enum
-- would need a new label added before the release, also through the Owner gate.
SELECT table_name, column_name, data_type, udt_name
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  column_name = 'match_quality'
ORDER  BY table_name;

-- ── Section 2. What is stored today? ────────────────────────────────────────
-- A baseline to compare against after the release. 'third_choice' should be
-- absent here and start appearing only for placements made after it ships.
SELECT match_quality, count(*) AS matches
FROM   public.matches
GROUP  BY match_quality
ORDER  BY matches DESC;

-- ── Section 3. How many existing placements WERE a 3rd choice? ──────────────
-- Context for an Owner decision only: these rows are stored as 'other' and will
-- keep displaying as "Other placement" unless the Owner asks for a backfill.
-- Nothing in the release depends on this number, and this file changes nothing.
-- Read it as "placements whose unit matches the student's CURRENT 3rd preference",
-- which is not the same claim as "was a 3rd choice when it was made".
SELECT c.name                AS cohort,
       count(*)              AS other_rows_matching_current_third_choice
FROM   public.matches m
JOIN   public.students s ON s.id = m.student_id
JOIN   public.units    u ON u.id = m.unit_id
LEFT   JOIN public.cohorts c ON c.id = m.cohort_id
WHERE  m.match_quality = 'other'
  AND  u.unit_name = s.unit_preference_3
GROUP  BY c.name
ORDER  BY other_rows_matching_current_third_choice DESC;
