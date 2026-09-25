// test/s08SchoolFormPasswordHash.test.mjs
//
// S-08 completion: the school form password is a bcrypt hash in a table no browser can
// read, the two password RPCs are repository definitions, and nothing in the app writes
// the plaintext column.
//
//   * Migration A and migration B run on real Postgres (PGlite with pgcrypto), on a
//     cohorts table seeded with plaintext passwords. The passwords are generated at test
//     time; no password value is written into this file.
//   * TRIM behaviour is preserved on both sides of the hash: a password entered with
//     surrounding spaces still verifies, and a plaintext stored with spaces still hashes
//     to something its trimmed form verifies against.
//   * the transition: a plaintext written after A but before the app moved (the old modal
//     path) still verifies and still "requires a password"; B refuses to drop it unless a
//     hash exists.
//   * anon keeps EXECUTE on both public RPCs at every step; the set RPC is service_role only;
//     the secrets table has RLS on and no policy.
//   * every audit section is executable and says what its comment says.
//   * the endpoint, through its factory: Owner/Admin only, 503 before the migration, never
//     logs or echoes the password.
//   * SWEEP: no file under src/ puts school_form_password into a cohorts insert or update.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { createCohortPasswordSetHandler } from '../api/cohort-password-set.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

const MIGRATION_A = 'supabase/migrations/20261002000000_s08_school_form_password_hash.sql'
const MIGRATION_B = 'supabase/migrations/20261003000000_s08_school_form_password_plaintext_drop.sql'
const AUDIT = 'db/audit/s08_school_form_password_hash_checks.sql'
const migrationA = read(MIGRATION_A)
const migrationB = read(MIGRATION_B)
const audit = read(AUDIT)

// A fresh secret per run, never a literal in the repository.
const secret = () => `t-${randomBytes(9).toString('base64url')}`

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE TABLE public.user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE public.cohorts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
    accepting_submissions boolean NOT NULL DEFAULT false, school_form_password text);
  GRANT SELECT, INSERT, UPDATE ON public.cohorts TO authenticated;
  -- The dashboard-created functions, as their recorded semantics describe them.
  CREATE FUNCTION public.school_form_requires_password(p_cohort_id uuid) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = p_cohort_id AND btrim(coalesce(c.school_form_password, '')) <> '') $$;
  CREATE FUNCTION public.verify_school_form_password(p_cohort_id uuid, p_entered_password text) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = p_cohort_id AND btrim(coalesce(c.school_form_password, '')) <> ''
                   AND btrim(c.school_form_password) = btrim(coalesce(p_entered_password, ''))) $$;
  GRANT EXECUTE ON FUNCTION public.school_form_requires_password(uuid) TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.verify_school_form_password(uuid, text) TO anon, authenticated, service_role;
