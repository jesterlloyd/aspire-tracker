# AP School Canonicalization and Placement-Request Confirmation (AP-SCHOOL-CANONICALIZATION-1)

One connected Academic Partner defect, fixed together on branch
`fix-ap-school-canonicalization-and-email`. REVISED 2026-07-31 against the verified production
schema: `public.schools` does NOT exist and `students.school_id` does NOT exist (the phase-4 school
catalog migration is not applied in production), so the fix uses the repository's STATIC school
identity source and no new database objects. The SQL below is OWNER-GATED and has NOT been run.

## Root cause

A placement request IS a students row, and At a Glance groups Placement Requests by the
`students.school` string. The two submission paths persisted different strings for the same school:

- The public `/school-form` submits the school's OPERATIVE display name (`Cal State Northridge`,
  the value every historical row uses).
- The Academic Partner portal locks the coordinator's school to their scope key
  (`PlacementRequestsView.jsx`: `school: schoolKey`), the CANONICAL name
  (`California State University, Northridge`).
- `performSchoolPlacementUpsert` persisted whichever string arrived, verbatim, into BOTH
  `students.school` and `cohort_school_rotations.school_name` (the rotation upsert conflicts on
  `(cohort_id, school_name)`, so the two spellings also created two rotation rows).

The confirmation email compounded it: both paths fired `form_received`, whose copy is
student-application language - false for a coordinator-submitted placement request.

## Confirmed affected records (production-verified)

- Cohort: Fall 2026 `eedd91ec-ad6f-4df8-aa20-5c06b2889011`
- Keeper rotation `1b133a71-4f29-40c7-97d1-ad529b91830a` - school `Cal State Northridge`, used by
  the 10 historical CSUN students, carries the richer school-wide scheduling notes.
- Duplicate rotation `ba77268c-f09a-4010-9ef4-2920555f01e0` - school
  `California State University, Northridge`, used only by Alexander Lim, no scheduling notes.
- Affected student: `77aae540-5158-488b-b052-69bd07e7b3b8` Alexander Lim.
- The only reference to `cohort_school_rotations.id` is `students.cohort_school_rotation_id`
  (`ON DELETE SET NULL`).

## The fix (code, this branch)

- `src/lib/schoolIdentity.js`: the static identity catalog - the existing
  `api/lib/schoolAliases.js` vocabulary (parity-tested, same canonical + alias set) plus each
  school's OPERATIVE display identity. `resolveOperativeSchoolName` matches any known variant
  (canonical, operative, alias; case- and punctuation-insensitive, exact-normalized, never fuzzy).
  Campus identities (WCU North Hollywood vs Anaheim) stay distinct.
- `performSchoolPlacementUpsert` resolves once per write and persists ONLY the operative name into
  `students.school` and `cohort_school_rotations.school_name` (both submission paths share it).
  No `school_id`, no FK, no migration, no database catalog.
- The AP endpoint fails closed (`422 unknown_school`) BEFORE any write: Academic Partner
  submissions can never persist free-text school names. The public form degrades to the raw string
  only for schools not in the catalog.
- At a Glance groups Placement Requests through `schoolGroupKey` (alias-aware) as a DEFENSIVE
  safeguard, so even a stray stored variant can never render a second group. Unknown strings group
  by exactly what was stored.
- `placement_request_received` notification (Owner-approved copy) replaces `form_received` for both
  submit paths: placement-request language to the SUBMITTING coordinator plus the internal team,
  Program row only when present, localized timestamp, `aspire@cshs.org`, approved signature. There is
  no student variant - a placement request never emails the student. `form_received` remains
  registered only for notification-log archive reconstruction; its recipient resolver was removed,
  so it can never send again.
- Distinct events preserved: Academic Partner placement request (coordinator event, this email),
  Student Profile Form submission (student intake flow, untouched), and application/interview
  progression (staff workflows, untouched).

## Read-only diagnostics (run first; no writes; actual schema only)

