-- db/demo/demo_seed.sql
--
-- DEMO-MODE-1, phase 3: the cast.
--
-- Creates one fabricated cohort and everything hanging off it, so that turning demo
-- mode on shows a working program rather than an empty app.
--
-- RE-RUNNABLE BY DESIGN. Every row has a fixed id beginning 0de0, and the file deletes
-- those rows before inserting them. Run it as often as you like; run it again the
-- morning of a talk so every date is fresh, because the rotation is anchored to
-- CURRENT_DATE and a cohort seeded in March looks finished by May.
--
-- ─────────────────────────────────────────────────────────────────────
-- THREE DECISIONS WORTH DISAGREEING WITH
-- ─────────────────────────────────────────────────────────────────────
--
-- 1. PEOPLE AND SCHOOLS ARE FABRICATED. UNITS ARE REAL.
--    Every student, preceptor, coordinator and school here is invented. The units are
--    the real ones from src/lib/unitCatalog.js, and that is deliberate: the app looks
--    up a unit's division, description and eligibility from that catalog by name, so an
--    invented unit renders as a blank division and an empty description on exactly the
--    screens a demo is meant to show. Unit names are also institutional rather than
--    personal, and already appear in public job postings. If you would rather they were
--    invented too, change them here and accept the blanks.
--
-- 2. EVERY ADDRESS IS @demo.aspire.invalid.
--    That is not decoration. lib/server/email/mailer.js refuses to hand any recipient at
--    that domain to Resend, and RFC 2606 guarantees the domain can never resolve. Change
--    a demo address to a real-looking domain and you have armed every cron in the system
--    to email a person who does not exist. See shared/demoIdentity.js.
--
-- 3. THE CAST INCLUDES FRICTION, BECAUSE THAT IS THE PRODUCT.
--    A student flagged for a second interview, one who has asked for support mid-shift,
--    one who declined, an unmatched candidate on the board and a unit with unfilled
--    capacity. An app that only ever shows a perfect Tuesday does not demonstrate
--    anything; the value is in what it catches.
--
-- ─────────────────────────────────────────────────────────────────────
-- PREREQUISITE
-- ─────────────────────────────────────────────────────────────────────
-- supabase/migrations/20260921000000_demo_mode_foundation.sql must be applied first.
-- The preflight below refuses to run otherwise, rather than inserting rows that nothing
-- can tell apart from real ones. That is the one failure mode worth being paranoid
-- about: a demo student with no is_demo marker is indistinguishable from a real one.

--
-- ─────────────────────────────────────────────────────────────────────
-- COLUMN TYPES THAT ARE NOT WHAT YOU WOULD GUESS
-- ─────────────────────────────────────────────────────────────────────
-- Some date columns in this schema are TEXT holding 'YYYY-MM-DD', and some are real
-- DATEs. PostgreSQL will not implicitly cast date to text on INSERT, so getting this
-- wrong aborts the entire file. Verified against the migrations, not assumed:
--
--   TEXT  cohorts.start_date, cohorts.end_date          (migration_cohorts.sql)
--   TEXT  students.interview_scheduled_date             (migration_interview_redesign.sql:61)
--   TEXT  student_shift_logs.shift_date                 (the review RPCs take p_shift_date text
--                                                        and compare l.shift_date = p_shift_date)
--   DATE  cohort_school_rotations.rotation_start_date / rotation_end_date
--   DATE  preceptors.started_at / ended_at
--   DATE  student_preceptor_assignments.start_date / end_date
--
-- The TEXT ones are written ::text here. Keep it that way.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 0. Preflight
-- ─────────────────────────────────────────────────────────────────────
DO $preflight$
DECLARE
  needed text[][] := ARRAY[
    ['cohorts','is_demo'], ['students','is_demo'], ['units','is_demo'],
    ['contacts','is_demo'], ['preceptors','is_demo'],
    ['matches','is_demo'], ['student_shift_logs','is_demo'],
    ['student_preceptor_assignments','is_demo'], ['cohort_school_rotations','is_demo'],
    -- Columns this file actually writes. Several of these tables were created through
    -- the Supabase dashboard, so the shape is confirmed here rather than assumed.
    ['students','first_name'], ['students','last_name'], ['students','preferred_first_name'],
    ['students','school_email'], ['students','status'], ['students','cohort_id'],
    ['students','hours_required'], ['students','approved_hours'], ['students','program_type'],
    ['students','matched_unit_id'], ['students','preceptor_id'], ['students','shift_assigned'],
    ['students','interview_scheduled_date'], ['students','unit_preference_1'],
    ['units','unit_name'], ['units','division'], ['units','total_slots'],
    ['units','slots_remaining'], ['units','is_participating'], ['units','cohort_id'],
    ['preceptors','full_name'], ['preceptors','email'], ['preceptors','unit_name'],
    ['preceptors','shift_type'], ['preceptors','is_active'],
    ['contacts','full_name'], ['contacts','email'], ['contacts','category'],
    ['preceptor_cohort_participation','preceptor_id'], ['preceptor_cohort_participation','cohort_id'],
    ['preceptor_cohort_participation','status'], ['preceptor_cohort_participation','started_at'],
    ['matches','student_id'], ['matches','unit_id'], ['matches','preceptor_id'],
    ['student_shift_logs','school_email'], ['student_shift_logs','shift_date'],
    ['student_shift_logs','lifecycle_state'],
    ['student_shift_logs','total_hours'], ['student_shift_logs','status'],
    ['student_shift_logs','support_needed'], ['student_shift_logs','unit_name'],
    ['cohort_school_rotations','school_name'], ['cohort_school_rotations','rotation_start_date'],
    ['cohort_school_rotations','rotation_end_date']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(needed, 1) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=needed[i][1] AND column_name=needed[i][2]
    ) THEN
      IF needed[i][2] = 'is_demo' THEN
        RAISE EXCEPTION
          'DEMO SEED: %.is_demo does not exist. Apply supabase/migrations/20260921000000_demo_mode_foundation.sql FIRST. Seeding without it would create rows nothing can tell apart from real ones.', needed[i][1];
      ELSE
        RAISE EXCEPTION
          'DEMO SEED: %.% does not exist. The live schema differs from what this seed was written against; fix the column list before running.', needed[i][1], needed[i][2];
      END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'DEMO SEED preflight passed.';
