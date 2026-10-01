// test/keithKnowledgeSelfcheck.test.mjs
//
// KEITH-KNOWLEDGE-SELFCHECK-1 Phase 1 (2026-09-30): the plumbing for Keith's Knowledge Center self-check.
//   - which chat questions are kept (program questions no Active entry covered, real sessions only)
//     and how they are scrubbed (emails, phones and every known person's name; units stay)
//   - the chat handler keeps them alongside the model call and never lets it fail the answer
//   - the app's change history, read from GitHub: trailers stripped, merges skipped, paged, never throws
//   - on real Postgres (PGlite), the migration over the real Knowledge Center migrations: the gaps
//     table and its checks, the proposed_by columns, nothing existing changed, re-runnable, and the
//     Owner's Apply still works on a revision Keith proposed

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const G = await import('../lib/server/keith/knowledgeGaps.js')
const A = await import('../lib/server/keith/appChanges.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')

// ── Which questions are kept ─────────────────────────────────────────────────────

const miss = { governedCovered: false, scores: [1], matchedCount: 0 }
const q = 'How many make-up hours count toward the requirement?'

test('only an uncovered program question from a real session is kept', () => {
  assert.equal(G.shouldRecordGap({ intent: 'policy_process', governed: miss, isDemo: false, question: q }), true)
  assert.equal(G.shouldRecordGap({ intent: 'general_other', governed: miss, isDemo: false, question: q }), true)
  for (const intent of ['cohort_status', 'placement_capacity', 'person_contact_role', 'email_drafting']) {
    assert.equal(G.shouldRecordGap({ intent, governed: miss, isDemo: false, question: q }), false, `${intent} is answered from records or is not a question`)
  }
  assert.equal(G.shouldRecordGap({ intent: 'policy_process', governed: { ...miss, governedCovered: true }, isDemo: false, question: q, answer: 'Students log hours within 48 hours.' }), false, 'covered and answered')
  assert.equal(G.shouldRecordGap({ intent: 'policy_process', governed: { ...miss, error: 'x' }, isDemo: false, question: q }), false, 'a failed retrieval is not a gap')
  assert.equal(G.shouldRecordGap({ intent: 'policy_process', governed: miss, isDemo: true, question: q }), false, 'demo keeps nothing')
  assert.equal(G.shouldRecordGap({ intent: 'policy_process', governed: miss, isDemo: false, question: 'hi' }), false, 'too short to mean anything')
})

// KEITH-GAP-DETECT-1 (2026-09-30): the Owner asked "What is the policy for students bringing personal
// laptops to the unit?" and nothing was kept. Retrieval had matched entries on "students", "unit" and
// "policy", so it reported covered; Keith read them and said he had no governed guidance. A question
// whose ANSWER says so is a gap too.
test('a matched question whose answer says governed guidance was not found is kept', () => {
  const covered = { governedCovered: true, scores: [6, 4], matchedCount: 2 }
  const laptops = "I don't have governed guidance on personal laptop policies for students on clinical units. That's an operational or unit-specific policy that isn't covered in the ASPIRE Knowledge Center entries available to me."
  assert.equal(G.shouldRecordGap({ intent: 'policy_process', governed: covered, isDemo: false, question: 'What is the policy for students bringing personal laptops to the unit?', answer: laptops }), true)
  assert.equal(G.isGapCandidate({ intent: 'policy_process', governed: covered, isDemo: false, question: q }), true, 'a candidate before the answer is known')
  assert.equal(G.isGapCandidate({ intent: 'cohort_status', governed: covered, isDemo: false, question: q }), false)
})

test('the answer patterns: every way Keith says "not found", and none of the ways he answers', () => {
  for (const t of [
    "I don't have governed guidance on personal laptop policies.",
    'Governed guidance was not found for this question.',
    'No governed entry covers that.',
    "That isn't covered in the ASPIRE Knowledge Center entries available to me.",
    'These topics aren’t covered by the Knowledge Center.',
    'This is not covered in the Knowledge Center.',
    'I could not find governed guidance on that, so please verify with the Owner.',
  ]) assert.equal(G.answerSaysNotFound(t), true, t)
  for (const t of [
    'Per the governed guidance, students may not bring laptops onto the unit.',
    'The governed entry says students cannot use personal devices.',
    'Students must complete 120 hours. No exceptions without written approval.',
    'Governed guidance: badges are worn above the waist; do not wear artificial nails.',
    'The Knowledge Center covers this: students are not covered by unit insurance.',
    '',
  ]) assert.equal(G.answerSaysNotFound(t), false, t)
})

