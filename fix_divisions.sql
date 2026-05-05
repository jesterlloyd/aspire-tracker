-- Adds a 'division' column to the units table and sets the correct
-- division for every existing unit by name.
-- Run in Supabase SQL Editor before deploying.

ALTER TABLE units ADD COLUMN IF NOT EXISTS division TEXT DEFAULT '';

UPDATE units SET division = 'Surgical'
  WHERE unit_name IN ('7NE','7NW','8SE','8SW','8NE','8NW','ACUs');

UPDATE units SET division = 'Medical'
  WHERE unit_name IN ('3SE','3SW','4SE','4SW','4NE/4NW','5SE','5SW','5NE','5NW','6SE','6SW','7SE','7SW');

UPDATE units SET division = 'Critical Care'
  WHERE unit_name IN ('6NE','6NW','3SCCT','4SCCT','5SCCT','6SCCT','7SCCT','8SCCT','CMC','MSCCT','6SE PFT','6NE ABG');

UPDATE units SET division = 'Specialty'
  WHERE unit_name IN ('Labor and Delivery','PACU','NICU','PICU','Pediatrics','Postpartum','3 South','Float Pool');
