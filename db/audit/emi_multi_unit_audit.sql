-- =============================================================================
-- Emi Bayaraa multi-unit audit  (MULTI-UNIT-STUDENT-PLACEMENTS-1)
-- READ-ONLY. SELECTs only - nothing here inserts, updates, deletes, or claims.
-- =============================================================================
--
-- PURPOSE. Before any multi-unit history is written for Saruulsanaa "Emi"
-- Bayaraa (Summer 2026, rotated in PACU and 6 NE), the Owner needs the exact
-- current state of every record involved. This script shows it. It draws NO
-- conclusions: shift logs prove shifts happened, not that ASPIRE approved a
-- unit assignment, so the distribution in section 5 is context for the Owner's
-- decision - never an input to a write.
--
-- Run each section in the Supabase SQL editor. Sections 2-7 reuse the student
-- id from section 1; substitute it for <EMI_STUDENT_ID> once known.
-- =============================================================================

-- ── 1. Her exact student and cohort record ───────────────────────────────────
-- Matched on school email (the identity key used across the app). Personal
-- fields beyond what this decision needs are deliberately not selected.
SELECT s.id            AS student_id,
       s.first_name, s.last_name, s.preferred_first_name,
       s.school, s.school_email,
       s.status, s.matched_unit_id, s.matched_preceptor, s.preceptor_id,
       s.shift_assigned, s.match_quality,
       s.rotation_end_date, s.rotation_completed_at,
       s.cohort_id, c.name AS cohort_name, c.status AS cohort_status
FROM public.students s
JOIN public.cohorts c ON c.id = s.cohort_id
WHERE lower(s.school_email) = lower('sbayara@calstatela.edu')
   OR (s.last_name ILIKE 'Bayaraa' AND s.first_name ILIKE 'Saruulsanaa%');
-- Expect exactly ONE row. If more than one appears (a repeating student has one
-- row per cohort), every following section must use the Summer 2026 row's id.

-- ── 2. Current matched_unit_id resolved to its unit ──────────────────────────
SELECT s.matched_unit_id,
       u.id AS unit_id, u.unit_name, u.division, u.cohort_id AS unit_cohort_id,
       u.total_slots, u.slots_remaining, u.is_participating
FROM public.students s
LEFT JOIN public.units u ON u.id = s.matched_unit_id
WHERE s.id = '<EMI_STUDENT_ID>';

-- ── 3. The PACU and 6 NE unit rows in her cohort ─────────────────────────────
-- units rows are PER COHORT; the rows that matter are the ones in her cohort.
SELECT u.id, u.unit_name, u.division, u.cohort_id,
       u.total_slots, u.slots_remaining, u.is_participating,
       u.contact_person, u.contact_email
FROM public.units u
WHERE u.unit_name IN ('PACU', '6 NE')
  AND u.cohort_id = (SELECT cohort_id FROM public.students WHERE id = '<EMI_STUDENT_ID>')
ORDER BY u.unit_name;

-- ── 4. Existing match records ────────────────────────────────────────────────
-- matches has NO uniqueness constraint, so duplicates are possible; every row
-- is shown. matched_at is the creation instant, not an assignment period.
SELECT m.id AS match_id, m.unit_id, u.unit_name,
       m.cohort_id, m.match_quality, m.preceptor_assigned, m.preceptor_id,
       m.shift_assigned, m.matched_at, m.notified_at, m.notes
FROM public.matches m
LEFT JOIN public.units u ON u.id = m.unit_id
WHERE m.student_id = '<EMI_STUDENT_ID>'
ORDER BY m.matched_at;

-- ── 5. Shift-log unit distribution and dates ─────────────────────────────────
-- CONTEXT ONLY. A shift log is evidence a shift occurred in a unit - it is not
-- proof ASPIRE approved that unit assignment, and nothing may be backfilled
-- from it. The table is student_shift_logs; the shift's unit is the free-text
-- unit_name column (never validated against the assignment), and shift_date is
-- TEXT in YYYY-MM-DD form, so min/max and ORDER BY sort correctly.
SELECT sl.unit_name,
       count(*)            AS shift_count,
       min(sl.shift_date)  AS first_shift,
       max(sl.shift_date)  AS last_shift,
       sum(sl.total_hours) AS total_hours
FROM public.student_shift_logs sl
WHERE sl.student_id = '<EMI_STUDENT_ID>'
GROUP BY sl.unit_name
ORDER BY first_shift;

-- Per-shift detail, if the Owner wants the full timeline:
SELECT sl.shift_date, sl.unit_name, sl.status, sl.is_assigned_unit,
       sl.checked_in_at, sl.checked_out_at, sl.total_hours
FROM public.student_shift_logs sl
WHERE sl.student_id = '<EMI_STUDENT_ID>'
ORDER BY sl.shift_date;

-- ── 6. Existing preceptor assignments ────────────────────────────────────────
-- student_preceptor_assignments carries NO unit column: preceptor authorization
-- infers the unit from matched_unit_id at decision time, which is part of why
-- the second unit is invisible today.
SELECT a.id, a.role, a.status, a.start_date, a.end_date,
       a.preceptor_id, p.full_name AS preceptor_name, p.unit_name AS preceptor_unit,
       a.assigned_by, a.created_at, a.updated_at, a.notes
FROM public.student_preceptor_assignments a
LEFT JOIN public.preceptors p ON p.id = a.preceptor_id
WHERE a.student_id = '<EMI_STUDENT_ID>'
ORDER BY a.created_at;

-- ── 7. Her projection row in the new foundation (AFTER the migration only) ───
-- Immediately after 20260816000000 is applied, expect exactly ONE row: her
-- current matched_unit_id as an active primary, with NULL dates and no actor.
-- Her real PACU + 6 NE history is written only after the Owner confirms the
-- primary unit and the assignment dates.
SELECT a.id, a.unit_id, a.unit_key, a.role, a.status,
       a.start_date, a.end_date, a.assigned_by, a.created_at
FROM public.student_unit_assignments a
WHERE a.student_id = '<EMI_STUDENT_ID>'
ORDER BY a.created_at;
-- =============================================================================
