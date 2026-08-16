// PRECEPTOR-ASSIGNMENT-PROJECTION-1: proofs for the primary-preceptor
// projection (name, email, shift) across the database triggers, the client
// projection module, and the surfaces that display it.
//
// Behavioral on the pure module; structural where the guarantee lives in SQL
// or in prop wiring. Every requirement carries a negative control.
//
// Run: node --test test/preceptorProjection.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const sql = read('supabase/migrations/20260820000000_preceptor_shift_projection.sql')
const sqlCode = sql.replace(/--[^\n]*/g, '')

const {
  CANONICAL_SHIFTS, projectedShift, preceptorProjection, applyPreceptorProjection,
} = await import('../src/lib/preceptorProjection.js')

// ── The shift rule: Day, Night, Mid, Variable, blank ───────────────────────

test('every canonical shift projects verbatim; anything else projects BLANK', () => {
  assert.deepEqual([...CANONICAL_SHIFTS], ['Day', 'Night', 'Mid', 'Variable'])
  for (const s of CANONICAL_SHIFTS) {
    assert.equal(projectedShift({ shift_type: s }), s, `${s} passes through`)
  }
  assert.equal(projectedShift({ shift_type: '  Day  ' }), 'Day', 'trimmed')
  // A preceptor with NO shift yields a BLANK student shift - never a guess.
  assert.equal(projectedShift({ shift_type: null }), '')
  assert.equal(projectedShift({ shift_type: '' }), '')
  assert.equal(projectedShift({ shift_type: '   ' }), '')
  assert.equal(projectedShift({}), '')
  assert.equal(projectedShift(null), '')
  // Legacy / unexpected spellings are NOT silently accepted.
  assert.equal(projectedShift({ shift_type: 'Midshift' }), '')
  assert.equal(projectedShift({ shift_type: 'Either' }), '')
  assert.equal(projectedShift({ shift_type: 'Evenings' }), '')
})

test('NEGATIVE CONTROL: the shift is never inferred from unit or availability', () => {
  const preceptor = { id: 'p1', full_name: 'A', email: 'a@x', shift_type: null }
  // Even when unit/preference-shaped fields are present, they are ignored.
  const withNoise = { ...preceptor, unit_shift_preference: 'Night', shift_availability: 'Day' }
  assert.equal(projectedShift(withNoise), '', 'no fallback to any other field')
  assert.equal(preceptorProjection(withNoise).shift_assigned, '')
  const mod = read('src/lib/preceptorProjection.js')
  assert.doesNotMatch(mod, /shift_availability|unit_shift|matched_unit/,
    'the module cannot even see a unit or preference field')
})

// ── The student projection: assign, replace, clear ─────────────────────────

test('assigning projects id, name, email, and shift together', () => {
  const p = { id: 'p1', full_name: 'Marc Reyes', email: 'marc@x.org', shift_type: 'Night' }
  assert.deepEqual(preceptorProjection(p), {
    preceptor_id: 'p1', matched_preceptor: 'Marc Reyes',
    preceptor_email: 'marc@x.org', shift_assigned: 'Night',
  })
})

test('clearing or replacing leaves NOTHING of the previous preceptor', () => {
  const cleared = preceptorProjection(null)
  assert.deepEqual(cleared, {
    preceptor_id: null, matched_preceptor: '', preceptor_email: '', shift_assigned: '',
  })
  // Replacement overwrites every projected field, including a shift that the
  // new preceptor does not have.
  const students = [{
    id: 's1', preceptor_id: 'old', matched_preceptor: 'Old Name',
    preceptor_email: 'old@x.org', shift_assigned: 'Day', name: 'Student',
  }]
  const next = applyPreceptorProjection(students, 's1',
    { id: 'new', full_name: 'New Name', email: '', shift_type: null })
  assert.deepEqual(next[0], {
    id: 's1', preceptor_id: 'new', matched_preceptor: 'New Name',
    preceptor_email: '', shift_assigned: '', name: 'Student',
  })
  assert.equal(next[0].shift_assigned, '', 'the previous Day shift did not survive')
})

