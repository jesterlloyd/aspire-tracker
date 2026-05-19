-- ============================================
-- DATA ERROR RECOVERY: UUIDs in unit_preference fields
-- ============================================
-- Two UUIDs were found in unit_preference_1. Try to resolve them
-- to a unit_name from the units table before nulling.

UPDATE students s
SET unit_preference_1 = u.unit_name
FROM units u
WHERE s.unit_preference_1 = u.id::text;

UPDATE students s
SET unit_preference_2 = u.unit_name
FROM units u
WHERE s.unit_preference_2 = u.id::text;

UPDATE students s
SET unit_preference_3 = u.unit_name
FROM units u
WHERE s.unit_preference_3 = u.id::text;

-- Anything still UUID-shaped after the lookup is a true error: NULL it
UPDATE students SET unit_preference_1 = NULL
  WHERE unit_preference_1 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
UPDATE students SET unit_preference_2 = NULL
  WHERE unit_preference_2 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
UPDATE students SET unit_preference_3 = NULL
  WHERE unit_preference_3 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- ============================================
-- CANONICALIZE: students.unit_preference_*
-- ============================================

-- Slash zone-style → floor-style canonical names
UPDATE students SET unit_preference_1 = '4 North' WHERE unit_preference_1 = '4 NE / 4 NW';
UPDATE students SET unit_preference_2 = '4 North' WHERE unit_preference_2 = '4 NE / 4 NW';
UPDATE students SET unit_preference_3 = '4 North' WHERE unit_preference_3 = '4 NE / 4 NW';

UPDATE students SET unit_preference_1 = '4 South' WHERE unit_preference_1 = '4 SE / 4 SW';
UPDATE students SET unit_preference_2 = '4 South' WHERE unit_preference_2 = '4 SE / 4 SW';
UPDATE students SET unit_preference_3 = '4 South' WHERE unit_preference_3 = '4 SE / 4 SW';

UPDATE students SET unit_preference_1 = '5 North' WHERE unit_preference_1 = '5 NE / 5 NW';
UPDATE students SET unit_preference_2 = '5 North' WHERE unit_preference_2 = '5 NE / 5 NW';
UPDATE students SET unit_preference_3 = '5 North' WHERE unit_preference_3 = '5 NE / 5 NW';

UPDATE students SET unit_preference_1 = '5 South' WHERE unit_preference_1 = '5 SE / 5 SW';
UPDATE students SET unit_preference_2 = '5 South' WHERE unit_preference_2 = '5 SE / 5 SW';
UPDATE students SET unit_preference_3 = '5 South' WHERE unit_preference_3 = '5 SE / 5 SW';

UPDATE students SET unit_preference_1 = '6 South' WHERE unit_preference_1 = '6 SE / 6 SW';
UPDATE students SET unit_preference_2 = '6 South' WHERE unit_preference_2 = '6 SE / 6 SW';
UPDATE students SET unit_preference_3 = '6 South' WHERE unit_preference_3 = '6 SE / 6 SW';

UPDATE students SET unit_preference_1 = '7 North' WHERE unit_preference_1 = '7 NE / 7 NW';
UPDATE students SET unit_preference_2 = '7 North' WHERE unit_preference_2 = '7 NE / 7 NW';
UPDATE students SET unit_preference_3 = '7 North' WHERE unit_preference_3 = '7 NE / 7 NW';

UPDATE students SET unit_preference_1 = '7 South' WHERE unit_preference_1 = '7 SE / 7 SW';
UPDATE students SET unit_preference_2 = '7 South' WHERE unit_preference_2 = '7 SE / 7 SW';
UPDATE students SET unit_preference_3 = '7 South' WHERE unit_preference_3 = '7 SE / 7 SW';

UPDATE students SET unit_preference_1 = '8 North' WHERE unit_preference_1 = '8 NE';
UPDATE students SET unit_preference_2 = '8 North' WHERE unit_preference_2 = '8 NE';
UPDATE students SET unit_preference_3 = '8 North' WHERE unit_preference_3 = '8 NE';

UPDATE students SET unit_preference_1 = '8 North' WHERE unit_preference_1 = '8 NW';
UPDATE students SET unit_preference_2 = '8 North' WHERE unit_preference_2 = '8 NW';
UPDATE students SET unit_preference_3 = '8 North' WHERE unit_preference_3 = '8 NW';

