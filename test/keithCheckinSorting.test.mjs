// test/keithCheckinSorting.test.mjs
//
// KEITH-CHECKIN-1 (2026-09-29): Keith sorts support check-in replies. On real Postgres (PGlite) with the
// Action Center's own classifier and capture trigger (sliced from 20261005000000), the Keith
// foundation (20261016000000) and this build's migration (20261017000000).
//
//   - rules 1 and 2 run first and unchanged; Keith only ever sees rule 3 and 4 replies
//   - Keith never closes a reply with a safety term, and can never label Urgent
//   - shadow mode records without acting, and the agreement and kept-open figures are right
//   - auto-close stays shut until 14 days have passed with nothing kept open; the Owner switches it
//   - with Keith ON: thank-yous close into the daily line, requests open as their type, Reopen
//     reverts the provenance (and becomes a correction), Undo puts Keith's close back
//   - demo replies are never sorted by the cron

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const M = await import('../src/lib/keith/checkinSortModel.js')
const Q = await import('../src/lib/actionCenter/queueModel.js')
const S = await import('../lib/server/keith/checkinSorting.js')
const K = await import('../lib/server/keith/runKeithSkill.js')
const G = await import('../lib/server/keith/checkinShadow.js')
const { populationDb } = await import('../lib/server/demoScope.js')
const { createKeithCheckinHandler } = await import('../api/keith-checkin.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')

// ── The pure rules ──────────────────────────────────────────────────────────────

test('the safety pattern in code is rule 1’s pattern in the database, word for word', () => {
  const sql = read('supabase/migrations/20261005000000_action_center_queue.sql')
  const rule1 = sql.match(/IF v ~ '\\m\((harm\|[^']+)\)\\M' THEN\s+RETURN QUERY SELECT 'urgent'/)
  assert.ok(rule1, 'rule 1 found in the migration')
  assert.equal(M.SAFETY_RE.source, `\\b(${rule1[1]})\\b`)
  for (const t of ['I felt unsafe on the unit', 'needle stick today', 'got a needlestick', 'I was harassed', 'feeling sick', 'possible exposure']) assert.ok(M.hasSafetyTerm(t), t)
  for (const t of ['Thanks, great shift!', 'Can I get a parking pass?', 'skills lab was fun']) assert.ok(!M.hasSafetyTerm(t), t)
})

test('low confidence is always Needs a look; a type rides only on a request; nothing becomes Urgent', () => {
  assert.deepEqual(M.normalizeSort({ label: 'thank_you', confidence: 'low', reason: 'x' }), { label: 'needs_a_look', request_type: null, confidence: 'low', reason: 'x' })
  assert.equal(M.normalizeSort({ label: 'request', confidence: 'high', request_type: 'parking' }).request_type, 'parking')
  assert.equal(M.normalizeSort({ label: 'request', confidence: 'high' }).request_type, 'other')
  assert.equal(M.normalizeSort({ label: 'thank_you', confidence: 'high', request_type: 'parking' }).request_type, null)
  assert.equal(M.normalizeSort({ label: 'urgent', confidence: 'high' }).label, 'needs_a_look')
  assert.ok(!M.LABELS.includes('urgent'))
})

test('Keith closes only a thank-you at high or medium confidence, and never one with a safety term', () => {
  const ty = { label: 'thank_you', confidence: 'high' }
  assert.equal(M.wouldClose(ty, 'Thanks so much, great shift'), true)
  assert.equal(M.wouldClose({ ...ty, confidence: 'medium' }, 'Thanks'), true)
  assert.equal(M.wouldClose({ ...ty, confidence: 'low' }, 'Thanks'), false)
  assert.equal(M.wouldClose(ty, 'Thanks, though I felt sick after'), false)
  assert.deepEqual(M.eventFor(ty, 'Thanks, though I felt sick after'), { classification: 'needs_look', status: 'open', rule_key: 'keith_needs_a_look' })
  assert.deepEqual(M.eventFor(ty, 'Thank you!'), { classification: 'thank_you', status: 'closed_auto', rule_key: 'keith_thank_you' })
  assert.deepEqual(M.eventFor({ label: 'request', request_type: 'parking', confidence: 'high' }, 'parking?'), { classification: 'request', status: 'open', rule_key: 'keith_request:parking' })
  assert.equal(M.openRequestLabel('parking'), 'Open as parking request')
  assert.equal(M.openRequestLabel('badge_access'), 'Open as badge access request')
  assert.equal(M.openRequestLabel('other'), 'Open as request')
})

