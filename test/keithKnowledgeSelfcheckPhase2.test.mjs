// test/keithKnowledgeSelfcheckPhase2.test.mjs
//
// KEITH-KNOWLEDGE-SELFCHECK-1 Phase 2 (2026-10-01): Keith checks his own Knowledge Center.
//   - the skill: one row, two steps, SKILL.md is what the migration seeds, the draft step shares the row
//   - the pure core: the triage message, Keith's findings held to what he was shown, the gates on an
//     edit (governed rails kept, numbers listed not refused, links resolved) and on a Draft
//   - on real Postgres (PGlite) over the real Knowledge Center, foundation and self-check migrations,
//     with a stand-in model and a stand-in GitHub: a check files an edit and a Draft with their
//     evidence, credits the Owner, deletes the questions it used, records itself, starts the next check
//     where it stopped, calls no model when there is nothing new, skips an entry with a pending
//     revision, and does nothing while the skill is off
//   - the endpoint: Owner and Admin see the status, only the Owner runs a check
//   - the Knowledge Center: the Keith card and badge, the strip, the evidence on revisions and Drafts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const M = await import('../lib/server/keith/knowledgeSelfCheckModel.js')
const C = await import('../lib/server/keith/knowledgeSelfCheck.js')
const D = await import('../lib/server/keith/skillDefs.js')
const { VALID_DATA_GRANTS } = await import('../lib/server/keith/skillPackage.js')
const { createKnowledgeCheckHandler } = await import('../api/keith-knowledge-check.js')
const T = await import('../src/lib/keith/knowledgeSelfCheckText.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')

// ── The skill ────────────────────────────────────────────────────────────────────