END
$preflight$;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Clear any previous demo cast, so this file is re-runnable.
--    Children first. Nothing here can touch a real row: every predicate is is_demo.
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM student_preceptor_assignments WHERE is_demo;
DELETE FROM student_shift_logs            WHERE is_demo;
DELETE FROM preceptor_cohort_participation WHERE is_demo;
DELETE FROM matches                       WHERE is_demo;
DELETE FROM cohort_school_rotations       WHERE is_demo;
DELETE FROM students                      WHERE is_demo;
DELETE FROM preceptors                    WHERE is_demo;
DELETE FROM units                         WHERE is_demo;
DELETE FROM contacts                      WHERE is_demo;
DELETE FROM cohorts                       WHERE is_demo;

-- ─────────────────────────────────────────────────────────────────────
-- 2. The cohort. Mid-rotation on purpose: started three weeks ago, five to run.
--    That is the only moment where every stage is visible at once.
--
--    accepting_submissions IS false, AND MUST STAY false.
--
--    This is not a workaround for the partial unique index
--    cohorts_one_accepting_submissions (which permits exactly one accepting cohort at a
--    time, and correctly refused an earlier draft of this file). It is the only correct
--    value. That flag is the ROUTER for public form submissions: api/student-intake-submit.js,
--    api/school-form-submit.js, api/school-form-existing-request.js and
--    api/unit-form-submit.js all resolve their destination cohort from it. A demo cohort
--    holding that flag would take real students' intake forms, real schools' placement
--    requests and real units' capacity submissions and file them against fabricated
--    records, where the boundary would then hide them from everyone in normal use.
--
--    The constraint caught this. Nothing else would have.
--
--    Nothing in a demo needs it: the cast already exists, and the scope picker's dot
--    reads cohort STATUS, not this flag (SCOPE-DOT-1), so the Demo Cohort still shows as
--    Active with a green dot.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO cohorts (id, name, status, start_date, end_date, accepting_submissions, is_demo)
VALUES ('0de00000-0000-4000-8000-000000000001',
        'Demo Cohort', 'Active',
        (CURRENT_DATE - 21)::text, (CURRENT_DATE + 35)::text,
        false, true);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Schools.
--
--    There is no schools row here, because this instance has no schools table: the
--    canonical catalog (gate item 13) was never applied, and api/lib/schoolScope.js is
--    written to tolerate exactly that, deriving the school boundary from the names on
--    student records instead. A demo student's school is students.school, a TEXT column
--    inside the boundary, and the rotation windows below key off the same names.
--    The three invented schools are therefore defined by their use, not by a catalog row.
-- ─────────────────────────────────────────────────────────────────────

-- Rotation windows per school. The Rotation Timeline column on every roster reads these.
INSERT INTO cohort_school_rotations
  (id, cohort_id, school_name, rotation_start_date, rotation_end_date,
   coordinator_name, coordinator_email, min_days_per_week, weekends_allowed, nights_allowed, is_demo)
VALUES
  ('0de08000-0000-4000-8000-000000000001', '0de00000-0000-4000-8000-000000000001',
   'Pacific Crest University',       CURRENT_DATE - 21, CURRENT_DATE + 35,
   'Marguerite Alvarado', 'marguerite.alvarado@demo.aspire.invalid', 2, true,  false, true),
  ('0de08000-0000-4000-8000-000000000002', '0de00000-0000-4000-8000-000000000001',
   'Harbor View College of Nursing', CURRENT_DATE - 14, CURRENT_DATE + 42,
   'Desmond Achebe',      'desmond.achebe@demo.aspire.invalid',      2, true,  true,  true),
  ('0de08000-0000-4000-8000-000000000003', '0de00000-0000-4000-8000-000000000001',
   'Valley State University',        CURRENT_DATE - 7,  CURRENT_DATE + 49,
   'Ingrid Solheim',      'ingrid.solheim@demo.aspire.invalid',      3, false, false, true);

