-- ASPIRE Unit Names Final Migration
-- Renames all unit records and student preference fields to final spaced format.
-- Run in Supabase SQL Editor before deploying.

-- ── Update units table ────────────────────────────────────────

UPDATE units SET unit_name = '7 NE / 7 NW', patient_population = 'Orthopedics, Surgical, Trauma'
  WHERE unit_name IN ('7NE','7NW','7NE/7NW','7 NE','7 NW');

UPDATE units SET unit_name = '8 SE / 8 SW', patient_population = 'General Surgery'
  WHERE unit_name IN ('8SE','8SW','8SE/8SW','8 SE','8 SW','8SE/SW');

UPDATE units SET unit_name = '8 NE', patient_population = 'Neurosurgical, Neuro Step-down, Trauma Step-down'
  WHERE unit_name IN ('8NE','8 NE');

UPDATE units SET unit_name = '8 NW', patient_population = 'Spine Surgeries, Trauma, Lumbar Drains'
  WHERE unit_name IN ('8NW','8 NW');

UPDATE units SET unit_name = 'Alternate Care Units, Clinical Decision Unit & IV Team', patient_population = ''
  WHERE unit_name IN ('ACUs','ACU','Alternate Care Units','Alternate Care Units, Clinical Decision Unit & IV Team');

UPDATE units SET unit_name = '3 SE / 3 SW', patient_population = 'Medical Observation Unit, Telemetry'
  WHERE unit_name IN ('3SE','3SW','3SE/3SW','3 SE','3 SW');

UPDATE units SET unit_name = '4 SE / 4 SW', patient_population = 'Medicine, Oncology, PCU, Bone Marrow Transplants'
  WHERE unit_name IN ('4SE','4SW','4SE/4SW','4 SE','4 SW');

UPDATE units SET unit_name = '4 NE / 4 NW', patient_population = 'Monitored, Stroke, Epilepsy, Medical, PCU'
  WHERE unit_name IN ('4NE','4NW','4NE/4NW','4NW/4NE','4 NE','4 NW');

UPDATE units SET unit_name = '5 SE / 5 SW', patient_population = 'Medical, PCU, Safety Quad'
  WHERE unit_name IN ('5SE','5SW','5SE/5SW','5 SE','5 SW');

UPDATE units SET unit_name = '5 NE / 5 NW', patient_population = 'PCU, Monitored Post Cardiac Cath Care'
  WHERE unit_name IN ('5NE','5NW','5NE/5NW','5 NE','5 NW');

UPDATE units SET unit_name = '6 SE / 6 SW', patient_population = 'Advanced Heart Failure, PCU'
  WHERE unit_name IN ('6SE','6SW','6SE/6SW','6 SE','6 SW');

UPDATE units SET unit_name = '7 SE / 7 SW', patient_population = 'PCU, General Medical'
  WHERE unit_name IN ('7SE','7SW','7SE/7SW','7 SE','7 SW');

UPDATE units SET unit_name = '6 NE', patient_population = 'PCU, Heart Transplant, Lung Transplant, Mechanical Circulatory Support'
  WHERE unit_name IN ('6NE','6 NE');

UPDATE units SET unit_name = '6 NW', patient_population = 'PCU, Kidney/Pancreas Transplant, Liver Transplant, Hepatobiliary, Trauma, Thoracic'
  WHERE unit_name IN ('6NW','6 NW');

UPDATE units SET unit_name = '3 SCCT', patient_population = 'Medicine Telemetry'
  WHERE unit_name IN ('3SCCT','3 SCCT');

UPDATE units SET unit_name = '4 SCCT', patient_population = 'Medicine Cardiac Care Intensive Care Unit'
  WHERE unit_name IN ('4SCCT','4 SCCT');

UPDATE units SET unit_name = '5 SCCT', patient_population = 'Surgical Trauma Transplant Intensive Care Unit'
  WHERE unit_name IN ('5SCCT','5 SCCT');

UPDATE units SET unit_name = '6 SCCT', patient_population = 'Surgical Cardiac Intensive Care Unit'
  WHERE unit_name IN ('6SCCT','6 SCCT');

UPDATE units SET unit_name = '7 SCCT', patient_population = 'Medicine Respiratory Intensive Care Unit'
  WHERE unit_name IN ('7SCCT','7 SCCT');

