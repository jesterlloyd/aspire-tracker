// test/s04InterviewerSelfService.test.mjs
//
// S-04 completion: interviewer self-service on interview_availability_blocks,
// interview_slots and interview_sessions runs through ownership-checked server actions,
// the browser writes none of the three tables, and the migration moves their write
// policies to is_active_staff_writer() while keeping SELECT on is_staff().
//
//   * the endpoint, driven through its factory with the caller and database mocked:
//       an interviewer can pause their own block, block and unblock their own slot, and
//       mark their own Teams invite; cannot do any of these on another interviewer's rows;
//       Owner, Admin and Co-Lead can act on any row; a booked slot cannot be blocked or
//       unblocked; the actor stamp comes from the verified profile and the body cannot
//       set it; a session with no slot is admin-level only.
//   * SWEEP: no file under src/ inserts, updates, upserts or deletes any of the three
//     tables directly.
//   * the migration, on real Postgres (PGlite): the three FOR ALL policies go, twelve
//     split policies arrive, a narrower pre-existing policy survives, the file is safe to
//     re-run, and every audit section executes and says what its comment says.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { createAvailabilityHandler } from '../api/availability.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const stripComments = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

const MIGRATION = 'supabase/migrations/20261004000000_s04_interview_tables_write_split.sql'
const AUDIT = 'db/audit/s04_interview_tables_write_split_checks.sql'
const migration = read(MIGRATION)
const audit = read(AUDIT)

// ── A small relational fake: three tables, the chains the endpoint uses ────────