test('one skill, two steps: SKILL.md is what the migration seeds, and the draft step shares the row', () => {
  const body = read('skills/knowledge-self-check/SKILL.md').split('---\n').slice(2).join('---\n').trim()
  // KEITH-KNOWLEDGE-SELFCHECK-TRIAGE-1 changed this: the triage was rewritten, and the migration that
  // carries the current text is 20261031000000 (Phase 2 seeds the first version, 20261030000000 the second).
  const current = read('supabase/migrations/20261031000000_knowledge_self_check_triage.sql').match(/v_body  text := E'(You keep[\s\S]*?)';\nBEGIN/)[1].replace(/''/g, "'").replace(/\\n/g, '\n')
  assert.equal(current, body)
  assert.match(read('supabase/migrations/20261029000000_keith_knowledge_selfcheck_phase2.sql'), /E'You keep ASPIRE Intelligence''s Knowledge Center current\./)
  assert.match(body, /5\. Changes are listed newest first\. When two changes disagree, such as a screen renamed twice, the NEWEST one is what the app does now/)
  assert.match(body, /Go through the Active entries ONE AT A TIME; do not skip any/)
  assert.match(body, /cite EVERY change that makes any part of it wrong/)
  assert.match(body, /uses the feature's CURRENT name \(rule 5\)/)
  assert.doesNotMatch(body, /Skip anything you are unsure of/, 'the sentence that made the second check find nothing')
  assert.doesNotMatch(body, /—/, 'house style: no em dashes in what Keith is told')
  assert.equal(D.SKILL_DEFS['knowledge-self-check'].skillSlug, undefined)
  assert.equal(D.SKILL_DEFS['knowledge-self-check-draft'].skillSlug, 'knowledge-self-check', 'one switch for both steps')
  assert.ok(VALID_DATA_GRANTS.includes('knowledge_center_read'), 'the seeded grant is one the skill editor accepts')
  assert.match(read('lib/server/keith/runKeithSkill.js'), /loadSkill\(db, def\.skillSlug \|\| skillKey\)/)
})

// ── The pure core ────────────────────────────────────────────────────────────────

const E = (id, title, body, state = 'active', extra = {}) => ({ id, title, slug: title.toLowerCase().replace(/\W+/g, '-'), category: 'student_requirements', state, body, review_date: null, aliases: [], tags: [], source_attribution: 'Handbook', precedence_rank: 100, ...extra })
const hours = E('00000000-0000-4000-8000-000000000001', 'Clinical Hours', '# Clinical Hours\n\nStudents complete 90 hours and log each shift on Rotation > Activity within 48 hours.\n\n## Keith Guidance\nKeith should say: hours count only when logged.\nKeith should not say: that unlogged hours count.')
const logging = E('00000000-0000-4000-8000-000000000002', 'Shift Logging', 'Students log shifts in the Student Portal.')
const draft = E('00000000-0000-4000-8000-000000000003', 'Parking', 'Draft parking notes.', 'draft')
const commit = (sha, subject, body = '', date = '2026-09-30T20:00:00Z') => ({ sha, date, subject, body })
const changes = [commit('aaaa1111', 'Rotation > Activity is labelled Shift Log', 'The picker and launcher now say Shift Log; the route is unchanged.'), commit('bbbb2222', 'TEST: fix a date')]
const questions = [{ id: '10000000-0000-4000-8000-000000000001', question: 'What is the policy for students bringing personal laptops to the unit?', created_at: '2026-10-01T00:46:22Z' }]

test('the triage message: ids for what Keith may cite, Active entries in full-ish, Drafts by title only', () => {
  const { message, refs } = M.buildTriage({ today: '2026-10-01', entries: [hours, logging, draft], changes, questions })
  assert.match(message, /^TASK: TRIAGE\nToday is 2026-10-01\./)
  assert.match(message, /\[c1\] 2026-09-30 · Rotation > Activity is labelled Shift Log :: The picker and launcher now say Shift Log/)
  assert.match(message, /\[q1\] 2026-10-01 · What is the policy for students bringing personal laptops/)
  assert.match(message, /DRAFT ENTRIES ALREADY WAITING \(1\)\n- Parking/)
  assert.match(message, /\[e1\] Clinical Hours · student_requirements · review none/)
  assert.ok(!message.includes('Draft parking notes'), 'a Draft is listed by title, never sent as an entry to flag')
  assert.equal(refs.entries.size, 2)
  const long = M.buildTriage({ today: 'x', entries: [E('e', 'Long', 'x'.repeat(20000))], changes: [], questions: [] }).message
  assert.match(long, /…\(continues\)/)
  assert.ok(long.length < 6500)
})

test('findings are held to what Keith was shown: known ids, evidence, Active entries, one each, ten at most', () => {
  const { refs } = M.buildTriage({ today: 'x', entries: [hours, logging, draft], changes, questions })
  const out = M.parseFindings({ findings: [
    { kind: 'outdated', entry: 'e1', changes: ['c1'], reason: 'Activity is now Shift Log.', confidence: 'high' },
    { kind: 'outdated', entry: 'e1', changes: ['c1'], reason: 'duplicate' },
    { kind: 'outdated', entry: 'e9', changes: ['c1'], reason: 'unknown entry' },
    { kind: 'outdated', entry: 'e2', changes: ['c99'], reason: 'no real evidence' },
    { kind: 'missing', entry: null, title: 'Personal Devices on the Unit', questions: ['q1'], reason: 'Staff asked about laptops.', confidence: 'medium' },
    { kind: 'missing', title: 'personal devices on the unit', questions: ['q1'], reason: 'same topic again' },
    { kind: 'renamed', entry: 'e2', changes: ['c1'], reason: 'not a kind' },
  ] }, refs)
  assert.deepEqual(out.map(f => [f.kind, f.title, f.confidence]), [['outdated', 'Clinical Hours', 'high'], ['missing', 'Personal Devices on the Unit', 'medium']])
  assert.equal(out[0].entry.id, hours.id)
  assert.equal(out[0].changes[0].sha, 'aaaa1111')
  assert.equal(out[1].questions[0].id, questions[0].id)
  const many = M.parseFindings({ findings: Array.from({ length: 20 }, (_, i) => ({ kind: 'missing', title: `Topic ${i}`, questions: ['q1'], reason: 'r' })) }, refs)
  assert.equal(many.length, M.MAX_FINDINGS)
})

const finding = { kind: 'outdated', entry: hours, title: hours.title, reason: 'Rotation > Activity is now called Shift Log.', confidence: 'high', changes: [changes[0]], questions: [] }

test('an edit keeps the governed rails, lists changed numbers instead of refusing them, and resolves links', () => {
  const good = hours.body.replace('Rotation > Activity', 'Rotation > Shift Log').replace('90 hours', '120 hours') + '\n\nSee [[Shift Logging]] and [[Nowhere Page]].'
  const g = M.validateUpdate({ finding, proposal: { body_markdown: good, change_note: 'Renamed the screen.', flags: ['Check the hour total.'] }, catalog: [hours, logging] })
  assert.equal(g.ok, true)
  assert.match(g.body, /\[\[Shift Logging\]\]/)
  assert.doesNotMatch(g.body, /\[\[Nowhere Page\]\]/, 'an unresolved link is unwrapped to plain text')
  assert.match(g.changeNote, /^Keith self-check \(Owner-reviewed\): Rotation > Activity is now called Shift Log\. Renamed the screen\./)
  assert.match(g.changeNote, /Numbers to check: removed 90; added 120\./)
  assert.match(g.changeNote, /REVIEW FLAGS: Check the hour total\./)

  const lost = hours.body.replace(/## Keith Guidance[\s\S]*/, '').replace('Activity', 'Shift Log')
  assert.equal(M.validateUpdate({ finding, proposal: { body_markdown: lost }, catalog: [hours] }).reason, 'governed_rails_lost')
  assert.equal(M.validateUpdate({ finding, proposal: { body_markdown: hours.body }, catalog: [hours] }).reason, 'no_change')
  assert.equal(M.validateUpdate({ finding, proposal: {}, catalog: [hours] }).reason, 'unparseable')
})

test('a Draft needs a real category and a new title; its terms are cleaned', () => {
  const missing = { kind: 'missing', entry: null, title: 'Personal Devices on the Unit', reason: 'Staff asked about laptops.', confidence: 'medium', changes: [], questions }
  const ok = M.validateNewEntry({ finding: missing, proposal: { title: 'Personal Devices on the Unit', category: 'student_requirements', body_markdown: '# Personal Devices\n\n[Owner to confirm: may students bring laptops?]', aliases: ['Laptops', 'laptops', ''], tags: ['Devices'] }, catalog: [hours] })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.aliases, ['Laptops'], 'blank and duplicate terms are dropped, case-insensitively')
  assert.equal(M.validateNewEntry({ finding: missing, proposal: { title: 'Clinical Hours', category: 'faq', body_markdown: 'x' }, catalog: [hours] }).reason, 'duplicate_title')
  assert.equal(M.validateNewEntry({ finding: missing, proposal: { title: 'New', category: 'policies', body_markdown: 'x' }, catalog: [] }).reason, 'bad_category')
})

test('the Knowledge Center words for a check', () => {
  assert.equal(T.describeCheck(null), 'Keith has not checked the Knowledge Center yet.')
  assert.match(T.describeCheck({ status: 'done', started_at: '2026-10-01T10:00:00Z', changes_read: 61, questions_read: 1, suggestions: 2, drafts: 1, cost_usd: 0.123 }),
    /read 61 app changes and 1 unanswered question; suggested 2 edits and wrote 1 Draft \(about \$0\.12\)\.$/)
  assert.match(T.describeCheck({ status: 'done', started_at: '2026-10-01', changes_read: 0, questions_read: 0, suggestions: 0, drafts: 0, cost_usd: 0 }), /nothing needed your attention\.$/)
  assert.match(T.describeCheck({ status: 'failed', started_at: '2026-10-01' }), /did not finish/)
})

// ── The check, on Postgres ───────────────────────────────────────────────────────

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
  CREATE OR REPLACE FUNCTION public.append_only_refuse() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501'; END $f$;
  CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
  CREATE TABLE public.organizations (id uuid PRIMARY KEY);
  INSERT INTO public.organizations VALUES ('a5f1e000-0000-4000-8000-000000000001');
  CREATE TABLE public.user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, email text, role text, is_owner boolean DEFAULT false, is_active boolean DEFAULT true, auth_user_id uuid, created_at timestamptz DEFAULT now());
  CREATE TABLE public.activity_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, user_name text, user_role text, action_type text, entity_type text, entity_id text, cohort_id uuid, description text, metadata jsonb, created_at timestamptz DEFAULT now());
  CREATE TABLE public.keith_skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, display_name text NOT NULL, description text NOT NULL DEFAULT '',
    version integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'draft', enabled boolean NOT NULL DEFAULT false,
    allowed_roles text[] NOT NULL DEFAULT '{}', required_tools text[] NOT NULL DEFAULT '{}', required_data text[] NOT NULL DEFAULT '{}',
    trigger_phrases text[] NOT NULL DEFAULT '{}', data_classification text NOT NULL DEFAULT 'internal', model_route text NOT NULL DEFAULT 'default',
    io_contract jsonb NOT NULL DEFAULT '{}'::jsonb, instruction_body text NOT NULL DEFAULT '', owner_label text NOT NULL DEFAULT 'ASPIRE', provenance text NOT NULL DEFAULT '', updated_by uuid);
  CREATE TABLE public.keith_skill_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), skill_id uuid NOT NULL, version_number integer NOT NULL, display_name text NOT NULL, description text NOT NULL DEFAULT '', allowed_roles text[] NOT NULL DEFAULT '{}', required_tools text[] NOT NULL DEFAULT '{}', required_data text[] NOT NULL DEFAULT '{}', trigger_phrases text[] NOT NULL DEFAULT '{}', data_classification text NOT NULL, model_route text NOT NULL, io_contract jsonb NOT NULL DEFAULT '{}', instruction_body text NOT NULL DEFAULT '', change_note text NOT NULL DEFAULT '', editor_id uuid, created_at timestamptz DEFAULT now(), UNIQUE (skill_id, version_number));
  CREATE TABLE public.keith_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id text, profile_id uuid, role text, intent text, skill_id uuid, skill_version integer, model text, model_route text, rounds integer, input_tokens integer, output_tokens integer, duration_ms integer, outcome text, rate_limited boolean, created_at timestamptz DEFAULT now());
  CREATE TABLE public.keith_skill_invocations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), skill_id uuid, skill_slug text, skill_version integer, request_id text, invoked_by uuid, invoked_role text, cohort_id uuid, student_id uuid, invocation_mode text, data_sources jsonb, outcome text, denial_reason text, model text, input_tokens integer, output_tokens integer, duration_ms integer, created_at timestamptz DEFAULT now());
