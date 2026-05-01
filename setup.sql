-- =============================================
-- ASPIRE Placement Tracker — Supabase Setup
-- Run this entire file in the Supabase SQL Editor
-- =============================================

-- 1. Create the students table
CREATE TABLE IF NOT EXISTS students (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  school_email TEXT DEFAULT '',
  personal_email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  school TEXT DEFAULT '',
  aspire_cohort TEXT DEFAULT 'Summer 2026',
  term_dates TEXT DEFAULT '',
  hours_required INTEGER DEFAULT 0,
  hours_completed INTEGER DEFAULT 0,
  unit TEXT DEFAULT '',
  preceptor_name TEXT DEFAULT '',
  status TEXT DEFAULT 'Form Sent',
  ngrp_cohort_target TEXT DEFAULT '',
  ngrp_outcome TEXT DEFAULT 'Pending',
  gpa_verified BOOLEAN DEFAULT FALSE,
  bls_current BOOLEAN DEFAULT FALSE,
  health_cleared BOOLEAN DEFAULT FALSE,
  background_check BOOLEAN DEFAULT FALSE,
  coordinators TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable Row Level Security
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

-- 3. Permissive policy for anon role (internal tool — single org use)
DROP POLICY IF EXISTS "anon_all" ON students;
CREATE POLICY "anon_all" ON students
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

-- 4. Seed the 29 students (only runs if table is empty)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM students LIMIT 1) THEN
    INSERT INTO students (name, school_email, school, aspire_cohort, term_dates, hours_required, coordinators, status, ngrp_outcome)
    VALUES
      -- WCU North Hollywood (5 students)
      ('Kimberly Romero', 'kromero38@u.westcoastuniversity.edu', 'WCU North Hollywood', 'Summer 2026', 'Jun 8 - Aug 18, 2026', 90, 'Therese Sandoval (ThSandoval@westcoastuniversity.edu); Laura Nunez (lNunez@westcoastuniversity.edu); Silvia St George (sStgeorge@westcoastuniversity.edu); Tony Kim (ToKim@westcoastuniversity.edu)', 'Form Sent', 'Pending'),
      ('Marisol Peralta-Topete', 'mperalta-topete1@u.westcoastuniversity.edu', 'WCU North Hollywood', 'Summer 2026', 'Jun 8 - Aug 18, 2026', 90, 'Therese Sandoval (ThSandoval@westcoastuniversity.edu); Laura Nunez (lNunez@westcoastuniversity.edu); Silvia St George (sStgeorge@westcoastuniversity.edu); Tony Kim (ToKim@westcoastuniversity.edu)', 'Form Sent', 'Pending'),
      ('Melissa Rodriguez', 'mrodriguez101@u.westcoastuniversity.edu', 'WCU North Hollywood', 'Summer 2026', 'Jun 8 - Aug 18, 2026', 90, 'Therese Sandoval (ThSandoval@westcoastuniversity.edu); Laura Nunez (lNunez@westcoastuniversity.edu); Silvia St George (sStgeorge@westcoastuniversity.edu); Tony Kim (ToKim@westcoastuniversity.edu)', 'Form Sent', 'Pending'),
      ('Ofer DeLeon', 'odeleon1@u.westcoastuniversity.edu', 'WCU North Hollywood', 'Summer 2026', 'Jun 8 - Aug 18, 2026', 90, 'Therese Sandoval (ThSandoval@westcoastuniversity.edu); Laura Nunez (lNunez@westcoastuniversity.edu); Silvia St George (sStgeorge@westcoastuniversity.edu); Tony Kim (ToKim@westcoastuniversity.edu)', 'Form Sent', 'Pending'),
      ('Pedro Simon', 'psimon2@u.westcoastuniversity.edu', 'WCU North Hollywood', 'Summer 2026', 'Jun 8 - Aug 18, 2026', 90, 'Therese Sandoval (ThSandoval@westcoastuniversity.edu); Laura Nunez (lNunez@westcoastuniversity.edu); Silvia St George (sStgeorge@westcoastuniversity.edu); Tony Kim (ToKim@westcoastuniversity.edu)', 'Form Sent', 'Pending'),
      -- Azusa Pacific University (2 students)
      ('Wonsang Yun', 'wyun23@apu.edu', 'Azusa Pacific University', 'Summer 2026', 'May 4 - Jul 30, 2026', 180, 'Susan Hunter (shunter@apu.edu)', 'Form Sent', 'Pending'),
      ('Dylan Cline', 'dcline24@apu.edu', 'Azusa Pacific University', 'Summer 2026', 'May 4 - Jul 30, 2026', 180, 'Susan Hunter (shunter@apu.edu)', 'Form Sent', 'Pending'),
      -- Cal State Long Beach (7 students)
      ('Jayde De Leon', 'Jayde.Deleon01@student.csulb.edu', 'Cal State Long Beach', 'Summer 2026', 'Jun 1 - Aug 14, 2026', 90, 'Lucy Van Otterloo (Lucy.VanOtterloo@csulb.edu)', 'Form Sent', 'Pending'),
      ('Jorge Velasco', 'Jorge.Velasco01@student.csulb.edu', 'Cal State Long Beach', 'Summer 2026', 'Jun 1 - Aug 14, 2026', 90, 'Lucy Van Otterloo (Lucy.VanOtterloo@csulb.edu)', 'Form Sent', 'Pending'),
      ('Alison Curd', 'Alison.Curd01@student.csulb.edu', 'Cal State Long Beach', 'Summer 2026', 'Jun 1 - Aug 14, 2026', 90, 'Lucy Van Otterloo (Lucy.VanOtterloo@csulb.edu)', 'Form Sent', 'Pending'),
      ('Jonathan Tcheumani', 'Jonathan.Tcheumani01@student.csulb.edu', 'Cal State Long Beach', 'Summer 2026', 'Jun 1 - Aug 14, 2026', 90, 'Lucy Van Otterloo (Lucy.VanOtterloo@csulb.edu)', 'Form Sent', 'Pending'),
      ('James Mason', 'James.Mason01@student.csulb.edu', 'Cal State Long Beach', 'Summer 2026', 'Jun 1 - Aug 14, 2026', 90, 'Lucy Van Otterloo (Lucy.VanOtterloo@csulb.edu)', 'Form Sent', 'Pending'),
      ('Eileen Fuerte', 'Eileen.Fuerte01@student.csulb.edu', 'Cal State Long Beach', 'Summer 2026', 'Jun 1 - Aug 14, 2026', 90, 'Lucy Van Otterloo (Lucy.VanOtterloo@csulb.edu)', 'Form Sent', 'Pending'),
      ('Ivan Cruz', 'Ivan.Cruz01@student.csulb.edu', 'Cal State Long Beach', 'Summer 2026', 'Jun 1 - Aug 14, 2026', 90, 'Lucy Van Otterloo (Lucy.VanOtterloo@csulb.edu)', 'Form Sent', 'Pending'),
      -- Cal State LA (12 students)
      ('Saruulsanaa Bayaraa (Emi)', 'sbayara@calstatela.edu', 'Cal State LA', 'Summer 2026', 'Jun 1 - Aug 7, 2026', 144, 'Marissa Grafil Ramirez (Marissa.Ramirez119@calstatela.edu); Alyssa Marie Manlangit (amanlan3@calstatela.edu)', 'Form Sent', 'Pending'),
      ('Adam Friedenthal', 'afriede3@calstatela.edu', 'Cal State LA', 'Summer 2026', 'Jun 1 - Aug 7, 2026', 144, 'Marissa Grafil Ramirez (Marissa.Ramirez119@calstatela.edu); Alyssa Marie Manlangit (amanlan3@calstatela.edu)', 'Form Sent', 'Pending'),
      ('Michael Gonzales', 'mgonza515@calstatela.edu', 'Cal State LA', 'Summer 2026', 'Jun 1 - Aug 7, 2026', 144, 'Marissa Grafil Ramirez (Marissa.Ramirez119@calstatela.edu); Alyssa Marie Manlangit (amanlan3@calstatela.edu)', 'Form Sent', 'Pending'),
      ('Emma Haugstad', 'ehaugst@calstatela.edu', 'Cal State LA', 'Summer 2026', 'Jun 1 - Aug 7, 2026', 144, 'Marissa Grafil Ramirez (Marissa.Ramirez119@calstatela.edu); Alyssa Marie Manlangit (amanlan3@calstatela.edu)', 'Form Sent', 'Pending'),
      ('Vivian Huang', 'vhuang6@calstatela.edu', 'Cal State LA', 'Summer 2026', 'Jun 1 - Aug 7, 2026', 144, 'Marissa Grafil Ramirez (Marissa.Ramirez119@calstatela.edu); Alyssa Marie Manlangit (amanlan3@calstatela.edu)', 'Form Sent', 'Pending'),
      ('Daria Klenert', 'dklener@calstatela.edu', 'Cal State LA', 'Summer 2026', 'Jun 1 - Aug 7, 2026', 144, 'Marissa Grafil Ramirez (Marissa.Ramirez119@calstatela.edu); Alyssa Marie Manlangit (amanlan3@calstatela.edu)', 'Form Sent', 'Pending'),
      ('Megan Laird', 'mlaird@calstatela.edu', 'Cal State LA', 'Summer 2026', 'Jun 1 - Aug 7, 2026', 144, 'Marissa Grafil Ramirez (Marissa.Ramirez119@calstatela.edu); Alyssa Marie Manlangit (amanlan3@calstatela.edu)', 'Form Sent', 'Pending'),
      ('Juan Perez', 'jperez182@calstatela.edu', 'Cal State LA', 'Summer 2026', 'Jun 1 - Aug 7, 2026', 144, 'Marissa Grafil Ramirez (Marissa.Ramirez119@calstatela.edu); Alyssa Marie Manlangit (amanlan3@calstatela.edu)', 'Form Sent', 'Pending'),
      ('Justin Perr', 'jperr@calstatela.edu', 'Cal State LA', 'Summer 2026', 'Jun 1 - Aug 7, 2026', 144, 'Marissa Grafil Ramirez (Marissa.Ramirez119@calstatela.edu); Alyssa Marie Manlangit (amanlan3@calstatela.edu)', 'Form Sent', 'Pending'),
      ('Jungmin Shin (Brian)', 'jshin40@calstatela.edu', 'Cal State LA', 'Summer 2026', 'Jun 1 - Aug 7, 2026', 144, 'Marissa Grafil Ramirez (Marissa.Ramirez119@calstatela.edu); Alyssa Marie Manlangit (amanlan3@calstatela.edu)', 'Form Sent', 'Pending'),
      ('Carina Welch', 'cwelch2@calstatela.edu', 'Cal State LA', 'Summer 2026', 'Jun 1 - Aug 7, 2026', 144, 'Marissa Grafil Ramirez (Marissa.Ramirez119@calstatela.edu); Alyssa Marie Manlangit (amanlan3@calstatela.edu)', 'Form Sent', 'Pending'),
      ('Eliana York', 'eyork2@calstatela.edu', 'Cal State LA', 'Summer 2026', 'Jun 1 - Aug 7, 2026', 144, 'Marissa Grafil Ramirez (Marissa.Ramirez119@calstatela.edu); Alyssa Marie Manlangit (amanlan3@calstatela.edu)', 'Form Sent', 'Pending'),
      -- WCU Anaheim (3 students)
      ('Lauren Chung', 'pending', 'WCU Anaheim', 'Summer 2026', 'Jun 8 - Aug 16, 2026', 90, 'Joelene Balatero (jBalatero@westcoastuniversity.edu); Rena Youssef (RYoussef@westcoastuniversity.edu)', 'Form Sent', 'Pending'),
      ('Vanessa Mored', 'pending', 'WCU Anaheim', 'Summer 2026', 'Jun 8 - Aug 16, 2026', 90, 'Joelene Balatero (jBalatero@westcoastuniversity.edu); Rena Youssef (RYoussef@westcoastuniversity.edu)', 'Form Sent', 'Pending'),
      ('Joshua Dela Cruz', 'pending', 'WCU Anaheim', 'Summer 2026', 'Jun 8 - Aug 16, 2026', 90, 'Joelene Balatero (jBalatero@westcoastuniversity.edu); Rena Youssef (RYoussef@westcoastuniversity.edu)', 'Form Sent', 'Pending');
  END IF;
END $$;