test('scrubbing removes emails, phones and every known name, and keeps unit names', () => {
  const names = { people: ['Maria', 'Santos', 'Rosa'], units: [] }
  const out = G.scrubQuestion('Can Maria Santos (maria.s@csun.edu, 818-555-0142) make up hours on 6 NE with Rosa?', names)
  assert.equal(out.ok, true)
  assert.doesNotMatch(out.text, /Maria|Santos|Rosa|@|555/)
  assert.match(out.text, /\[name\]/)
  assert.match(out.text, /\[email\]/)
  assert.match(out.text, /\[phone\]/)
  assert.match(out.text, /6 NE/, 'a unit identifies no one and is what makes the question useful')
})

test('a question that is mostly names is dropped, and a long one is capped', () => {
  assert.equal(G.scrubQuestion('Maria Santos Rosa Tan?', { people: ['Maria', 'Santos', 'Rosa', 'Tan'] }).ok, false)
  const long = G.scrubQuestion('How do make-up hours work '.repeat(40), { people: [] })
  assert.equal(long.ok, true)
  assert.equal(long.text.length, G.MAX_QUESTION_CHARS)
})

test('recording is best-effort: a missing table or a throw never escapes', async () => {
  const fake = (insertError) => ({
    from: (t) => ({
      select: async () => ({ data: [] }),
      insert: async () => ({ error: insertError }),
      delete: () => ({ lt: async () => ({}) }),
    }),
  })
  assert.deepEqual(await G.recordKnowledgeGap(fake({ code: 'PGRST205' }), { question: q, intent: 'policy_process', governed: miss }), { recorded: false, reason: 'not_enabled' })
  assert.deepEqual(await G.recordKnowledgeGap(fake({ code: '42P01' }), { question: q, intent: 'policy_process', governed: miss }), { recorded: false, reason: 'not_enabled' })
  const boom = { from: () => { throw new Error('down') } }
  assert.deepEqual(await G.recordKnowledgeGap(boom, { question: q, intent: 'policy_process', governed: miss }), { recorded: false, reason: 'threw' })
})