test('a person’s decision maps to a label; agreement and the kept-open figure follow the Owner’s rule', () => {
  assert.equal(M.humanLabelOf('staff_close_no_help'), 'thank_you')
  assert.equal(M.humanLabelOf('staff_open_request'), 'request')
  assert.equal(M.humanLabelOf('staff_reopen'), 'request')
  assert.equal(M.humanLabelOf('ambiguous'), null)
  assert.equal(M.agrees('thank_you', 'thank_you'), true)
  assert.equal(M.agrees('needs_a_look', 'request'), true)
  assert.equal(M.agrees('request', 'request'), true)
  assert.equal(M.agrees('thank_you', 'request'), false)
  assert.equal(M.agrees('needs_a_look', 'thank_you'), false)
  assert.equal(M.keptOpenCount([{ keith: 'thank_you', human: 'request' }, { keith: 'thank_you', human: 'thank_you' }, { keith: 'thank_you', human: null }, { keith: 'request', human: 'request' }]), 1)
})

test('auto-close unlocks only after 14 days of shadow with nothing kept open', () => {
  const now = Date.parse('2026-10-20T12:00:00Z')
  assert.equal(M.gateState({ firstShadowAt: null, keptOpen: 0, now }).ok, false)
  const d13 = M.gateState({ firstShadowAt: '2026-10-06T12:00:01Z', keptOpen: 0, now })
  assert.deepEqual([d13.ok, d13.daysLeft, d13.day], [false, 1, 14])
  assert.match(d13.message, /1 day is left/)
  assert.equal(M.gateState({ firstShadowAt: '2026-10-06T12:00:00Z', keptOpen: 0, now }).ok, true)
  const kept = M.gateState({ firstShadowAt: '2026-10-01T12:00:00Z', keptOpen: 2, now })
  assert.deepEqual([kept.ok, kept.message], [false, 'You kept open 2 replies Keith would have closed.'])
})

// ── The world ───────────────────────────────────────────────────────────────────

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE OR REPLACE FUNCTION public.append_only_refuse() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501'; END $f$;
  CREATE TABLE public.organizations (id uuid PRIMARY KEY);
  INSERT INTO public.organizations VALUES ('a5f1e000-0000-4000-8000-000000000001');
  CREATE TABLE public.user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, email text, role text, is_owner boolean DEFAULT false, is_active boolean DEFAULT true);
  CREATE TABLE public.cohorts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, is_demo boolean DEFAULT false);
  CREATE TABLE public.students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), first_name text, last_name text, preferred_first_name text, cohort_id uuid, is_demo boolean DEFAULT false);
  CREATE TABLE public.student_shift_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), student_id uuid, cohort_id uuid, shift_date date, unit_name text, support_needed text, is_demo boolean DEFAULT false);
  CREATE OR REPLACE FUNCTION public.portal_profile_id() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $f$;
  CREATE OR REPLACE FUNCTION public.is_active_owner_or_admin() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;
  CREATE TABLE public.keith_skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, display_name text NOT NULL, description text NOT NULL DEFAULT '',
    version integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'draft', enabled boolean NOT NULL DEFAULT false,
    allowed_roles text[] NOT NULL DEFAULT '{}', required_tools text[] NOT NULL DEFAULT '{}', required_data text[] NOT NULL DEFAULT '{}',
    trigger_phrases text[] NOT NULL DEFAULT '{}', data_classification text NOT NULL DEFAULT 'internal', model_route text NOT NULL DEFAULT 'default',
    io_contract jsonb NOT NULL DEFAULT '{}'::jsonb, instruction_body text NOT NULL DEFAULT '', owner_label text NOT NULL DEFAULT 'ASPIRE', provenance text NOT NULL DEFAULT '', updated_by uuid);
  CREATE TABLE public.keith_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id text, profile_id uuid, role text, intent text, skill_id uuid, skill_version integer, model text, model_route text, rounds integer, input_tokens integer, output_tokens integer, duration_ms integer, outcome text, rate_limited boolean, created_at timestamptz DEFAULT now());
  CREATE TABLE public.keith_skill_invocations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), skill_id uuid, skill_slug text, skill_version integer, request_id text, invoked_by uuid, invoked_role text, cohort_id uuid, student_id uuid, invocation_mode text, data_sources jsonb, outcome text, denial_reason text, model text, input_tokens integer, output_tokens integer, duration_ms integer, created_at timestamptz DEFAULT now());
