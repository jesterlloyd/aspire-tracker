-- ASPIRE Program Tracker — Combined Migration
-- Run in Supabase SQL Editor before deploying.

-- Add patient_population to units
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS patient_population TEXT DEFAULT '';

-- Add cumulative_gpa and interest_statement to students
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS cumulative_gpa    DECIMAL(3,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS interest_statement TEXT         DEFAULT '';
