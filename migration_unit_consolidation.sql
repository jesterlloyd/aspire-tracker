-- ASPIRE Unit Consolidation Migration
-- Renames standalone unit entries to combined names, removes retired units,
-- and updates student preference fields to match.
-- Run in Supabase SQL Editor before deploying.

-- ── Consolidate units table ───────────────────────────────────

UPDATE units SET unit_name = '7NE/7NW', patient_population = 'Orthopedics, Surgical, Trauma', division = 'Surgical'
  WHERE unit_name IN ('7NE', '7NW');

UPDATE units SET unit_name = '3SE/3SW', patient_population = 'Medical Observation Unit, Telemetry', division = 'Medical'
  WHERE unit_name IN ('3SE', '3SW');

UPDATE units SET unit_name = '4SE/4SW', patient_population = 'Medicine, Oncology, PCU, Bone Marrow Transplants', division = 'Medical'
  WHERE unit_name IN ('4SE', '4SW');

UPDATE units SET unit_name = '5SE/5SW', patient_population = 'Medical, PCU', division = 'Medical'
  WHERE unit_name IN ('5SE', '5SW');

UPDATE units SET unit_name = '5NE/5NW', patient_population = 'PCU, Monitored Post Cardiac Cath Care', division = 'Medical'
  WHERE unit_name IN ('5NE', '5NW');

UPDATE units SET unit_name = '6SE/6SW', patient_population = 'Advanced Heart Failure, PCU', division = 'Medical'
  WHERE unit_name IN ('6SE', '6SW');

UPDATE units SET unit_name = '7SE/7SW', patient_population = 'PCU, Generic Medical', division = 'Medical'
  WHERE unit_name IN ('7SE', '7SW');

UPDATE units SET unit_name = 'Alternate Care Units, Clinical Decision Unit & IV Team',
  patient_population = 'Medical/Surgical Overflow, Clinical Decision Unit, IV Team',
  division = 'Surgical'
  WHERE unit_name IN ('ACUs', 'ACU', 'Alternate Care Units');

DELETE FROM units WHERE unit_name IN ('3 South', 'MSCCT', '6SE PFT', 'CMC', '6NE ABG');

-- Fix remaining units' patient_population and division
UPDATE units SET patient_population = 'PCU, Heart Transplant, Lung Transplant, Mechanical Circulatory Support', division = 'Critical Care' WHERE unit_name = '6NE';
UPDATE units SET patient_population = 'PCU, Kidney/Pancreas Transplant, Liver Transplant, Hepatobiliary, Trauma, Thoracic', division = 'Critical Care' WHERE unit_name = '6NW';
UPDATE units SET division = 'Surgical'      WHERE unit_name IN ('8SE','8SW','8NE','8NW');
UPDATE units SET division = 'Medical'       WHERE unit_name = '4NE/4NW';
UPDATE units SET division = 'Critical Care' WHERE unit_name IN ('3SCCT','4SCCT','5SCCT','6SCCT','7SCCT','8SCCT');
UPDATE units SET division = 'Specialty'     WHERE unit_name IN ('Labor and Delivery','PACU','NICU','PICU','Pediatrics','Postpartum','Float Pool','Operating Room','Emergency Department');

UPDATE units SET patient_population = 'General Surgery, Colorectal, Urology, OB/GYN, Plastic Surgery, Gender Affirming, ENT, GYN, Trauma' WHERE unit_name IN ('8SE','8SW');
UPDATE units SET patient_population = 'Neurosurgical, Neuro Step-down, Trauma Step-down'                                                   WHERE unit_name = '8NE';
UPDATE units SET patient_population = 'Spine Surgeries, Trauma, Lumbar Drains'                                                             WHERE unit_name = '8NW';
UPDATE units SET patient_population = 'Monitored, Stroke, Epilepsy, Medical, PCU'                                                          WHERE unit_name = '4NE/4NW';
UPDATE units SET patient_population = 'Medicine Telemetry'                            WHERE unit_name = '3SCCT';
UPDATE units SET patient_population = 'Medicine Cardiac Care Intensive Care Unit'     WHERE unit_name = '4SCCT';
UPDATE units SET patient_population = 'Surgical Trauma Transplant Intensive Care Unit' WHERE unit_name = '5SCCT';
UPDATE units SET patient_population = 'Surgical Cardiac Intensive Care Unit'          WHERE unit_name = '6SCCT';
UPDATE units SET patient_population = 'Medicine Respiratory Intensive Care Unit'      WHERE unit_name = '7SCCT';
UPDATE units SET patient_population = 'Neuroscience Intensive Care Unit'              WHERE unit_name = '8SCCT';
UPDATE units SET patient_population = 'Labor and Delivery'      WHERE unit_name = 'Labor and Delivery';
UPDATE units SET patient_population = 'Post-Anesthesia Care Unit' WHERE unit_name = 'PACU';
UPDATE units SET patient_population = 'Neonatal Intensive Care Unit' WHERE unit_name = 'NICU';
UPDATE units SET patient_population = 'Pediatric Intensive Care Unit' WHERE unit_name = 'PICU';
UPDATE units SET patient_population = 'Pediatrics'   WHERE unit_name = 'Pediatrics';
UPDATE units SET patient_population = 'Postpartum'   WHERE unit_name = 'Postpartum';
UPDATE units SET patient_population = 'Float Pool'   WHERE unit_name = 'Float Pool';
UPDATE units SET patient_population = 'Perioperative Care'       WHERE unit_name = 'Operating Room';
UPDATE units SET patient_population = 'Emergency and Acute Care' WHERE unit_name = 'Emergency Department';

