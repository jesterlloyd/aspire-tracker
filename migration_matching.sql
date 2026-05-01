-- =====================================================================
-- ASPIRE Placement Tracker — Matching Feature Migration
-- Run this entire file in your Supabase SQL Editor
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. Create units table FIRST (students FK references it)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS units (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_name TEXT NOT NULL DEFAULT '',
  contact_person TEXT DEFAULT '',
  total_slots INTEGER DEFAULT 0,
  slots_remaining INTEGER DEFAULT 0,
  shift_preference TEXT DEFAULT '',
  preceptors TEXT DEFAULT '',
  considerations TEXT DEFAULT '',
  is_participating BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON units;
CREATE POLICY "anon_all" ON units FOR ALL TO anon USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Create matches table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
  preceptor_assigned TEXT DEFAULT '',
  shift_assigned TEXT DEFAULT '',
  matched_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT DEFAULT ''
);

ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON matches;
CREATE POLICY "anon_all" ON matches FOR ALL TO anon USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Alter students table — add matching columns
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE students ADD COLUMN IF NOT EXISTS interview_outcome TEXT DEFAULT 'Pending Interview';
ALTER TABLE students ADD COLUMN IF NOT EXISTS unit_preference_1 TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS unit_preference_2 TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS unit_preference_3 TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS matched_unit_id UUID DEFAULT NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS matched_preceptor TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS shift_availability TEXT DEFAULT '';

-- Add FK constraint safely (skips if already exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_matched_unit_id_fkey'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_matched_unit_id_fkey
      FOREIGN KEY (matched_unit_id) REFERENCES units(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Seed 14 units (only if table is empty)
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM units LIMIT 1) THEN
    INSERT INTO units (unit_name, contact_person, total_slots, slots_remaining, shift_preference, preceptors, considerations, is_participating)
    VALUES
      ('Labor & Delivery',  'Nicole Schwartz',                                    2, 2, 'Either',         '', '', true),
      ('6 NW',              'Priscilla Wilson and Joyce Serpas',                   3, 3, 'Day and Night',  'AM Lauren Moore, AM Stephanie Manzo, PM Christine Gonzalez', '', true),
      ('6 NE',              'Priscilla Wilson and Claire Dy',                      2, 2, 'Day and Night',  'AM Courtney Mazzanti, PM Welby Solis', '', true),
      ('PACU',              'Rusela DeSilva / Kescia Gray / Alena Mascetta',       3, 3, 'Day or Midshift','', 'Midshift starts as early as 10:30am and ends as late as 2am. Day or Midshift preferred for best student experience.', true),
      ('7 NE/NW',           'Ann Gilligan',                                        1, 1, 'Night',          'Aurora Torrez (nights)', '', true),
      ('8 NE/NW',           'Aileen Espiritu-Tepper',                              2, 2, 'Day and Night',  '', 'Preferably one night and one day student.', true),
      ('8 SE/SW',           'Paul Cancio',                                         2, 2, 'Night',          '', '', true),
      ('4 SE/SW',           'Herson Portillo',                                     2, 2, 'Day and Night',  '', 'Prefer students interested in specializing in oncology after graduation. One day, one night.', true),
      ('5 SE/SW',           'Janet Toledo',                                        2, 2, 'Day and Night',  '', 'Can accommodate 1 day and 1 night if needed.', true),
      ('Pediatrics',        'Amanda Serrano',                                      1, 1, 'Either',         '', 'Avoid scheduling during new grad orientation dates.', true),
      ('NICU',              'Melissa Arjon',                                       1, 1, 'Day',            'Monica Bartolome', 'No artificial nails. Student must follow bare-below-the-elbows policy. Strict infection prevention required.', true),
      ('6 SE/SW',           'Jimmy Nguyen',                                        2, 2, 'Day and Night',  '', '1 day, 1 night.', true),
      ('5 SCCT',            'Luba Tashlyk',                                        2, 2, 'Either',         'To be assigned', '', true),
      ('4 NE/NW',           'Iesha King',                                          1, 1, 'Night',          '', '', true);
  END IF;
END $$;