UPDATE students SET unit_preference_1 = '8 South' WHERE unit_preference_1 = '8 SE / 8 SW';
UPDATE students SET unit_preference_2 = '8 South' WHERE unit_preference_2 = '8 SE / 8 SW';
UPDATE students SET unit_preference_3 = '8 South' WHERE unit_preference_3 = '8 SE / 8 SW';

-- Single-zone → floor-style
UPDATE students SET unit_preference_1 = '6 North' WHERE unit_preference_1 IN ('6 NE', '6 NW');
UPDATE students SET unit_preference_2 = '6 North' WHERE unit_preference_2 IN ('6 NE', '6 NW');
UPDATE students SET unit_preference_3 = '6 North' WHERE unit_preference_3 IN ('6 NE', '6 NW');

-- Spelling normalization
UPDATE students SET unit_preference_1 = 'Labor & Delivery' WHERE unit_preference_1 = 'Labor and Delivery';
UPDATE students SET unit_preference_2 = 'Labor & Delivery' WHERE unit_preference_2 = 'Labor and Delivery';
UPDATE students SET unit_preference_3 = 'Labor & Delivery' WHERE unit_preference_3 = 'Labor and Delivery';

-- ACU legacy names
UPDATE students SET unit_preference_1 = 'ACU/CDU' WHERE unit_preference_1 = 'Alternate Care Units, Clinical Decision Unit & IV Team';
UPDATE students SET unit_preference_2 = 'ACU/CDU' WHERE unit_preference_2 = 'Alternate Care Units, Clinical Decision Unit & IV Team';
UPDATE students SET unit_preference_3 = 'ACU/CDU' WHERE unit_preference_3 = 'Alternate Care Units, Clinical Decision Unit & IV Team';

-- ============================================
-- CANONICALIZE: student_shift_logs.unit_name
-- ============================================

UPDATE student_shift_logs SET unit_name = '4 North' WHERE unit_name = '4 NE / 4 NW';
UPDATE student_shift_logs SET unit_name = '4 South' WHERE unit_name = '4 SE / 4 SW';
UPDATE student_shift_logs SET unit_name = '5 North' WHERE unit_name = '5 NE / 5 NW';
UPDATE student_shift_logs SET unit_name = '5 South' WHERE unit_name = '5 SE / 5 SW';
UPDATE student_shift_logs SET unit_name = '6 South' WHERE unit_name = '6 SE / 6 SW';
UPDATE student_shift_logs SET unit_name = '7 North' WHERE unit_name = '7 NE / 7 NW';
UPDATE student_shift_logs SET unit_name = '7 South' WHERE unit_name = '7 SE / 7 SW';
UPDATE student_shift_logs SET unit_name = '8 South' WHERE unit_name = '8 SE / 8 SW';
UPDATE student_shift_logs SET unit_name = '6 North' WHERE unit_name IN ('6 NE', '6 NW');
UPDATE student_shift_logs SET unit_name = '8 North' WHERE unit_name IN ('8 NE', '8 NW');
UPDATE student_shift_logs SET unit_name = 'Labor & Delivery' WHERE unit_name = 'Labor and Delivery';
UPDATE student_shift_logs SET unit_name = 'ACU/CDU' WHERE unit_name = 'Alternate Care Units, Clinical Decision Unit & IV Team';

-- ============================================
-- CANONICALIZE: units.unit_name
-- ============================================
-- SAFETY CHECK: run this SELECT first. If it returns rows, STOP and report to Jester
-- before running the UPDATEs below — it means both a legacy and canonical name exist
-- in the same cohort and a straight rename would create a duplicate.

SELECT cohort_id, COUNT(DISTINCT unit_name) AS variants, ARRAY_AGG(DISTINCT unit_name) AS names
FROM units
WHERE unit_name IN (
  '4 NE / 4 NW', '4 North', '4 SE / 4 SW', '4 South',
  '5 NE / 5 NW', '5 North', '5 SE / 5 SW', '5 South',
  '6 SE / 6 SW', '6 South', '7 NE / 7 NW', '7 North',
  '7 SE / 7 SW', '7 South', '8 SE / 8 SW', '8 South',
  '6 NE', '6 NW', '6 North', '8 NE', '8 NW', '8 North',
  'Labor and Delivery', 'Labor & Delivery',
  'Alternate Care Units, Clinical Decision Unit & IV Team', 'ACU/CDU'
)
GROUP BY cohort_id
HAVING COUNT(DISTINCT unit_name) > 1;

