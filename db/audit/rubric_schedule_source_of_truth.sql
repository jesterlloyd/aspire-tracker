-- RUBRIC-SCHEDULE-1 verification. READ ONLY: every statement is a SELECT.
-- Run one section at a time in the Supabase SQL editor and read the result before
-- moving on. Nothing here changes data.
--
-- Context: the interview rubric's Section 1 date and time used to write
-- interview_rubrics.interview_date / interview_time, which no surface read. The
-- Interview Recommendations table reads students.interview_scheduled_*, and the
-- Interviews Today card reads interview_slots. These queries show where a given
-- student's appointment actually lives and whether the three agree.

-- ── 1. The three stores for one student, side by side ────────────────────────
-- Replace the name. This is the query that shows a correction landing in the
-- rubric while the booking stayed where it was.
SELECT
  s.first_name || ' ' || s.last_name        AS student,
  s.status                                  AS aspire_status,
  s.interview_scheduled_date                AS table_shows_date,
  s.interview_scheduled_time                AS table_shows_time,
  sl.slot_date                              AS card_shows_date,
  sl.slot_time                              AS card_shows_time,
  sl.interviewer_name                       AS booked_with,
  r.interview_date                          AS rubric_recorded_date,
  r.interview_time                          AS rubric_recorded_time,
  r.status                                  AS rubric_status
FROM public.students s
LEFT JOIN public.interview_slots sl
  ON sl.booked_by_student_id = s.id AND sl.is_booked = true
LEFT JOIN public.interview_rubrics r
  ON r.student_id = s.id
WHERE s.last_name ILIKE 'Waggoner'
ORDER BY r.created_at NULLS LAST;

-- ── 2. Every student in the cohort whose three stores disagree ───────────────
-- Any row returned is a place where a staff member could read two different
-- answers to "when is this interview". Expect this list to stop growing once
-- Section 1 edits the booking instead of a private copy.
SELECT
  s.first_name || ' ' || s.last_name  AS student,
  s.interview_scheduled_date, s.interview_scheduled_time,
  sl.slot_date, sl.slot_time,
  r.interview_date, r.interview_time
FROM public.students s
LEFT JOIN public.interview_slots sl
  ON sl.booked_by_student_id = s.id AND sl.is_booked = true
LEFT JOIN public.interview_rubrics r
  ON r.student_id = s.id
WHERE s.cohort_id = (SELECT id FROM public.cohorts WHERE accepting_submissions = true LIMIT 1)
  AND (
       s.interview_scheduled_date IS DISTINCT FROM sl.slot_date
    OR left(s.interview_scheduled_time::text, 5) IS DISTINCT FROM left(sl.slot_time::text, 5)
    OR (r.interview_date IS NOT NULL AND r.interview_date IS DISTINCT FROM s.interview_scheduled_date)
    OR (r.interview_time IS NOT NULL AND r.interview_time <> ''
        AND left(r.interview_time, 5) IS DISTINCT FROM left(s.interview_scheduled_time::text, 5))
  )
ORDER BY s.last_name;

-- ── 3. Is there an open slot to move a booking INTO? ─────────────────────────
-- move_booking refuses unless the destination already exists, is open, and belongs
-- to the SAME availability block (so the interviewer never changes silently). Set
-- the date and time to the ones being requested; an empty result is exactly the
-- refusal the rubric will show.
SELECT
  sl.id, sl.slot_date, sl.slot_time, sl.duration_minutes,
  sl.interviewer_name, sl.is_booked
FROM public.interview_slots sl
WHERE sl.block_id = (
        SELECT block_id FROM public.interview_slots
        WHERE booked_by_student_id = (
                SELECT id FROM public.students WHERE last_name ILIKE 'Waggoner' LIMIT 1)
          AND is_booked = true
        LIMIT 1)
  AND sl.slot_date = DATE '2026-09-09'
ORDER BY sl.slot_time;

-- ── 4. The one-booking invariant still holds ────────────────────────────────
-- A move claims the destination before releasing the origin, and rolls the claim
-- back if the release fails. This must return ZERO rows; any row is a student
-- holding two slots and needs a look.
SELECT booked_by_student_id, count(*) AS booked_slots
FROM public.interview_slots
WHERE is_booked = true AND booked_by_student_id IS NOT NULL
GROUP BY booked_by_student_id
HAVING count(*) > 1;

-- ── 5. Reschedules recorded since the change shipped ────────────────────────
-- move_booking logs one program_event per move, naming both the old and the new
-- appointment, so a corrected time leaves a trail.
SELECT pe.event_date, s.first_name || ' ' || s.last_name AS student, pe.notes
FROM public.program_events pe
JOIN public.students s ON s.id = pe.student_id
WHERE pe.event_type = 'interview_rescheduled'
ORDER BY pe.event_date DESC, pe.created_at DESC
LIMIT 50;