const U = (n) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`
const IVY = U(1), OLA = U(2), ADA = U(3), CO = U(4)          // profiles: two interviewers, an admin, a co-lead
const B_IVY = U(5), B_OLA = U(6), B_LEGACY = U(7)           // blocks
const S_IVY = U(8), S_IVY_BOOKED = U(9), S_OLA = U('a'), S_ORPHAN = U('b')
const SESS_IVY = U('c'), SESS_OLA = U('d'), SESS_NOSLOT = U('e')
const STUDENT = U('f')

function makeDb() {
  const t = {
    interview_availability_blocks: [
      { id: B_IVY, created_by_user_id: ADA, interviewer_profile_id: IVY, is_active: true },     // made FOR Ivy by an admin
      { id: B_OLA, created_by_user_id: OLA, interviewer_profile_id: OLA, is_active: true },
      { id: B_LEGACY, created_by_user_id: null, interviewer_profile_id: null, is_active: true },
    ],
    interview_slots: [
      { id: S_IVY, block_id: B_IVY, is_booked: false, status: 'available', blocked_reason: null },
      { id: S_IVY_BOOKED, block_id: B_IVY, is_booked: true, status: 'booked', blocked_reason: null },
      { id: S_OLA, block_id: B_OLA, is_booked: false, status: 'blocked', blocked_reason: 'Break' },
      { id: S_ORPHAN, block_id: null, is_booked: false, status: 'available', blocked_reason: null },
    ],
    interview_sessions: [
      { id: SESS_IVY, slot_id: S_IVY_BOOKED, student_id: STUDENT, teams_meeting_booked: false, teams_invite_sent_at: null, teams_invite_sent_by: null },
      { id: SESS_OLA, slot_id: S_OLA, student_id: U('0'), teams_meeting_booked: false, teams_invite_sent_at: null, teams_invite_sent_by: null },
      { id: SESS_NOSLOT, slot_id: null, student_id: STUDENT, teams_meeting_booked: false, teams_invite_sent_at: null, teams_invite_sent_by: null },
    ],
  }
  const log = { updates: [], deletes: [] }
  const db = {
    from(table) {
      const rows = t[table]
      const q = { _f: [], _op: null, _patch: null }
      q.select = () => q
      q.eq = (col, v) => { q._f.push([col, v]); return q }
      q.update = (patch) => { q._op = 'update'; q._patch = patch; return q }
      q.delete = () => { q._op = 'delete'; return q }
      const matches = () => rows.filter((r) => q._f.every(([c, v]) => r[c] === v))
      q.maybeSingle = async () => ({ data: matches()[0] ? { ...matches()[0] } : null, error: null })
      q.then = (resolve) => {
        if (q._op === 'update') {
          const hit = matches(); hit.forEach((r) => Object.assign(r, q._patch)); log.updates.push({ table, patch: q._patch, n: hit.length })
          return resolve({ error: null })
        }
        if (q._op === 'delete') {
          const hit = matches(); t[table] = rows.filter((r) => !hit.includes(r)); log.deletes.push({ table, n: hit.length })
          return resolve({ error: null, count: hit.length })
        }
        return resolve({ data: matches(), error: null })
      }
      return q
    },
    tables: t, log,
  }
  return db
}

function makeRes() {
  const res = { statusCode: 0, body: null, headers: {} }
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v }
  res.status = (code) => { res.statusCode = code; return res }
  res.json = (payload) => { res.body = payload; return res }
  res.end = () => res
  return res
}

const caller = (profileId, role, isOwner = false) => async () => ({ authenticated: true, userId: `auth-${profileId}`, profileId, role, isOwner, fullName: 'Test' })

async function call(db, who, body) {
  const handler = createAvailabilityHandler({ verifyCaller: who, getDb: () => db })
  const res = makeRes()
  await handler({ method: 'POST', headers: {}, body }, res)
  return res
}

test('an interviewer can pause and resume their own block, including one an admin created for them', async () => {
  const db = makeDb()
  let r = await call(db, caller(IVY, 'interviewer'), { action: 'set_block_active', block_id: B_IVY, active: false })
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
  assert.equal(db.tables.interview_availability_blocks.find((b) => b.id === B_IVY).is_active, false)
  r = await call(db, caller(IVY, 'interviewer'), { action: 'set_block_active', block_id: B_IVY, active: true })
  assert.equal(r.statusCode, 200)
  assert.equal(db.tables.interview_availability_blocks.find((b) => b.id === B_IVY).is_active, true)
})

test('an interviewer cannot pause another interviewer\'s block, or a legacy block with no owner', async () => {
  const db = makeDb()
  for (const blockId of [B_OLA, B_LEGACY]) {
    const r = await call(db, caller(IVY, 'interviewer'), { action: 'set_block_active', block_id: blockId, active: false })
    assert.equal(r.statusCode, 403, blockId)
  }
  assert.equal(db.log.updates.length, 0, 'nothing written')
})

test('an interviewer can block and unblock their own open slot, never a booked one, never another\'s', async () => {
  const db = makeDb()
  let r = await call(db, caller(IVY, 'interviewer'), { action: 'block_slot', slot_id: S_IVY, reason: 'Meeting' })
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
  assert.deepEqual(db.tables.interview_slots.find((s) => s.id === S_IVY), { id: S_IVY, block_id: B_IVY, is_booked: false, status: 'blocked', blocked_reason: 'Meeting' })
  r = await call(db, caller(IVY, 'interviewer'), { action: 'unblock_slot', slot_id: S_IVY })
  assert.equal(r.statusCode, 200)
  assert.equal(db.tables.interview_slots.find((s) => s.id === S_IVY).status, 'available')
  assert.equal(db.tables.interview_slots.find((s) => s.id === S_IVY).blocked_reason, null)

  // A booked slot is refused for everyone, block or unblock, even the owner and an admin.
  for (const who of [caller(IVY, 'interviewer'), caller(ADA, 'admin')]) {
    for (const action of ['block_slot', 'unblock_slot']) {
      r = await call(db, who, { action, slot_id: S_IVY_BOOKED, reason: 'x' })
      assert.equal(r.statusCode, 409, `${action} on a booked slot`)
    }
  }
  assert.equal(db.tables.interview_slots.find((s) => s.id === S_IVY_BOOKED).status, 'booked')

  // Another interviewer's slot, and a slot with no parent block.
  r = await call(db, caller(IVY, 'interviewer'), { action: 'unblock_slot', slot_id: S_OLA })
  assert.equal(r.statusCode, 403)
  r = await call(db, caller(IVY, 'interviewer'), { action: 'block_slot', slot_id: S_ORPHAN, reason: 'x' })
  assert.equal(r.statusCode, 403)
  assert.equal(db.tables.interview_slots.find((s) => s.id === S_OLA).status, 'blocked')

  // A missing or oversized reason is refused before anything is read.
  r = await call(db, caller(IVY, 'interviewer'), { action: 'block_slot', slot_id: S_IVY, reason: '   ' })
  assert.equal(r.statusCode, 400)
  r = await call(db, caller(IVY, 'interviewer'), { action: 'block_slot', slot_id: S_IVY, reason: 'x'.repeat(121) })
  assert.equal(r.statusCode, 400)
})

test('an interviewer can mark their own Teams invite sent; the actor stamp is the verified profile; the body cannot set it', async () => {
  const db = makeDb()
  let r = await call(db, caller(IVY, 'interviewer'), { action: 'mark_teams_invite_sent', session_id: SESS_IVY })
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
  const sess = db.tables.interview_sessions.find((s) => s.id === SESS_IVY)
  assert.equal(sess.teams_meeting_booked, true)
  assert.equal(sess.teams_invite_sent_by, IVY, 'stamped from the verified profile')
  assert.match(sess.teams_invite_sent_at, /^\d{4}-\d{2}-\d{2}T/)

  r = await call(db, caller(IVY, 'interviewer'), { action: 'mark_teams_invite_sent', session_id: SESS_OLA })
  assert.equal(r.statusCode, 403, 'another interviewer\'s session')
  r = await call(db, caller(IVY, 'interviewer'), { action: 'mark_teams_invite_sent', session_id: SESS_NOSLOT })
  assert.equal(r.statusCode, 403, 'a session with no slot has no interviewer to own it')
  r = await call(db, caller(IVY, 'interviewer'), { action: 'mark_teams_invite_sent', session_id: SESS_IVY, teams_invite_sent_by: OLA })
  assert.equal(r.statusCode, 400, 'the body cannot name the actor')
  assert.equal(db.tables.interview_sessions.find((s) => s.id === SESS_OLA).teams_invite_sent_by, null)
})

test('Owner, Admin and Co-Lead can act on any interviewer\'s rows; a viewer cannot use the endpoint', async () => {
  for (const [who, label] of [[caller(ADA, 'admin'), 'admin'], [caller(CO, 'co-lead'), 'co-lead'], [caller(CO, 'co_lead'), 'co_lead'], [caller(ADA, 'viewer', true), 'owner']]) {
    const db = makeDb()
    let r = await call(db, who, { action: 'set_block_active', block_id: B_OLA, active: false })
    assert.equal(r.statusCode, 200, `${label} pauses Ola's block`)
    r = await call(db, who, { action: 'set_block_active', block_id: B_LEGACY, active: false })
    assert.equal(r.statusCode, 200, `${label} pauses a legacy block`)
    r = await call(db, who, { action: 'unblock_slot', slot_id: S_OLA })
    assert.equal(r.statusCode, 200, `${label} unblocks Ola's slot`)
    r = await call(db, who, { action: 'block_slot', slot_id: S_ORPHAN, reason: 'Hold' })
    assert.equal(r.statusCode, 200, `${label} blocks an orphan slot`)
    r = await call(db, who, { action: 'mark_teams_invite_sent', session_id: SESS_OLA })
    assert.equal(r.statusCode, 200, `${label} marks Ola's invite`)
    r = await call(db, who, { action: 'mark_teams_invite_sent', session_id: SESS_NOSLOT })
    assert.equal(r.statusCode, 200, `${label} marks a slotless session`)
    r = await call(db, who, { action: 'delete_student_sessions', student_id: STUDENT })
    assert.equal(r.statusCode, 200, `${label} runs the student cascade`)
    assert.equal(r.body.deleted, 2)
  }
  const db = makeDb()
  const r = await call(db, caller(U('9'), 'viewer'), { action: 'set_block_active', block_id: B_OLA, active: false })
  assert.equal(r.statusCode, 403, 'a viewer has no availability to manage')
  const r2 = await call(db, caller(IVY, 'interviewer'), { action: 'delete_student_sessions', student_id: STUDENT })
  assert.equal(r2.statusCode, 403, 'an interviewer cannot delete a student\'s sessions')
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