`
const MIGRATIONS = [
  '20260610000000_kt1_governance_knowledge_templates', '20260610000001_kt2b_pre_governance_lifecycle_rpcs', '20260807000001_knowledge_vault_markdown',
  '20261016000000_keith_foundation', '20261028000000_keith_knowledge_selfcheck', '20261029000000_keith_knowledge_selfcheck_phase2',
]

async function world({ on = true } = {}) {
  const pg = new PGlite()
  await pg.exec(PRELUDE)
  for (const m of MIGRATIONS) await pg.exec(runnable(read(`supabase/migrations/${m}.sql`)))
  const one = async (sql, args = []) => (await pg.query(sql, args)).rows[0]
  const owner = await one(`INSERT INTO user_profiles (full_name, role, is_owner) VALUES ('Jester Lloyd Bautista', 'owner', true) RETURNING *`)
  const admin = await one(`INSERT INTO user_profiles (full_name, role) VALUES ('An Admin', 'admin') RETURNING *`)
  const add = (e) => one(`INSERT INTO knowledge_entries (title, slug, category, body, source_attribution, state, created_by, updated_by, body_format)
    VALUES ($1, $2, $3, $4, 'Handbook', $5, $6, $6, 'markdown') RETURNING *`, [e.title, e.slug, e.category, e.body, e.state, owner.id])
  const hoursRow = await add(hours)
  const loggingRow = await add(logging)
  await add(draft)
  const gap = await one(`INSERT INTO keith_knowledge_gaps (question, intent) VALUES ($1, 'policy_process') RETURNING *`, [questions[0].question])
  if (on) await pg.query(`UPDATE keith_skills SET status = 'active', enabled = true, version = 1 WHERE slug = 'knowledge-self-check'`)
  return { pg, db: pgliteRest(pg), one, owner, admin, hoursRow, loggingRow, gap }
}

/** A stand-in model: the triage names one outdated entry and one missing topic; drafts follow. */
function stubModel({ findings } = {}) {
  const calls = []
  const complete = async ({ messages, route }) => {
    const msg = messages[0].content
    calls.push({ task: msg.split('\n')[0], route })
    if (msg.startsWith('TASK: TRIAGE')) {
      const ids = { hours: (msg.match(/\[(e\d+)\] Clinical Hours/) || [])[1], change: (msg.match(/\[(c\d+)\] [^\n]*Shift Log/) || [])[1], question: (msg.match(/\[(q\d+)\]/) || [])[1] }
      const out = findings ? findings(ids) : [
        { kind: 'outdated', entry: ids.hours, changes: [ids.change], reason: 'Rotation > Activity is now called Shift Log.', confidence: 'high' },
        { kind: 'missing', entry: null, title: 'Personal Devices on the Unit', questions: [ids.question], reason: 'Staff asked about laptops on the unit.', confidence: 'medium' },
      ]
      return { ok: true, text: JSON.stringify({ findings: out }), model: 'claude-sonnet-5-5', usage: { inputTokens: 20000, outputTokens: 600 } }
    }
    if (msg.startsWith('TASK: UPDATE ENTRY')) {
      return { ok: true, text: JSON.stringify({ body_markdown: hours.body.replace('Rotation > Activity', 'Rotation > Shift Log'), change_note: 'Renamed the screen to Shift Log.', flags: [] }), model: 'claude-sonnet-5-5', usage: { inputTokens: 3000, outputTokens: 400 } }
    }
    return { ok: true, text: JSON.stringify({ title: 'Personal Devices on the Unit', category: 'student_requirements', body_markdown: '# Personal Devices on the Unit\n\n[Owner to confirm: may students bring personal laptops to the unit?]\n\n## Keith Guidance\nKeith should say: the policy is being confirmed.\nKeith should not say: that laptops are allowed.', aliases: ['laptops'], tags: ['devices'], change_note: 'New topic from staff questions.', flags: [] }), model: 'claude-sonnet-5-5', usage: { inputTokens: 2500, outputTokens: 500 } }
  }
  return { complete, calls }
}
const history = (commits = changes) => { const seen = []; const fn = async ({ since }) => { seen.push(since); return { ok: true, commits, truncated: false } }; fn.seen = seen; return fn }

test('a check files an edit and a Draft with their evidence, credits the Owner, uses up its questions, and records itself', async () => {
  const w = await world()
  const model = stubModel()
  const fetchChanges = history()
  const now = new Date('2026-10-01T12:00:00Z')
  const out = await C.runKnowledgeSelfCheck(w.db, { actor: w.owner, now, fetchChanges, complete: model.complete })
  assert.equal(out.ok, true, out.message)
  assert.deepEqual(model.calls.map(c => c.task), ['TASK: TRIAGE', 'TASK: UPDATE ENTRY', 'TASK: NEW ENTRY'])
  assert.equal(model.calls[0].route.model, 'claude-sonnet-5-5', 'the quality route')
  assert.equal(model.calls[0].route.maxTokens, 16000)
  assert.equal(model.calls[0].route.effort, 'high', 'the triage thinks; the route default (low) missed a stale entry')
  assert.equal(model.calls[1].route.effort, 'low', 'drafting stays on the route default')
  assert.equal(fetchChanges.seen[0].toISOString(), '2026-09-01T12:00:00.000Z', 'a first check reads the last 30 days')

  const rev = await w.one(`SELECT * FROM knowledge_revisions WHERE entry_id = $1`, [w.hoursRow.id])
  assert.equal(rev.proposed_by, 'keith')
  assert.equal(rev.author_id, w.owner.id, 'credited to the Owner who reviews it')
  assert.match(rev.body, /Rotation > Shift Log/)
  assert.match(rev.change_note, /^Keith self-check \(Owner-reviewed\)/)
  assert.deepEqual(rev.evidence.changes.map(c => c.sha), ['aaaa1111'])
  assert.equal(rev.evidence.confidence, 'high')
  assert.ok(rev.evidence.provenance_id, 'the Keith mark can open its provenance')

  const d = await w.one(`SELECT * FROM knowledge_entries WHERE proposed_by = 'keith'`)
  assert.equal(d.state, 'draft', 'a Draft: Keith cannot use it until the Owner activates it')
  assert.equal(d.slug, 'personal-devices-on-the-unit')
  assert.equal(d.created_by, w.owner.id)
  assert.equal(d.confidence, 'provisional')
  assert.equal(d.proposal_evidence.questions[0].text, questions[0].question)

  assert.equal((await w.one(`SELECT count(*)::int AS n FROM keith_knowledge_gaps`)).n, 0, 'the question that fed a suggestion is deleted')
  const check = out.check
  assert.equal(check.status, 'done')
  assert.equal(check.changes_read, 2)
  assert.equal(check.questions_read, 1)
  assert.equal(check.entries_read, 2)
  assert.equal(check.suggestions, 1)
  assert.equal(check.drafts, 1)
  assert.equal(check.input_tokens, 25500)
  assert.equal(check.output_tokens, 1500)
  assert.equal(check.changes_until, '2026-09-30T20:00:01.000Z', 'the next check starts a second after the newest commit')
  assert.deepEqual(check.findings.map(f => f.outcome), ['suggested an edit', 'wrote a Draft'])
  assert.equal((await w.one(`SELECT count(*)::int AS n FROM activity_logs WHERE action_type = 'knowledge_self_check'`)).n, 1)
  assert.equal((await w.one(`SELECT count(*)::int AS n FROM keith_requests WHERE intent = 'knowledge_self_check'`)).n, 3, 'every model call is metered')

  // The next check reads from where this one stopped; an entry with a waiting revision is skipped.
  const again = stubModel({ findings: (ids) => [{ kind: 'outdated', entry: ids.hours, changes: [ids.change], reason: 'still outdated', confidence: 'high' }] })
  const next = history()
  const out2 = await C.runKnowledgeSelfCheck(w.db, { actor: w.owner, now: new Date('2026-10-15T12:00:00Z'), fetchChanges: next, complete: again.complete })
  assert.equal(next.seen[0].toISOString(), '2026-09-30T20:00:01.000Z')
  assert.deepEqual(again.calls.map(c => c.task), ['TASK: TRIAGE'], 'no draft for an entry that already has one waiting')
  assert.deepEqual(out2.check.skipped, [{ title: 'Clinical Hours', reason: 'pending_revision' }])
})

test('with nothing new to read, no model is called; while the skill is off, nothing runs', async () => {
  const w = await world()
  await w.pg.query(`DELETE FROM keith_knowledge_gaps`)
  const model = stubModel()
  const out = await C.runKnowledgeSelfCheck(w.db, { actor: w.owner, fetchChanges: history([]), complete: model.complete })
  assert.equal(out.ok, true)
  assert.equal(model.calls.length, 0)
  assert.equal(out.check.status, 'done')

  const off = await world({ on: false })
  const r = await C.runKnowledgeSelfCheck(off.db, { actor: off.owner, fetchChanges: history(), complete: stubModel().complete })
  assert.equal(r.reason, 'off')
  assert.equal((await off.one(`SELECT count(*)::int AS n FROM keith_knowledge_checks`)).n, 0)
})

test('a GitHub failure is recorded as a failed check, and a running check blocks a second', async () => {
  const w = await world()
  const failed = await C.runKnowledgeSelfCheck(w.db, { actor: w.owner, fetchChanges: async () => ({ ok: false, error: 'rate_limited' }), complete: stubModel().complete })
  assert.equal(failed.reason, 'history_unavailable')
  assert.equal(failed.check.status, 'failed')
  assert.equal(failed.check.error, 'github: rate_limited')
  await w.pg.query(`INSERT INTO keith_knowledge_checks (trigger, status) VALUES ('manual', 'running')`)
  assert.equal((await C.runKnowledgeSelfCheck(w.db, { actor: w.owner, fetchChanges: history(), complete: stubModel().complete })).reason, 'already_running')
})

test('the endpoint: Owner and Admin see the status, only the Owner runs a check', async () => {
  const w = await world()
  const call = async (profile, body) => {
    let status = 0, json = null
    const res = { setHeader() {}, status(s) { status = s; return this }, json(j) { json = j; return this }, end() { return this } }
    const handler = createKnowledgeCheckHandler({ verifyCaller: async () => ({ authenticated: true, profile }), makeDb: () => w.db, complete: stubModel().complete, fetchChanges: history() })
    await handler({ method: 'POST', body }, res)
    return { status, json }
  }
  const s = await call(w.admin, { action: 'status' })
  assert.equal(s.status, 200)
  assert.deepEqual({ enabled: s.json.enabled, skill_on: s.json.skill_on, can_run: s.json.can_run, questions_waiting: s.json.questions_waiting }, { enabled: true, skill_on: true, can_run: false, questions_waiting: 1 })
  assert.equal((await call(w.admin, { action: 'run' })).status, 403)
  assert.equal((await call(w.owner, { action: 'run', extra: 1 })).status, 400)
  const r = await call(w.owner, { action: 'run' })
  assert.equal(r.status, 200)
  assert.equal(r.json.check.suggestions + r.json.check.drafts, 2)
  assert.ok(r.json.check.cost_usd > 0.05 && r.json.check.cost_usd < 0.07, `priced on Sonnet 5.5: ${r.json.check.cost_usd}`)
  const after = await call(w.owner, { action: 'status' })
  assert.equal(after.json.edits_waiting, 1)
  assert.equal(after.json.drafts_waiting, 1)
  assert.equal(after.json.checks.length, 1)
})

test('the migration: the checks table is locked to the service role, the skill starts off, and it re-runs', async () => {
  const w = await world({ on: false })
  await w.pg.exec(runnable(read('supabase/migrations/20261029000000_keith_knowledge_selfcheck_phase2.sql')))
  const skill = await w.one(`SELECT status, enabled, run_mode, model_route, allowed_roles, required_data, io_contract->>'surface' AS surface FROM keith_skills WHERE slug = 'knowledge-self-check'`)
  assert.deepEqual(skill, { status: 'draft', enabled: false, run_mode: 'on', model_route: 'quality', allowed_roles: [], required_data: ['knowledge_center_read'], surface: 'knowledge_center' })
  const p = await w.one(`SELECT has_table_privilege('authenticated', 'public.keith_knowledge_checks', 'SELECT') AS auth, has_table_privilege('service_role', 'public.keith_knowledge_checks', 'DELETE') AS del`)
  assert.deepEqual(p, { auth: false, del: false })
  await assert.rejects(w.pg.query(`INSERT INTO keith_knowledge_checks (trigger) VALUES ('cron')`), /trigger_check/)
})

// ── The Knowledge Center ─────────────────────────────────────────────────────────

test('the Knowledge Center: the Keith card and badge, the check strip, and evidence on revisions and Drafts', () => {
  const panel = read('src/components/settings/KnowledgeCenterPanel.jsx')
  assert.match(panel, /\{ key: 'keith', accent: 'lavender' \}/)
  assert.match(panel, /stateFilter === 'keith' \? e\.keith_suggestion === true/)
  assert.match(panel, /<KnowledgeSelfCheckBar onChanged=\{loadEntries\} \/>/)
  assert.match(panel, /e\.keith_suggestion && \(/)
  assert.match(read('src/components/settings/KnowledgeRevisionPanel.jsx'), /revision\.proposed_by === 'keith' && <KeithEvidence evidence=\{revision\.evidence\} kind="edit" \/>/)
  assert.match(read('src/components/settings/KnowledgeEntryDrawer.jsx'), /entry\?\.proposed_by === 'keith' && entry\?\.state === 'draft' && <KeithEvidence evidence=\{entry\.proposal_evidence\} kind="draft" \/>/)
  const admin = read('api/knowledge-admin.js')
  assert.match(admin, /keith_suggestion: keithRevIds\.has\(e\.id\) \|\| \(e\.proposed_by === 'keith' && e\.state === 'draft'\)/)
  assert.match(admin, /submitted_at, proposed_by, evidence'\)/)
  assert.match(read('vercel.json'), /"api\/keith-knowledge-check\.js":\s+\{ "maxDuration": 300 \}/)
})

test('the Keith title is set as text beside the orb, and Enrich no longer shares Skills’ icon', () => {
  const brand = read('src/components/keith/KeithBrand.jsx')
  assert.match(brand, /<img className="keith-lockup-orb" src="\/brand\/keith-orb-160\.png"/)
  assert.match(brand, /<span className="keith-lockup-name">Keith<\/span>/)
  assert.doesNotMatch(brand, /src="\/brand\/keith-lockup\.png"/, 'the padded PNG wordmark is no longer drawn (KEITH-LOCKUP-2)')
  assert.match(read('src/components/keith/keithBrand.css'), /\.keith-lockup \{ display: inline-flex; align-items: center; gap: 10px;/)
  assert.match(read('src/components/settings/SettingsShell.jsx'), /keithSkills: Sparkles/)
  for (const p of ['src/components/settings/KnowledgeCenterPanel.jsx', 'src/components/settings/KnowledgeEnrichmentPanel.jsx']) {
    assert.doesNotMatch(read(p), /Sparkles/, `${p}: Enrich wears the wand`)
    assert.match(read(p), /Wand2/)
  }
})

// ── KEITH-KNOWLEDGE-SELFCHECK-FIX-1 (2026-10-01): from the first real check ───────────────────────

test('the history ceiling is 800, and a check that hits it says older changes were not read', async () => {
  const A = await import('../lib/server/keith/appChanges.js')
  assert.equal(A.MAX_CHANGES, 800, '200 was about a week of this repository')
  assert.equal(M.MAX_TRIAGE_CHANGES, 800)
  const row = (i) => ({ sha: `abcdef${String(i).padStart(4, '0')}`, parents: [{}], commit: { message: `C${i}`, committer: { date: '2026-09-30T00:00:00Z' } } })
  let pages = 0
  const r = await A.fetchAppChanges({ fetchImpl: async () => { pages++; return { ok: true, json: async () => Array.from({ length: 100 }, (_, i) => row(pages * 100 + i)) } }, token: '' })
  assert.equal(r.commits.length, 800)
  assert.equal(r.truncated, true)
  assert.equal(pages, 8)

  const w = await world()
  const out = await C.runKnowledgeSelfCheck(w.db, { actor: w.owner, fetchChanges: async () => ({ ok: true, commits: changes, truncated: true }), complete: stubModel().complete })
  assert.deepEqual(out.check.skipped[0], { title: 'App changes', reason: 'history_truncated', detail: 'only the newest 2 were read' })
  assert.match(T.describeCheck({ ...out.check, cost_usd: 0.1 }), /Older app changes in this period were not read\.$/)
  assert.doesNotMatch(T.describeCheck({ status: 'done', started_at: '2026-10-01', skipped: [] }), /not read/)
})

test('the rules migration: an active skill gets the new instructions as a new version, once', async () => {
  const sql = runnable(read('supabase/migrations/20261030000000_knowledge_self_check_rules.sql'))
  const w = await world()
  await w.pg.exec(sql)
  await w.pg.exec(sql)
  const skill = await w.one(`SELECT id, version, status, enabled, instruction_body FROM keith_skills WHERE slug = 'knowledge-self-check'`)
  assert.equal(skill.version, 2, 'one new version, however many times it runs')
  assert.equal(skill.status, 'active')
  assert.equal(skill.enabled, true)
  assert.match(skill.instruction_body, /the NEWEST one is what the app does now/)
  assert.match(skill.instruction_body, /Cite a change only when it is ABOUT the topic/)
  const versions = (await w.pg.query(`SELECT version_number, change_note, editor_id FROM keith_skill_versions WHERE skill_id = $1`, [skill.id])).rows
  assert.equal(versions.length, 1)
  assert.equal(versions[0].version_number, 2)
  assert.equal(versions[0].editor_id, w.owner.id)
  assert.equal((await w.one(`SELECT count(*)::int AS n FROM activity_logs WHERE action_type = 'keith_skill_update'`)).n, 1)

  // A skill still in Draft just takes the new text.
  const d = await world({ on: false })
  await d.pg.exec(sql)
  const draftSkill = await d.one(`SELECT version, status, instruction_body FROM keith_skills WHERE slug = 'knowledge-self-check'`)
  assert.equal(draftSkill.version, 0)
  assert.equal(draftSkill.status, 'draft')
  assert.match(draftSkill.instruction_body, /the NEWEST one is what the app does now/)
})

test('the triage migration: version 3 after the rules migration, once, and a Draft just takes the text', async () => {
  const rules = runnable(read('supabase/migrations/20261030000000_knowledge_self_check_rules.sql'))
  const sql = runnable(read('supabase/migrations/20261031000000_knowledge_self_check_triage.sql'))
  const w = await world()
  await w.pg.exec(rules)
  await w.pg.exec(sql)
  await w.pg.exec(sql)
  const skill = await w.one(`SELECT id, version, status, enabled, instruction_body FROM keith_skills WHERE slug = 'knowledge-self-check'`)
  assert.equal(skill.version, 3, 'one new version, however many times it runs')
  assert.equal(skill.status, 'active')
  assert.equal(skill.enabled, true)
  assert.match(skill.instruction_body, /Go through the Active entries ONE AT A TIME/)
  const versions = (await w.pg.query(`SELECT version_number, editor_id FROM keith_skill_versions WHERE skill_id = $1 ORDER BY version_number`, [skill.id])).rows
  assert.deepEqual(versions.map(v => v.version_number), [2, 3])
  assert.equal(versions[1].editor_id, w.owner.id)
  // Either order: on a skill the rules migration never reached, it still lands the current text.
  const d = await world({ on: false })
  await d.pg.exec(sql)
  const draftSkill = await d.one(`SELECT version, status, instruction_body FROM keith_skills WHERE slug = 'knowledge-self-check'`)
  assert.equal(draftSkill.version, 0)
  assert.equal(draftSkill.status, 'draft')
  assert.match(draftSkill.instruction_body, /Go through the Active entries ONE AT A TIME/)
})

test('a check that runs out of time does not move past the period it did not finish', async () => {
  const w = await world()
  const now = new Date('2026-10-01T12:00:00Z')
  const out = await C.runKnowledgeSelfCheck(w.db, { actor: w.owner, now, fetchChanges: history(), complete: stubModel().complete, budgetMs: -1 })
  assert.equal(out.ok, true, out.message)
  assert.ok(out.check.skipped.some(x => x.reason === 'out_of_time'))
  assert.equal(out.check.suggestions + out.check.drafts, 0)
  assert.equal(new Date(out.check.changes_until).toISOString(), new Date(out.check.changes_since).toISOString(), 'the next check re-reads the same window')
  const next = history()
  await C.runKnowledgeSelfCheck(w.db, { actor: w.owner, now: new Date('2026-10-01T12:30:00Z'), fetchChanges: next, complete: stubModel().complete })
  assert.equal(next.seen[0].toISOString(), '2026-09-01T12:00:00.000Z')
})

test('the triage shows most entries whole', () => {
  assert.equal(M.EXCERPT_CHARS, 6000)
  const long = E('00000000-0000-4000-8000-0000000000aa', 'Navigation', `# Navigation\n\n${'x'.repeat(3000)}\n\nRetired: Matrix board`)
  assert.match(M.buildTriage({ today: '2026-10-01', entries: [long], changes: [], questions: [] }).message, /Retired: Matrix board/)
})