-- ─────────────────────────────────────────────────────────────────────
-- 4. Units. Real catalog names (see decision 1), fabricated contacts.
--    7 North is deliberately left with unfilled capacity: the gap is the point.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO units
  (id, cohort_id, unit_name, division, total_slots, slots_remaining,
   contact_person, contact_email, is_participating, patient_population, is_demo)
VALUES
  ('0de0c000-0000-4000-8000-000000000001', '0de00000-0000-4000-8000-000000000001',
   '6 NE',       'Critical Care', 3, 0, 'Rosalind Meier',  'rosalind.meier@demo.aspire.invalid',  true, 'PCU, Heart Transplant', true),
  ('0de0c000-0000-4000-8000-000000000002', '0de00000-0000-4000-8000-000000000001',
   '5 North',    'Medical',       3, 0, 'Bernard Okafor',  'bernard.okafor@demo.aspire.invalid',  true, 'Medical-Surgical',      true),
  ('0de0c000-0000-4000-8000-000000000003', '0de00000-0000-4000-8000-000000000001',
   '8 South',    'Surgical',      2, 0, 'Clarice Dunne',   'clarice.dunne@demo.aspire.invalid',   true, 'Surgical Stepdown',     true),
  ('0de0c000-0000-4000-8000-000000000004', '0de00000-0000-4000-8000-000000000001',
   '4 SCCT',     'Critical Care', 2, 1, 'Anton Petrescu',  'anton.petrescu@demo.aspire.invalid',  true, 'Medicine Telemetry',    true),
  -- The unfilled unit. Two slots offered, nobody placed.
  ('0de0c000-0000-4000-8000-000000000005', '0de00000-0000-4000-8000-000000000001',
   '7 North',    'Surgical',      2, 2, 'Priscilla Vance', 'priscilla.vance@demo.aspire.invalid', true, 'Orthopedics, Spine',    true);

-- ─────────────────────────────────────────────────────────────────────
-- 5. Preceptors, and their Connect contact records.
--    Both exist because the app carries preceptor identity in preceptors and
--    directory identity in contacts; a preceptor missing from contacts shows up
--    on the roster but nowhere in Connect.
-- ─────────────────────────────────────────────────────────────────────
--    preceptors carries IDENTITY ONLY on this instance: no cohort_id, no status, no
--    started_at. Those live on preceptor_cohort_participation, which is how a shared
--    preceptor can take part in several cohorts without being duplicated. Verified
--    against the live schema, not inferred: every preceptors select in the app reads
--    only id, full_name, email, unit_name, phone, shift_type and unit_id, and
--    src/hooks/usePreceptors.js reaches the rest through the embed.
INSERT INTO preceptors
  (id, full_name, email, unit_name, shift_type, is_active, is_demo)
VALUES
  ('0de0d000-0000-4000-8000-000000000001',
   'Solomon Adeyemi', 'solomon.adeyemi@demo.aspire.invalid', '6 NE', 'Day', true, true),
  ('0de0d000-0000-4000-8000-000000000002',
   'Birgitta Lindqvist', 'birgitta.lindqvist@demo.aspire.invalid', '6 NE', 'Night', true, true),
  ('0de0d000-0000-4000-8000-000000000003',
   'Mateo Carrasco', 'mateo.carrasco@demo.aspire.invalid', '5 North', 'Day', true, true),
  ('0de0d000-0000-4000-8000-000000000004',
   'Ngozi Balogun', 'ngozi.balogun@demo.aspire.invalid', '5 North', 'Day', true, true),
  ('0de0d000-0000-4000-8000-000000000005',
   'Henrietta Fowles', 'henrietta.fowles@demo.aspire.invalid', '8 South', 'Day', true, true),
  ('0de0d000-0000-4000-8000-000000000006',
   'Ravi Chandrasekar', 'ravi.chandrasekar@demo.aspire.invalid', '4 SCCT', 'Night', true, true);

-- Cohort participation. This is the row that puts "Demo Cohort, active" beside a
-- preceptor's name: preceptors itself carries no cohort and no status, because a
-- preceptor is shared across cohorts and is never duplicated per cohort.
--
-- started_at is a real DATE here, unlike students.interview_scheduled_date and
-- student_shift_logs.shift_date, which are TEXT. Confirmed from the live CHECK
-- constraint, which matches migration_preceptor_schema_v2.sql:143 exactly, so that
-- file is the definition and started_at DATE is the live type. No ::text.
--
-- status must be one of active / inactive / completed
-- (preceptor_cohort_participation_status_check).
INSERT INTO preceptor_cohort_participation (id, preceptor_id, cohort_id, status, started_at, is_demo)
SELECT
  ('0de0b000-0000-4000-8000-0000000000' || lpad(row_number() OVER (ORDER BY p.id)::text, 2, '0'))::uuid,
  p.id, '0de00000-0000-4000-8000-000000000001', 'active', CURRENT_DATE - 21, true
FROM preceptors p
WHERE p.is_demo;

