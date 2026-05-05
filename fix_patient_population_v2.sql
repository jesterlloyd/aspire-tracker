-- Sets patient_population using ILIKE for case-insensitive, partial matching.
-- Covers units that may have been entered with slight name variations.
-- Run in Supabase SQL Editor before deploying.

UPDATE units SET patient_population = 'Orthopedics, Surgical, Trauma'
  WHERE unit_name ILIKE '%7NE%' OR unit_name ILIKE '%7NW%';
UPDATE units SET patient_population = 'General Surgery, Colorectal, Urology, OB/GYN, Plastic Surgery, Gender Affirming, ENT, GYN, Trauma'
  WHERE unit_name ILIKE '%8SE%' OR unit_name ILIKE '%8SW%';
UPDATE units SET patient_population = 'Neurosurgical, Neuro Step-down, Trauma Step-down'
  WHERE unit_name ILIKE '%8NE%';
UPDATE units SET patient_population = 'Spine Surgeries, Trauma, Lumbar Drains'
  WHERE unit_name ILIKE '%8NW%';
UPDATE units SET patient_population = 'Medical/Surgical Unit Overflow'
  WHERE unit_name ILIKE '%ACU%';
UPDATE units SET patient_population = 'Medical Observation Unit, Telemetry'
  WHERE unit_name ILIKE '%3SE%' OR unit_name ILIKE '%3SW%';
UPDATE units SET patient_population = 'Medicine, Oncology, PCU, Bone Marrow Transplants'
  WHERE unit_name ILIKE '%4SE%' OR unit_name ILIKE '%4SW%';
UPDATE units SET patient_population = 'Monitored, Stroke, Epilepsy, Medical, PCU'
  WHERE unit_name ILIKE '%4NE%' OR unit_name ILIKE '%4NW%';
UPDATE units SET patient_population = 'Medical, PCU'
  WHERE unit_name ILIKE '%5SE%';
UPDATE units SET patient_population = 'Medicine, PCU, Safety Quad'
  WHERE unit_name ILIKE '%5SW%';
UPDATE units SET patient_population = 'PCU, Monitored Post Cardiac Cath Care'
  WHERE unit_name ILIKE '%5NE%' OR unit_name ILIKE '%5NW%';
UPDATE units SET patient_population = 'Advanced Heart Failure, PCU'
  WHERE unit_name ILIKE '%6SE%' OR unit_name ILIKE '%6SW%';
UPDATE units SET patient_population = 'PCU, Generic Medical, Diabetes'
  WHERE unit_name ILIKE '%7SE%';
UPDATE units SET patient_population = 'PCU, Generic Medical, Surgery Overflow'
  WHERE unit_name ILIKE '%7SW%';
UPDATE units SET patient_population = 'PCU, Heart Transplant, Lung Transplant, Mechanical Circulatory Support'
  WHERE unit_name ILIKE '%6NE%';
UPDATE units SET patient_population = 'PCU, Kidney/Pancreas Transplant, Liver Transplant, Hepatobiliary, Trauma, Thoracic'
  WHERE unit_name ILIKE '%6NW%';
UPDATE units SET patient_population = 'Medicine Telemetry'
  WHERE unit_name ILIKE '%3SCCT%';
UPDATE units SET patient_population = 'Medicine Cardiac Care Intensive Care Unit'
  WHERE unit_name ILIKE '%4SCCT%';
UPDATE units SET patient_population = 'Surgical Trauma Transplant Intensive Care Unit'
  WHERE unit_name ILIKE '%5SCCT%';
UPDATE units SET patient_population = 'Surgical Cardiac Intensive Care Unit'
  WHERE unit_name ILIKE '%6SCCT%';
UPDATE units SET patient_population = 'Medicine Respiratory Intensive Care Unit'
  WHERE unit_name ILIKE '%7SCCT%';
UPDATE units SET patient_population = 'Neuroscience Intensive Care Unit'
  WHERE unit_name ILIKE '%8SCCT%';
UPDATE units SET patient_population = 'Monitored'
  WHERE unit_name ILIKE '%CMC%';
UPDATE units SET patient_population = 'Respiratory Therapy Department'
  WHERE unit_name ILIKE '%MSCCT%';
UPDATE units SET patient_population = 'Pulmonary Function Lab'
  WHERE unit_name ILIKE '%PFT%';
UPDATE units SET patient_population = 'Arterial Blood Gas Lab'
  WHERE unit_name ILIKE '%ABG%';
UPDATE units SET patient_population = 'Labor and Delivery'
  WHERE unit_name ILIKE '%labor%' OR unit_name ILIKE '%delivery%' OR unit_name ILIKE '%L&D%';
UPDATE units SET patient_population = 'Post-Anesthesia Care Unit'
  WHERE unit_name ILIKE '%PACU%';
UPDATE units SET patient_population = 'Neonatal Intensive Care Unit'
  WHERE unit_name ILIKE '%NICU%';
UPDATE units SET patient_population = 'Pediatric Intensive Care Unit'
  WHERE unit_name ILIKE '%PICU%';
UPDATE units SET patient_population = 'Pediatrics'
  WHERE unit_name ILIKE '%pediatric%' AND unit_name NOT ILIKE '%PICU%';
UPDATE units SET patient_population = 'Postpartum'
  WHERE unit_name ILIKE '%postpartum%';
UPDATE units SET patient_population = 'Medical/Surgical'
  WHERE unit_name ILIKE '%3 south%';
UPDATE units SET patient_population = 'Float Pool'
  WHERE unit_name ILIKE '%float%';
