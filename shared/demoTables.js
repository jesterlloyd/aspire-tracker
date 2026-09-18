// shared/demoTables.js
//
// DEMO-MODE-1: the registry of tables inside the demo boundary, in one place because
// BOTH halves of the app now filter on it.
//
// It used to live in src/lib/demoScope.js, which is browser code. The server could not
// import it without dragging localStorage-reading modules into a Vercel function, so
// when the portal previews needed the same boundary the choice was to duplicate the
// list or to move it here. A duplicated registry is a registry that drifts, and the
// drift would show up as a real student's name on a projector, so it moved.
//
// A table appears here ONLY once its is_demo column exists in the database, because
// filtering on a column that is not there turns every read of that table into a 400 and
// takes the app down. Keep this list and supabase/migrations/20260921000000 in lockstep;
// test/demoScope.test.mjs fails when they drift.

export const DEMO_SCOPED_TABLES = Object.freeze([
  // Roots. These carry is_demo as their own column.
  'cohorts',
  'students',
  'units',
  'contacts',
  'preceptors',
  // NOTE: 'schools' is deliberately absent. The canonical schools catalog does not
  // exist on this instance (gate item 13, 20260712000012_phase4_school_portal.sql, was
  // never applied), and api/lib/schoolScope.js already tolerates that: it derives the
  // same boundary from the school names carried on student records. A student's school
  // is students.school, a TEXT column that IS inside the boundary, so nothing about the
  // demo is weaker for this.
  // Children of a student. is_demo is inherited from the parent by trigger, so a row
  // written by an rpc or by a server endpoint is stamped correctly too.
  'matches',
  'student_shift_logs',
  'student_shift_plans',
  'student_preceptor_assignments',
  'student_unit_assignments',
  // NOTE: 'student_active_disposition' is deliberately absent. It is a VIEW over
  // student_dispositions (WHERE is_active), so it cannot carry a column, and it does not
  // need to: every read of it is already scoped by cohort_id or student_id, both of
  // which the boundary filters, so it can only ever return rows belonging to a
  // population the caller can already see.
  'evaluation_assignments',
  'interview_slots',
  'interview_sessions',
  'interview_rubrics',
  // Children of a preceptor. A preceptor is a SHARED entity carrying identity only, so
  // which cohorts they took part in, and with what status, lives here rather than on
  // preceptors. src/hooks/usePreceptors.js embeds this table to render a preceptor's
  // cohort beside their name.
  'preceptor_cohort_participation',
  // Children of a cohort.
  'cohort_school_rotations',
  // Children of a unit.
  'unit_capacity_submissions',
  'unit_placement_requests',
  'unit_cohort_responses',
])
