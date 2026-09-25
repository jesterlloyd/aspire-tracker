// test/s15UnitLeaderThreadReadScope.test.mjs
//
// S-15: a Unit Leader who loses scope for a unit loses READ access to that unit's threads
// immediately. Runs supabase/migrations/20260930000000_s15_unit_leader_thread_read_scope.sql
// against a real Postgres (PGlite, in process), on top of the helper predicates and the
// send predicate exactly as the earlier migrations define them, and proves:
//
//   * a revoked scope blocks read, an expired scope blocks read, an active scope allows it;
//   * the OLD predicate really did admit the revoked case (so the test is not vacuous);
//   * can_read and can_send agree for every Unit Leader row, unit-scoped and general;
//   * student and academic partner reads are byte-for-byte unchanged, in text and in result;
//   * signature, SECURITY DEFINER, STABLE, search_path and grants are preserved;
//   * every section of the audit file is executable SQL;
//   * the register and the SQL gate were updated in the same commit.
//
// The PRELUDE builds only the tables the predicates read, with the columns they read.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const MIGRATION_PATH = 'supabase/migrations/20260930000000_s15_unit_leader_thread_read_scope.sql'
const AUDIT_PATH = 'db/audit/s15_unit_leader_thread_read_scope_checks.sql'
const migration = read(MIGRATION_PATH)
const audit = read(AUDIT_PATH)
const naUtilities = read('supabase/migrations/20260828000000_enable_nursing_academic_portal_utilities.sql')
const generalThreads = read('supabase/migrations/20260724000001_general_team_threads_backend.sql')
const ulFoundation = read('supabase/migrations/20260720000000_unit_leader_portal_foundation.sql')

// The CREATE OR REPLACE FUNCTION block for one function, from its header to its closing $$;.
function fnBlock(sql, name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  assert.ok(start >= 0, `${name} not found`)
  const end = sql.indexOf('\n$$;', start)
  assert.ok(end > start, `${name} has no closing $$;`)
  return sql.slice(start, end + 4)
}

const oldCanRead = fnBlock(naUtilities, 'message_participant_can_read')
const canSend = fnBlock(naUtilities, 'message_participant_can_send')
const newCanRead = fnBlock(migration, 'message_participant_can_read')

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE TABLE user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_active boolean DEFAULT true);
  CREATE TABLE students (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE cohorts (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE user_role_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_profile_id uuid NOT NULL, role text NOT NULL,
    starts_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, revoked_at timestamptz);
  CREATE TABLE user_unit_scopes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_profile_id uuid NOT NULL, unit_key text NOT NULL,
    cohort_id uuid, starts_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, revoked_at timestamptz);
  CREATE TABLE user_school_scopes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_profile_id uuid NOT NULL, school_key text NOT NULL,
    starts_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, revoked_at timestamptz);
  CREATE TABLE user_student_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_profile_id uuid NOT NULL, student_id uuid NOT NULL,
    revoked_at timestamptz);
  CREATE TABLE conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), related_student_id uuid, related_unit_key text,
    related_school_key text, related_cohort_id uuid);
  CREATE TABLE conversation_participants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL,
    participant_profile_id uuid NOT NULL, participant_role text NOT NULL, scope_kind text NOT NULL,
    scope_student_id uuid, scope_unit_key text, scope_school_key text, scope_cohort_id uuid,
    added_at timestamptz NOT NULL DEFAULT now(), removed_at timestamptz);
  -- my_message_conversation_ids() needs portal_profile_id(); it is not exercised here.
  CREATE OR REPLACE FUNCTION public.portal_profile_id() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
  ${fnBlock(ulFoundation, 'message_profile_is_active')}
  ${fnBlock(generalThreads, 'message_profile_has_active_student_portal')}
  ${fnBlock(generalThreads, 'message_profile_has_active_unit_leader_portal_scope')}
  ${oldCanRead}
  ${canSend}
  ${fnBlock(ulFoundation, 'my_message_conversation_ids')}