```sql
-- D1. Full split audit: every distinct students.school value, with cohort and counts.
SELECT s.school, c.name AS cohort, COUNT(*) AS students
FROM public.students s
LEFT JOIN public.cohorts c ON c.id = s.cohort_id
GROUP BY s.school, c.name
ORDER BY s.school, c.name;

-- D2. school strings outside the known operative identities (the app's write/display identity
--     list from src/lib/schoolIdentity.js). Anything listed here either needs a catalog entry or
--     is a variant to merge.
SELECT DISTINCT s.school, COUNT(*) OVER (PARTITION BY s.school) AS students
FROM public.students s
WHERE coalesce(s.school, '') NOT IN (
  'Azusa Pacific University', 'Cal State Long Beach', 'Cal State LA', 'Cal State Northridge',
  'UCLA', 'West Coast University', 'West Coast University North Hollywood',
  'West Coast University Anaheim'
)
ORDER BY s.school;

-- D3. The confirmed CSUN records, by id.
SELECT id, name, school, cohort_id, cohort_school_rotation_id, status,
       school_coordinator_email, submitted_via, placement_request_last_source, created_at
FROM public.students
WHERE school IN ('Cal State Northridge', 'California State University, Northridge')
ORDER BY school, created_at;

-- D4. The two CSUN rotation rows (keeper + duplicate).
SELECT id, cohort_id, school_name, coordinator_name, coordinator_email,
       rotation_start_date, rotation_end_date, scheduling_notes IS NOT NULL AS has_notes, updated_at
FROM public.cohort_school_rotations
WHERE id IN ('1b133a71-4f29-40c7-97d1-ad529b91830a', 'ba77268c-f09a-4010-9ef4-2920555f01e0')
   OR school_name IN ('Cal State Northridge', 'California State University, Northridge')
ORDER BY cohort_id, school_name;

-- D5. Other coordinators at the same risk: rotation rows whose school_name is not an operative
--     identity (would group apart from historical rows).
SELECT r.school_name, r.coordinator_email, COUNT(*) AS rows
FROM public.cohort_school_rotations r
WHERE r.school_name NOT IN (
  'Azusa Pacific University', 'Cal State Long Beach', 'Cal State LA', 'Cal State Northridge',
  'UCLA', 'West Coast University', 'West Coast University North Hollywood',
  'West Coast University Anaheim'
)
GROUP BY r.school_name, r.coordinator_email
ORDER BY r.school_name;
```

## Owner-gated merge SQL (single transaction; idempotent; NOT run)

Uses the confirmed row ids. The keeper's richer scheduling notes are deliberately left untouched
(the duplicate carries none). Safe to re-run: every statement is a no-op once merged.

```sql
BEGIN;

-- 1. Repoint any student on the duplicate rotation row (currently exactly Alexander Lim,
--    77aae540-5158-488b-b052-69bd07e7b3b8) to the keeper row.
UPDATE public.students
SET cohort_school_rotation_id = '1b133a71-4f29-40c7-97d1-ad529b91830a'
WHERE cohort_school_rotation_id = 'ba77268c-f09a-4010-9ef4-2920555f01e0';

-- 2. Normalize the school string for every student still carrying the long-name variant.
UPDATE public.students
SET school = 'Cal State Northridge'
WHERE school = 'California State University, Northridge';

-- 3. Delete the duplicate rotation row (links repointed in step 1, so ON DELETE SET NULL has
--    nothing to null; the keeper and its scheduling notes are untouched).
DELETE FROM public.cohort_school_rotations
WHERE id = 'ba77268c-f09a-4010-9ef4-2920555f01e0'
  AND school_name = 'California State University, Northridge';

-- 4. Postconditions: abort the whole transaction unless the merge is complete and consistent.
DO $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM public.students
    WHERE school = 'California State University, Northridge';
  IF bad > 0 THEN RAISE EXCEPTION 'postcondition: % students still on the long name', bad; END IF;

  SELECT count(*) INTO bad FROM public.cohort_school_rotations
    WHERE school_name = 'California State University, Northridge';
  IF bad > 0 THEN RAISE EXCEPTION 'postcondition: % rotation rows still on the long name', bad; END IF;

  SELECT count(*) INTO bad FROM public.students
    WHERE id = '77aae540-5158-488b-b052-69bd07e7b3b8'
      AND school = 'Cal State Northridge'
      AND cohort_school_rotation_id = '1b133a71-4f29-40c7-97d1-ad529b91830a';
  IF bad <> 1 THEN RAISE EXCEPTION 'postcondition: Alexander Lim not merged onto the keeper row'; END IF;

  SELECT count(*) INTO bad
  FROM public.students s
  WHERE s.cohort_id = 'eedd91ec-ad6f-4df8-aa20-5c06b2889011'
    AND s.cohort_school_rotation_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.cohort_school_rotations r WHERE r.id = s.cohort_school_rotation_id);
  IF bad > 0 THEN RAISE EXCEPTION 'postcondition: % students point at a missing rotation row', bad; END IF;
END $$;

COMMIT;
```

If D2/D5 reveal further splits at other schools, apply the same pattern per school (repoint links
to the keeper row, normalize the string, delete the duplicate) after Owner review of that school's
diagnostics. Do not generalize into one blanket statement.