-- If the above returns ZERO rows, continue:

UPDATE units SET unit_name = '4 North' WHERE unit_name = '4 NE / 4 NW';
UPDATE units SET unit_name = '4 South' WHERE unit_name = '4 SE / 4 SW';
UPDATE units SET unit_name = '5 North' WHERE unit_name = '5 NE / 5 NW';
UPDATE units SET unit_name = '5 South' WHERE unit_name = '5 SE / 5 SW';
UPDATE units SET unit_name = '6 South' WHERE unit_name = '6 SE / 6 SW';
UPDATE units SET unit_name = '7 North' WHERE unit_name = '7 NE / 7 NW';
UPDATE units SET unit_name = '7 South' WHERE unit_name = '7 SE / 7 SW';
UPDATE units SET unit_name = '8 South' WHERE unit_name = '8 SE / 8 SW';
UPDATE units SET unit_name = '6 North' WHERE unit_name IN ('6 NE', '6 NW');
UPDATE units SET unit_name = '8 North' WHERE unit_name IN ('8 NE', '8 NW');
UPDATE units SET unit_name = 'Labor & Delivery' WHERE unit_name = 'Labor and Delivery';
UPDATE units SET unit_name = 'ACU/CDU' WHERE unit_name = 'Alternate Care Units, Clinical Decision Unit & IV Team';

-- Also update unit_cohort_responses.unit_name to match
UPDATE unit_cohort_responses SET unit_name = '4 North' WHERE unit_name = '4 NE / 4 NW';
UPDATE unit_cohort_responses SET unit_name = '4 South' WHERE unit_name = '4 SE / 4 SW';
UPDATE unit_cohort_responses SET unit_name = '5 North' WHERE unit_name = '5 NE / 5 NW';
UPDATE unit_cohort_responses SET unit_name = '5 South' WHERE unit_name = '5 SE / 5 SW';
UPDATE unit_cohort_responses SET unit_name = '6 South' WHERE unit_name = '6 SE / 6 SW';
UPDATE unit_cohort_responses SET unit_name = '7 North' WHERE unit_name = '7 NE / 7 NW';
UPDATE unit_cohort_responses SET unit_name = '7 South' WHERE unit_name = '7 SE / 7 SW';
UPDATE unit_cohort_responses SET unit_name = '8 South' WHERE unit_name = '8 SE / 8 SW';
UPDATE unit_cohort_responses SET unit_name = '6 North' WHERE unit_name IN ('6 NE', '6 NW');
UPDATE unit_cohort_responses SET unit_name = '8 North' WHERE unit_name IN ('8 NE', '8 NW');
UPDATE unit_cohort_responses SET unit_name = 'Labor & Delivery' WHERE unit_name = 'Labor and Delivery';
UPDATE unit_cohort_responses SET unit_name = 'ACU/CDU' WHERE unit_name = 'Alternate Care Units, Clinical Decision Unit & IV Team';

-- ============================================
-- POST-MIGRATION VERIFICATION
-- ============================================

-- Should return zero orphans after seeding unit_leaders
SELECT DISTINCT ul.unit_name AS orphan_leader_unit
FROM unit_leaders ul
LEFT JOIN units u ON LOWER(TRIM(u.unit_name)) = LOWER(TRIM(ul.unit_name))
WHERE u.id IS NULL;

-- Should show only canonical names
SELECT DISTINCT unit_name FROM units WHERE unit_name IS NOT NULL ORDER BY unit_name;

-- Confirm clean student preference data (should return zero rows if all canonical)
SELECT DISTINCT unit_preference_1 FROM students
WHERE unit_preference_1 IS NOT NULL
  AND unit_preference_1 NOT IN (
    'ACU/CDU', 'Emergency Department', 'Float Pool', 'Labor & Delivery', 'NICU',
    'Operating Room', 'PACU', 'Pediatrics', 'PICU',
    '3 North', '3 SCCT', '3 South Short Stay',
    '4 North', '4 SCCT', '4 South',
    '5 North', '5 SCCT', '5 South',
    '6 North', '6 SCCT', '6 South',
    '7 North', '7 SCCT', '7 South',
    '8 North', '8 SCCT', '8 South'
  );