// KEITH-GAP-DETECT-1 changed this test: the decision moved from before the model call to after
// it, because only the answer says whether the matched entries actually answered the question.
test('the chat handler decides after the answer, on both paths, and logs no text', () => {
  const src = read('api/keith.js')
  assert.match(src, /isGapCandidate\(\{ intent, governed, isDemo: populationOf\(req\), question: lastUserText \}\)/)
  assert.ok(src.indexOf('const gapCandidate =') > src.indexOf('[keith-retrieval]'), 'after retrieval, on the main model path')
  assert.match(src, /await settleGapCapture\(text\);/, 'success: judged on the answer')
  assert.match(src, /await settleGapCapture\(''\);/, 'failure: judged on retrieval alone')
  assert.match(src, /shouldRecordGap\(\{ intent, governed, isDemo: false, question: lastUserText, answer \}\)/)
  assert.doesNotMatch(src, /console\.log\('\[keith-gap\]'[^\n]*(question|answer|lastUserText)/, 'the log line carries the outcome, never the text')
})

test('At a Glance shows the Keith orb while his drawer is open, and hides it when closed', () => {
  // KEITH-ORB-HOME-1 (Owner, 2026-09-30): HOME-1 hid the orb on At a Glance; opened from the
  // launcher, the drawer then had no orb to put it away with.
  assert.match(read('src/components/Keith.jsx'), /\{\(!hideLauncher \|\| isOpen\) && \(/)
})

// ── The app's change history ─────────────────────────────────────────────────────

test('a commit message becomes a subject and a body without trailers', () => {
  const m = A.summarizeCommitMessage('KEITH-X: rename Activity to Shift Log\n\nThe picker says Shift Log.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nSigned-off-by: J\n')
  assert.deepEqual(m, { subject: 'KEITH-X: rename Activity to Shift Log', body: 'The picker says Shift Log.' })
  const long = A.summarizeCommitMessage(`S\n\n${'x'.repeat(5000)}`)
  assert.ok(long.body.length <= A.MAX_BODY_CHARS + 2)
})

test('the history is read page by page from main, merges skipped, and a failure is a value', async () => {
  const commit = (i, parents = 1) => ({ sha: `abcdef${String(i).padStart(4, '0')}`, parents: Array(parents).fill({}), commit: { message: `C${i}\n\nbody ${i}`, committer: { date: '2026-09-30T00:00:00Z' } } })
  const urls = []
  const pages = [Array.from({ length: 100 }, (_, i) => commit(i, i === 5 ? 2 : 1)), [commit(100), commit(101)]]
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, json: async () => pages.shift() || [] } }
  const r = await A.fetchAppChanges({ since: '2026-09-23T00:00:00Z', fetchImpl, token: '' })
  assert.equal(r.ok, true)
  assert.equal(r.commits.length, 101, '102 commits less one merge')
  assert.ok(!r.commits.some(c => c.subject === 'C5'))
  assert.deepEqual(r.commits[0], { sha: 'abcdef00', date: '2026-09-30T00:00:00Z', subject: 'C0', body: 'body 0' })
  assert.match(urls[0], /repos\/jesterlloyd\/aspire-tracker\/commits\?sha=main&per_page=100&page=1&since=2026-09-23T00%3A00%3A00.000Z/)
  assert.equal(urls.length, 2)

  assert.deepEqual(await A.fetchAppChanges({ fetchImpl: async () => ({ ok: false, status: 403 }), token: '' }), { ok: false, error: 'rate_limited', status: 403 })
  assert.deepEqual(await A.fetchAppChanges({ fetchImpl: async () => { throw new TypeError('fetch failed') }, token: '' }), { ok: false, error: 'network', status: 0 })
  const capped = await A.fetchAppChanges({ max: 3, fetchImpl: async () => ({ ok: true, json: async () => Array.from({ length: 100 }, (_, i) => commit(i)) }), token: '' })
  assert.equal(capped.commits.length, 3)
  assert.equal(capped.truncated, true)
})

// ── The migration, on real Postgres ──────────────────────────────────────────────

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE TABLE public.organizations (id uuid PRIMARY KEY);
  INSERT INTO public.organizations VALUES ('a5f1e000-0000-4000-8000-000000000001');
  CREATE TABLE public.user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, role text, is_owner boolean DEFAULT false, auth_user_id uuid);
  CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
  CREATE TABLE public.activity_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, user_name text, user_role text, action_type text, entity_type text, entity_id text, cohort_id uuid, description text, metadata jsonb, created_at timestamptz DEFAULT now());