`

const PAST = `now() - interval '1 day'`
const FUTURE = `now() + interval '30 days'`

// A world with every scope state the finding names, built on the OLD predicate.
async function world() {
  const db = new PGlite()
  await db.exec(PRELUDE)
  const id = async () => (await db.query(`SELECT gen_random_uuid() AS id`)).rows[0].id
  const profile = async () => {
    const { rows } = await db.query(`INSERT INTO user_profiles DEFAULT VALUES RETURNING id`)
    return rows[0].id
  }
  const grant = (p, role) => db.query(`INSERT INTO user_role_grants (user_profile_id, role) VALUES ($1, $2)`, [p, role])
  const scope = (p, unit, extra = '') => db.exec(
    `INSERT INTO user_unit_scopes (user_profile_id, unit_key ${extra ? ', ' + extra.split('=')[0].trim() : ''})
     VALUES ('${p}', '${unit}' ${extra ? ', ' + extra.split('=')[1].trim() : ''})`)
  const conversation = async (studentId = null) => {
    const { rows } = await db.query(`INSERT INTO conversations (related_student_id) VALUES ($1) RETURNING id`, [studentId])
    return rows[0].id
  }
  const participant = (c, p, role, kind, cols = {}) => db.query(
    `INSERT INTO conversation_participants (conversation_id, participant_profile_id, participant_role, scope_kind,
       scope_student_id, scope_unit_key, scope_school_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [c, p, role, kind, cols.student ?? null, cols.unit ?? null, cols.school ?? null])

  const student = await id()
  await db.query(`INSERT INTO students (id) VALUES ($1)`, [student])

  // Unit Leaders: every one holds an active account and an active unit_leader grant.
  const ulActive = await profile();  await grant(ulActive, 'unit_leader');  await scope(ulActive, 'Unit A')
  const ulRevoked = await profile(); await grant(ulRevoked, 'unit_leader'); await scope(ulRevoked, 'Unit A', `revoked_at = ${PAST}`)
  const ulExpired = await profile(); await grant(ulExpired, 'unit_leader'); await scope(ulExpired, 'Unit A', `expires_at = ${FUTURE}`)
  const ulOtherUnit = await profile(); await grant(ulOtherUnit, 'unit_leader'); await scope(ulOtherUnit, 'Unit B')
  const ulNoScope = await profile(); await grant(ulNoScope, 'unit_leader')

  // A student with an active grant and link; another whose link was revoked.
  const stu = await profile(); await grant(stu, 'student')
  await db.query(`INSERT INTO user_student_links (user_profile_id, student_id) VALUES ($1, $2)`, [stu, student])
  const stuRevoked = await profile(); await grant(stuRevoked, 'student')
  await db.query(`INSERT INTO user_student_links (user_profile_id, student_id, revoked_at) VALUES ($1, $2, now())`, [stuRevoked, student])

  // An Academic Partner with an active school scope.
  const ap = await profile(); await grant(ap, 'academic_partner')
  await db.query(`INSERT INTO user_school_scopes (user_profile_id, school_key) VALUES ($1, 'WCU-LA')`, [ap])

  // Threads. direct_student: a student row plus a unit-scoped Unit Leader row naming the student.
  const direct = await conversation(student)
  await participant(direct, stu, 'student', 'student', { student })
  await participant(direct, ulActive, 'unit_leader', 'unit', { student, unit: 'Unit A' })
  const directRevoked = await conversation(student)
  await participant(directRevoked, stuRevoked, 'student', 'student', { student })
  await participant(directRevoked, ulRevoked, 'unit_leader', 'unit', { student, unit: 'Unit A' })
  // team_student_context: the Unit Leader alone, unit-scoped, student as context.
  const ctxExpired = await conversation(student)
  await participant(ctxExpired, ulExpired, 'unit_leader', 'unit', { student, unit: 'Unit A' })
  const ctxOther = await conversation(student)
  await participant(ctxOther, ulOtherUnit, 'unit_leader', 'unit', { student, unit: 'Unit A' })
  // team_general: a Unit Leader row with no unit key.
  const genActive = await conversation()
  await participant(genActive, ulActive, 'unit_leader', 'unit')
  const genNoScope = await conversation()
  await participant(genNoScope, ulNoScope, 'unit_leader', 'unit')
  // An Academic Partner general thread.
  const apGeneral = await conversation()
  await participant(apGeneral, ap, 'academic_partner', 'school', { school: 'WCU-LA' })

  const canRead = async (c, p) => (await db.query(`SELECT public.message_participant_can_read($1, $2) AS ok`, [c, p])).rows[0].ok
  const canSendQ = async (c, p) => (await db.query(`SELECT public.message_participant_can_send($1, $2) AS ok`, [c, p])).rows[0].ok
  const ulRows = [
    [direct, ulActive], [directRevoked, ulRevoked], [ctxExpired, ulExpired], [ctxOther, ulOtherUnit],
    [genActive, ulActive], [genNoScope, ulNoScope],
  ]
  const otherRows = [[direct, stu], [directRevoked, stuRevoked], [apGeneral, ap]]

  return { db, canRead, canSend: canSendQ, ulRows, otherRows,
    direct, directRevoked, ctxExpired, ctxOther, genActive, genNoScope, apGeneral,
    ulActive, ulRevoked, ulExpired, ulOtherUnit, ulNoScope, stu, stuRevoked, ap }
}