INSERT INTO contacts (id, full_name, email, category, role, organization, unit_name, is_active, is_demo)
VALUES
  ('0de0e000-0000-4000-8000-000000000001', 'Solomon Adeyemi',   'solomon.adeyemi@demo.aspire.invalid',   'Preceptor', 'Registered Nurse III', 'Cedars-Sinai', '6 NE',    true, true),
  ('0de0e000-0000-4000-8000-000000000002', 'Birgitta Lindqvist','birgitta.lindqvist@demo.aspire.invalid','Preceptor', 'Registered Nurse III', 'Cedars-Sinai', '6 NE',    true, true),
  ('0de0e000-0000-4000-8000-000000000003', 'Mateo Carrasco',    'mateo.carrasco@demo.aspire.invalid',    'Preceptor', 'Registered Nurse II',  'Cedars-Sinai', '5 North', true, true),
  ('0de0e000-0000-4000-8000-000000000004', 'Ngozi Balogun',     'ngozi.balogun@demo.aspire.invalid',     'Preceptor', 'Registered Nurse III', 'Cedars-Sinai', '5 North', true, true),
  ('0de0e000-0000-4000-8000-000000000005', 'Henrietta Fowles',  'henrietta.fowles@demo.aspire.invalid',  'Preceptor', 'Registered Nurse II',  'Cedars-Sinai', '8 South', true, true),
  ('0de0e000-0000-4000-8000-000000000006', 'Ravi Chandrasekar', 'ravi.chandrasekar@demo.aspire.invalid', 'Preceptor', 'Registered Nurse III', 'Cedars-Sinai', '4 SCCT',  true, true),
  -- Unit leaders and academic partners, so Connect and the portals have someone in them.
  ('0de0e000-0000-4000-8000-000000000011', 'Rosalind Meier',    'rosalind.meier@demo.aspire.invalid',    'Unit Leader', 'Nurse Manager',    'Cedars-Sinai', '6 NE',    true, true),
  ('0de0e000-0000-4000-8000-000000000012', 'Bernard Okafor',    'bernard.okafor@demo.aspire.invalid',    'Unit Leader', 'Nurse Manager',    'Cedars-Sinai', '5 North', true, true),
  ('0de0e000-0000-4000-8000-000000000013', 'Priscilla Vance',   'priscilla.vance@demo.aspire.invalid',   'Unit Leader', 'Nurse Manager',    'Cedars-Sinai', '7 North', true, true),
  ('0de0e000-0000-4000-8000-000000000021', 'Marguerite Alvarado','marguerite.alvarado@demo.aspire.invalid','Academic Partner','Clinical Placement Coordinator','Pacific Crest University',       NULL, true, true),
  ('0de0e000-0000-4000-8000-000000000022', 'Desmond Achebe',    'desmond.achebe@demo.aspire.invalid',    'Academic Partner','Clinical Placement Coordinator','Harbor View College of Nursing', NULL, true, true),
  ('0de0e000-0000-4000-8000-000000000023', 'Ingrid Solheim',    'ingrid.solheim@demo.aspire.invalid',    'Academic Partner','Clinical Placement Coordinator','Valley State University',        NULL, true, true);

-- ─────────────────────────────────────────────────────────────────────
-- 6. The students, one per stage of the pathway.
--
--    Read the status column downward and you have the whole program: an outreach that
--    has not gone out yet, forms in flight, interviews booked and held, a board being
--    matched, five rotations running, two finished, and one person who said no.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO students
  (id, cohort_id, name, first_name, last_name, preferred_first_name,
   school_email, personal_email, school, program_type, status,
   hours_required, approved_hours, matched_unit_id, preceptor_id, matched_preceptor,
   shift_assigned, interview_scheduled_date, interview_scheduled_time,
   unit_preference_1, unit_preference_2, unit_preference_3, cumulative_gpa, is_demo)
VALUES
-- ── Active Rotation (5). Two of these are on campus right now; see section 8.
('0de05000-0000-4000-8000-000000000001','0de00000-0000-4000-8000-000000000001','Amara Okonkwo','Amara','Okonkwo',NULL,
 'amara.okonkwo@demo.aspire.invalid','amara.okonkwo.personal@demo.aspire.invalid','Pacific Crest University','BSN Semester','Active Rotation',
 120, 72,'0de0c000-0000-4000-8000-000000000001','0de0d000-0000-4000-8000-000000000001','Solomon Adeyemi','Day',NULL,NULL,'6 NE','4 SCCT','5 North',3.82,true),
('0de05000-0000-4000-8000-000000000002','0de00000-0000-4000-8000-000000000001','Diego Salazar','Diego','Salazar',NULL,
 'diego.salazar@demo.aspire.invalid','diego.salazar.personal@demo.aspire.invalid','Pacific Crest University','BSN Semester','Active Rotation',
 120, 60,'0de0c000-0000-4000-8000-000000000001','0de0d000-0000-4000-8000-000000000002','Birgitta Lindqvist','Night',NULL,NULL,'6 NE','8 South','5 North',3.54,true),
('0de05000-0000-4000-8000-000000000003','0de00000-0000-4000-8000-000000000001','Priya Raghunathan','Priya','Raghunathan','Pri',
 'priya.raghunathan@demo.aspire.invalid','priya.r.personal@demo.aspire.invalid','Harbor View College of Nursing','Accelerated BSN','Active Rotation',
 135, 84,'0de0c000-0000-4000-8000-000000000002','0de0d000-0000-4000-8000-000000000003','Mateo Carrasco','Day',NULL,NULL,'5 North','6 NE','8 South',3.91,true),