`

async function world() {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(PRELUDE)
  const pw = { fall: secret(), summer: secret(), winter: secret() }
  const ins = async (name, password, accepting = false) => {
    const { rows } = await db.query(
      `INSERT INTO public.cohorts (name, accepting_submissions, school_form_password) VALUES ($1, $2, $3) RETURNING id`,
      [name, accepting, password])
    return rows[0].id
  }
  const ids = {
    fall: await ins('Fall 2026', pw.fall, true),
    summer: await ins('Summer 2026', `  ${pw.summer} `), // stored with spaces, as a paste might leave it
    winter: await ins('Winter 2027', pw.winter),
    open: await ins('Spring 2027 (no password)', null),
  }
  const requires = async (id) => (await db.query(`SELECT public.school_form_requires_password($1) AS ok`, [id])).rows[0].ok
  const verify = async (id, entered) => (await db.query(`SELECT public.verify_school_form_password($1, $2) AS ok`, [id, entered])).rows[0].ok
  const section = (label) => {
    const parts = audit.split(/\n(?=-- ── (?:PRE-A|POST-A|PRE-B|POST-B) \d+:)/).slice(1)
    const s = parts.find((x) => x.startsWith(`-- ── ${label}:`))
    assert.ok(s, `${label} present`)
    return s.replace(/^\s*--.*$/gm, '')
  }
  const run = async (label) => (await db.query(section(label))).rows
  return { db, pw, ids, requires, verify, run }
}

test('before A: the plaintext functions behave as recorded (TRIM equality), so the fixture is faithful', async () => {
  const w = await world()
  assert.equal(await w.verify(w.ids.fall, w.pw.fall), true)
  assert.equal(await w.verify(w.ids.fall, `  ${w.pw.fall}  `), true, 'TRIM on the entered side')
  assert.equal(await w.verify(w.ids.summer, w.pw.summer), true, 'TRIM on the stored side')
  assert.equal(await w.verify(w.ids.fall, `${w.pw.fall}x`), false)
  assert.equal(await w.requires(w.ids.open), false)
  const pre4 = await w.run('PRE-A 4')
  assert.deepEqual(pre4.map((r) => [r.name, r.has_password, r.secrets_table_present]), [
    ['Fall 2026', true, false], ['Spring 2027 (no password)', false, false], ['Summer 2026', true, false], ['Winter 2027', true, false],
  ])
  await w.run('PRE-A 1'); await w.run('PRE-A 2'); await w.run('PRE-A 3')
})

test('A: every existing password verifies through its hash, TRIM is preserved, wrong and empty are refused, grants hold', async () => {
  const w = await world()
  await w.db.exec(migrationA)
  for (const k of ['fall', 'summer', 'winter']) {
    assert.equal(await w.verify(w.ids[k], w.pw[k]), true, `${k} verifies`)
    assert.equal(await w.verify(w.ids[k], `  ${w.pw[k]} `), true, `${k} verifies with spaces (TRIM preserved)`)
    assert.equal(await w.verify(w.ids[k], `${w.pw[k]}x`), false, `${k} refuses a wrong password`)
    assert.equal(await w.requires(w.ids[k]), true)
  }
  assert.equal(await w.verify(w.ids.fall, ''), false)
  assert.equal(await w.verify(w.ids.open, 'anything'), false)
  assert.equal(await w.requires(w.ids.open), false)
  // The other cohort's password does not open this cohort.
  assert.equal(await w.verify(w.ids.fall, w.pw.winter), false)

  const post1 = await w.run('POST-A 1')
  assert.deepEqual(post1.map((r) => [r.proname, r.security_definer, r.anon, r.authenticated, r.service_role, r.body_reads_secrets]), [
    ['school_form_requires_password', true, true, true, true, true],
    ['set_school_form_password', true, false, false, true, true],
    ['verify_school_form_password', true, true, true, true, true],
  ])
  for (const r of post1) assert.deepEqual(r.search_path, ['search_path=public, pg_catalog'])
  const post2 = await w.run('POST-A 2')
  assert.deepEqual(post2[0], { rls_enabled: true, policies: 0, anon_select: false, authenticated_select: false, service_role_select: true })
  const post3 = await w.run('POST-A 3')
  for (const r of post3) {
    if (r.name.startsWith('Spring')) { assert.equal(r.hashed, false); assert.equal(r.requires_password, false); continue }
    assert.equal(r.hashed, true, r.name); assert.equal(r.hash_is_bcrypt, true, r.name)
    assert.equal(r.own_password_verifies, true, r.name); assert.equal(r.with_spaces_verifies, true, r.name)
    assert.equal(r.wrong_password_refused, true, r.name); assert.equal(r.empty_refused, true, r.name)
  }
  const post4 = await w.run('POST-A 4')
  assert.deepEqual([Number(post4[0].plaintext_rows), Number(post4[0].hashed_rows)], [3, 3], 'plaintext kept until B')
  assert.equal((await w.run('POST-A 5'))[0].set_function_present, true)
  // Applying A twice is harmless: same hashes, nothing re-hashed.
  const before = (await w.db.query(`SELECT password_hash FROM public.cohort_form_secrets WHERE cohort_id = $1`, [w.ids.fall])).rows[0].password_hash
  await w.db.exec(migrationA)
  const after = (await w.db.query(`SELECT password_hash FROM public.cohort_form_secrets WHERE cohort_id = $1`, [w.ids.fall])).rows[0].password_hash
  assert.equal(after, before)
})

test('A refuses to commit if a password would stop verifying (the in-transaction proof is real)', async () => {
  const w = await world()
  // Sabotage: a secrets table already holding a hash of a DIFFERENT password for Fall.
  await w.db.exec(`CREATE EXTENSION IF NOT EXISTS pgcrypto`)
  await w.db.exec(`CREATE TABLE public.cohort_form_secrets (cohort_id uuid PRIMARY KEY, password_hash text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid)`)
  await w.db.query(`INSERT INTO public.cohort_form_secrets (cohort_id, password_hash) VALUES ($1, crypt($2, gen_salt('bf', 4)))`, [w.ids.fall, secret()])
  await assert.rejects(() => w.db.exec(migrationA), /does not verify through its hash/)
  // A failed block in the SQL editor rolls itself back; PGlite's session needs telling.
  await w.db.exec('ROLLBACK')
  // Nothing applied: the old functions still answer, and no set function exists.
  assert.equal(await w.verify(w.ids.winter, w.pw.winter), true)
  const { rows } = await w.db.query(`SELECT to_regprocedure('public.set_school_form_password(uuid, text)') IS NOT NULL AS present`)
  assert.equal(rows[0].present, false)
})

test('transition: a plaintext written after A (the old modal path) still works, and set_school_form_password replaces it with a hash and clears it', async () => {
  const w = await world()
  await w.db.exec(migrationA)
  const late = secret()
  const { rows } = await w.db.query(`INSERT INTO public.cohorts (name, school_form_password) VALUES ('Late cohort', $1) RETURNING id`, [late])
  const id = rows[0].id
  assert.equal(await w.requires(id), true, 'plaintext still counts during the transition')
  assert.equal(await w.verify(id, late), true)
  const replacement = secret()
  const set = await w.db.query(`SELECT public.set_school_form_password($1, $2) AS ok`, [id, replacement])
  assert.equal(set.rows[0].ok, true)
  assert.equal(await w.verify(id, replacement), true)
  assert.equal(await w.verify(id, late), false, 'the old password no longer opens it')
  const plain = (await w.db.query(`SELECT school_form_password IS NULL AS cleared FROM public.cohorts WHERE id = $1`, [id])).rows[0]
  assert.equal(plain.cleared, true, 'setting a password clears the plaintext')
  // An empty password clears the secret.
  await w.db.query(`SELECT public.set_school_form_password($1, '   ')`, [id])
  assert.equal(await w.requires(id), false)
  assert.equal(await w.verify(id, replacement), false)
  // An unknown cohort returns false and writes nothing.
  const unknown = await w.db.query(`SELECT public.set_school_form_password($1, $2) AS ok`, [randomUUID(), secret()])
  assert.equal(unknown.rows[0].ok, false)
})

test('B: refuses while a plaintext has no hash; then drops the column, and every password still verifies with no plaintext anywhere', async () => {
  const w = await world()
  await w.db.exec(migrationA)
  // A plaintext with no hash (written after A by old code) blocks B.
  const late = secret()
  const { rows } = await w.db.query(`INSERT INTO public.cohorts (name, school_form_password) VALUES ('Late cohort', $1) RETURNING id`, [late])
  const lateId = rows[0].id
  const preB1 = await w.run('PRE-B 1')
  assert.notEqual(Number(preB1[0].plaintext_rows), Number(preB1[0].hashed_plaintext_rows), 'PRE-B 1 shows the inequality')
  await assert.rejects(() => w.db.exec(migrationB), /still has a plaintext password and no hash/)
  await w.db.exec('ROLLBACK')
  // Give it a hash through the one writer, then B goes through.
  await w.db.query(`SELECT public.set_school_form_password($1, $2)`, [lateId, late])
  const preB1b = await w.run('PRE-B 1')
  assert.equal(Number(preB1b[0].plaintext_rows), Number(preB1b[0].hashed_plaintext_rows))
  assert.equal(Number(preB1b[0].plaintext_rows), Number(preB1b[0].verifying_rows))
  assert.deepEqual(await w.run('PRE-B 2'), [], 'nothing depends on the column')
  await w.db.exec(migrationB)

  assert.deepEqual((await w.run('POST-B 1'))[0], { column_present: false, secrets_table_present: true })
  const post2 = await w.run('POST-B 2')
  for (const r of post2) {
    assert.equal(r.mentions_plaintext, false, r.proname)
    assert.equal(r.security_definer, true)
    assert.deepEqual(r.search_path, ['search_path=public, pg_catalog'])
    assert.equal(r.service_role, true)
    assert.equal(r.anon, r.proname !== 'set_school_form_password')
    assert.equal(r.authenticated, r.proname !== 'set_school_form_password')
  }
  for (const k of ['fall', 'summer', 'winter']) {
    assert.equal(await w.verify(w.ids[k], w.pw[k]), true, `${k} still verifies after the column is gone`)
    assert.equal(await w.verify(w.ids[k], `  ${w.pw[k]} `), true)
    assert.equal(await w.verify(w.ids[k], `${w.pw[k]}x`), false)
    assert.equal(await w.requires(w.ids[k]), true)
  }
  assert.equal(await w.verify(lateId, late), true)
  assert.equal(await w.requires(w.ids.open), false)
  const post3 = await w.run('POST-B 3')
  for (const r of post3) {
    assert.equal(r.wrong_password_refused, true, r.name); assert.equal(r.empty_refused, true, r.name)
    assert.equal(r.requires_password, !r.name.startsWith('Spring'), r.name)
  }
  await w.run('POST-B 4')
  // Applying B twice is harmless.
  await w.db.exec(migrationB)
  assert.equal(await w.verify(w.ids.fall, w.pw.fall), true)
})

test('the audit file selects no password value, and both migrations print none', () => {
  const code = audit.replace(/^\s*--.*$/gm, '')
  assert.doesNotMatch(code, /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/im, 'read-only')
  // The column may be passed INTO a function; it may never be a selected output.
  for (const line of code.split('\n')) {
    if (/^\s*SELECT\b/.test(line) || /^\s*,?\s*c\.school_form_password\s*(AS|,|$)/.test(line)) {
      assert.doesNotMatch(line, /^\s*(SELECT\s+)?c\.school_form_password\s*(AS|,)/, `a password column is selected: ${line.trim()}`)
    }
  }
  assert.doesNotMatch(code, /SELECT\s+(c\.)?school_form_password\b/)
  assert.doesNotMatch(code, /password_hash\s+AS\b|SELECT\s+(s\.)?password_hash\s*(,|FROM)/, 'a hash is never selected as output')
  for (const m of [migrationA, migrationB]) {
    assert.doesNotMatch(m, /RAISE (NOTICE|EXCEPTION)[^;]*school_form_password\b[^;]*%/, 'no notice interpolates the password')
    assert.doesNotMatch(m, /RAISE (NOTICE|EXCEPTION)[^;]*password_hash/)
  }
})

// ── The endpoint, through the factory ────────────────────────────────────────

function makeRes() {
  const res = { statusCode: 0, body: null, headers: {} }
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (payload) => { res.body = payload; return res }
  res.end = () => res
  return res
}
const ADMIN = { id: 'p-admin', role: 'admin', full_name: 'Ada Admin', email: 'ada@x.org' }
const COHORT = '33333333-3333-4333-8333-333333333333'

function makeDb({ rpcResult = { data: true, error: null } } = {}) {
  const log = { rpc: [], audits: [] }
  return {
    log,
    db: {
      async rpc(name, args) { log.rpc.push({ name, args }); return rpcResult },
      from(table) { return { insert: async (row) => { if (table === 'activity_logs') log.audits.push(row); return { error: null } } } },
    },
  }
}

test('endpoint: Owner/Admin only; the password reaches the RPC and nothing else; 503 before the migration', async () => {
  const pw = secret()
  const denied = createCohortPasswordSetHandler({ verifyCaller: async () => ({ ok: false, status: 403 }), getDb: () => makeDb().db })
  const r0 = makeRes(); await denied({ method: 'POST', headers: {}, body: { cohort_id: COHORT, password: pw } }, r0)
  assert.equal(r0.statusCode, 403)

  const { db, log } = makeDb()
  const logged = []
  const origLog = console.log, origWarn = console.warn
  console.log = (...a) => logged.push(a.map(String).join(' ')); console.warn = console.log
  try {
    const handler = createCohortPasswordSetHandler({ verifyCaller: async () => ({ ok: true, profile: ADMIN }), getDb: () => db })
    const r1 = makeRes(); await handler({ method: 'POST', headers: {}, body: { cohort_id: COHORT, password: pw } }, r1)
    assert.equal(r1.statusCode, 200); assert.deepEqual(r1.body, { success: true, cleared: false })
    assert.deepEqual(log.rpc, [{ name: 'set_school_form_password', args: { p_cohort_id: COHORT, p_password: pw } }])
    assert.equal(log.audits.length, 1); assert.equal(log.audits[0].action_type, 'cohort_form_password_set')
    assert.doesNotMatch(JSON.stringify(log.audits), new RegExp(pw), 'the audit row never carries the password')
    assert.doesNotMatch(JSON.stringify(r1.body), new RegExp(pw))
    const r2 = makeRes(); await handler({ method: 'POST', headers: {}, body: { cohort_id: COHORT, password: '   ' } }, r2)
    assert.deepEqual(r2.body, { success: true, cleared: true })
    const r3 = makeRes(); await handler({ method: 'POST', headers: {}, body: { cohort_id: 'nope', password: pw } }, r3)
    assert.equal(r3.statusCode, 400)
  } finally {
    console.log = origLog; console.warn = origWarn
  }
  assert.ok(!logged.some((l) => l.includes(pw)), 'the password is never logged')

  const missing = makeDb({ rpcResult: { data: null, error: { code: '42883', message: 'function public.set_school_form_password(uuid, text) does not exist' } } })
  const early = createCohortPasswordSetHandler({ verifyCaller: async () => ({ ok: true, profile: ADMIN }), getDb: () => missing.db })
  const r4 = makeRes(); await early({ method: 'POST', headers: {}, body: { cohort_id: COHORT, password: pw } }, r4)
  assert.equal(r4.statusCode, 503); assert.equal(r4.body.error, 'password_hashing_not_enabled')
  assert.doesNotMatch(JSON.stringify(r4.body), new RegExp(pw))
})

// ── SWEEP ───────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (/ \d\.(jsx?|mjs)$/.test(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (['.js', '.jsx'].includes(extname(name))) out.push(p)
  }
  return out
}

test('SWEEP: no browser code writes school_form_password to the cohorts table, and the modals never prefill it', () => {
  const offenders = []
  for (const file of walk(join(root, 'src'))) {
    const rel = file.slice(root.length + 1)
    const code = stripComments(readFileSync(file, 'utf8'))
    // A cohorts insert or update whose payload names the column, within a few lines.
    for (const m of code.matchAll(/from\(\s*['"]cohorts['"]\s*\)\s*\.(insert|update|upsert)\(([\s\S]{0,300})/g)) {
      if (/school_form_password/.test(m[2])) offenders.push(`${rel}: cohorts.${m[1]} with school_form_password`)
    }
  }
  assert.deepEqual(offenders, [])
  const staff = stripComments(read('src/staff/StaffApp.jsx'))
  assert.match(staff, /const \{ school_form_password: password, \.\.\.row \} = d/, 'createCohort strips the password before the insert')
  assert.match(staff, /setCohortPassword\(supabase, data\.id, password\)/)
  assert.match(staff, /const \{ school_form_password: _dropped, \.\.\.row \} = updates \|\| \{\}/, 'updateCohort strips it too')
  assert.match(staff, /setCohortPassword\(supabase, id, newPassword\)/)
  const manage = stripComments(read('src/components/ManageCohortModal.jsx'))
  assert.match(manage, /const \{ school_form_password: _neverShown, \.\.\.cohortFields \} = cohort \|\| \{\}/, 'the stored value is never put in the form')
  assert.match(manage, /rpc\('school_form_requires_password'/, 'whether one is set comes from the RPC')
  assert.doesNotMatch(manage, /school_form_password:\s+form\.school_form_password/)
  assert.match(manage, /autoComplete="new-password"/)
  const client = stripComments(read('src/lib/cohortPassword.js'))
  assert.match(client, /fetch\('\/api\/cohort-password-set'/)
  assert.doesNotMatch(client, /console\.(log|warn|error)/, 'the client logs nothing')
})

test('the register and the SQL gate were updated, and no changed file carries an em dash', () => {
  const register = read('docs/security/FINDINGS_REGISTER.md')
  const s08 = register.slice(register.indexOf('## S-08.'), register.indexOf('## S-09.'))
  // 4be42047 shipped this as "Closed (code); SQL unconfirmed" with both ledger rows
  // UNKNOWN. The Owner applied A and B on 2026-09-25 and every POST section passed, so
  // the closing commit moved S-08 to CLOSED and both rows to APPLIED.
  assert.match(s08, /\*\*Status\*\*: CLOSED\./)
  assert.match(s08, /20261002000000_s08_school_form_password_hash\.sql/)
  assert.match(s08, /20261003000000_s08_school_form_password_plaintext_drop\.sql/)
  const gate = read('docs/security/OWNER_SQL_GATE.md')
  assert.match(gate, /^\| 20261002000000_s08_school_form_password_hash\.sql \|.*APPLIED 2026-09-25/m)
  assert.match(gate, /^\| 20261003000000_s08_school_form_password_plaintext_drop\.sql \|.*APPLIED 2026-09-25/m)
  const dash = new RegExp(String.fromCharCode(8212))
  for (const p of [MIGRATION_A, MIGRATION_B, AUDIT, 'api/cohort-password-set.js', 'src/lib/cohortPassword.js', 'src/components/ManageCohortModal.jsx']) {
    assert.doesNotMatch(read(p), dash, `${p}: no em dash`)
    assert.doesNotMatch(read(p), new RegExp('ASPIRE ' + 'Program'))
  }
  assert.doesNotMatch(s08, dash)
})