-- ── Update student unit_preference fields ─────────────────────

UPDATE students SET unit_preference_1 = '7NE/7NW' WHERE unit_preference_1 IN ('7NE','7NW');
UPDATE students SET unit_preference_2 = '7NE/7NW' WHERE unit_preference_2 IN ('7NE','7NW');
UPDATE students SET unit_preference_3 = '7NE/7NW' WHERE unit_preference_3 IN ('7NE','7NW');

UPDATE students SET unit_preference_1 = '3SE/3SW' WHERE unit_preference_1 IN ('3SE','3SW');
UPDATE students SET unit_preference_2 = '3SE/3SW' WHERE unit_preference_2 IN ('3SE','3SW');
UPDATE students SET unit_preference_3 = '3SE/3SW' WHERE unit_preference_3 IN ('3SE','3SW');

UPDATE students SET unit_preference_1 = '4SE/4SW' WHERE unit_preference_1 IN ('4SE','4SW');
UPDATE students SET unit_preference_2 = '4SE/4SW' WHERE unit_preference_2 IN ('4SE','4SW');
UPDATE students SET unit_preference_3 = '4SE/4SW' WHERE unit_preference_3 IN ('4SE','4SW');

UPDATE students SET unit_preference_1 = '5SE/5SW' WHERE unit_preference_1 IN ('5SE','5SW');
UPDATE students SET unit_preference_2 = '5SE/5SW' WHERE unit_preference_2 IN ('5SE','5SW');
UPDATE students SET unit_preference_3 = '5SE/5SW' WHERE unit_preference_3 IN ('5SE','5SW');

UPDATE students SET unit_preference_1 = '5NE/5NW' WHERE unit_preference_1 IN ('5NE','5NW');
UPDATE students SET unit_preference_2 = '5NE/5NW' WHERE unit_preference_2 IN ('5NE','5NW');
UPDATE students SET unit_preference_3 = '5NE/5NW' WHERE unit_preference_3 IN ('5NE','5NW');

UPDATE students SET unit_preference_1 = '6SE/6SW' WHERE unit_preference_1 IN ('6SE','6SW');
UPDATE students SET unit_preference_2 = '6SE/6SW' WHERE unit_preference_2 IN ('6SE','6SW');
UPDATE students SET unit_preference_3 = '6SE/6SW' WHERE unit_preference_3 IN ('6SE','6SW');

UPDATE students SET unit_preference_1 = '7SE/7SW' WHERE unit_preference_1 IN ('7SE','7SW');
UPDATE students SET unit_preference_2 = '7SE/7SW' WHERE unit_preference_2 IN ('7SE','7SW');
UPDATE students SET unit_preference_3 = '7SE/7SW' WHERE unit_preference_3 IN ('7SE','7SW');

UPDATE students SET unit_preference_1 = 'Alternate Care Units, Clinical Decision Unit & IV Team' WHERE unit_preference_1 IN ('ACUs','ACU');
UPDATE students SET unit_preference_2 = 'Alternate Care Units, Clinical Decision Unit & IV Team' WHERE unit_preference_2 IN ('ACUs','ACU');
UPDATE students SET unit_preference_3 = 'Alternate Care Units, Clinical Decision Unit & IV Team' WHERE unit_preference_3 IN ('ACUs','ACU');

UPDATE students SET unit_preference_1 = NULL WHERE unit_preference_1 IN ('3 South','MSCCT','6SE PFT','CMC','6NE ABG');
UPDATE students SET unit_preference_2 = NULL WHERE unit_preference_2 IN ('3 South','MSCCT','6SE PFT','CMC','6NE ABG');
UPDATE students SET unit_preference_3 = NULL WHERE unit_preference_3 IN ('3 South','MSCCT','6SE PFT','CMC','6NE ABG');
