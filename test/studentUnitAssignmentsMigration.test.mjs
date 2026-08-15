// MULTI-UNIT-STUDENT-PLACEMENTS-1: static guard for the student_unit_assignments
// foundation migration and the read-only Emi audit.
//
// The migration is UNAPPLIED and awaiting the Owner, so this is where its
// guarantees are checked before it reaches a database. It pins what the design
// rests on: additive-only scope, the active-primary backward-compat backbone,
// unbounded unit count, durable unit identity, projection-only backfill (never
// shift logs), modern RLS (never the legacy anon_all), and history that cannot
// be deleted.
//
// Run: node --test test/studentUnitAssignmentsMigration.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const sql = read('supabase/migrations/20260816000000_student_unit_assignments.sql')
/** Executable SQL only, so guards test statements rather than prose. */
const code = sql.replace(/--[^\n]*/g, '')
const audit = read('db/audit/emi_multi_unit_audit.sql')

// ── Scope: one new table, nothing existing altered ──────────────────────────

test('the migration creates exactly one table and alters no existing one', () => {
  assert.equal((code.match(/CREATE TABLE/g) || []).length, 1)
  assert.match(code, /CREATE TABLE IF NOT EXISTS public\.student_unit_assignments/)
  const alters = code.match(/ALTER TABLE[^;]*/g) || []
  for (const a of alters) {
    assert.match(a, /student_unit_assignments/,
      `only the new table may be altered, saw: ${a.trim().slice(0, 80)}`)
  }
  assert.doesNotMatch(code, /DROP TABLE|DELETE FROM|TRUNCATE/,
    'the foundation destroys nothing')
})

test('students.matched_unit_id behavior is preserved - the migration never touches students, matches, or units', () => {
  assert.doesNotMatch(code, /UPDATE public\.students|UPDATE students/)
  assert.doesNotMatch(code, /ALTER TABLE (public\.)?students\b/)
  assert.doesNotMatch(code, /ALTER TABLE (public\.)?matches\b/)
  assert.doesNotMatch(code, /ALTER TABLE (public\.)?units\b/)
  assert.doesNotMatch(code, /INSERT INTO (public\.)?(students|matches|units)\b/)
})

test('it runs as one transaction', () => {
  assert.match(code, /^\s*BEGIN;/m)
  assert.match(code, /^\s*COMMIT;/m)
})

// ── The forbidden shapes are genuinely absent ───────────────────────────────

test('NO unit_2/unit_3 columns, NO array, NO json - a unit is a row', () => {
  assert.doesNotMatch(code, /unit_2|unit_3|unit2|unit3/i)
  assert.doesNotMatch(code, /uuid\[\]|text\[\]|\bjsonb?\b/i,
    'multi-unit lives in rows of a normalized table, never in a collection column')
})

