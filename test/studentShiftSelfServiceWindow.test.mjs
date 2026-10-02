import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20261027000000_student_shift_self_service_window.sql')
const old = read('supabase/migrations/20260819000000_student_shift_log_self_service.sql')
const audit = old.slice(old.indexOf('CREATE TABLE IF NOT EXISTS public.student_shift_log_edits'), old.indexOf('-- Unlike the staff ledger'))
const classify = old.slice(old.indexOf('CREATE OR REPLACE FUNCTION public.student_shift_classify'), old.indexOf('-- ── 5.'))
const reviewed = read('supabase/migrations/20260901010000_student_rotation_activity.sql')
const revise = reviewed.slice(reviewed.indexOf('CREATE OR REPLACE FUNCTION public.student_revise_shift_log'), reviewed.indexOf('-- Existing clients call'))
const student = '00000000-0000-0000-0000-000000000001'
const shift = '00000000-0000-0000-0000-000000000002'
const rotation = '00000000-0000-0000-0000-000000000003'
const actor = '00000000-0000-0000-0000-000000000004'

test('real SQL: only hours AND passed window lock; reviewed deletion audits and recalculates', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE cohorts(id uuid PRIMARY KEY);
      CREATE TABLE user_profiles(id uuid PRIMARY KEY);
      CREATE TABLE cohort_school_rotations(id uuid PRIMARY KEY, rotation_end_date date);
      CREATE TABLE students(id uuid PRIMARY KEY, hours_required numeric, approved_hours numeric, pending_hours numeric,
        cohort_school_rotation_id uuid, status text, rotation_completed_at timestamptz);
      CREATE TABLE student_shift_logs(id uuid PRIMARY KEY, student_id uuid, cohort_id uuid, status text,
        lifecycle_state text, total_hours numeric, shift_date text, unit_name text, preceptor_name text,
        shift_type text, exception_flags jsonb, review_reason text);
      CREATE FUNCTION student_shift_edit_ready() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
      ${audit}
      ${migration}
      INSERT INTO user_profiles VALUES ('${actor}');
      INSERT INTO cohort_school_rotations VALUES ('${rotation}', CURRENT_DATE + 5);
      INSERT INTO students VALUES ('${student}', 7.5, 999, 999, '${rotation}', 'Completed', now());
      INSERT INTO student_shift_logs VALUES ('${shift}', '${student}', NULL, 'Approved', 'completed', 7.5,
        '2026-09-01', 'PACU', 'Susie', 'Day', '[]', NULL);
    `)
    const eligibility = async (id = student) => (await db.query(
      'SELECT student_shift_edit_eligibility($1, $2) AS result', [shift, id])).rows[0].result
    assert.equal((await eligibility()).editable, true, 'manual Completed does not lock; hours done but window open')
    await db.exec("UPDATE cohort_school_rotations SET rotation_end_date = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date")
    assert.equal((await eligibility()).editable, true, 'last rotation day is still editable')
    await db.exec("UPDATE cohort_school_rotations SET rotation_end_date = CURRENT_DATE - 5")
    assert.deepEqual(await eligibility(), { editable: false, reason: 'rotation_window_closed' })
    await db.exec('UPDATE students SET hours_required = 8')
    assert.equal((await eligibility()).editable, true, 'window passed but required hours incomplete')
    await db.exec("UPDATE cohort_school_rotations SET rotation_end_date = '1900-01-01'; UPDATE students SET hours_required = 7.5")
    assert.equal((await eligibility()).editable, true, 'unknown window is not a passed window')
    assert.deepEqual(await eligibility(actor), { editable: false, reason: 'not_found' }, 'ownership cannot be bypassed')

    for (const status of ['Approved', 'Auto-Accepted', 'Pending Review', 'Rejected']) {
      await db.query("UPDATE student_shift_logs SET status=$1, lifecycle_state='completed'", [status])
      const result = (await db.query('SELECT student_void_shift_log($1,$2,$3,$4) AS result',
        [shift, student, actor, 'Duplicate log'])).rows[0].result
      assert.equal(result.ok, true, status + ' can be deleted')
      assert.equal(result.approved_hours, 0)
      assert.equal(result.pending_hours, 0)
      assert.deepEqual(await eligibility(), { editable: false, reason: 'already_voided' })
    }
    const { rows } = await db.query('SELECT before_status, before_total_hours, after_lifecycle_state, reason FROM student_shift_log_edits ORDER BY id')
    assert.equal(rows.length, 4, 'each change retained its audit')
    assert.equal(rows[0].before_status, 'Approved')
    assert.equal(Number(rows[0].before_total_hours), 7.5)
    assert.ok(rows.every(r => r.after_lifecycle_state === 'voided' && r.reason === 'Duplicate log'))
    await db.exec("UPDATE student_shift_logs SET status='Approved', lifecycle_state='completed'; UPDATE cohort_school_rotations SET rotation_end_date = CURRENT_DATE - 5")
    await assert.rejects(db.query('SELECT student_void_shift_log($1,$2,$3,NULL)', [shift, student, actor]),
      /rotation_window_closed/)
    assert.equal((await db.query('SELECT count(*) AS n FROM student_shift_log_edits')).rows[0].n, 4)
    // Run the existing reviewed-edit writer with the NEW eligibility rule and
    // the actual classifier, not a substitute edit implementation.
    await db.exec(`
      ALTER TABLE students ADD COLUMN matched_preceptor text, ADD COLUMN matched_unit_id uuid;
      ALTER TABLE cohort_school_rotations ADD COLUMN rotation_start_date date;
      ALTER TABLE student_shift_logs
        ADD COLUMN is_assigned_unit boolean, ADD COLUMN unit_override_reason text,
        ADD COLUMN is_assigned_preceptor boolean, ADD COLUMN preceptor_override_note text,
        ADD COLUMN learning_highlight text, ADD COLUMN support_needed text,
        ADD COLUMN admin_notes text, ADD COLUMN reviewed_by uuid, ADD COLUMN reviewed_at timestamptz;
      ${classify}
      ${revise}
      UPDATE students SET hours_required = 8;
    `)
    const edit = (await db.query(`
      SELECT student_revise_shift_log($1,$2,$3,'2026-09-02',7.5,'PACU',true,'',
        'Susie',true,'','Day','Learning','','Correct hours') AS result
    `, [shift, student, actor])).rows[0].result
    assert.equal(edit.status, 'Pending Review')
    assert.equal(edit.total_hours, 7.5)
    assert.equal(edit.approved_hours, 0)
    assert.equal(edit.pending_hours, 7.5)
    assert.equal((await db.query('SELECT count(*) AS n FROM student_shift_log_edits')).rows[0].n, 5)
  } finally { await db.close() }
})