`
const MIGRATION = runnable(read('supabase/migrations/20261028000000_keith_knowledge_selfcheck.sql'))

async function world() {
  const pg = new PGlite()
  await pg.exec(PRELUDE)
  for (const f of ['20260610000000_kt1_governance_knowledge_templates.sql', '20260610000001_kt2b_pre_governance_lifecycle_rpcs.sql', '20260807000001_knowledge_vault_markdown.sql']) {
    await pg.exec(runnable(read(`supabase/migrations/${f}`)))
  }
  const owner = (await pg.query(`INSERT INTO user_profiles (full_name, role, is_owner) VALUES ('Jester Lloyd Bautista', 'owner', true) RETURNING id`)).rows[0]
  const entry = (await pg.query(`INSERT INTO knowledge_entries (title, slug, category, body, source_attribution, state, created_by, updated_by, body_format)
    VALUES ('Clinical Hours', 'clinical-hours', 'student_requirements', 'Students complete 120 hours.', 'Handbook', 'active', $1, $1, 'markdown') RETURNING id`, [owner.id])).rows[0]
  return { pg, owner, entry }
}

test('the migration adds the gaps table and the proposed_by columns, changes nothing existing, and re-runs', async () => {
  const { pg, owner, entry } = await world()
  await pg.exec(MIGRATION)
  await pg.exec(MIGRATION)
  const one = async (sql, args = []) => (await pg.query(sql, args)).rows[0]
  assert.deepEqual(await one(`SELECT proposed_by, proposal_evidence FROM knowledge_entries WHERE id = $1`, [entry.id]), { proposed_by: 'person', proposal_evidence: null })
  const t = await one(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.keith_knowledge_gaps'::regclass`)
  assert.equal(t.relrowsecurity, true)
  assert.equal((await one(`SELECT has_table_privilege('authenticated', 'public.keith_knowledge_gaps', 'SELECT') AS s`)).s, false)

  // The gaps table's own rules.
  await pg.query(`INSERT INTO keith_knowledge_gaps (question, intent) VALUES ('How do make-up hours work?', 'policy_process')`)
  const g = await one(`SELECT EXTRACT(day FROM expires_at - created_at)::int AS days FROM keith_knowledge_gaps`)
  assert.equal(g.days, 90)
  await assert.rejects(pg.query(`INSERT INTO keith_knowledge_gaps (question, intent) VALUES ('x', 'cohort_status')`), /intent_check/)
  await assert.rejects(pg.query(`INSERT INTO keith_knowledge_gaps (question, intent) VALUES ($1, 'policy_process')`, ['x'.repeat(501)]), /question_check/)
  await assert.rejects(pg.query(`UPDATE knowledge_entries SET proposed_by = 'robot' WHERE id = $1`, [entry.id]), /proposed_by_check/)

  // A revision Keith proposes is credited to the Owner, carries its evidence, and the Owner's Apply still works.
  await pg.query(`INSERT INTO knowledge_revisions (entry_id, title, category, body, source_attribution, precedence_rank, change_note, author_id, proposed_by, evidence)
    SELECT id, title, category, 'Students complete 120 precepted hours, logged within 48 hours.', source_attribution, precedence_rank, 'Keith self-check', $2, 'keith', '{"commits":["f5c5f4f0"]}'::jsonb
    FROM knowledge_entries WHERE id = $1`, [entry.id, owner.id])
  await pg.query(`SELECT governance_apply_knowledge_revision($1::uuid, $2::uuid)`, [entry.id, owner.id])
  const after = await one(`SELECT body, current_version FROM knowledge_entries WHERE id = $1`, [entry.id])
  assert.match(after.body, /48 hours/)
  assert.equal((await one(`SELECT count(*)::int AS n FROM knowledge_revisions`)).n, 0, 'apply consumes the revision, as before')
})

test('recording a gap end to end: scrubbed, stored, and past-expiry rows cleared', async () => {
  const { pg } = await world()
  await pg.exec(MIGRATION)
  await pg.exec(`CREATE TABLE students (first_name text, last_name text, preferred_first_name text);
    CREATE TABLE preceptors (full_name text); CREATE TABLE contacts (full_name text);
    INSERT INTO students VALUES ('Maria', 'Santos', NULL); INSERT INTO preceptors VALUES ('Rosa Tan');`)
  await pg.query(`INSERT INTO keith_knowledge_gaps (question, intent, created_at, expires_at) VALUES ('old', 'general_other', now() - interval '100 days', now() - interval '10 days')`)
  const db = pgliteRest(pg)
  const out = await G.recordKnowledgeGap(db, { question: 'Can Maria make up hours on 4 North with Rosa?', intent: 'policy_process', governed: { governedCovered: false, scores: [2, 1] }, role: 'admin' })
  assert.deepEqual(out, { recorded: true })
  const rows = (await pg.query(`SELECT question, intent, top_score::int AS top, asked_role FROM keith_knowledge_gaps`)).rows
  assert.deepEqual(rows, [{ question: 'Can [name] make up hours on 4 North with [name]?', intent: 'policy_process', top: 2, asked_role: 'admin' }])
})