// ── Phase 3: the schedule, the audit rows, Needs you, the progress line ──────────

const INVOCATION_CHECK = `ALTER TABLE public.keith_skill_invocations ADD CONSTRAINT mode_chk CHECK (invocation_mode IS NULL OR invocation_mode IN ('picker','trigger_phrase'))`

test('KEITH-AUDIT-MODE-1: a check\'s audit rows land under the real invocation_mode CHECK', async () => {
  // The first schema's CHECK (20260805000001) allows only the two chat modes; the self-check's
  // 'knowledge_check' was refused in production (23514) and every audit row of a check was lost.
  assert.match(read('supabase/migrations/20260805000001_keith_p0_foundations_and_skills.sql'), /invocation_mode IN \('picker','trigger_phrase'\)/)
  const w = await world()
  await w.pg.exec(INVOCATION_CHECK)
  const out = await C.runKnowledgeSelfCheck(w.db, { actor: w.owner, fetchChanges: history(), complete: stubModel().complete })
  assert.equal(out.ok, true, out.message)
  const rows = (await w.pg.query(`SELECT invocation_mode, data_sources FROM keith_skill_invocations`)).rows
  assert.equal(rows.length, 3, 'the triage and both drafts')
  for (const r of rows) {
    assert.equal(r.invocation_mode, null)
    assert.equal(r.data_sources.invocation, 'knowledge_check', 'how it ran is still recorded')
  }
  const U = await import('../lib/server/keith/usageLog.js')
  assert.deepEqual([...U.CHAT_INVOCATION_MODES], ['picker', 'trigger_phrase'])
  const seen = []
  const db = { from: () => ({ insert: async (row) => { seen.push(row); return { error: null } } }) }
  await U.recordSkillInvocation(db, { skillId: 'x', invocationMode: 'picker', dataSources: { a: 1 } })
  await U.recordSkillInvocation(db, { skillId: 'x', invocationMode: 'receipt_panel' })
  assert.deepEqual([seen[0].invocation_mode, seen[0].data_sources], ['picker', { a: 1 }], 'a chat mode is stored as before')
  assert.deepEqual([seen[1].invocation_mode, seen[1].data_sources], [null, { invocation: 'receipt_panel' }])
})