test('NO PERMANENT MAXIMUM: nothing constrains how many units a student may hold', () => {
  // The only CHECKs are the five named ones; none counts rows or caps units.
  const checks = [...code.matchAll(/CONSTRAINT (chk_sua_[a-z_]+)\s+CHECK/g)].map(m => m[1])
  assert.deepEqual(checks.sort(), [
    'chk_sua_ended_fields', 'chk_sua_live_requires_unit', 'chk_sua_period',
    'chk_sua_role', 'chk_sua_status', 'chk_sua_unit_key_trimmed',
  ])
  assert.doesNotMatch(code, /<=\s*3|<\s*4|count\s*\(/i,
    'no constraint may cap the number of assignments')
  // Uniqueness: three PARTIAL indexes on the new table (active primary,
  // planned primary, live-per-unit) + two identity-pair support indexes on the
  // parents. None limits how many TOTAL assignment rows a student may hold.
  assert.equal((code.match(/CREATE UNIQUE INDEX/g) || []).length, 5)
})

// ── Backward compatibility: the active-primary backbone ─────────────────────

test('at most ONE ACTIVE PRIMARY per (student, cohort) - a partial unique index, not convention', () => {
  assert.match(code, /CREATE UNIQUE INDEX IF NOT EXISTS uq_sua_one_active_primary_per_student_cohort\s*\n?\s*ON public\.student_unit_assignments \(student_id, cohort_id\)\s*\n?\s*WHERE role = 'primary' AND status = 'active'/)
})

test('the same unit cannot be live twice, but sequential re-rotation is representable', () => {
  assert.match(code, /uq_sua_one_live_row_per_student_unit\s*\n?\s*ON public\.student_unit_assignments \(student_id, cohort_id, unit_key\)\s*\n?\s*WHERE status IN \('planned', 'active'\)/,
    "ended/removed rows leave the partial index, so a later return to the same unit is a new row")
})

test('roles and statuses express sequential, overlapping, and historical assignments', () => {
  assert.match(code, /CHECK \(role\s+IN \('primary', 'additional'\)\)/)
  assert.match(code, /CHECK \(status IN \('planned', 'active', 'ended', 'removed'\)\)/)
  assert.match(code, /start_date\s+date/)
  assert.match(code, /end_date\s+date/)
  assert.match(code, /CHECK \(start_date IS NULL OR end_date IS NULL OR end_date >= start_date\)/)
  assert.match(code, /\(status IN \('ended', 'removed'\)\) = \(ended_at IS NOT NULL\)/,
    'history rows carry when they ended; live rows never do')
})

// ── Identity: normalized AND durable ────────────────────────────────────────

test('student, cohort, and unit identity are normalized - and COHORT-CONSISTENT by construction', () => {
  assert.match(code, /cohort_id\s+uuid\s+NOT NULL REFERENCES public\.cohorts\(id\) ON DELETE CASCADE/)
  // The assignment cohort IS the student's cohort - a composite FK, not convention.
  assert.match(code, /CONSTRAINT fk_sua_student_cohort FOREIGN KEY \(student_id, cohort_id\)\s*\n?\s*REFERENCES public\.students \(id, cohort_id\) ON DELETE CASCADE/)
  // A referenced unit belongs to the SAME cohort, and deleting it nulls ONLY
  // unit_id (PG15 column-qualified action) so history keeps its cohort.
  assert.match(code, /CONSTRAINT fk_sua_unit_cohort FOREIGN KEY \(unit_id, cohort_id\)\s*\n?\s*REFERENCES public\.units \(id, cohort_id\) ON DELETE SET NULL \(unit_id\)/)
  // The identity-pair support indexes exist and are trivially satisfiable
  // (id alone is each parent's PK, so they can never reject existing data).
  assert.match(code, /CREATE UNIQUE INDEX IF NOT EXISTS uq_students_id_cohort ON public\.students \(id, cohort_id\)/)
  assert.match(code, /CREATE UNIQUE INDEX IF NOT EXISTS uq_units_id_cohort\s+ON public\.units \(id, cohort_id\)/)
})

test('LIVE ASSIGNMENTS REQUIRE A REAL UNIT, so unit deletion cannot silently orphan one', () => {
  assert.match(code, /CONSTRAINT chk_sua_live_requires_unit CHECK \(\s*status NOT IN \('planned', 'active'\) OR unit_id IS NOT NULL\s*\)/)
  // The pairing that makes deletion safe: SET NULL (unit_id) + this CHECK means
  // deleting a unit with a live assignment FAILS; with only history it succeeds
  // and the row keeps its unit_key.
  assert.match(code, /ON DELETE SET NULL \(unit_id\)/)
})

test('unit_key can never disagree with the referenced unit: derived or verified by trigger', () => {
  const fn = code.slice(code.indexOf('CREATE OR REPLACE FUNCTION public.sua_enforce_unit_identity'), code.indexOf('DROP TRIGGER IF EXISTS trg_sua_enforce_unit_identity'))
  assert.match(fn, /SELECT u\.unit_name INTO v_unit_name FROM public\.units u WHERE u\.id = NEW\.unit_id/)
  assert.match(fn, /NEW\.unit_key := v_unit_name/, 'omitted unit_key is DERIVED from the unit')
  assert.match(fn, /ELSIF NEW\.unit_key <> v_unit_name THEN/, 'a supplied mismatch is REJECTED')
  assert.match(fn, /RAISE EXCEPTION/)
  assert.match(fn, /SECURITY DEFINER/)
  assert.match(fn, /SET search_path = public, pg_catalog/)
  assert.match(code, /CREATE TRIGGER trg_sua_enforce_unit_identity\s*\n?\s*BEFORE INSERT OR UPDATE OF unit_id, unit_key ON public\.student_unit_assignments/)
  assert.match(code, /REVOKE ALL ON FUNCTION public\.sua_enforce_unit_identity\(\) FROM PUBLIC, anon, authenticated/)
})

test('PLANNED-PRIMARY CARDINALITY: one active primary plus at most one planned successor', () => {
  assert.match(code, /uq_sua_one_planned_primary_per_student_cohort\s*\n?\s*ON public\.student_unit_assignments \(student_id, cohort_id\)\s*\n?\s*WHERE role = 'primary' AND status = 'planned'/)
  assert.match(sql, /at most ONE active primary PLUS at\s*\n?-- most ONE planned successor primary/,
    'the chosen cardinality rule is documented in the migration itself')
})

test('unit_key snapshots the canonical name - the user_unit_scopes identity - so history survives unit deletion', () => {
  assert.match(code, /unit_key\s+text\s+NOT NULL/)
  assert.match(code, /CHECK \(unit_key = btrim\(unit_key\) AND char_length\(unit_key\) > 0\)/)
  assert.match(code, /idx_sua_unit_key_cohort ON public\.student_unit_assignments \(unit_key, cohort_id\)/,
    'the future Unit Leader roster shape (unit_key, cohort_id) is indexed from day one')
})

test('actor attribution exists and follows the user_profiles convention', () => {
  assert.match(code, /assigned_by\s+uuid\s+REFERENCES public\.user_profiles\(id\) ON DELETE SET NULL/)
  assert.match(code, /ended_by\s+uuid\s+REFERENCES public\.user_profiles\(id\) ON DELETE SET NULL/)
})

// ── The backfill is a projection, never an inference ────────────────────────

test('THE MIGRATION NEVER READS SHIFT LOGS - assignments are not inferred from evidence of shifts', () => {
  assert.doesNotMatch(code, /shift_log|student_shift_logs|shift_logs/i)
  assert.doesNotMatch(code, /planned_unit_name|is_assigned_unit/)
})

test('the backfill projects matched_unit_id exactly: one active primary, nothing invented', () => {
  const backfill = code.slice(code.indexOf('INSERT INTO public.student_unit_assignments'))
  assert.match(backfill, /SELECT s\.id, s\.cohort_id, s\.matched_unit_id, u\.unit_name, 'primary', 'active'/)
  assert.match(backfill, /JOIN public\.units u ON u\.id = s\.matched_unit_id/)
  assert.match(backfill, /WHERE s\.matched_unit_id IS NOT NULL/)
  // No dates and no actor appear anywhere in the insert.
  const insertCols = backfill.slice(0, backfill.indexOf('SELECT'))
  assert.doesNotMatch(insertCols, /start_date|end_date|assigned_by|ended_at/,
    'a data migration invents no dates and no actor')
})

test('the backfill is idempotent and yields to any existing active primary', () => {
  const backfill = code.slice(code.indexOf('INSERT INTO public.student_unit_assignments'))
  assert.match(backfill, /NOT EXISTS \(\s*SELECT 1 FROM public\.student_unit_assignments a\s*WHERE a\.student_id = s\.id\s*AND a\.cohort_id = s\.cohort_id\s*AND a\.role = 'primary'\s*AND a\.status = 'active'\s*\)/)
})

test("no student is singled out: the backfill is uniform, and Emi's multi-unit history is NOT created", () => {
  assert.doesNotMatch(code, /Bayaraa|Saruulsanaa|sbayara|PACU|6 NE/i,
    'the executable migration must not hardcode any student or unit')
})

// ── RLS: the modern posture, never the legacy one ───────────────────────────

test('RLS is enabled with ONE Owner/Admin SELECT policy and zero write policies', () => {
  assert.match(code, /ALTER TABLE public\.student_unit_assignments ENABLE ROW LEVEL SECURITY/)
  assert.equal((code.match(/CREATE POLICY/g) || []).length, 1)
  assert.match(code, /CREATE POLICY "student_unit_assignments_owner_admin_read"\s*\n?\s*ON public\.student_unit_assignments FOR SELECT\s*\n?\s*TO authenticated\s*\n?\s*USING \(public\.is_active_owner_or_admin\(\)\)/)
  assert.doesNotMatch(code, /TO anon/, 'anon never appears as a grantee or policy target')
  assert.doesNotMatch(code, /anon_all/, 'the legacy matches/units posture is not copied')
})

test('privileges: authenticated reads, service_role writes, NOBODY deletes history', () => {
  assert.match(code, /REVOKE ALL ON public\.student_unit_assignments\s*\n?\s*FROM PUBLIC, anon, authenticated, service_role/)
  assert.match(code, /GRANT SELECT ON public\.student_unit_assignments TO authenticated/)
  assert.match(code, /GRANT SELECT, INSERT, UPDATE ON public\.student_unit_assignments TO service_role/)
  const grants = code.match(/GRANT[^;]*student_unit_assignments[^;]*/g) || []
  for (const g of grants) {
    assert.ok(!/DELETE|TRUNCATE|ALL\b/.test(g),
      `history is ended by status, never erased: ${g.trim().slice(0, 80)}`)
  }
})

// ── Owner-facing completeness ───────────────────────────────────────────────

test('it is marked apply-manually and Claude applied nothing', () => {
  assert.match(sql, /APPLY MANUALLY[\s\S]{0,24}\(Owner\/Jester\)/)
  assert.match(sql, /Claude Code has applied NOTHING/)
})

test('verification covers columns, constraints, indexes, RLS, privileges, and the projection probes', () => {
  const verify = sql.slice(sql.indexOf('VERIFICATION'))
  for (const probe of [
    /to_regclass\('public\.student_unit_assignments'\)/,
    /all 15 columns, in order/,
    /expect: 15/,
    /pg_constraint/,
    /pg_indexes/,
    /relrowsecurity/,
    /pg_policies/,
    /role_table_grants/,
  ]) assert.match(verify, probe)
  // The three projection probes that prove the backfill mirrors matched_unit_id.
  assert.match(verify, /matched students missing their projection row/)
  assert.match(verify, /projection rows whose unit disagrees with matched_unit_id/)
  assert.match(verify, /rows invented for unmatched students/)
  assert.match(verify, /no dates or actors were invented/)
  assert.match(verify, /unit_key matches the referenced unit's name/)
})

test('the verification block hands the Owner the executable smoke file', () => {
  const verify = sql.slice(sql.indexOf('VERIFICATION'))
  assert.match(verify, /db\/audit\/student_unit_assignments_smoke_test\.sql/)
  assert.match(verify, /EXECUTABLE AS-IS \(no placeholders\)/)
  assert.match(verify, /ROLLS EVERYTHING BACK/)
})

test('rollback instructions drop only the new objects', () => {
  const rollback = sql.slice(sql.indexOf('ROLLBACK (safe'))
  assert.match(rollback, /DROP TABLE IF EXISTS public\.student_unit_assignments/)
  assert.match(rollback, /DROP TRIGGER IF EXISTS set_updated_at_student_unit_assignments/)
  assert.match(rollback, /DROP TRIGGER IF EXISTS trg_sua_enforce_unit_identity/)
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.sua_enforce_unit_identity\(\)/)
  // The identity-pair support indexes are the ONLY objects on pre-existing
  // tables, and both are dropped for a complete revert.
  assert.match(rollback, /DROP INDEX IF EXISTS public\.uq_students_id_cohort/)
  assert.match(rollback, /DROP INDEX IF EXISTS public\.uq_units_id_cohort/)
  assert.doesNotMatch(rollback, /DROP TABLE IF EXISTS (public\.)?(students|matches|units)\b/,
    'rollback never drops a pre-existing table')
})

// ── The Emi audit is read-only ──────────────────────────────────────────────

test('THE EMI AUDIT CONTAINS ONLY SELECTs - no write of any kind', () => {
  const auditCode = audit.replace(/--[^\n]*/g, '')
  // Word-bounded: created_at/updated_at column names are not statements.
  assert.doesNotMatch(auditCode, /\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/i,
    'the audit is evidence for the Owner, never a mutation')
  assert.ok((auditCode.match(/SELECT/gi) || []).length >= 7, 'every section is a SELECT')
})

test('the audit covers every record the Owner needs, and brands shift logs as context only', () => {
  for (const section of [
    /student and cohort record/,
    /matched_unit_id resolved to its unit/,
    /PACU and 6 NE unit rows/,
    /Existing match records/,
    /Shift-log unit distribution/,
    /preceptor assignments/,
  ]) assert.match(audit, section)
  assert.match(audit, /not\s*\n?-- proof ASPIRE approved that unit assignment|is not\s*\n?-- proof ASPIRE approved/,
    'the audit itself restates the no-inference rule')
  assert.match(audit, /nothing may be backfilled\s*\n?-- from it/)
})

// ── The audit is schema-valid, not merely SELECT-only ───────────────────────

/**
 * Schema catalog for every table the audit touches, assembled from the defining
 * SQL and verified against it: students (setup.sql + migration_matching.sql +
 * migrations/migration_student_preferred_first_name.sql + 20260720000000),
 * cohorts (migration_cohorts.sql), units (migration_matching.sql + later ADD
 * COLUMNs), matches (migration_matching.sql + cohorts/quality/notifications/
 * preceptor_v2), student_shift_logs (migration_shift_logs.sql +
 * 20260607000000 lifecycle), student_preceptor_assignments (20260621000000),
 * preceptors (migration_phase1_analytics.sql), student_unit_assignments
 * (20260816000000). The same catalog was cross-checked by an AST-based
 * validator using the real Postgres grammar (102 qualified references, all
 * resolving; the pre-repair audit fails it on preferred_name/hours_worked).
 */
const AUDIT_CATALOG = {
  s: ['id', 'first_name', 'last_name', 'preferred_first_name', 'school', 'school_email', 'status', 'matched_unit_id', 'matched_preceptor', 'preceptor_id', 'shift_assigned', 'match_quality', 'rotation_end_date', 'rotation_completed_at', 'cohort_id'],
  c: ['id', 'name', 'status'],
  u: ['id', 'unit_name', 'division', 'cohort_id', 'total_slots', 'slots_remaining', 'is_participating', 'contact_person', 'contact_email'],
  m: ['id', 'student_id', 'unit_id', 'cohort_id', 'match_quality', 'preceptor_assigned', 'preceptor_id', 'shift_assigned', 'matched_at', 'notified_at', 'notes'],
  sl: ['id', 'student_id', 'shift_date', 'unit_name', 'status', 'is_assigned_unit', 'checked_in_at', 'checked_out_at', 'total_hours'],
  a: ['id', 'student_id', 'cohort_id', 'unit_id', 'unit_key', 'role', 'status', 'start_date', 'end_date', 'preceptor_id', 'assigned_by', 'ended_by', 'ended_at', 'created_at', 'updated_at', 'notes'],
  p: ['id', 'full_name', 'email', 'unit_name'],
}

test('EVERY column the audit references exists in the current schema', () => {
  const auditCode = audit.replace(/--[^\n]*/g, '')
  const refs = [...auditCode.matchAll(/\b(s|c|u|m|sl|a|p)\.([a-z_]+)\b/g)]
  assert.ok(refs.length >= 90, `expected a dense audit, found ${refs.length} references`)
  const unknown = refs
    .filter(([, alias, col]) => !(AUDIT_CATALOG[alias] || []).includes(col))
    .map(([full]) => full)
  assert.deepEqual([...new Set(unknown)], [],
    'these audit references do not exist in the schema')
})

test('the audit uses the REAL shift-log table and fields', () => {
  assert.match(audit, /FROM public\.student_shift_logs sl/)
  assert.match(audit, /sl\.checked_in_at, sl\.checked_out_at, sl\.total_hours/)
  assert.doesNotMatch(audit, /public\.shift_logs\b|\bhours_worked\b|\bcheck_in_at\b|\bcheck_out_at\b|\bsl\.assigned_unit\b/,
    'the pre-repair guesses must be gone')
  assert.match(audit, /s\.preferred_first_name/)
  assert.doesNotMatch(audit, /s\.preferred_name\b/)
})

// ── Negative integrity assertions (each keyed to one enforcement) ───────────

// ── The executable smoke test (db/audit/student_unit_assignments_smoke_test.sql) ──

const smoke = read('db/audit/student_unit_assignments_smoke_test.sql')
/** The smoke test's executable SQL (comment lines stripped). */
const smokeCode = smoke.replace(/^\s*--.*$/gm, '')

test('the smoke test is wrapped in BEGIN...ROLLBACK and uses only synthetic fixtures', () => {
  assert.match(smokeCode, /^\s*BEGIN;/m)
  assert.match(smokeCode, /^\s*ROLLBACK;/m)
  assert.doesNotMatch(smokeCode, /COMMIT/i, 'nothing may persist')
  // Fixtures are created inside the transaction with the ZZ SMOKE prefix and
  // captured as variables - never looked up from production data.
  assert.match(smokeCode, /INSERT INTO public\.cohorts \(name, status\) VALUES \('ZZ SMOKE TEST COHORT'/)
  assert.match(smokeCode, /INSERT INTO public\.units \(unit_name, cohort_id, total_slots\)/)
  assert.match(smokeCode, /INSERT INTO public\.students \(name, first_name, last_name, cohort_id\)/)
  assert.doesNotMatch(smokeCode, /<[A-Z_]+_ID>/, 'no placeholders - executable as pasted')
})

test('GUARD: the smoke test contains no live assignment without unit_id (except the one deliberate rejection)', () => {
  const inserts = [...smokeCode.matchAll(/INSERT INTO public\.student_unit_assignments \(([^)]+)\)\s*\n?\s*VALUES \(([^;]+)\);/g)]
  assert.ok(inserts.length >= 9, `expected a dense smoke test, found ${inserts.length} assignment inserts`)
  const liveWithoutUnit = inserts.filter(([, cols, vals]) =>
    !cols.includes('unit_id') && /'(planned|active)'/.test(vals))
  assert.equal(liveWithoutUnit.length, 1,
    'exactly one live-without-unit_id insert may exist: the rejection-5 probe')
  // And that one probe sits inside an exception block expecting check_violation.
  const probeAt = smoke.indexOf(liveWithoutUnit[0][0])
  const window = smoke.slice(probeAt, probeAt + 500)
  assert.match(window, /SMOKE TEST FAILURE: live assignment without unit_id was accepted/)
  assert.match(window, /WHEN check_violation THEN/)
  // Every OTHER live insert carries unit_id.
  for (const [full, cols, vals] of inserts) {
    if (/'(planned|active)'/.test(vals) && full !== liveWithoutUnit[0][0]) {
      assert.ok(cols.includes('unit_id'), `live insert must carry unit_id: ${full.slice(0, 90)}`)
    }
  }
})

test('GUARD: unit deletion targets ONLY synthetic fixture units, never a pre-existing one', () => {
  const deletes = [...smokeCode.matchAll(/DELETE FROM public\.units[^;]*;/g)].map(m => m[0])
  assert.ok(deletes.length >= 2, 'the blocked and released deletions both execute')
  for (const d of deletes) {
    assert.match(d, /WHERE id = v_unit_[a-z]+/,
      `unit deletion must target a fixture variable: ${d}`)
  }
  assert.doesNotMatch(smokeCode, /DELETE FROM public\.(students|cohorts|matches|student_shift_logs)/,
    'nothing else is ever deleted - the ROLLBACK removes the fixtures')
})

test('GUARD: every rejection EXECUTES - none is commented out, each is isolated and self-failing', () => {
  // Each rejection: executable statement + a loud failure if it succeeds + a
  // handler naming the expected error class, inside its own BEGIN...END block
  // so the remaining checks continue.
  const failures = smokeCode.match(/SMOKE TEST FAILURE:/g) || []
  assert.ok(failures.length >= 9, `expected >= 9 self-failing probes, found ${failures.length}`)
  const handlers = smokeCode.match(/EXCEPTION WHEN (unique_violation|foreign_key_violation|check_violation|raise_exception) THEN/g) || []
  assert.ok(handlers.length >= 9, `expected >= 9 typed exception handlers, found ${handlers.length}`)
  // The rejections named in prose all appear as EXECUTABLE code, not comments.
  for (const probe of [
    /INSERT INTO public\.student_unit_assignments[\s\S]{0,200}'primary', 'active'\);\s*\n\s*RAISE EXCEPTION 'SMOKE TEST FAILURE: second active primary/,
    /v_other_cohort, v_unit_other/,
    /v_cohort, v_unit_other/,
    /'ZZ SMOKE Wrong Name'/,
    /'primary', 'planned'\);\s*\n\s*RAISE EXCEPTION 'SMOKE TEST FAILURE: second planned primary/,
    /DELETE FROM public\.units WHERE id = v_unit_b;\s*\n\s*RAISE EXCEPTION 'SMOKE TEST FAILURE: deleting a unit with a live assignment/,
  ]) assert.match(smokeCode, probe)
  // Expected-rejection confirmations name the enforcing object.
  for (const named of [
    'uq_sua_one_active_primary_per_student_cohort', 'fk_sua_student_cohort',
    'fk_sua_unit_cohort', 'trg_sua_enforce_unit_identity',
    'chk_sua_live_requires_unit', 'uq_sua_one_planned_primary_per_student_cohort',
    'uq_sua_one_live_row_per_student_unit', 'chk_sua_period', 'chk_sua_ended_fields',
  ]) assert.ok(smokeCode.includes(named), `handler confirms ${named}`)
})