-- Friction: has raised support needed on a shift.
('0de05000-0000-4000-8000-000000000004','0de00000-0000-4000-8000-000000000001','Kayla Brennan','Kayla','Brennan',NULL,
 'kayla.brennan@demo.aspire.invalid','kayla.brennan.personal@demo.aspire.invalid','Harbor View College of Nursing','BSN Trimester','Active Rotation',
 120, 36,'0de0c000-0000-4000-8000-000000000002','0de0d000-0000-4000-8000-000000000004','Ngozi Balogun','Day',NULL,NULL,'5 North','7 North','4 SCCT',3.27,true),
('0de05000-0000-4000-8000-000000000005','0de00000-0000-4000-8000-000000000001','Tomas Iglesias','Tomas','Iglesias','Tom',
 'tomas.iglesias@demo.aspire.invalid','tom.iglesias.personal@demo.aspire.invalid','Valley State University','BSN Quarter','Active Rotation',
 120, 48,'0de0c000-0000-4000-8000-000000000003','0de0d000-0000-4000-8000-000000000005','Henrietta Fowles','Day',NULL,NULL,'8 South','7 North','5 North',3.68,true),

-- ── Placed (3). Matched on the board, rotation not started.
('0de05000-0000-4000-8000-000000000006','0de00000-0000-4000-8000-000000000001','Nadia Petrov','Nadia','Petrov',NULL,
 'nadia.petrov@demo.aspire.invalid','nadia.petrov.personal@demo.aspire.invalid','Valley State University','BSN Quarter','Placed',
 120, 0,'0de0c000-0000-4000-8000-000000000003','0de0d000-0000-4000-8000-000000000005','Henrietta Fowles','Day',NULL,NULL,'8 South','6 NE','5 North',3.75,true),
('0de05000-0000-4000-8000-000000000007','0de00000-0000-4000-8000-000000000001','Marcus Whitfield','Marcus','Whitfield',NULL,
 'marcus.whitfield@demo.aspire.invalid','marcus.w.personal@demo.aspire.invalid','Pacific Crest University','BSN Semester','Placed',
 120, 0,'0de0c000-0000-4000-8000-000000000004','0de0d000-0000-4000-8000-000000000006','Ravi Chandrasekar','Night',NULL,NULL,'4 SCCT','6 NE','8 South',3.44,true),
('0de05000-0000-4000-8000-000000000008','0de00000-0000-4000-8000-000000000001','Hana Kimura','Hana','Kimura',NULL,
 'hana.kimura@demo.aspire.invalid','hana.kimura.personal@demo.aspire.invalid','Harbor View College of Nursing','Accelerated BSN','Placed',
 135, 0,'0de0c000-0000-4000-8000-000000000001','0de0d000-0000-4000-8000-000000000001','Solomon Adeyemi','Day',NULL,NULL,'6 NE','4 SCCT','7 North',3.88,true),

-- ── Interviewed (2). Both still on the board unmatched: this is the queue.
('0de05000-0000-4000-8000-000000000009','0de00000-0000-4000-8000-000000000001','Elena Vasquez','Elena','Vasquez',NULL,
 'elena.vasquez@demo.aspire.invalid','elena.vasquez.personal@demo.aspire.invalid','Valley State University','LVN to BSN','Interviewed',
 120, 0,NULL,NULL,NULL,NULL,(CURRENT_DATE - 6)::text,'10:30','7 North','8 South','5 North',3.12,true),
('0de05000-0000-4000-8000-000000000010','0de00000-0000-4000-8000-000000000001','Jordan Ellis','Jordan','Ellis',NULL,
 'jordan.ellis@demo.aspire.invalid','jordan.ellis.personal@demo.aspire.invalid','Pacific Crest University','BSN Semester','Interviewed',
 120, 0,NULL,NULL,NULL,NULL,(CURRENT_DATE - 5)::text,'14:00','7 North','4 SCCT','6 NE',3.61,true),

-- ── Interview Scheduled (3). Dates in the next few days, so the Interview tab is live.
('0de05000-0000-4000-8000-000000000011','0de00000-0000-4000-8000-000000000001','Simone Laurent','Simone','Laurent',NULL,
 'simone.laurent@demo.aspire.invalid','simone.laurent.personal@demo.aspire.invalid','Harbor View College of Nursing','BSN Trimester','Interview Scheduled',
 120, 0,NULL,NULL,NULL,NULL,(CURRENT_DATE + 2)::text,'09:00','6 NE','5 North','8 South',3.70,true),
('0de05000-0000-4000-8000-000000000012','0de00000-0000-4000-8000-000000000001','Rafael Mendoza','Rafael','Mendoza',NULL,
 'rafael.mendoza@demo.aspire.invalid','rafael.mendoza.personal@demo.aspire.invalid','Valley State University','BSN Quarter','Interview Scheduled',
 120, 0,NULL,NULL,NULL,NULL,(CURRENT_DATE + 2)::text,'11:00','4 SCCT','6 NE','7 North',3.35,true),