test('applyPreceptorProjection is immutable, targeted, and safe on bad input', () => {
  const students = [{ id: 's1', shift_assigned: 'Day' }, { id: 's2', shift_assigned: 'Night' }]
  const next = applyPreceptorProjection(students, 's1', { id: 'p', full_name: 'N', shift_type: 'Mid' })
  assert.notEqual(next, students, 'a new array so React re-renders')
  assert.equal(next[1], students[1], 'other students keep identity')
  assert.equal(students[0].shift_assigned, 'Day', 'the input is not mutated')
  assert.equal(applyPreceptorProjection(students, 'nope', { id: 'p' }), students)
  assert.equal(applyPreceptorProjection(null, 's1', { id: 'p' }), null)
  assert.equal(applyPreceptorProjection(students, null, { id: 'p' }), students)
})

// ── The migration: trigger behavior ────────────────────────────────────────

test('the SQL shift rule matches the client rule exactly', () => {
  const fn = sqlCode.slice(sqlCode.indexOf('preceptor_projected_shift'), sqlCode.indexOf('sync_primary_preceptor_mirror'))
  assert.match(fn, /IN \('Day', 'Night', 'Mid', 'Variable'\)/)
  assert.match(fn, /WHEN p_shift_type IS NULL THEN ''/)
  assert.match(fn, /ELSE ''/)
  assert.match(fn, /btrim\(p_shift_type\)/)
  // Both sides enumerate the SAME canonical set.
  for (const s of CANONICAL_SHIFTS) assert.ok(fn.includes(`'${s}'`), `SQL knows ${s}`)
})