`
const actionCenter = () => {
  const lines = read('supabase/migrations/20261005000000_action_center_queue.sql').split('\n')
  const start = lines.findIndex(l => l.startsWith('CREATE TABLE IF NOT EXISTS public.support_checkin_events'))
  const end = lines.findIndex(l => l.startsWith('-- Existing lifecycle records fan out'))
  return lines.slice(start, end).join('\n')
}
const MIGRATION = runnable(read('supabase/migrations/20261017000000_keith_checkin_sorting.sql'))

async function world({ skill = 'shadow' } = {}) {
  const pg = new PGlite()
  await pg.exec(PRELUDE)
  await pg.exec(actionCenter())
  await pg.exec(runnable(read('supabase/migrations/20261016000000_keith_foundation.sql')))
  await pg.exec(MIGRATION)
  const one = async (sql, args = []) => (await pg.query(sql, args)).rows[0]
  const owner = await one(`INSERT INTO user_profiles (full_name, role, is_owner) VALUES ('Jester Lloyd Bautista', 'owner', true) RETURNING *`)
  const admin = await one(`INSERT INTO user_profiles (full_name, role) VALUES ('An Admin', 'admin') RETURNING *`)
  const cohort = await one(`INSERT INTO cohorts (name) VALUES ('Fall 2026') RETURNING *`)
  const demoCohort = await one(`INSERT INTO cohorts (name, is_demo) VALUES ('Demo', true) RETURNING *`)
  if (skill) await pg.query(`UPDATE keith_skills SET status = 'active', enabled = true, version = 1, run_mode = $1 WHERE slug = 'sort-checkin-reply'`, [skill])
  const reply = async (text, { demo = false } = {}) => {
    const c = demo ? demoCohort : cohort
    const st = await one(`INSERT INTO students (first_name, last_name, cohort_id, is_demo) VALUES ($1, 'Student', $2, $3) RETURNING *`, [text.slice(0, 8), c.id, demo])
    return one(`INSERT INTO student_shift_logs (student_id, cohort_id, shift_date, unit_name, support_needed, is_demo) VALUES ($1, $2, '2026-09-28', '6 NE', $3, $4) RETURNING *`, [st.id, c.id, text, demo])
  }
  const events = async (logId) => (await pg.query(`SELECT classification, status, rule_key FROM support_checkin_events WHERE shift_log_id = $1 ORDER BY created_at, id`, [logId])).rows
  const decide = async (logId, action, as = owner) => {
    await pg.query(`SELECT set_config('test.uid', $1, false)`, [as.id])
    await pg.query(`SELECT public.record_support_checkin_decision($1, $2)`, [logId, action])
  }
  const db = pgliteRest(pg)
  return { pg, db, cron: populationDb(db), owner, admin, cohort, reply, events, decide }
}

// A stub model: sorts by what the reply says, and records what it was sent.
function stubKeith(seen = []) {
  return async (args) => {
    seen.push(args)
    const text = args.messages[0].content
    const out = /parking/i.test(text) ? { label: 'request', request_type: 'parking', confidence: 'high', reason: 'Asks for parking.' }
      : /URGENT-TEST/.test(text) ? { label: 'urgent', confidence: 'high', reason: 'x' }
        : /maybe/i.test(text) ? { label: 'thank_you', confidence: 'low', reason: 'Unclear.' }
          : /thank|great/i.test(text) ? { label: 'thank_you', confidence: 'high', reason: 'A thank-you with no question.' }
            : { label: 'needs_a_look', confidence: 'medium', reason: 'Mentions a problem without a clear ask.' }
    return { ok: true, text: JSON.stringify(out), model: 'claude-test', usage: { inputTokens: 90, outputTokens: 30 } }
  }
}

test('the migration: thank_you is a classification, the skill is seeded draft, disabled, in shadow, and matches SKILL.md', async () => {
  const { pg } = await world({ skill: null })
  const [row] = (await pg.query(`SELECT status, enabled, run_mode, model_route, io_contract->>'surface' AS surface, instruction_body FROM keith_skills WHERE slug = 'sort-checkin-reply'`)).rows
  assert.deepEqual([row.status, row.enabled, row.run_mode, row.model_route, row.surface], ['draft', false, 'shadow', 'default', 'action_center'])
  const md = read('skills/sort-checkin-reply/SKILL.md').split('---\n').slice(2).join('---\n').trim()
  assert.equal(row.instruction_body, md, 'the seeded instructions are SKILL.md, exactly')
  await pg.exec(MIGRATION)   // safe to re-run
  assert.equal((await pg.query(`SELECT count(*)::int n FROM keith_skills WHERE slug = 'sort-checkin-reply'`)).rows[0].n, 1)
  assert.doesNotMatch(read('supabase/migrations/20261017000000_keith_checkin_sorting.sql').replace(/--.*$/gm, ''), /DROP TABLE|DELETE FROM/i)
})

test('rules 1 and 2 run first, unchanged; Keith sees only what they do not catch, and only the reply text', async () => {
  const { pg, db, cron, reply, events } = await world()
  const urgent = await reply('I had a needlestick today, thanks for asking')
  const decline = await reply('Thanks!')
  const warm = await reply('The shift was great, thank you for setting it up')
  const ask = await reply('Can I get a parking pass for next week?')
  assert.deepEqual((await events(urgent.id)).map(e => [e.classification, e.rule_key]), [['urgent', 'safety_term']])
  assert.deepEqual((await events(decline.id)).map(e => [e.classification, e.status]), [['decline', 'closed_auto']])
  const seen = []
  const out = await S.sweep(cron, { complete: stubKeith(seen) })
  assert.deepEqual([out.mode, out.candidates, out.sorted, out.closed], ['shadow', 2, 2, 0])
  assert.deepEqual(seen.map(a => a.messages[0].content).sort(), ['REPLY:\nCan I get a parking pass for next week?', 'REPLY:\nThe shift was great, thank you for setting it up'])
  for (const a of seen) assert.doesNotMatch(JSON.stringify(a), /6 NE|Student|Fall 2026|2026-09-28/, 'no name, unit, cohort or date: the reply only')
  // Shadow: provenance only. The rule events are untouched.
  assert.deepEqual((await events(warm.id)).map(e => e.rule_key), ['ambiguous'])
  assert.deepEqual((await events(ask.id)).map(e => e.rule_key), ['question_or_problem'])
  const prov = (await pg.query(`SELECT entity_id, mode, state, output->>'label' AS label FROM keith_provenance ORDER BY output->>'label'`)).rows
  assert.deepEqual(prov.map(p => [p.label, p.mode, p.state]), [['request', 'shadow', 'drafted'], ['thank_you', 'shadow', 'drafted']])
  assert.equal((await S.sweep(cron, { complete: stubKeith() })).candidates, 0, 'a sorted reply is not sorted again')
  // The runner ran as the system, metered under the skill.
  assert.equal((await pg.query(`SELECT count(*)::int n FROM keith_requests WHERE role = 'system' AND intent = 'checkin_sorting' AND outcome = 'completed'`)).rows[0].n, 2)
  // The Action Center: exactly as today, plus "would" lines with a provenance id for the mark.
  const view = await S.queueView(db, { cohortId: warm.cohort_id })
  const logs = (await pg.query(`SELECT * FROM student_shift_logs`)).rows
  const evs = (await pg.query(`SELECT * FROM support_checkin_events`)).rows.map(e => ({ ...e, created_at: e.created_at.toISOString() }))
  const q = Q.normalizeSupportQueue({ logs, events: evs, students: (await pg.query(`SELECT * FROM students`)).rows, keith: view })
  const byLog = new Map(q.open.map(i => [i.shiftLogId, i]))
  assert.deepEqual(byLog.get(warm.id).keith.label, 'Keith would close this')
  assert.equal(byLog.get(ask.id).keith.label, 'Keith would label this: Request · Parking')
  assert.ok(byLog.get(warm.id).keith.provenanceId && byLog.get(warm.id).keith.would)
  assert.equal(byLog.get(urgent.id).keith, null, 'Keith never touched the urgent reply')
  assert.equal(byLog.get(ask.id).actions[0].label, 'Reply', 'in shadow the actions are today’s')
})

test('Keith never closes a reply with a safety term, and can never label Urgent', async () => {
  const { pg, cron, reply, events } = await world({ skill: 'on' })
  // A reply with a safety term can reach rule 3 or 4 only if rule 1 changed; force it, to prove code holds anyway.
  const unsafe = await reply('Thank you, great shift')
  await pg.query(`UPDATE student_shift_logs SET support_needed = 'Thank you, I felt unsafe with one patient' WHERE id = $1`, [unsafe.id])
  await pg.exec(`SET session_replication_role = replica`)   // the capture trigger off, so rule 1 cannot re-sort it
  await pg.query(`INSERT INTO support_checkin_events (shift_log_id, student_id, cohort_id, reply_fingerprint, classification, status, rule_key, created_at) SELECT id, student_id, cohort_id, md5(support_needed), 'needs_look', 'open', 'ambiguous', now() + interval '1 second' FROM student_shift_logs WHERE id = $1`, [unsafe.id])
  await pg.exec(`SET session_replication_role = origin`)
  const seen = []
  const out = await S.sweep(cron, { complete: stubKeith(seen) })
  assert.equal(out.skipped_safety, 1)
  assert.ok(!seen.some(a => /unsafe/.test(a.messages[0].content)), 'Keith was not even asked')
  assert.ok(!(await events(unsafe.id)).some(e => e.status === 'closed_auto'), 'and nothing closed it')
  // "Urgent" is not a label Keith has: the output is dropped, nothing is written.
  const u = await reply('URGENT-TEST please look')
  const before = (await pg.query(`SELECT count(*)::int n FROM keith_provenance`)).rows[0].n
  const o2 = await S.sweep(cron, { complete: stubKeith() })
  assert.equal(o2.failed, 1)
  assert.equal((await pg.query(`SELECT count(*)::int n FROM keith_provenance`)).rows[0].n, before)
  assert.deepEqual((await events(u.id)).map(e => e.rule_key), ['ambiguous'], 'the reply is left as the rules put it')
  assert.equal((await pg.query(`SELECT count(*)::int n FROM support_checkin_events WHERE classification = 'urgent' AND rule_key <> 'safety_term'`)).rows[0].n, 0, 'only rule 1 ever writes Urgent')
})

test('shadow figures: agreement per label and "kept open" from what people actually did', async () => {
  const { db, cron, reply, decide } = await world()
  const a = await reply('Great shift, thank you')           // Keith: thank_you; person closes: agree
  const b = await reply('Thank you, it was great really')  // Keith: thank_you; person opens a request: KEPT OPEN
  const c = await reply('The preceptor left early and I was alone')  // Keith: needs a look; person opens: agree
  const d = await reply('Parking is a problem for me')     // Keith: request; not decided yet: not counted
  await S.sweep(cron, { complete: stubKeith() })
  await decide(a.id, 'close_no_help')
  await decide(b.id, 'open_request')
  await decide(c.id, 'open_request')
  await S.sweep(cron, { complete: stubKeith() })            // observes the decisions
  const f = await G.checkinShadowFigures(db)
  assert.deepEqual([f.sorted, f.keptOpen, f.agreement.total, f.agreement.agreed], [4, 1, 3, 2])
  assert.deepEqual(f.agreement.byLabel, { thank_you: { total: 2, agreed: 1 }, needs_a_look: { total: 1, agreed: 1 } })
  // Changing a decision is observed too: close b after all, and kept-open returns to 0.
  await decide(b.id, 'close_no_help')
  await S.observeShadow(db)
  assert.equal((await G.checkinShadowFigures(db)).keptOpen, 0)
  void d
})

test('auto-close stays shut until 14 days pass with nothing kept open; then the Owner switches it, logged', async () => {
  const { pg, db, owner, admin, cron, reply, decide } = await world()
  const a = await reply('Great shift, thank you')
  await S.sweep(cron, { complete: stubKeith() })
  const as = (profile) => createKeithCheckinHandler({ verifyCaller: async () => ({ authenticated: true, profile }), makeDb: () => db })
  const early = await call(as(owner), { action: 'set_mode', mode: 'on' })
  assert.equal(early.status, 409)
  assert.match(early.body.message, /Shadow mode runs 14 days\. 14 days are left\./)
  assert.equal((await call(as(admin), { action: 'set_mode', mode: 'on' })).status, 403, 'the Owner only')
  // Fifteen days of shadow, one of which a person kept open.
  await pg.query(`INSERT INTO keith_provenance (skill_key, skill_version, entity_type, entity_id, field, output, mode, state, human_diff, created_at)
    VALUES ('sort-checkin-reply', '1.1', 'checkin_reply', gen_random_uuid(), 'fp', '{"label":"thank_you"}', 'shadow', 'drafted', '{"label":"request"}', now() - interval '15 days')`)
  const kept = await call(as(owner), { action: 'set_mode', mode: 'on' })
  assert.deepEqual([kept.status, kept.body.message], [409, 'You kept open 1 reply Keith would have closed.'])
  await pg.exec(`ALTER TABLE keith_provenance DISABLE TRIGGER trg_keith_provenance_guard`)
  await pg.query(`UPDATE keith_provenance SET human_diff = '{"label":"thank_you"}' WHERE field = 'fp'`)
  await pg.exec(`ALTER TABLE keith_provenance ENABLE TRIGGER trg_keith_provenance_guard`)
  await decide(a.id, 'close_no_help'); await S.observeShadow(db)
  const on = await call(as(owner), { action: 'set_mode', mode: 'on' })
  assert.deepEqual([on.status, on.body.from, on.body.to, on.body.agreement.agreed, on.body.agreement.total], [200, 'shadow', 'on', 2, 2])
  const [log] = (await pg.query(`SELECT from_mode, to_mode, agreement FROM keith_skill_mode_changes`)).rows
  assert.deepEqual([log.from_mode, log.to_mode, log.agreement.total], ['shadow', 'on', 2])
  // Turning it off is always allowed.
  assert.equal((await call(as(owner), { action: 'set_mode', mode: 'shadow' })).body.to, 'shadow')
})

test('with Keith ON: a thank-you closes into the daily line, a request opens as its type, Reopen and Undo work', async () => {
  const { pg, db, owner, cron, reply, events } = await world({ skill: 'on' })
  const ty = await reply('Great shift, thank you so much')
  const park = await reply('Where is student parking?')
  const vague = await reply('Maybe fine, not sure')          // low confidence thank-you: Needs a look
  const out = await S.sweep(cron, { complete: stubKeith() })
  assert.deepEqual([out.sorted, out.closed, out.labeled], [3, 1, 2])
  assert.deepEqual((await events(ty.id)).map(e => [e.classification, e.status, e.rule_key]).at(-1), ['thank_you', 'closed_auto', 'keith_thank_you'])
  assert.deepEqual((await events(park.id)).at(-1).rule_key, 'keith_request:parking')
  assert.deepEqual((await events(vague.id)).at(-1).rule_key, 'keith_needs_a_look')

  const load = async () => {
    const view = await S.queueView(db, { cohortId: ty.cohort_id })
    const logs = (await pg.query(`SELECT * FROM student_shift_logs`)).rows
    const evs = (await pg.query(`SELECT * FROM support_checkin_events`)).rows.map(e => ({ ...e, created_at: e.created_at.toISOString() }))
    return { view, q: Q.normalizeSupportQueue({ logs, events: evs, students: (await pg.query(`SELECT * FROM students`)).rows, keith: view }) }
  }
  let { view, q } = await load()
  assert.equal(view.mode, 'on')
  assert.ok(!q.open.some(i => i.shiftLogId === ty.id), 'the closed thank-you left the queue')
  assert.ok(!q.closed.some(i => i.shiftLogId === ty.id), 'and is not in the rule-closed list')
  assert.deepEqual(q.keithDaily.map(d => [d.today, d.items.map(i => i.reply)]), [[true, ['Great shift, thank you so much']]])
  assert.ok(q.keithDaily[0].items[0].provenanceId)
  const parkItem = q.open.find(i => i.shiftLogId === park.id)
  assert.deepEqual([parkItem.keith.label, parkItem.keith.would, parkItem.actions[0].label], ['Request · Parking', false, 'Open as parking request'])
  assert.equal(q.open.find(i => i.shiftLogId === vague.id).keith.label, 'Needs a look')

  // Reopen: back to the queue as a normal item; its provenance reverted; it becomes a correction.
  await S.reopen(db, owner, { shiftLogId: ty.id })
  ;({ q } = await load())
  assert.ok(q.open.some(i => i.shiftLogId === ty.id))
  assert.deepEqual(q.keithDaily, [])
  assert.equal((await provState(pg, ty.id)), 'reverted')
  assert.deepEqual(await S.correctionsFor(cron), ['Great shift, thank you so much'])
  // Undo: Keith's close again, provenance back to drafted.
  await S.undoReopen(db, owner, { shiftLogId: ty.id })
  ;({ q } = await load())
  assert.equal(q.keithDaily[0].items.length, 1)
  assert.equal(await provState(pg, ty.id), 'drafted')
  // Reopen twice more: the event log accepts repeats.
  await S.reopen(db, owner, { shiftLogId: ty.id })
  await S.undoReopen(db, owner, { shiftLogId: ty.id })
  await S.reopen(db, owner, { shiftLogId: ty.id })
  await assert.rejects(S.reopen(db, owner, { shiftLogId: park.id }), /Keith did not close this reply/)

  // The next reading carries the correction in its instructions.
  const seen = []
  await reply('Thanks, great day')
  await S.sweep(cron, { complete: stubKeith(seen) })
  assert.match(seen[0].system, /THE OWNER'S CORRECTIONS[\s\S]*"Great shift, thank you so much"/)
})

test('a reply a person already decided is never sorted, and demo replies are never sorted by the cron', async () => {
  const { cron, reply, decide } = await world({ skill: 'on' })
  const decided = await reply('Great shift, thank you')
  await decide(decided.id, 'open_request')
  await reply('Great shift, thank you!!', { demo: true })
  const seen = []
  const out = await S.sweep(cron, { complete: stubKeith(seen) })
  assert.deepEqual([out.candidates, seen.length], [0, 0])
})

test('a person who acts while Keith is reading wins: Keith writes nothing over their decision', async () => {
  const { cron, reply, decide, events } = await world({ skill: 'on' })
  const r = await reply('Great shift, thank you')
  const base = stubKeith()
  const out = await S.sweep(cron, { complete: async (args) => { await decide(r.id, 'open_request'); return base(args) } })
  assert.deepEqual([out.sorted, out.closed, out.labeled], [1, 0, 0])
  assert.deepEqual((await events(r.id)).map(e => e.rule_key), ['ambiguous', 'staff_open_request'], 'the person’s decision stands')
})

test('/api/keith-checkin: Owner and Admin only, strict bodies', async () => {
  const { db, owner, admin, cohort } = await world()
  const as = (profile) => createKeithCheckinHandler({ verifyCaller: async () => ({ authenticated: true, profile }), makeDb: () => db })
  assert.equal((await call(as(owner), { action: 'queue', cohort_id: cohort.id })).status, 200)
  assert.equal((await call(as(admin), { action: 'queue', cohort_id: cohort.id })).status, 200)
  assert.equal((await call(as({ id: 'x', role: 'interviewer' }), { action: 'queue', cohort_id: cohort.id })).status, 403)
  assert.equal((await call(as({ id: 'x', role: 'student' }), { action: 'queue', cohort_id: cohort.id })).status, 403)
  assert.equal((await call(as(owner), { action: 'queue', cohort_id: cohort.id, mode: 'on' })).status, 400)
  assert.equal((await call(as(owner), { action: 'reopen', shift_log_id: 'nope' })).status, 400)
})

async function provState(pg, logId) {
  return (await pg.query(`SELECT state FROM keith_provenance WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1`, [logId])).rows[0]?.state
}
function call(handler, body) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.statusCode = c; return this }, json(b) { resolve({ status: this.statusCode, body: b }); return this }, end() { resolve({ status: this.statusCode }); return this } }
    handler({ method: 'POST', headers: {}, body }, res)
  })
}