('0de05000-0000-4000-8000-000000000013','0de00000-0000-4000-8000-000000000001','Aisha Rahman','Aisha','Rahman',NULL,
 'aisha.rahman@demo.aspire.invalid','aisha.rahman.personal@demo.aspire.invalid','Pacific Crest University','BSN Semester','Interview Scheduled',
 120, 0,NULL,NULL,NULL,NULL,(CURRENT_DATE + 3)::text,'13:30','5 North','8 South','6 NE',3.96,true),

-- ── Form Received (2), Form Sent (2), Pending Outreach (1). The intake funnel.
('0de05000-0000-4000-8000-000000000014','0de00000-0000-4000-8000-000000000001','Colin Doyle','Colin','Doyle',NULL,
 'colin.doyle@demo.aspire.invalid','colin.doyle.personal@demo.aspire.invalid','Valley State University','BSN Quarter','Form Received',
 120, 0,NULL,NULL,NULL,NULL,NULL,NULL,'8 South','7 North','4 SCCT',3.48,true),
('0de05000-0000-4000-8000-000000000015','0de00000-0000-4000-8000-000000000001','Yuki Tanaka','Yuki','Tanaka',NULL,
 'yuki.tanaka@demo.aspire.invalid','yuki.tanaka.personal@demo.aspire.invalid','Harbor View College of Nursing','Accelerated BSN','Form Received',
 135, 0,NULL,NULL,NULL,NULL,NULL,NULL,'6 NE','4 SCCT','5 North',3.79,true),
('0de05000-0000-4000-8000-000000000016','0de00000-0000-4000-8000-000000000001','Grace Mbeki','Grace','Mbeki',NULL,
 'grace.mbeki@demo.aspire.invalid','grace.mbeki.personal@demo.aspire.invalid','Pacific Crest University','BSN Semester','Form Sent',
 120, 0,NULL,NULL,NULL,NULL,NULL,NULL,'5 North','6 NE','8 South',3.55,true),
('0de05000-0000-4000-8000-000000000017','0de00000-0000-4000-8000-000000000001','Owen Fitzgerald','Owen','Fitzgerald',NULL,
 'owen.fitzgerald@demo.aspire.invalid','owen.f.personal@demo.aspire.invalid','Valley State University','BSN Quarter','Form Sent',
 120, 0,NULL,NULL,NULL,NULL,NULL,NULL,'7 North','8 South','6 NE',3.22,true),
('0de05000-0000-4000-8000-000000000018','0de00000-0000-4000-8000-000000000001','Leila Haddad','Leila','Haddad',NULL,
 'leila.haddad@demo.aspire.invalid','leila.haddad.personal@demo.aspire.invalid','Harbor View College of Nursing','BSN Trimester','Pending Outreach',
 120, 0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,3.64,true),

-- ── Completed (2). Hours met, rotation finished.
('0de05000-0000-4000-8000-000000000019','0de00000-0000-4000-8000-000000000001','Isabel Moreno','Isabel','Moreno',NULL,
 'isabel.moreno@demo.aspire.invalid','isabel.moreno.personal@demo.aspire.invalid','Pacific Crest University','BSN Semester','Completed',
 120, 124,'0de0c000-0000-4000-8000-000000000002','0de0d000-0000-4000-8000-000000000003','Mateo Carrasco','Day',NULL,NULL,'5 North','6 NE','8 South',3.86,true),
('0de05000-0000-4000-8000-000000000020','0de00000-0000-4000-8000-000000000001','Trevor Nakamura','Trevor','Nakamura',NULL,
 'trevor.nakamura@demo.aspire.invalid','trevor.n.personal@demo.aspire.invalid','Valley State University','BSN Quarter','Completed',
 120, 121,'0de0c000-0000-4000-8000-000000000004','0de0d000-0000-4000-8000-000000000006','Ravi Chandrasekar','Night',NULL,NULL,'4 SCCT','6 NE','7 North',3.41,true),

-- ── Declined (1). Somebody always does, and the app should show it.
('0de05000-0000-4000-8000-000000000021','0de00000-0000-4000-8000-000000000001','Bianca Rossi','Bianca','Rossi',NULL,
 'bianca.rossi@demo.aspire.invalid','bianca.rossi.personal@demo.aspire.invalid','Harbor View College of Nursing','BSN Trimester','Declined',
 120, 0,NULL,NULL,NULL,NULL,(CURRENT_DATE - 9)::text,'15:00','6 NE','5 North','7 North',3.58,true);

-- ─────────────────────────────────────────────────────────────────────
-- 7. The Placement Board. A match row per placed or rotating student.
--    The two Interviewed students have no row, which is what puts them in the
--    unmatched column, and 7 North has no rows at all, which is the unfilled unit.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO matches (id, cohort_id, student_id, unit_id, preceptor_id, preceptor_assigned, shift_assigned, notification_sent, is_demo)
SELECT
  ('0de06000-0000-4000-8000-0000000000' || lpad(row_number() OVER (ORDER BY s.id)::text, 2, '0'))::uuid,
  s.cohort_id, s.id, s.matched_unit_id, s.preceptor_id, s.matched_preceptor, s.shift_assigned, true, true
FROM students s
WHERE s.is_demo AND s.matched_unit_id IS NOT NULL;