test('the migration applies as one block on top of the earlier predicates, and applies twice', async () => {
  const w = await world()
  await w.db.exec(migration)
  await w.db.exec(migration)
  const { rows } = await w.db.query(`
    SELECT p.prosecdef, p.provolatile, p.proconfig,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'message_participant_can_read'`)
  assert.equal(rows.length, 1, 'exactly one overload')
  assert.equal(rows[0].prosecdef, true, 'SECURITY DEFINER preserved')
  assert.equal(rows[0].provolatile, 's', 'STABLE preserved')
  assert.deepEqual(rows[0].proconfig, ['search_path=public, pg_catalog'], 'pinned search_path preserved')
  assert.equal(rows[0].service_role, true)
  assert.equal(rows[0].authenticated, false)
  assert.equal(rows[0].anon, false)
  assert.equal(rows[0].args, 'p_conversation_id uuid, p_profile_id uuid', 'signature preserved')
})

test('the OLD predicate admitted a Unit Leader whose scope was revoked (the finding is real)', async () => {
  const w = await world()
  assert.equal(await w.canRead(w.directRevoked, w.ulRevoked), true, 'old can_read: revoked scope still reads')
  assert.equal(await w.canSend(w.directRevoked, w.ulRevoked), false, 'old can_send already refused')
  assert.equal(await w.canRead(w.genNoScope, w.ulNoScope), true, 'old can_read: no scope at all still reads a general thread')
})

test('scope revoked blocks read; scope for another unit blocks read; no scope blocks a general thread', async () => {
  const w = await world()
  await w.db.exec(migration)
  assert.equal(await w.canRead(w.directRevoked, w.ulRevoked), false, 'revoked scope')
  assert.equal(await w.canRead(w.ctxOther, w.ulOtherUnit), false, 'active scope for Unit B does not open a Unit A thread')
  assert.equal(await w.canRead(w.genNoScope, w.ulNoScope), false, 'general thread with no active unit scope')
})

test('scope expired blocks read the moment it lapses, with nothing written', async () => {
  const w = await world()
  await w.db.exec(migration)
  assert.equal(await w.canRead(w.ctxExpired, w.ulExpired), true, 'a future expiry still reads')
  // The scope lapses. No endpoint runs; only the clock moved.
  await w.db.query(`UPDATE user_unit_scopes SET expires_at = ${PAST} WHERE user_profile_id = $1`, [w.ulExpired])
  assert.equal(await w.canRead(w.ctxExpired, w.ulExpired), false, 'an expired scope no longer reads')
  const { rows } = await w.db.query(`SELECT count(*)::int AS n FROM conversation_participants WHERE removed_at IS NOT NULL`)
  assert.equal(rows[0].n, 0, 'no participant row was removed; the row is history, access is live')
})