UPDATE units SET unit_name = '8 SCCT', patient_population = 'Neuroscience Intensive Care Unit'
  WHERE unit_name IN ('8SCCT','8 SCCT');

UPDATE units SET patient_population = ''
  WHERE unit_name IN ('Labor and Delivery','Pediatrics','Postpartum','Float Pool');

-- ── Update student preference fields ─────────────────────────

UPDATE students SET unit_preference_1 = '7 NE / 7 NW' WHERE unit_preference_1 IN ('7NE','7NW','7NE/7NW');
UPDATE students SET unit_preference_2 = '7 NE / 7 NW' WHERE unit_preference_2 IN ('7NE','7NW','7NE/7NW');
UPDATE students SET unit_preference_3 = '7 NE / 7 NW' WHERE unit_preference_3 IN ('7NE','7NW','7NE/7NW');

UPDATE students SET unit_preference_1 = '8 SE / 8 SW' WHERE unit_preference_1 IN ('8SE','8SW','8SE/8SW');
UPDATE students SET unit_preference_2 = '8 SE / 8 SW' WHERE unit_preference_2 IN ('8SE','8SW','8SE/8SW');
UPDATE students SET unit_preference_3 = '8 SE / 8 SW' WHERE unit_preference_3 IN ('8SE','8SW','8SE/8SW');

UPDATE students SET unit_preference_1 = '8 NE' WHERE unit_preference_1 = '8NE';
UPDATE students SET unit_preference_2 = '8 NE' WHERE unit_preference_2 = '8NE';
UPDATE students SET unit_preference_3 = '8 NE' WHERE unit_preference_3 = '8NE';

UPDATE students SET unit_preference_1 = '8 NW' WHERE unit_preference_1 = '8NW';
UPDATE students SET unit_preference_2 = '8 NW' WHERE unit_preference_2 = '8NW';
UPDATE students SET unit_preference_3 = '8 NW' WHERE unit_preference_3 = '8NW';

UPDATE students SET unit_preference_1 = '3 SE / 3 SW' WHERE unit_preference_1 IN ('3SE','3SW','3SE/3SW');
UPDATE students SET unit_preference_2 = '3 SE / 3 SW' WHERE unit_preference_2 IN ('3SE','3SW','3SE/3SW');
UPDATE students SET unit_preference_3 = '3 SE / 3 SW' WHERE unit_preference_3 IN ('3SE','3SW','3SE/3SW');

UPDATE students SET unit_preference_1 = '4 SE / 4 SW' WHERE unit_preference_1 IN ('4SE','4SW','4SE/4SW');
UPDATE students SET unit_preference_2 = '4 SE / 4 SW' WHERE unit_preference_2 IN ('4SE','4SW','4SE/4SW');
UPDATE students SET unit_preference_3 = '4 SE / 4 SW' WHERE unit_preference_3 IN ('4SE','4SW','4SE/4SW');

UPDATE students SET unit_preference_1 = '4 NE / 4 NW' WHERE unit_preference_1 IN ('4NE','4NW','4NE/4NW','4NW/4NE');
UPDATE students SET unit_preference_2 = '4 NE / 4 NW' WHERE unit_preference_2 IN ('4NE','4NW','4NE/4NW','4NW/4NE');
UPDATE students SET unit_preference_3 = '4 NE / 4 NW' WHERE unit_preference_3 IN ('4NE','4NW','4NE/4NW','4NW/4NE');

UPDATE students SET unit_preference_1 = '5 SE / 5 SW' WHERE unit_preference_1 IN ('5SE','5SW','5SE/5SW');
UPDATE students SET unit_preference_2 = '5 SE / 5 SW' WHERE unit_preference_2 IN ('5SE','5SW','5SE/5SW');
UPDATE students SET unit_preference_3 = '5 SE / 5 SW' WHERE unit_preference_3 IN ('5SE','5SW','5SE/5SW');

UPDATE students SET unit_preference_1 = '5 NE / 5 NW' WHERE unit_preference_1 IN ('5NE','5NW','5NE/5NW');
UPDATE students SET unit_preference_2 = '5 NE / 5 NW' WHERE unit_preference_2 IN ('5NE','5NW','5NE/5NW');
UPDATE students SET unit_preference_3 = '5 NE / 5 NW' WHERE unit_preference_3 IN ('5NE','5NW','5NE/5NW');