-- Preceptor assignments are NOT inserted here. The database already made them.
--
-- trg_sync_primary_preceptor_mirror is AFTER INSERT OR UPDATE OF preceptor_id ON
-- students, and it creates exactly one active PRIMARY row in
-- student_preceptor_assignments for every student whose preceptor_id is set, skipping
-- those where it is NULL. So by the time section 6 finished, the eleven matched students
-- already had their assignment rows, and an explicit INSERT here collided with
-- uq_spa_one_active_primary_per_student_cohort.
--
-- Letting the trigger own it is better than ON CONFLICT DO NOTHING would have been: the
-- rows are then created by the same path the app itself uses, with the same invariant,
-- rather than by a seed that happens to agree with it today.
--
-- Those rows still come out marked, which is the demo boundary's own design working:
-- aspire_demo_inherit is a BEFORE INSERT trigger on student_preceptor_assignments that
-- reads is_demo from the parent student. A row written by a database trigger, with no
-- browser anywhere near it, is stamped correctly. V6 proves it.

-- ─────────────────────────────────────────────────────────────────────
-- 8. Shift logs.
--
--    Approved history for the rotating students, then TODAY'S shifts. Two students are
--    checked in and not yet out (lifecycle_state 'in_progress'), which is exactly what
--    On Campus Now reads: src/lib/onCampusNow.js treats lifecycle as authoritative and
--    the time window only as a fallback. Without these two rows that strip is empty.
-- ─────────────────────────────────────────────────────────────────────

-- Completed history: six past shifts each for the five rotating students.
INSERT INTO student_shift_logs
  (id, cohort_id, student_id, school_email, shift_date, shift_type, unit_name, preceptor_name,
   total_hours, expected_hours, status, lifecycle_state, support_needed, submitted_at, is_demo)
SELECT
  ('0de07000-0000-4000-8000-' || lpad((row_number() OVER (ORDER BY s.id, g))::text, 12, '0'))::uuid,
  s.cohort_id, s.id,
  s.school_email,
  (CURRENT_DATE - (g * 3))::text,
  s.shift_assigned,
  u.unit_name,
  s.matched_preceptor,
  12, 12, 'Approved', 'completed', false,
  (CURRENT_DATE - (g * 3) + TIME '19:30')::timestamptz,
  true
FROM students s
JOIN units u ON u.id = s.matched_unit_id
CROSS JOIN generate_series(1, 6) AS g
WHERE s.is_demo AND s.status = 'Active Rotation';

-- Today. Amara and Priya are on the unit right now.
INSERT INTO student_shift_logs
  (id, cohort_id, student_id, school_email, shift_date, shift_type, unit_name, preceptor_name,
   total_hours, expected_hours, status, lifecycle_state, support_needed, checked_in_at, is_demo)
VALUES
  ('0de07000-0000-4000-8000-000000009001','0de00000-0000-4000-8000-000000000001','0de05000-0000-4000-8000-000000000001',
   'amara.okonkwo@demo.aspire.invalid',CURRENT_DATE::text,'Day','6 NE','Solomon Adeyemi',12,12,'Auto-Accepted','in_progress',false,
   (CURRENT_DATE + TIME '06:45')::timestamptz, true),
  ('0de07000-0000-4000-8000-000000009002','0de00000-0000-4000-8000-000000000001','0de05000-0000-4000-8000-000000000003',
   'priya.raghunathan@demo.aspire.invalid',CURRENT_DATE::text,'Day','5 North','Mateo Carrasco',12,12,'Auto-Accepted','in_progress',false,
   (CURRENT_DATE + TIME '06:50')::timestamptz, true);

-- Friction: Kayla flagged that she needed support on her last shift.
INSERT INTO student_shift_logs
  (id, cohort_id, student_id, school_email, shift_date, shift_type, unit_name, preceptor_name,
   total_hours, expected_hours, status, lifecycle_state, support_needed, submitted_at, is_demo)
VALUES
  ('0de07000-0000-4000-8000-000000009003','0de00000-0000-4000-8000-000000000001','0de05000-0000-4000-8000-000000000004',
   'kayla.brennan@demo.aspire.invalid',(CURRENT_DATE - 1)::text,'Day','5 North','Ngozi Balogun',12,12,'Approved','completed',true,
   (CURRENT_DATE - 1 + TIME '19:40')::timestamptz, true);

-- Completed students carry a full record so their hours add up to what their profile says.
INSERT INTO student_shift_logs
  (id, cohort_id, student_id, school_email, shift_date, shift_type, unit_name, preceptor_name,
   total_hours, expected_hours, status, lifecycle_state, support_needed, submitted_at, is_demo)
SELECT
  ('0de07000-0000-4000-8000-' || lpad((8000 + row_number() OVER (ORDER BY s.id, g))::text, 12, '0'))::uuid,
  s.cohort_id, s.id,
  s.school_email,
  (CURRENT_DATE - 20 + g)::text,
  s.shift_assigned, u.unit_name, s.matched_preceptor,
  12, 12, 'Approved', 'completed', false,
  (CURRENT_DATE - 20 + g + TIME '19:30')::timestamptz,
  true
FROM students s
JOIN units u ON u.id = s.matched_unit_id
CROSS JOIN generate_series(1, 10) AS g
WHERE s.is_demo AND s.status = 'Completed';

COMMIT;

