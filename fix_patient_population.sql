-- Sets patient_population on all unit rows by unit_name.
-- Covers every cohort - runs against all rows regardless of cohort_id.
-- Run in Supabase SQL Editor before deploying.

UPDATE units SET patient_population = 'Orthopedics, Surgical, Trauma'
  WHERE unit_name IN ('7NE','7NW');
UPDATE units SET patient_population = 'General Surgery, Colorectal, Urology, OB/GYN, Plastic Surgery, Gender Affirming, ENT, GYN, Trauma'
  WHERE unit_name IN ('8SE','8SW');
UPDATE units SET patient_population = 'Neurosurgical, Neuro Step-down, Trauma Step-down'
  WHERE unit_name = '8NE';
UPDATE units SET patient_population = 'Spine Surgeries, Trauma, Lumbar Drains'
  WHERE unit_name = '8NW';
UPDATE units SET patient_population = 'Medical/Surgical Unit Overflow'
  WHERE unit_name = 'ACUs';
UPDATE units SET patient_population = 'Medical Observation Unit, Telemetry'
  WHERE unit_name IN ('3SE','3SW');
UPDATE units SET patient_population = 'Medicine, Oncology, PCU, Bone Marrow Transplants'
  WHERE unit_name IN ('4SE','4SW');
UPDATE units SET patient_population = 'Monitored, Stroke, Epilepsy, Medical, PCU'
  WHERE unit_name = '4NE/4NW';
UPDATE units SET patient_population = 'Medical, PCU'
  WHERE unit_name = '5SE';
UPDATE units SET patient_population = 'Medicine, PCU, Safety Quad'
  WHERE unit_name = '5SW';
UPDATE units SET patient_population = 'PCU, Monitored Post Cardiac Cath Care'
  WHERE unit_name IN ('5NE','5NW');
UPDATE units SET patient_population = 'Advanced Heart Failure, PCU'
  WHERE unit_name IN ('6SE','6SW');
UPDATE units SET patient_population = 'PCU, Generic Medical, Diabetes'
  WHERE unit_name = '7SE';
UPDATE units SET patient_population = 'PCU, Generic Medical, Surgery Overflow'
  WHERE unit_name = '7SW';
UPDATE units SET patient_population = 'PCU, Heart Transplant, Lung Transplant, Mechanical Circulatory Support'
  WHERE unit_name = '6NE';
UPDATE units SET patient_population = 'PCU, Kidney/Pancreas Transplant, Liver Transplant, Hepatobiliary, Trauma, Thoracic'
  WHERE unit_name = '6NW';
UPDATE units SET patient_population = 'Medicine Telemetry'
  WHERE unit_name = '3SCCT';
UPDATE units SET patient_population = 'Medicine Cardiac Care Intensive Care Unit'
  WHERE unit_name = '4SCCT';
UPDATE units SET patient_population = 'Surgical Trauma Transplant Intensive Care Unit'
  WHERE unit_name = '5SCCT';
UPDATE units SET patient_population = 'Surgical Cardiac Intensive Care Unit'
  WHERE unit_name = '6SCCT';
UPDATE units SET patient_population = 'Medicine Respiratory Intensive Care Unit'
  WHERE unit_name = '7SCCT';
UPDATE units SET patient_population = 'Neuroscience Intensive Care Unit'
  WHERE unit_name = '8SCCT';
UPDATE units SET patient_population = 'Monitored'
  WHERE unit_name = 'CMC';
UPDATE units SET patient_population = 'Respiratory Therapy Department'
  WHERE unit_name = 'MSCCT';
UPDATE units SET patient_population = 'Pulmonary Function Lab'
  WHERE unit_name = '6SE PFT';
UPDATE units SET patient_population = 'Arterial Blood Gas Lab'
  WHERE unit_name = '6NE ABG';
UPDATE units SET patient_population = 'Labor and Delivery'
  WHERE unit_name = 'Labor and Delivery';
UPDATE units SET patient_population = 'Post-Anesthesia Care Unit'
  WHERE unit_name = 'PACU';
UPDATE units SET patient_population = 'Neonatal Intensive Care Unit'
  WHERE unit_name = 'NICU';
UPDATE units SET patient_population = 'Pediatric Intensive Care Unit'
  WHERE unit_name = 'PICU';
UPDATE units SET patient_population = 'Pediatrics'
  WHERE unit_name = 'Pediatrics';
UPDATE units SET patient_population = 'Postpartum'
  WHERE unit_name = 'Postpartum';
UPDATE units SET patient_population = 'Medical/Surgical'
  WHERE unit_name = '3 South';
UPDATE units SET patient_population = 'Float Pool'
  WHERE unit_name = 'Float Pool';