UPDATE students SET unit_preference_1 = '6 SE / 6 SW' WHERE unit_preference_1 IN ('6SE','6SW','6SE/6SW');
UPDATE students SET unit_preference_2 = '6 SE / 6 SW' WHERE unit_preference_2 IN ('6SE','6SW','6SE/6SW');
UPDATE students SET unit_preference_3 = '6 SE / 6 SW' WHERE unit_preference_3 IN ('6SE','6SW','6SE/6SW');

UPDATE students SET unit_preference_1 = '7 SE / 7 SW' WHERE unit_preference_1 IN ('7SE','7SW','7SE/7SW');
UPDATE students SET unit_preference_2 = '7 SE / 7 SW' WHERE unit_preference_2 IN ('7SE','7SW','7SE/7SW');
UPDATE students SET unit_preference_3 = '7 SE / 7 SW' WHERE unit_preference_3 IN ('7SE','7SW','7SE/7SW');

UPDATE students SET unit_preference_1 = '6 NE' WHERE unit_preference_1 = '6NE';
UPDATE students SET unit_preference_2 = '6 NE' WHERE unit_preference_2 = '6NE';
UPDATE students SET unit_preference_3 = '6 NE' WHERE unit_preference_3 = '6NE';

UPDATE students SET unit_preference_1 = '6 NW' WHERE unit_preference_1 = '6NW';
UPDATE students SET unit_preference_2 = '6 NW' WHERE unit_preference_2 = '6NW';
UPDATE students SET unit_preference_3 = '6 NW' WHERE unit_preference_3 = '6NW';

UPDATE students SET unit_preference_1 = '3 SCCT' WHERE unit_preference_1 = '3SCCT';
UPDATE students SET unit_preference_2 = '3 SCCT' WHERE unit_preference_2 = '3SCCT';
UPDATE students SET unit_preference_3 = '3 SCCT' WHERE unit_preference_3 = '3SCCT';

UPDATE students SET unit_preference_1 = '4 SCCT' WHERE unit_preference_1 = '4SCCT';
UPDATE students SET unit_preference_2 = '4 SCCT' WHERE unit_preference_2 = '4SCCT';
UPDATE students SET unit_preference_3 = '4 SCCT' WHERE unit_preference_3 = '4SCCT';

UPDATE students SET unit_preference_1 = '5 SCCT' WHERE unit_preference_1 = '5SCCT';
UPDATE students SET unit_preference_2 = '5 SCCT' WHERE unit_preference_2 = '5SCCT';
UPDATE students SET unit_preference_3 = '5 SCCT' WHERE unit_preference_3 = '5SCCT';

UPDATE students SET unit_preference_1 = '6 SCCT' WHERE unit_preference_1 = '6SCCT';
UPDATE students SET unit_preference_2 = '6 SCCT' WHERE unit_preference_2 = '6SCCT';
UPDATE students SET unit_preference_3 = '6 SCCT' WHERE unit_preference_3 = '6SCCT';

UPDATE students SET unit_preference_1 = '7 SCCT' WHERE unit_preference_1 = '7SCCT';
UPDATE students SET unit_preference_2 = '7 SCCT' WHERE unit_preference_2 = '7SCCT';
UPDATE students SET unit_preference_3 = '7 SCCT' WHERE unit_preference_3 = '7SCCT';

UPDATE students SET unit_preference_1 = '8 SCCT' WHERE unit_preference_1 = '8SCCT';
UPDATE students SET unit_preference_2 = '8 SCCT' WHERE unit_preference_2 = '8SCCT';
UPDATE students SET unit_preference_3 = '8 SCCT' WHERE unit_preference_3 = '8SCCT';

UPDATE students SET unit_preference_1 = 'Alternate Care Units, Clinical Decision Unit & IV Team'
  WHERE unit_preference_1 IN ('ACUs','ACU');
UPDATE students SET unit_preference_2 = 'Alternate Care Units, Clinical Decision Unit & IV Team'
  WHERE unit_preference_2 IN ('ACUs','ACU');
UPDATE students SET unit_preference_3 = 'Alternate Care Units, Clinical Decision Unit & IV Team'
  WHERE unit_preference_3 IN ('ACUs','ACU');