-- ═════════════════════════════════════════════════════════════════════
-- VERIFICATION. Run after COMMIT.
-- ═════════════════════════════════════════════════════════════════════

-- V1. The cast, by stage. EXPECT 21 students spread across 9 statuses.
SELECT status, count(*) FROM students WHERE is_demo GROUP BY status ORDER BY count(*) DESC, status;

-- V2. Nothing real was touched. EXPECT: every count equal to what it was before.
SELECT 'students' AS t, count(*) FILTER (WHERE NOT is_demo) AS real_rows, count(*) FILTER (WHERE is_demo) AS demo_rows FROM students
UNION ALL SELECT 'cohorts', count(*) FILTER (WHERE NOT is_demo), count(*) FILTER (WHERE is_demo) FROM cohorts
UNION ALL SELECT 'units',   count(*) FILTER (WHERE NOT is_demo), count(*) FILTER (WHERE is_demo) FROM units
UNION ALL SELECT 'matches', count(*) FILTER (WHERE NOT is_demo), count(*) FILTER (WHERE is_demo) FROM matches
UNION ALL SELECT 'preceptors', count(*) FILTER (WHERE NOT is_demo), count(*) FILTER (WHERE is_demo) FROM preceptors
UNION ALL SELECT 'preceptor_cohort_participation', count(*) FILTER (WHERE NOT is_demo), count(*) FILTER (WHERE is_demo) FROM preceptor_cohort_participation
UNION ALL SELECT 'student_shift_logs', count(*) FILTER (WHERE NOT is_demo), count(*) FILTER (WHERE is_demo) FROM student_shift_logs
-- EXPECT 11 demo rows here, made by the trigger rather than by this file: one per
-- student with a preceptor (5 rotating + 3 placed + 2 completed, and the Declined and
-- unmatched students have none).
UNION ALL SELECT 'student_preceptor_assignments', count(*) FILTER (WHERE NOT is_demo), count(*) FILTER (WHERE is_demo) FROM student_preceptor_assignments
ORDER BY t;

-- V3. EVERY demo address is at the reserved domain. EXPECT: zero rows.
--     A row here is a fabricated person a cron could really email.
SELECT 'students.school_email' AS field, school_email AS value FROM students
  WHERE is_demo AND school_email NOT LIKE '%@demo.aspire.invalid'
UNION ALL SELECT 'students.personal_email', personal_email FROM students
  WHERE is_demo AND personal_email IS NOT NULL AND personal_email NOT LIKE '%@demo.aspire.invalid'
UNION ALL SELECT 'preceptors.email', email FROM preceptors
  WHERE is_demo AND email NOT LIKE '%@demo.aspire.invalid'
UNION ALL SELECT 'contacts.email', email FROM contacts
  WHERE is_demo AND email NOT LIKE '%@demo.aspire.invalid'
UNION ALL SELECT 'units.contact_email', contact_email FROM units
  WHERE is_demo AND contact_email NOT LIKE '%@demo.aspire.invalid';

-- V4. No demo row points at a real one, which would make the embedded-select gap in
--     src/lib/demoScope.js leak. EXPECT: zero rows.
SELECT 'student -> cohort' AS link, s.id FROM students s JOIN cohorts c ON c.id = s.cohort_id
  WHERE s.is_demo AND NOT c.is_demo
UNION ALL SELECT 'student -> unit', s.id FROM students s JOIN units u ON u.id = s.matched_unit_id
  WHERE s.is_demo AND NOT u.is_demo
UNION ALL SELECT 'student -> preceptor', s.id FROM students s JOIN preceptors p ON p.id = s.preceptor_id
  WHERE s.is_demo AND NOT p.is_demo
UNION ALL SELECT 'match -> unit', m.id FROM matches m JOIN units u ON u.id = m.unit_id
  WHERE m.is_demo AND NOT u.is_demo
UNION ALL SELECT 'participation -> cohort', pcp.id FROM preceptor_cohort_participation pcp
  JOIN cohorts c ON c.id = pcp.cohort_id WHERE pcp.is_demo AND NOT c.is_demo;

-- V5. On Campus Now has somebody on it. EXPECT: 2 rows (Amara, Priya).
SELECT s.first_name, s.last_name, l.unit_name, l.checked_in_at
FROM student_shift_logs l JOIN students s ON s.id = l.student_id
WHERE l.is_demo AND l.lifecycle_state = 'in_progress';

-- V6. The inheritance triggers did their job: every child row is demo because its
--     parent is, not because the seed said so. EXPECT: zero rows.
SELECT 'shift log' AS t, l.id FROM student_shift_logs l JOIN students s ON s.id = l.student_id
  WHERE s.is_demo AND NOT l.is_demo
UNION ALL SELECT 'match', m.id FROM matches m JOIN students s ON s.id = m.student_id
  WHERE s.is_demo AND NOT m.is_demo
-- The assignment rows are created by trg_sync_primary_preceptor_mirror, not by this
-- seed, so this line is the real proof that aspire_demo_inherit stamps a row written by
-- a database trigger with no client involved.
UNION ALL SELECT 'preceptor assignment', a.id FROM student_preceptor_assignments a
  JOIN students s ON s.id = a.student_id WHERE s.is_demo AND NOT a.is_demo;