test('Phase 3: the 1st and the 15th, with nobody behind it', async () => {
  const vercel = JSON.parse(read('vercel.json'))
  assert.deepEqual(vercel.crons.find(c => c.path === '/api/cron/keith-knowledge-check'), { path: '/api/cron/keith-knowledge-check', schedule: '10 14 1,15 * *' })
  assert.equal(vercel.functions['api/cron/keith-knowledge-check.js'].maxDuration, 300)
  const { createKnowledgeCheckCron, CRON_NAME } = await import('../api/cron/keith-knowledge-check.js')
  assert.equal(CRON_NAME, 'keith-knowledge-check')
  const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r }, json(b) { r.body = b; return r } }; return r }

  const w = await world()
  await w.pg.exec(INVOCATION_CHECK)
  await w.pg.exec(`CREATE TABLE IF NOT EXISTS public.cron_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cron_name text, status text DEFAULT 'running', started_at timestamptz DEFAULT now(), finished_at timestamptz, details jsonb, error_text text)`)
  const run = (db, opts) => C.runKnowledgeSelfCheck(db, { ...opts, fetchChanges: history(), complete: stubModel().complete })
  const denied = res()
  await createKnowledgeCheckCron({ makeDb: () => w.db, run, authorized: () => false })({}, denied)
  assert.equal(denied.code, 401)

  const ok = res()
  await createKnowledgeCheckCron({ makeDb: () => w.db, run, authorized: () => true })({}, ok)
  assert.equal(ok.code, 200)
  assert.deepEqual(ok.body, { checked: true, changes_read: changes.length, questions_read: 1, suggestions: 1, drafts: 1 })
  const check = await w.one(`SELECT trigger, run_by, status FROM keith_knowledge_checks`)
  assert.deepEqual(check, { trigger: 'schedule', run_by: null, status: 'done' })
  const rev = await w.one(`SELECT author_id, proposed_by FROM knowledge_revisions`)
  assert.deepEqual(rev, { author_id: w.owner.id, proposed_by: 'keith' }, 'credited to the Owner who reviews it')
  assert.match(T.describeCheck({ status: 'done', started_at: '2026-10-15', trigger: 'schedule', changes_read: 3, questions_read: 0, suggestions: 1, drafts: 0 }), /on schedule: read 3 app changes/)

  // The skill off is a stand-down, not a failure; anything else is a failed run.
  const off = await world({ on: false })
  const quiet = res()
  await createKnowledgeCheckCron({ makeDb: () => off.db, run, authorized: () => true })({}, quiet)
  assert.deepEqual([quiet.code, quiet.body], [200, { checked: false, reason: 'off' }])
  const bad = res()
  await createKnowledgeCheckCron({ makeDb: () => off.db, run: async () => ({ ok: false, reason: 'history_unavailable' }), authorized: () => true })({}, bad)
  assert.equal(bad.code, 500)
  // DEMO-DATA-2: a cron that builds a service client scopes it.
  assert.match(read('api/cron/keith-knowledge-check.js'), /populationDb\(createClient\(/)
})