test('scope active allows read, unit-scoped and general alike, and revocation ends it immediately', async () => {
  const w = await world()
  await w.db.exec(migration)
  assert.equal(await w.canRead(w.direct, w.ulActive), true, 'direct thread, active scope for its unit')
  assert.equal(await w.canRead(w.genActive, w.ulActive), true, 'general thread, any active scope')
  await w.db.query(`UPDATE user_unit_scopes SET revoked_at = now() WHERE user_profile_id = $1`, [w.ulActive])
  assert.equal(await w.canRead(w.direct, w.ulActive), false, 'revoked: the direct thread closes')
  assert.equal(await w.canRead(w.genActive, w.ulActive), false, 'revoked: the general thread closes too')
})

test('can_read and can_send agree for every Unit Leader row', async () => {
  const w = await world()
  await w.db.exec(migration)
  for (const [c, p] of w.ulRows) {
    assert.equal(await w.canRead(c, p), await w.canSend(c, p), `read and send agree for ${c}`)
  }
  // And the agreement is not trivial: some rows are true, some are false.
  const results = await Promise.all(w.ulRows.map(([c, p]) => w.canRead(c, p)))
  assert.ok(results.includes(true) && results.includes(false))
})

test('student and academic partner reads are unchanged, in result and in text', async () => {
  const w = await world()
  const before = await Promise.all(w.otherRows.map(([c, p]) => w.canRead(c, p)))
  assert.deepEqual(before, [true, false, true], 'baseline: linked student reads, revoked link does not, AP reads')
  await w.db.exec(migration)
  const after = await Promise.all(w.otherRows.map(([c, p]) => w.canRead(c, p)))
  assert.deepEqual(after, before)

  // Text: the student branch and everything from the Academic Partner branch on are the
  // 20260828000000 bytes. Only the unit_leader branch differs.
  const branchStart = (sql, marker) => sql.indexOf(marker)
  const studentOld = oldCanRead.slice(branchStart(oldCanRead, "cp.participant_role = 'student'"), branchStart(oldCanRead, "cp.participant_role = 'unit_leader'"))
  const studentNew = newCanRead.slice(branchStart(newCanRead, "cp.participant_role = 'student'"), branchStart(newCanRead, "cp.participant_role = 'unit_leader'"))
  assert.equal(studentNew, studentOld, 'student branch unchanged')
  const tailOld = oldCanRead.slice(branchStart(oldCanRead, '-- ADDED: an Academic Partner'))
  const tailNew = newCanRead.slice(branchStart(newCanRead, '-- ADDED: an Academic Partner'))
  assert.equal(tailNew, tailOld, 'academic_partner and nursing_academic branches unchanged')
})

test('the unit_leader branch tests scope the way can_send does: same table, same window, same general fallback', () => {
  const ul = newCanRead.slice(newCanRead.indexOf("cp.participant_role = 'unit_leader'"), newCanRead.indexOf('-- ADDED: an Academic Partner'))
  assert.match(ul, /FROM public\.user_unit_scopes s\s+WHERE s\.user_profile_id = p_profile_id\s+AND s\.unit_key = cp\.scope_unit_key\s+AND s\.revoked_at IS NULL\s+AND s\.starts_at <= now\(\)\s+AND \(s\.expires_at IS NULL OR s\.expires_at > now\(\)\)/)
  assert.match(ul, /cp\.scope_unit_key IS NULL\s+AND public\.message_profile_has_active_unit_leader_portal_scope\(p_profile_id\)/)
  // Not by writing history, and not by touching the revoke RPC (the header may NAME it; the code may not).
  const code = migration.replace(/^\s*--.*$/gm, '')
  assert.doesNotMatch(code, /UPDATE\s+public\.conversation_participants|SET\s+removed_at/i)
  assert.doesNotMatch(code, /revoke_portal_access/i)
  // Only one function is (re)defined, and only the grants for it are restated.
  assert.equal((code.match(/CREATE OR REPLACE FUNCTION/g) || []).length, 1)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.message_participant_can_send/)
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.my_message_conversation_ids/)
  assert.match(migration, /^BEGIN;/m)
  assert.match(migration, /^COMMIT;/m)
})