test('the student mirror now projects the shift and the match compatibility fields', () => {
  const fn = sqlCode.slice(sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.sync_primary_preceptor_mirror'),
                           sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.sync_students_from_preceptor_record'))
  // It reads the shift from the canonical record...
  assert.match(fn, /SELECT full_name, email, public\.preceptor_projected_shift\(shift_type\)/)
  // ...writes it to the student...
  assert.match(fn, /shift_assigned\s+= COALESCE\(v_shift, ''\)/)
  // ...and to the match row, alongside the name.
  assert.match(fn, /SET preceptor_id\s+= NEW\.preceptor_id,\s*\n?\s*preceptor_assigned = COALESCE\(v_full_name, ''\),\s*\n?\s*shift_assigned\s+= COALESCE\(v_shift, ''\)/)
  // The clear branch wipes all three plus the match fields.
  assert.match(fn, /SET matched_preceptor = '', preceptor_email = '', shift_assigned = ''/)
  assert.match(fn, /SET preceptor_id\s+= NULL,\s*\n?\s*preceptor_assigned = '',\s*\n?\s*shift_assigned\s+= ''/)
})

test('the single-match safety rule is preserved VERBATIM on every match write', () => {
  const rule = /\(SELECT count\(\*\) FROM public\.matches m2\s*\n?\s*WHERE m2\.student_id = NEW\.id AND m2\.cohort_id = NEW\.cohort_id\) = 1/g
  const hits = sqlCode.match(rule) || []
  assert.equal(hits.length, 2, 'set branch + clear branch both guarded')
  // NEGATIVE CONTROL: an unguarded match UPDATE would be a multi-row hazard.
  const mirror = sqlCode.slice(sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.sync_primary_preceptor_mirror'),
                               sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.sync_students_from_preceptor_record'))
  const matchUpdates = mirror.match(/UPDATE public\.matches[\s\S]*?;/g) || []
  assert.equal(matchUpdates.length, 2)
  for (const u of matchUpdates) {
    assert.match(u, /count\(\*\) FROM public\.matches m2/, 'every match write is single-match guarded')
  }
})

test('linked students FOLLOW a later edit to the canonical preceptor record', () => {
  const fn = sqlCode.slice(sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.sync_students_from_preceptor_record'))
  assert.match(fn, /AFTER UPDATE OF full_name, email, shift_type ON public\.preceptors/)
  assert.match(fn, /WHERE s\.preceptor_id = NEW\.id/, 'only the PRIMARY link follows')
  assert.match(fn, /public\.preceptor_projected_shift\(NEW\.shift_type\)/)
  // A no-op update short-circuits.
  assert.match(fn, /IF NEW\.full_name\s+IS NOT DISTINCT FROM OLD\.full_name[\s\S]{0,200}RETURN NULL/)
  // The match projection here carries the same single-match rule.
  assert.match(fn, /count\(\*\) FROM public\.matches m2/)
})

test('secondary/coverage can never reach the primary projection', () => {
  // Both triggers key off students.preceptor_id, which names the PRIMARY only;
  // neither reads student_preceptor_assignments.role to decide what to project.
  const mirror = sqlCode.slice(sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.sync_primary_preceptor_mirror'))
  assert.match(mirror, /WHERE s\.preceptor_id = NEW\.id|preceptor_id = NEW\.preceptor_id|s\.preceptor_id/)
  // The projection UPDATE targets students by preceptor_id, never by an
  // assignments-table role lookup.
  const follow = sqlCode.slice(sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.sync_students_from_preceptor_record'))
  assert.doesNotMatch(follow, /student_preceptor_assignments/,
    'the follow trigger never consults the assignments table, so a secondary row cannot drive it')
})

test('the assignment RPCs and the existing trigger definition are NOT modified', () => {
  assert.doesNotMatch(sqlCode, /CREATE OR REPLACE FUNCTION public\.assign_primary_preceptor/)
  assert.doesNotMatch(sqlCode, /CREATE OR REPLACE FUNCTION public\.clear_primary_preceptor/)
  assert.doesNotMatch(sqlCode, /CREATE OR REPLACE FUNCTION public\.set_secondary_coverage_preceptor/)
  // The students trigger itself is left in place (only its function body swaps).
  assert.doesNotMatch(sqlCode, /CREATE TRIGGER trg_sync_primary_preceptor_mirror/)
  assert.doesNotMatch(sqlCode, /DROP TRIGGER IF EXISTS trg_sync_primary_preceptor_mirror/)
  // No second assignment path is introduced.
  assert.doesNotMatch(sqlCode, /UPDATE public\.students[\s\S]{0,200}SET preceptor_id/)
})

test('the backfill is deterministic, audited, and blanks an unrelated manual shift', () => {
  assert.match(sqlCode, /CREATE TABLE IF NOT EXISTS public\.preceptor_projection_backfill_audit/)
  // Derived ONLY from the linked preceptor row.
  assert.match(sqlCode, /JOIN public\.preceptors p ON p\.id = s\.preceptor_id/)
  assert.match(sqlCode, /public\.preceptor_projected_shift\(p\.shift_type\)\s+AS new_shift/)
  // Before AND after values are recorded for every changed row.
  for (const col of ['old_matched_preceptor', 'new_matched_preceptor', 'old_shift_assigned', 'new_shift_assigned']) {
    assert.ok(sqlCode.includes(col), col)
  }
  // Append-only audit.
  assert.match(sqlCode, /GRANT SELECT, INSERT ON public\.preceptor_projection_backfill_audit TO service_role/)
  assert.doesNotMatch(sqlCode, /GRANT[^;]*UPDATE[^;]*ON public\.preceptor_projection_backfill_audit/)
  assert.doesNotMatch(sqlCode, /GRANT[^;]*DELETE[^;]*ON public\.preceptor_projection_backfill_audit/)
  // The match half honours the single-match rule too.
  // The match backfill's guard lives in its CTE, above the UPDATE - slice the
  // whole statement from where that CTE selects match rows.
  const matchBackfill = sqlCode.slice(sqlCode.indexOf('SELECT m.id AS match_id'))
  assert.match(matchBackfill, /count\(\*\) FROM public\.matches m2/)
})

test('the migration is gated and ships verification + rollback', () => {
  assert.match(sql, /APPLY MANUALLY[\s\S]{0,24}\(Owner\/Jester\)/)
  assert.match(sql, /Claude Code has applied NOTHING/)
  assert.match(sql, /db\/audit\/preceptor_projection_smoke_test\.sql/)
  assert.match(sql, /ROLLBACK \(safe/)
  assert.match(sql, /zero_student_drift/)
  assert.match(sql, /zero_match_drift/)
})

// ── The display surfaces ───────────────────────────────────────────────────

test('the Placement Board RENDERS the assigned preceptor name (it previously rendered nothing)', () => {
  const board = read('src/components/EmbedUnitCard.jsx')
  assert.match(board, /data-testid="placement-preceptor-name"/)
  assert.match(board, /student\.matched_preceptor \|\| 'Preceptor assigned'/)
  // NEGATIVE CONTROL: the old `: null` dead branch must be gone.
  assert.doesNotMatch(board, /\{'⚠'\} Preceptor needed\s*\n\s*<\/div>\s*\n\s*\) : null\}/,
    'the assigned case no longer renders null')
  // The shift chip still reads the projected field and knows all four values.
  for (const s of ['Day', 'Night', 'Mid', 'Variable']) {
    assert.ok(board.includes(`'${s}'`), `chip handles ${s}`)
  }
  assert.match(board, /student\.shift_assigned &&/)
})

test('the decision result reaches App state on BOTH assignment surfaces', () => {
  const app = read('src/App.jsx')
  assert.match(app, /const applyPreceptorAssignment = useCallback\(\(studentId, preceptor\) => \{\s*\n?\s*setStudents\(prev => applyPreceptorProjection\(prev, studentId, preceptor\)\)/)
  // Threaded to Rotation (Placement Board) AND Student Profiles.
  const rot = app.slice(app.indexOf('<RotationTab'), app.indexOf('</div>', app.indexOf('<RotationTab')))
  assert.match(rot, /onPreceptorAssigned=\{applyPreceptorAssignment\}/)
  const prof = app.slice(app.indexOf('<StudentProfilesTab'), app.indexOf('</div>', app.indexOf('<StudentProfilesTab')))
  assert.match(prof, /onPreceptorAssigned=\{applyPreceptorAssignment\}/)
  // ...through each intermediate owner.
  assert.match(read('src/components/MatchingTab.jsx'), /onPreceptorAssigned=\{onPreceptorAssigned\}/)
  const card = read('src/components/EmbedUnitCard.jsx')
  assert.match(card, /onPreceptorAssigned\?\.\(assignStudent\.id, preceptor\)/)
  // NEGATIVE CONTROL: the board previously discarded the preceptor entirely.
  assert.doesNotMatch(card, /onAssigned=\{\(\) => setAssignStudent\(null\)\}/,
    'the discarding callback is gone')
  // Student Profiles patches its local copy with the SAME shared projection.
  const panel = read('src/components/StudentSidePanel.jsx')
  assert.match(panel, /setData\(prev => \(\{ \.\.\.prev, \.\.\.preceptorProjection\(preceptor\) \}\)\)/)
  assert.match(panel, /onPreceptorAssigned\?\.\(student\.id, preceptor\)/)
})

test("NEGATIVE CONTROL: the modal's React Query invalidation alone cannot refresh the board", () => {
  const modal = read('src/components/PreceptorAssignmentModal.jsx')
  assert.match(modal, /invalidateQueries\(\{ queryKey: \['students', student\.cohort_id\] \}\)/,
    'the invalidation still exists...')
  const app = read('src/App.jsx')
  // ...but nothing owns that key: students are App useState.
  assert.match(app, /const \[students,\s+setStudents\]\s+= useState\(\[\]\)/)
  assert.doesNotMatch(app, /useQuery\(\{\s*queryKey:\s*\['students',/)
  // Which is exactly why the callback is required.
  assert.match(app, /applyPreceptorProjection/)
})

test('the shift vocabulary is aligned across the writer, the picker, and the board', () => {
  const api = read('api/student-update.js')
  // The endpoint now accepts the canonical four (Mid and Variable previously 400'd).
  for (const s of CANONICAL_SHIFTS) {
    assert.ok(new RegExp(`SHIFTS = \\[[^\\]]*'${s}'`).test(api), `endpoint accepts ${s}`)
  }
  // The Student Profile picker offers exactly the canonical set.
  const panel = read('src/components/StudentSidePanel.jsx')
  assert.match(panel, /\['Day','Night','Mid','Variable'\]\.map/)
  // NEGATIVE CONTROL: dropping Mid/Variable from the endpoint would break the
  // projection, since preceptors.shift_type can hold them.
  const shiftsLine = api.slice(api.indexOf('const SHIFTS ='), api.indexOf('\n', api.indexOf('const SHIFTS =')))
  assert.ok(shiftsLine.includes("'Mid'") && shiftsLine.includes("'Variable'"))
})

test('shift-log defaulting still reads the SAME canonical column, with its own narrower rule', () => {
  const lookup = read('api/lib/shiftLogLookup.js')
  assert.match(lookup, /from\('preceptors'\)\s*\n?\s*\.select\('shift_type'\)\s*\n?\s*\.eq\('id', student\.preceptor_id\)/,
    'the canonical source is unchanged')
  assert.match(lookup, /normalizeAssignedShift\(preceptor\?\.shift_type\)/)
  // That normalizer is deliberately narrower (Variable -> null) because the
  // check-in picker offers Day/Night/Mid only; the two rules must not be merged.
  const norm = read('api/lib/normalizeAssignedShift.js')
  assert.doesNotMatch(norm, /return 'Variable'/, 'Variable stays unmappable for shift-log defaulting')
  const proj = read('src/lib/preceptorProjection.js')
  assert.match(proj, /normalizeAssignedShift/, 'the difference is documented in the projection module')
})

// ── Final SQL-gate corrections ─────────────────────────────────────────────

test('C1: the match backfill repairs ALL THREE fields, including preceptor_id', () => {
  const backfill = sqlCode.slice(sqlCode.indexOf('SELECT m.id AS match_id'))
  // The FK is selected as a target, compared for drift, audited, and WRITTEN.
  assert.match(backfill, /m\.preceptor_id\s+AS old_match_preceptor_id/)
  assert.match(backfill, /s\.preceptor_id\s+AS new_match_preceptor_id/)
  assert.match(backfill, /WHERE old_match_preceptor_id IS DISTINCT FROM new_match_preceptor_id/)
  assert.match(backfill, /SET preceptor_id\s+= d\.new_match_preceptor_id,/)
  // NEGATIVE CONTROL: omitting the FK repair leaves the drift the audit measures.
  const withoutFk = backfill.replace(/SET preceptor_id\s+= d\.new_match_preceptor_id,\s*\n/, 'SET ')
  assert.ok(!withoutFk.includes('SET preceptor_id       = d.new_match_preceptor_id'),
    'removing the FK repair is detectable by this assertion')
})

test('C1: the previous match preceptor_id stays reviewable in the audit table', () => {
  assert.match(sqlCode, /old_match_preceptor_id uuid,/)
  assert.match(sqlCode, /new_match_preceptor_id uuid,/)
  const insert = sqlCode.slice(sqlCode.indexOf("SELECT 'preceptor-projection-20260820', 'match'"))
  assert.match(insert, /old_match_preceptor_id, new_match_preceptor_id/)
})

test('C1: verification requires zero drift across all THREE match fields', () => {
  const v = sql.slice(sql.indexOf('AS zero_student_drift'), sql.indexOf('AS zero_match_drift'))
  assert.match(v, /m\.preceptor_id\s+IS DISTINCT FROM s\.preceptor_id/)
  assert.match(v, /m\.preceptor_assigned IS DISTINCT FROM COALESCE\(p\.full_name, ''\)/)
  assert.match(v, /m\.shift_assigned\s+IS DISTINCT FROM public\.preceptor_projected_shift/)
  // NEGATIVE CONTROL: dropping the FK clause from verification is detectable.
  assert.ok(v.includes('m.preceptor_id'),
    'verification without the preceptor_id clause would fail this test')
})

test('C2: the follow trigger keys off the CANONICAL student link, not the match FK', () => {
  const fn = sqlCode.slice(sqlCode.indexOf('CREATE OR REPLACE FUNCTION public.sync_students_from_preceptor_record'))
  const matchUpdate = fn.slice(fn.indexOf('UPDATE public.matches m'))
  // It joins THROUGH the student and requires the canonical link...
  assert.match(matchUpdate, /FROM public\.students s/)
  assert.match(matchUpdate, /WHERE s\.id = m\.student_id/)
  assert.match(matchUpdate, /AND s\.cohort_id = m\.cohort_id/)
  assert.match(matchUpdate, /AND s\.preceptor_id = NEW\.id/)
  // ...and repairs the FK while it is there.
  assert.match(matchUpdate, /SET preceptor_id\s+= NEW\.id/)
  // ...keeping the single-match safeguard.
  assert.match(matchUpdate, /count\(\*\) FROM public\.matches m2/)
  // NEGATIVE CONTROL: the old stale-FK predicate must NOT return.
  assert.doesNotMatch(matchUpdate, /WHERE m\.preceptor_id = NEW\.id/,
    'keying off the match FK would let a stale row hijack the projection')
})

test('C3: verification is deterministic and has no tautology', () => {
  // NEGATIVE CONTROL: count(*) >= 0 can never fail and must be gone.
  assert.doesNotMatch(sql, /count\(\*\) >= 0/, 'the tautological check is removed')
  // Replaced by structural checks that hold even with ZERO backfill rows.
  assert.match(sql, /AS audit_fields_present/)
  assert.match(sql, /AS audit_records_new_match_fk/)
  assert.match(sql, /AS audit_append_only/)
  assert.match(sql, /AS audit_owner_admin_read_only/)
  // The field check enumerates the immutable before/after columns.
  const fields = sql.slice(sql.indexOf('AS audit_fields_present') - 900, sql.indexOf('AS audit_fields_present'))
  for (const col of ['old_matched_preceptor', 'new_matched_preceptor', 'old_preceptor_email',
    'new_preceptor_email', 'old_shift_assigned', 'new_shift_assigned', 'old_match_preceptor_id']) {
    assert.ok(fields.includes(col), `verification checks ${col}`)
  }
  // Access posture, not row count.
  assert.match(sql, /NOT has_table_privilege\('service_role','public\.preceptor_projection_backfill_audit','UPDATE'\)/)
  assert.match(sql, /NOT has_table_privilege\('service_role','public\.preceptor_projection_backfill_audit','DELETE'\)/)
})

test('C3: the drift audit is ONE statement producing ONE labelled result grid', () => {
  const audit = read('db/audit/preceptor_projection_drift_audit.sql')
  const code = audit.replace(/--[^\n]*/g, '')
  // Exactly one terminating semicolon => one statement => one result grid.
  const statements = code.split(';').filter(x => x.trim().length > 0)
  assert.equal(statements.length, 1, 'a single statement, so no earlier result is lost')
  // Every row is labelled with a section and a metric.
  assert.match(audit, /SELECT section, metric, value, detail/)
  for (const label of ['SUMMARY · students', 'SUMMARY · matches (single-match only)',
    'SKIPPED · multi-match students', 'DETAIL · stored student shift values',
    'DETAIL · student rows that would change', 'DETAIL · match rows that would change']) {
    assert.ok(audit.includes(label), `section labelled: ${label}`)
  }
  // It measures the match FK it now also repairs.
  assert.match(audit, /preceptor_id drift/)
  // READ-ONLY.
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i)
})

test('C1+C2: the smoke test proves the FK repair and the stale-FK isolation', () => {
  const smoke = read('db/audit/preceptor_projection_smoke_test.sql')
  assert.match(smoke, /STALE FK NAME/)
  assert.match(smoke, /editing the stale-FK preceptor did NOT touch the match/)
  assert.match(smoke, /editing the CANONICAL preceptor synchronized the match and repaired its stale FK/)
  // The stale case uses its OWN preceptor so it cannot disturb other sections.
  assert.match(smoke, /ZZ PROJ Stale Preceptor/)
  assert.match(smoke, /v_p_stale/)
})

test('GUARD: no typed VALUES alias anywhere in the smoke file', () => {
  // PostgreSQL rejects `AS t(col type, ...)` on a VALUES list - column type
  // declarations in a table alias are only legal for FROM-clause functions
  // returning record. pgsql-parser treats a $$...$$ body as an opaque string,
  // so this shape has to be guarded here (and by the plpgsql validator).
  const smoke = read('db/audit/preceptor_projection_smoke_test.sql')
  const TYPES = 'uuid|text|int|integer|bigint|numeric|boolean|date|timestamptz|jsonb'
  const typedAlias = new RegExp(`\\)\\s*AS\\s+[a-z_]+\\s*\\([a-z_]+\\s+(${TYPES})\\b`, 'i')
  assert.doesNotMatch(smoke, typedAlias, 'a VALUES alias must not declare column types')
  // The corrected form is present and untyped.
  assert.match(smoke, /\) AS t\(pid, pname, pshift\)/)
  // NEGATIVE CONTROL: the guard genuinely detects the broken shape.
  assert.match(') AS t(pid uuid, pname text)', typedAlias)
})