test('SWEEP: no browser code writes interview_availability_blocks, interview_slots or interview_sessions directly', () => {
  const offenders = []
  for (const file of walk(join(root, 'src'))) {
    const rel = file.slice(root.length + 1)
    const code = stripComments(readFileSync(file, 'utf8'))
    for (const m of code.matchAll(/from\(\s*['"](interview_availability_blocks|interview_slots|interview_sessions)['"]\s*\)([\s\S]{0,120})/g)) {
      if (/^\s*\.(insert|update|upsert|delete)\(/.test(m[2]) || /\n\s*\.(insert|update|upsert|delete)\(/.test(m[2].split(')')[0] + ')')) {
        offenders.push(`${rel}: ${m[1]}.${(m[2].match(/\.(insert|update|upsert|delete)\(/) || [])[1]}`)
      }
    }
  }
  assert.deepEqual(offenders, [], 'the three interview tables are written only by api/availability.js:\n' + offenders.join('\n'))
  assert.equal(existsSync(join(root, 'src/components/AvailabilitySection.jsx')), false, 'the unreferenced legacy section that wrote the tables is retired')
  assert.equal(existsSync(join(root, 'src/components/WeekCalendar.jsx')), false, 'the unreferenced legacy calendar that wrote the tables is retired')
  for (const f of ['src/components/AvailabilityManagerModal.jsx', 'src/components/InterviewDayDrawer.jsx', 'src/staff/StaffApp.jsx']) {
    assert.match(read(f), /callAvailability\(supabase, \{ action: '/, `${f} goes through the endpoint`)
  }
  // The self-service controls stay visible to every role, as the earlier S-04 test also holds.
  const drawer = read('src/components/InterviewDayDrawer.jsx')
  assert.match(drawer, /handleMarkTeamsInviteSent\(session\.id\)/)
  assert.match(drawer, /setBlockingSlot\(slot\)/)
  assert.match(drawer, /handleUnblockSlot\(slot\.id\)/)
})

// ── The migration, on real Postgres ─────────────────────────────────────────

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
  CREATE OR REPLACE FUNCTION public.is_active_staff_writer() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
  CREATE TABLE public.interview_availability_blocks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_active boolean);
  CREATE TABLE public.interview_slots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), block_id uuid, is_booked boolean, status text, booked_by_student_id uuid);
  CREATE TABLE public.interview_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slot_id uuid, student_id uuid);
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_availability_blocks, public.interview_slots, public.interview_sessions TO authenticated;
  ALTER TABLE public.interview_availability_blocks ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.interview_slots ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.interview_sessions ENABLE ROW LEVEL SECURITY;
  -- Wave E (20260712000004): the three FOR ALL policies this migration replaces
  CREATE POLICY "staff_all_availability_blocks" ON public.interview_availability_blocks FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
  CREATE POLICY "staff_all_interview_slots" ON public.interview_slots FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
  CREATE POLICY "staff_all_interview_sessions" ON public.interview_sessions FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
  -- A narrower policy that already exists must survive untouched
  CREATE POLICY "slots_student_read_own" ON public.interview_slots FOR SELECT TO authenticated USING (booked_by_student_id = auth_placeholder());
`
const AUTH_STUB = `CREATE OR REPLACE FUNCTION public.auth_placeholder() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;`

const sections = () => audit.split(/\n(?=-- ── (?:PRE|POST) \d+:)/).slice(1)
const sectionSql = (label) => {
  const s = sections().find((x) => x.startsWith(`-- ── ${label}:`))
  assert.ok(s, `${label} present`)
  return s.replace(/^\s*--.*$/gm, '')
}

test('the migration replaces the three FOR ALL policies with the split, preserves a narrower policy, and is safe to re-run', async () => {
  const db = new PGlite()
  await db.exec(AUTH_STUB)
  await db.exec(PRELUDE)
  const pre1 = (await db.query(sectionSql('PRE 1'))).rows
  assert.deepEqual(pre1.map((r) => [r.tablename, r.policyname, r.cmd]), [
    ['interview_availability_blocks', 'staff_all_availability_blocks', 'ALL'],
    ['interview_sessions', 'staff_all_interview_sessions', 'ALL'],
    ['interview_slots', 'slots_student_read_own', 'SELECT'],
    ['interview_slots', 'staff_all_interview_slots', 'ALL'],
  ])
  assert.equal((await db.query(sectionSql('PRE 2'))).rows.length, 2)
  const pre3 = (await db.query(sectionSql('PRE 3'))).rows

  await db.exec(migration)
  await db.exec(migration) // idempotent

  const post1 = (await db.query(sectionSql('POST 1'))).rows
  const names = post1.map((r) => `${r.tablename}.${r.policyname}:${r.cmd}`)
  for (const t of ['interview_availability_blocks', 'interview_slots', 'interview_sessions']) {
    assert.ok(names.includes(`${t}.${t}_staff_select:SELECT`), t)
    assert.ok(names.includes(`${t}.${t}_writer_insert:INSERT`), t)
    assert.ok(names.includes(`${t}.${t}_writer_update:UPDATE`), t)
    assert.ok(names.includes(`${t}.${t}_writer_delete:DELETE`), t)
  }
  assert.ok(names.includes('interview_slots.slots_student_read_own:SELECT'), 'the narrower pre-existing policy survives')
  assert.equal(post1.filter((r) => r.policyname.startsWith('staff_all_')).length, 0)
  assert.equal(post1.length, 13)
  for (const r of post1.filter((r) => r.policyname.endsWith('_staff_select'))) assert.match(r.qual, /is_staff\(\)/)
  for (const r of post1.filter((r) => r.policyname.includes('_writer_'))) {
    assert.doesNotMatch(String(r.qual) + String(r.with_check), /is_staff\(\)/)
    assert.match(String(r.qual) + String(r.with_check), /is_active_staff_writer\(\)/)
  }
  assert.deepEqual((await db.query(sectionSql('POST 2'))).rows, [])
  const post3 = (await db.query(sectionSql('POST 3'))).rows[0]
  assert.equal(Number(post3.writes), 9); assert.equal(Number(post3.writer_gated), 9)
  assert.deepEqual((await db.query(sectionSql('POST 4'))).rows, pre3)
})

test('the migration refuses to run without its predicates, and the audit is read-only', async () => {
  const db = new PGlite()
  await db.exec(`CREATE TABLE public.interview_availability_blocks (id uuid PRIMARY KEY); CREATE TABLE public.interview_slots (id uuid PRIMARY KEY); CREATE TABLE public.interview_sessions (id uuid PRIMARY KEY);`)
  await assert.rejects(() => db.exec(migration), /is_staff\(\) and is_active_staff_writer\(\) must both exist/)
  const code = audit.replace(/^\s*--.*$/gm, '')
  assert.doesNotMatch(code, /^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/im)
  assert.equal(sections().length, 7)
})

test('the register and the SQL gate were updated, and no changed file carries an em dash', () => {
  const register = read('docs/security/FINDINGS_REGISTER.md')
  const s04 = register.slice(register.indexOf('## S-04.'), register.indexOf('## S-05.'))
  // Repinned when the Owner applied 20261004000000 on 2026-09-25 (S04-2): the finding is Closed.
  assert.match(s04, /- \*\*Status\*\*: Closed\./)
  assert.doesNotMatch(s04, /SQL unconfirmed/)
  assert.match(s04, /20261004000000_s04_interview_tables_write_split\.sql/)
  const gate = read('docs/security/OWNER_SQL_GATE.md')
  assert.match(gate, /^\| 20261004000000_s04_interview_tables_write_split\.sql \|.*APPLIED 2026-09-25/m)
  assert.doesNotMatch(gate, /^\| 20261004000000_s04_interview_tables_write_split\.sql \|.*UNKNOWN/m)
  const dash = new RegExp(String.fromCharCode(8212))
  for (const p of [MIGRATION, AUDIT, 'api/availability.js', 'src/lib/availabilityApi.js']) {
    assert.doesNotMatch(read(p), dash, `${p}: no em dash`)
    assert.doesNotMatch(read(p), new RegExp('ASPIRE ' + 'Program'))
  }
  assert.doesNotMatch(s04, dash)
})