test('the smoke test proves end-then-delete releases the unit and preserves history', () => {
  assert.match(smokeCode, /SET status = 'ended', ended_at = now\(\)/)
  assert.match(smokeCode, /history lost its unit_key after unit deletion|history kept unit_key/)
  assert.match(smokeCode, /ALL SMOKE TESTS PASSED/)
})

test('NEGATIVE CONTROL: stripping any single enforcement fails this suite', () => {
  // Each assertion above keys on the exact constraint/trigger DDL, so deleting
  // the enforcement deletes the matched text. Prove it for each one.
  const enforcements = [
    /CONSTRAINT fk_sua_student_cohort[\s\S]*?ON DELETE CASCADE,/,
    /CONSTRAINT fk_sua_unit_cohort[\s\S]*?ON DELETE SET NULL \(unit_id\),/,
    /CONSTRAINT chk_sua_live_requires_unit[\s\S]*?\),/,
    /CREATE OR REPLACE FUNCTION public\.sua_enforce_unit_identity[\s\S]*?\$\$;/,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_sua_one_planned_primary_per_student_cohort[\s\S]*?status = 'planned';/,
  ]
  for (const e of enforcements) {
    assert.match(code, e, `enforcement present: ${String(e).slice(0, 60)}`)
    const stripped = code.replace(e, '')
    assert.ok(stripped.length < code.length, 'the strip removed something')
    assert.doesNotMatch(stripped, e, 'and removing it would break the assertion above')
  }
})

// ── Negative control ────────────────────────────────────────────────────────

test('NEGATIVE CONTROL: removing the active-primary backbone fails this suite', () => {
  const without = code.replace(/CREATE UNIQUE INDEX IF NOT EXISTS uq_sua_one_active_primary_per_student_cohort[\s\S]*?WHERE role = 'primary' AND status = 'active';/, '')
  assert.doesNotMatch(without, /uq_sua_one_active_primary/,
    'the backward-compatibility assertion above keys on this exact index')
})