test('every audit section is executable, read-only, and PII-free; PRE 3 sees the exposure and POST 3 sees it closed', async () => {
  const sections = audit.split(/\n(?=-- ── (?:PRE|POST) \d+:)/).slice(1)
  assert.equal(sections.length, 11, 'PRE 1 to 5 and POST 1 to 6')
  const code = audit.replace(/^\s*--.*$/gm, '')
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/i, 'read-only')
  assert.doesNotMatch(code, /full_name|first_name|last_name|email/i, 'no names or emails selected')

  const w = await world()
  const run = async (label) => {
    const s = sections.find((x) => x.startsWith(`-- ── ${label}:`))
    assert.ok(s, `${label} present`)
    return (await w.db.query(s.replace(/^\s*--.*$/gm, ''))).rows
  }
  for (const s of sections.slice(0, 5)) await w.db.query(s.replace(/^\s*--.*$/gm, ''))
  const pre1 = await run('PRE 1')
  assert.equal(pre1.find((r) => r.proname === 'message_participant_can_read').reads_unit_scopes, false)
  const pre3 = await run('PRE 3')
  const exposed = pre3.filter((r) => !r.has_active_scope && r.can_read_now)
  assert.equal(exposed.length, 3, 'three Unit Leader rows readable without scope before the fix')

  await w.db.exec(migration)
  const post1 = await run('POST 1')
  assert.equal(post1.find((r) => r.proname === 'message_participant_can_read').reads_unit_scopes, true)
  assert.equal(post1.find((r) => r.proname === 'message_participant_can_send').delegates_to_can_read, true)
  const post2 = await run('POST 2')
  assert.deepEqual(post2[0], { security_definer: true, stable: true, search_path: ['search_path=public, pg_catalog'],
    service_role: true, authenticated: false, anon: false, public: false })
  const post3 = await run('POST 3')
  assert.equal(Number(post3[0].readable_without_scope), 0)
  assert.equal(Number(post3[0].without_scope), 3)
  assert.equal(Number(post3[0].readable_with_scope), Number(post3[0].with_scope))
  assert.equal(Number(post3[0].with_scope), 3)
  const post5 = await run('POST 5')
  assert.equal(Number(post5[0].disagreements), 0)
  await run('POST 4'); await run('POST 6')
})

test('the register and the SQL gate were updated with the migration', () => {
  const register = read('docs/security/FINDINGS_REGISTER.md')
  const s15 = register.slice(register.indexOf('## S-15.'), register.indexOf('## S-16.'))
  // 42e67e67 shipped this as "Closed (code); SQL unconfirmed" with the ledger row UNKNOWN.
  // The Owner applied the migration on 2026-09-24 and every POST section passed, so the
  // closing commit moved S-15 to CLOSED and the ledger row to APPLIED.
  assert.match(s15, /\*\*Status\*\*: CLOSED\./)
  assert.match(s15, /20260930000000_s15_unit_leader_thread_read_scope\.sql/)
  assert.match(s15, /s15_unit_leader_thread_read_scope_checks\.sql/)
  const gate = read('docs/security/OWNER_SQL_GATE.md')
  assert.match(gate, /^\| 20260930000000_s15_unit_leader_thread_read_scope\.sql \|.*APPLIED 2026-09-24/m)
  for (const text of [migration, audit, s15]) {
    assert.doesNotMatch(text, new RegExp(String.fromCharCode(8212)), 'no em dash')
    assert.doesNotMatch(text, /ASPIRE Program/, 'ASPIRE, never "ASPIRE Program"')
  }
})