test('Phase 3: At a Glance lists what Keith is waiting on, for the Owner, as navigation', async () => {
  const Y = await import('../src/lib/home/needsYouModel.js')
  assert.ok(Y.GROUP_ORDER.includes('knowledge'))
  const now = Date.parse('2026-10-02T12:00:00Z')
  const g = Y.knowledgeGroup({ now, waiting: [
    { kind: 'draft', id: 'd1', title: 'Budget Tracker', since: '2026-10-01T12:00:00Z' },
    { kind: 'edit', id: 'e1', title: 'App Navigation', since: '2026-09-30T12:00:00Z' },
  ] })
  assert.deepEqual([g.key, g.name, g.count], ['knowledge', 'Knowledge Center', 2])
  assert.deepEqual(g.rows.map(r => [r.title, r.pill.text, r.to]), [
    ['App Navigation', 'Edit', '/settings/keith/knowledge?filter=keith'],
    ['Budget Tracker', 'Draft', '/settings/keith/knowledge?filter=keith'],
  ], 'oldest first, and every row opens the Knowledge Center on Keith\'s suggestions')
  assert.deepEqual(g.pills.map(p => p.text), ['1 edit', '1 Draft'])
  assert.equal(Y.knowledgeGroup({ waiting: [] }), null, 'nothing waiting, no group')

  const home = read('src/components/OverviewTab.jsx')
  assert.match(home, /queryFn: loadKnowledgeSuggestions, enabled: !!isOwner/)
  assert.match(home, /if \(isOwner\) out\.push\(\{ key: 'knowledge', status: qStatus\(qKnowledge\)/)
  assert.match(read('src/components/settings/KnowledgeCenterPanel.jsx'), /get\('filter'\) === 'keith' \? 'keith' : 'all'/)

  // The status the row reads: titles only, the Owner's and Admin's.
  const w = await world()
  await C.runKnowledgeSelfCheck(w.db, { actor: w.owner, fetchChanges: history(), complete: stubModel().complete })
  const handler = createKnowledgeCheckHandler({ verifyCaller: async () => ({ authenticated: true, profile: w.owner }), makeDb: () => w.db })
  const r = { code: 0, body: null, setHeader() {}, status(c) { r.code = c; return r }, json(b) { r.body = b; return r }, end() {} }
  await handler({ method: 'POST', body: { action: 'status' } }, r)
  assert.equal(r.code, 200)
  assert.deepEqual(r.body.waiting.map(x => [x.kind, x.title]), [['edit', 'Clinical Hours'], ['draft', 'Personal Devices on the Unit']])
  assert.ok(r.body.waiting.every(x => !('body' in x)))
})

test('the progress line: the time gone, what Keith is usually doing by then, and no false claims', () => {
  assert.match(T.progressText(0), /^Keith is reading the app changes.* 0:00 so far; a check usually takes about two minutes\. You can leave this page/)
  assert.match(T.progressText(95), /^Keith is writing his suggestions.* 1:35 so far/)
  assert.match(T.progressText(260), /^Still working\..* 4:20 so far/)
  assert.doesNotMatch(T.progressText(95), /finished|done|—/i)
  const bar = read('src/components/settings/KnowledgeSelfCheckBar.jsx')
  assert.match(bar, /progressText\(elapsed\)/)
  assert.match(bar, /clearInterval\(id\)/)
})

test('ACTION-CENTER-KNOWLEDGE-1: Keith\'s suggestions are in the Action Center too, for the Owner, as navigation', async () => {
  const Q = await import('../src/lib/actionCenter/queueModel.js')
  const Y = await import('../src/lib/home/needsYouModel.js')
  assert.ok(Q.ACTION_CENTER_GROUPS.some(g => g.key === 'knowledge' && g.label === 'Knowledge Center'))
  const now = Date.parse('2026-10-02T12:00:00Z')
  const group = Y.knowledgeGroup({ now, waiting: [{ kind: 'edit', id: 'e1', title: 'App Navigation', since: '2026-09-30T12:00:00Z' }, { kind: 'draft', id: 'd1', title: 'Budget Tracker', since: '2026-10-01T12:00:00Z' }] })
  const items = Q.normalizeHomeQueue({ groups: [group], now })
  assert.deepEqual(items.map(i => [i.group, i.chip, i.personal, i.cohort, i.title, i.href]), [
    ['knowledge', 'Review', true, null, 'App Navigation', '/settings/keith/knowledge?filter=keith'],
    ['knowledge', 'Review', true, null, 'Budget Tracker', '/settings/keith/knowledge?filter=keith'],
  ])
  assert.deepEqual(items[0].actions.map(a => a.label), ['Review', 'Snooze'], 'no Apply or Discard here: the decision stays in the Knowledge Center')
  const hook = read('src/hooks/useActionCenterQueue.js')
  assert.match(hook, /queryKey: \['home_knowledge_suggestions'\], queryFn: loadKnowledgeSuggestions, enabled: enabled && !!isOwner/)
  assert.match(hook, /queryState\(qKnowledge, 'knowledge', 'Knowledge Center'\)/)
})

test('KEITH-LABEL-1: a Knowledge Center entry has one name on the Keith card', () => {
  assert.deepEqual([...D.INPUT_LABELS.knowledge_entry], ['Knowledge Center entry', 'Knowledge Center entries'])
  assert.equal((read('lib/server/keith/skillDefs.js').match(/^\s+knowledge_entry:/gm) || []).length, 1, 'the key was declared twice and the second ("policy entry") won')
})
