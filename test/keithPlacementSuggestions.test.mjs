// test/keithPlacementSuggestions.test.mjs
//
// KEITH-PLACEMENT-1 (2026-09-29): Keith suggests placements.
//   - each hard rule, one test apiece: capacity, shift, preceptor load, clearance, and (none on file)
//     school rules; a candidate failing any rule is gone and Keith cannot bring it back
//   - scoring: preference first; Keith's fit reorders within a rank and never lifts a 2nd over a 1st
//   - "Suggest for all": contests for the last slot or a preceptor resolve by score, then preference
//     rank, then application date, and each is logged
//   - on real Postgres (PGlite) with the foundation and this migration: shadow runs are quiet,
//     explanations are reused, the board re-checks, Accept re-checks on the server, Reject blocks the
//     pairing, Undo reopens, the comparison card counts, demo students are never suggested

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const C = await import('../src/lib/placement/candidatePlacements.js')
const W = await import('../src/lib/placement/suggestionConfig.js')
const P = await import('../lib/server/placement/placementSuggestions.js')
const D = await import('../lib/server/keith/skillDefs.js')
const { populationDb } = await import('../lib/server/demoScope.js')
const { createKeithPlacementHandler } = await import('../api/keith-placement.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')

// ── The rules, pure ─────────────────────────────────────────────────────────────

const U = (id, over = {}) => ({ id, unit_name: id.toUpperCase(), total_slots: 1, is_participating: true, shift_preference: 'No Preference', ...over })
const S = (id, over = {}) => ({ id, status: 'Interviewed', matched_unit_id: null, unit_preference_1: 'A', unit_preference_2: 'B', unit_preference_3: 'C', nights_available: true, ...over })
const PR = (id, unit_id, over = {}) => ({ id, unit_id, full_name: `Preceptor ${id}`, is_active: true, ...over })
const ctxOf = (over = {}) => C.buildContext({
  units: [U('a'), U('b'), U('c'), U('d')],
  preceptors: [PR('pa', 'a'), PR('pb', 'b'), PR('pc', 'c'), PR('pd', 'd')],
  ...over,
})
const unitsOf = (r) => r.candidates.map(c => c.unitId)

test('capacity: a full unit, or one not participating, is gone', () => {
  const ctx = ctxOf({ matches: [{ unit_id: 'a', student_id: 'x' }], units: [U('a'), U('b'), U('c', { is_participating: false }), U('d')] })
  const r = C.candidatePlacements(S('s1'), ctx)
  assert.deepEqual(unitsOf(r).sort(), ['b', 'd'])
  assert.ok(r.failed.some(f => f.unitId === 'a' && /capacity/.test(f.reason)))
  const ok = C.candidatePlacements(S('s1'), ctxOf({ units: [U('a', { total_slots: 2 })], preceptors: [PR('pa', 'a')], matches: [{ unit_id: 'a', student_id: 'x' }] }))
  assert.equal(ok.candidates[0].checks.find(c => c.key === 'capacity').label, 'Capacity 2 of 2')
})

test('shift: a Night-preferred unit needs a student who has not said no to nights', () => {
  const ctx = ctxOf({ units: [U('a', { shift_preference: C.NIGHT_UNIT }), U('b', { shift_preference: C.DAY_UNIT }), U('c')] })
  assert.deepEqual(unitsOf(C.candidatePlacements(S('s', { nights_available: false }), ctx)).sort(), ['b', 'c'])
  assert.deepEqual(unitsOf(C.candidatePlacements(S('s', { nights_available: null }), ctx)).sort(), ['a', 'b', 'c'], 'unanswered is not a no')
})

test('preceptor: a unit whose preceptors are all at the cap, or with none, is gone; the least loaded is offered', () => {
  assert.equal(W.PLACEMENT_RULES.preceptorCap, 1)
  const ctx = ctxOf({
    preceptors: [PR('pa', 'a'), PR('pb1', 'b', { full_name: 'Zed' }), PR('pb2', 'b', { full_name: 'Amy' }), PR('pc', 'c', { is_active: false })],
    assignments: [{ preceptor_id: 'pa', student_id: 'x' }, { preceptor_id: 'pb2', student_id: 'y' }],
  })
  const r = C.candidatePlacements(S('s'), ctx)
  assert.deepEqual(r.candidates.map(c => [c.unitId, c.preceptorId]), [['b', 'pb1']])
  assert.ok(r.failed.some(f => f.unitId === 'a' && f.reason === 'preceptor'))
  assert.ok(r.failed.some(f => f.unitId === 'c' && f.reason === 'preceptor'), 'an inactive preceptor does not count')
  assert.ok(r.failed.some(f => f.unitId === 'd' && f.reason === 'preceptor'), 'no preceptor on file')
})

test('clearance is today’s placement rule: Interviewed and unplaced, nothing else', () => {
  for (const status of ['Form Received', 'Interview Scheduled', 'Not Proceeding', 'Placed']) {
    assert.equal(C.candidatePlacements(S('s', { status }), ctxOf()).candidates.length, 0, status)
  }
  assert.equal(C.candidatePlacements(S('s', { matched_unit_id: 'a' }), ctxOf()).candidates.length, 0)
  assert.equal(C.isSuggestable(S('s')), true)
})

test('school rules: none are on file, so the check always passes and says so', () => {
  const c = C.candidatePlacements(S('s'), ctxOf()).candidates[0]
  assert.deepEqual(c.checks.find(k => k.key === 'school'), { key: 'school', ok: true, label: 'No school rules on file' })
})

test('a rejected pairing is gone for the cohort', () => {
  assert.ok(!unitsOf(C.candidatePlacements(S('s'), ctxOf({ rejected: ['s|a'] }))).includes('a'))
})

test('scoring: preference first; Keith’s fit reorders within a rank and never lifts a 2nd choice over a 1st', () => {
  const ctx = ctxOf()
  const base = C.candidatePlacements(S('s'), ctx).candidates
  assert.deepEqual(base.map(c => [c.unitId, c.rank]), [['a', 1], ['b', 2], ['c', 3], ['d', null]])
  const fits = new Map([['a|pa', 0], ['b|pb', 1], ['d|pd', 1], ['c|pc', 0]])
  const withFit = C.candidatePlacements(S('s'), ctx, { fits }).candidates
  assert.deepEqual(withFit.map(c => c.unitId), ['a', 'b', 'c', 'd'], 'fit 1 on a 2nd choice still loses to a 1st choice with fit 0')
  assert.ok(W.PLACEMENT_WEIGHTS.experienceFit < W.PLACEMENT_WEIGHTS.preference[1] - W.PLACEMENT_WEIGHTS.preference[2])
  // Two units the student did not pick: fit decides.
  const s2 = S('s2', { unit_preference_1: null, unit_preference_2: null, unit_preference_3: null })
  assert.deepEqual(C.candidatePlacements(s2, ctx, { fits: new Map([['c|pc', 0.9], ['a|pa', 0.1]]) }).candidates.slice(0, 2).map(c => c.unitId), ['c', 'a'])
})

test('Suggest for all: the last slot goes by score, then preference rank, then application date, and each contest is logged', () => {
  const ctx = ctxOf({ units: [U('a'), U('b'), U('c'), U('d')] })
  const s1 = S('s1'); const s2 = S('s2'); const s3 = S('s3', { unit_preference_1: 'B', unit_preference_2: 'A' })
  const options = new Map([s1, s2, s3].map(s => [s.id, C.candidatePlacements(s, ctx).candidates]))
  const applied = new Map([['s1', '2026-08-02'], ['s2', '2026-08-01'], ['s3', '2026-08-03']])
  const { picks, conflicts } = C.allocate([s1, s2, s3], options, ctx, applied)
  assert.equal(picks.get('s2').unitId, 'a', 'same score and rank: the earlier application wins')
  assert.equal(picks.get('s3').unitId, 'b')
  assert.equal(picks.get('s1').unitId, 'c', 's1 lost A (to s2) and B (to s3), then took its 3rd choice')
  assert.deepEqual(conflicts.map(c => [c.studentId, c.unitId, c.winnerId, c.decidedBy]), [['s1', 'a', 's2', 'application date'], ['s1', 'b', 's3', 'score']])
})

// ── The world, on Postgres ──────────────────────────────────────────────────────

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  CREATE OR REPLACE FUNCTION public.append_only_refuse() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501'; END $f$;
  CREATE TABLE public.organizations (id uuid PRIMARY KEY);
  INSERT INTO public.organizations VALUES ('a5f1e000-0000-4000-8000-000000000001');
  CREATE TABLE public.user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, email text, role text, is_owner boolean DEFAULT false, is_active boolean DEFAULT true);
  CREATE TABLE public.cohorts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, is_demo boolean DEFAULT false);
  CREATE TABLE public.students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cohort_id uuid, first_name text, last_name text, preferred_first_name text, status text,
    matched_unit_id uuid, unit_preference_1 text, unit_preference_2 text, unit_preference_3 text, nights_available boolean, interest_statement text,
    prior_healthcare_experience text, cumulative_gpa numeric, created_at timestamptz DEFAULT now(), is_demo boolean DEFAULT false);
  CREATE TABLE public.units (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cohort_id uuid, unit_name text, total_slots int, is_participating boolean DEFAULT true,
    shift_preference text, patient_population text, division text, is_demo boolean DEFAULT false);
  CREATE TABLE public.matches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cohort_id uuid, student_id uuid, unit_id uuid, created_at timestamptz DEFAULT now(), is_demo boolean DEFAULT false);
  CREATE TABLE public.preceptors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, unit_id uuid, is_active boolean DEFAULT true, notes text, is_demo boolean DEFAULT false);
  CREATE TABLE public.student_preceptor_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), student_id uuid, preceptor_id uuid, cohort_id uuid, role text, status text, is_demo boolean DEFAULT false);
  CREATE TABLE public.program_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), student_id uuid, event_type text, event_date date);
  CREATE TABLE public.keith_skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, display_name text NOT NULL, description text NOT NULL DEFAULT '',
    version integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'draft', enabled boolean NOT NULL DEFAULT false,
    allowed_roles text[] NOT NULL DEFAULT '{}', required_tools text[] NOT NULL DEFAULT '{}', required_data text[] NOT NULL DEFAULT '{}',
    trigger_phrases text[] NOT NULL DEFAULT '{}', data_classification text NOT NULL DEFAULT 'internal', model_route text NOT NULL DEFAULT 'default',
    io_contract jsonb NOT NULL DEFAULT '{}'::jsonb, instruction_body text NOT NULL DEFAULT '', owner_label text NOT NULL DEFAULT 'ASPIRE', provenance text NOT NULL DEFAULT '', updated_by uuid);
  CREATE TABLE public.keith_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id text, profile_id uuid, role text, intent text, skill_id uuid, skill_version integer, model text, model_route text, rounds integer, input_tokens integer, output_tokens integer, duration_ms integer, outcome text, rate_limited boolean, created_at timestamptz DEFAULT now());
  CREATE TABLE public.keith_skill_invocations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), skill_id uuid, skill_slug text, skill_version integer, request_id text, invoked_by uuid, invoked_role text, cohort_id uuid, student_id uuid, invocation_mode text, data_sources jsonb, outcome text, denial_reason text, model text, input_tokens integer, output_tokens integer, duration_ms integer, created_at timestamptz DEFAULT now());
`
const MIGRATION = runnable(read('supabase/migrations/20261018000000_keith_placement_suggestions.sql'))

async function world({ mode = 'on' } = {}) {
  const pg = new PGlite()
  await pg.exec(PRELUDE)
  await pg.exec(runnable(read('supabase/migrations/20261016000000_keith_foundation.sql')))
  await pg.exec(MIGRATION)
  const one = async (sql, args = []) => (await pg.query(sql, args)).rows[0]
  const owner = await one(`INSERT INTO user_profiles (full_name, role, is_owner) VALUES ('Jester Lloyd Bautista', 'owner', true) RETURNING *`)
  const admin = await one(`INSERT INTO user_profiles (full_name, role) VALUES ('An Admin', 'admin') RETURNING *`)
  const cohort = await one(`INSERT INTO cohorts (name) VALUES ('Fall 2026') RETURNING *`)
  if (mode) await pg.query(`UPDATE keith_skills SET status = 'active', enabled = true, version = 1, run_mode = $1 WHERE slug = 'explain-placement'`, [mode])
  const unit = (name, slots = 1, over = {}) => one(`INSERT INTO units (cohort_id, unit_name, total_slots, shift_preference, patient_population) VALUES ($1, $2, $3, $4, $5) RETURNING *`, [cohort.id, name, slots, over.shift || 'No Preference', over.pop || null])
  const preceptor = (u, name, notes = '') => one(`INSERT INTO preceptors (full_name, unit_id, notes) VALUES ($1, $2, $3) RETURNING *`, [name, u.id, notes])
  const student = (first, prefs, over = {}) => one(`INSERT INTO students (cohort_id, first_name, last_name, status, unit_preference_1, unit_preference_2, unit_preference_3, interest_statement, prior_healthcare_experience, cumulative_gpa, is_demo, nights_available)
    VALUES ($1, $2, 'Reyes', $3, $4, $5, $6, $7, $8, 3.9, $9, $10) RETURNING *`, [cohort.id, first, over.status || 'Interviewed', prefs[0] || null, prefs[1] || null, prefs[2] || null, over.goals || `I want cardiac experience (${first})`, over.exp || 'CNA two years', !!over.demo, over.nights ?? true])
  const db = pgliteRest(pg)
  return { pg, db, cron: populationDb(db), owner, admin, cohort, unit, preceptor, student }
}

function stubKeith(seen = [], fitFor = () => 0.6) {
  return async (args) => {
    seen.push(args)
    const text = args.messages[0].content
    return { ok: true, text: JSON.stringify({ experience_fit: fitFor(text), reason: 'Wants cardiac experience; the unit is cardiac.' }), model: 'claude-test', usage: { inputTokens: 200, outputTokens: 40 } }
  }
}

test('the migration: two tables locked to the service role, the skill seeded draft, disabled, in shadow, matching SKILL.md', async () => {
  const { pg } = await world({ mode: null })
  const [skill] = (await pg.query(`SELECT status, enabled, run_mode, io_contract->>'surface' AS surface, instruction_body FROM keith_skills WHERE slug = 'explain-placement'`)).rows
  assert.deepEqual([skill.status, skill.enabled, skill.run_mode, skill.surface], ['draft', false, 'shadow', 'placement_board'])
  assert.equal(skill.instruction_body, read('skills/explain-placement/SKILL.md').split('---\n').slice(2).join('---\n').trim())
  await pg.query(`INSERT INTO placement_suggestion_runs (cohort_id, mode, source) SELECT id, 'on', 'manual' FROM cohorts`)
  await assert.rejects(pg.query(`UPDATE placement_suggestion_runs SET students = 1`), /append-only/)
  await pg.exec(MIGRATION)
  assert.equal((await pg.query(`SELECT count(*)::int n FROM keith_skills WHERE slug = 'explain-placement'`)).rows[0].n, 1, 'safe to re-run')
})

test('Keith reads only goals, experience, the unit and the preceptor’s notes; never grades, names or demographics', async () => {
  const { db, owner, cohort, unit, preceptor, student } = await world()
  const cicu = await unit('4 SCCT', 1, { pop: 'cardiac surgery' })
  await preceptor(cicu, 'Rosa Tan', 'Loves teaching new grads')
  await student('Ana', ['4 SCCT'])
  const seen = []
  await P.runSuggestions(db, { cohortId: cohort.id, actor: owner, complete: stubKeith(seen) })
  assert.equal(seen.length, 1)
  const text = seen[0].messages[0].content
  assert.match(text, /Student goal statement: I want cardiac experience/)
  assert.match(text, /Unit: 4 SCCT; Cardiac Care ICU \(CICU\); patients: cardiac surgery/)
  assert.match(text, /Preceptor notes: Loves teaching new grads/)
  assert.doesNotMatch(text, /Reyes|3\.9|Rosa Tan|Interviewed/, 'no surname, GPA, preceptor name or status')
})

test('a run: rules, Keith, scores, ranks 1 to 3; explanations reused; the board re-checks what is shown', async () => {
  const { pg, db, owner, cohort, unit, preceptor, student } = await world()
  const a = await unit('A'); const b = await unit('B'); const c = await unit('C'); const n = await unit('N', 1, { shift: 'Night Shift Preferred' })
  for (const u of [a, b, c, n]) await preceptor(u, `P-${u.unit_name}`)
  const ana = await student('Ana', ['A', 'B', 'C'])
  const ben = await student('Ben', ['N', 'A'], { nights: false })
  await student('Cy', ['A'], { status: 'Form Received' })
  const seen = []
  const r = await P.runSuggestions(db, { cohortId: cohort.id, actor: owner, complete: stubKeith(seen) })
  assert.deepEqual([r.mode, r.students, r.suggested], ['on', 2, 2])
  const rows = (await pg.query(`SELECT s.first_name, u.unit_name, ps.rank, ps.pref_rank, ps.state, ps.mode FROM placement_suggestions ps JOIN students s ON s.id = ps.student_id JOIN units u ON u.id = ps.unit_id ORDER BY s.first_name, ps.rank`)).rows
  assert.deepEqual(rows.map(x => [x.first_name, x.unit_name, x.rank]), [['Ana', 'A', 1], ['Ana', 'B', 2], ['Ana', 'C', 3], ['Ben', 'B', 1], ['Ben', 'A', 2], ['Ben', 'C', 3]],
    'Ben cannot work nights so N is gone; Ana holds A, so Ben’s suggestion is B (A stays an alternative behind Swap)')
  assert.equal(r.conflicts.length, 1, 'one contest: A’s only slot')
  assert.deepEqual([r.conflicts[0].student, r.conflicts[0].unitName, r.conflicts[0].winner], ['Ben Reyes', 'A', 'Ana Reyes'])
  const [run] = (await pg.query(`SELECT source, students, suggested, jsonb_array_length(conflicts) AS c FROM placement_suggestion_runs`)).rows
  assert.deepEqual(run, { source: 'manual', students: 2, suggested: 2, c: 1 })
  // A second run reads nothing again: the same pairings were already explained in this cohort.
  const seen2 = []
  await P.runSuggestions(db, { cohortId: cohort.id, actor: owner, complete: stubKeith(seen2) })
  assert.equal(seen2.length, 0, seen2.map(x => x.messages[0].content.split('\n').filter(l => /Unit:|goal/.test(l)).join(' | ')).join(' ;; '))
  assert.equal((await pg.query(`SELECT count(*)::int n FROM placement_suggestions WHERE state = 'superseded'`)).rows[0].n, 6, 'the earlier run’s open suggestions are superseded')
  // The board: each suggestion with its alternatives; a slot filled since hides it.
  let v = await P.boardView(db, { cohortId: cohort.id })
  const anaS = v.suggestions.find(s => s.studentId === ana.id)
  assert.deepEqual([anaS.unitName, anaS.alternatives.map(x => x.unitName), anaS.prefRank, anaS.preceptorName], ['A', ['B', 'C'], 1, 'P-A'])
  assert.ok(anaS.checks.every(k => k.ok) && anaS.provenanceId)
  await pg.query(`INSERT INTO matches (cohort_id, student_id, unit_id) SELECT $1, id, $2 FROM students WHERE first_name = 'Cy'`, [cohort.id, a.id])
  v = await P.boardView(db, { cohortId: cohort.id })
  assert.equal(v.suggestions.find(s => s.studentId === ana.id).unitName, 'B', 'A filled up: the next valid option moves up')
  void ben
})

test('Accept re-checks every rule on the server; Undo reopens; Reject blocks the pairing for the cohort', async () => {
  const { pg, db, owner, cohort, unit, preceptor, student } = await world()
  const a = await unit('A'); const b = await unit('B')
  await preceptor(a, 'P-A'); await preceptor(b, 'P-B')
  const ana = await student('Ana', ['A', 'B'])
  await P.runSuggestions(db, { cohortId: cohort.id, actor: owner, complete: stubKeith() })
  const first = (await pg.query(`SELECT id, keith_provenance_id FROM placement_suggestions WHERE rank = 1`)).rows[0]
  const accepted = await P.accept(db, owner, { suggestionId: first.id })
  assert.equal(accepted.unitId, a.id)
  assert.equal((await pg.query(`SELECT state FROM keith_provenance WHERE id = $1`, [first.keith_provenance_id])).rows[0].state, 'accepted')
  assert.equal((await pg.query(`SELECT count(*)::int n FROM placement_suggestions WHERE state = 'open'`)).rows[0].n, 0, 'the alternatives are superseded')
  await assert.rejects(P.accept(db, owner, { suggestionId: first.id }), /already decided/)
  // The board placed it: the pinned note keeps the mark in the accepted state.
  await pg.query(`INSERT INTO matches (cohort_id, student_id, unit_id) VALUES ($1, $2, $3)`, [cohort.id, ana.id, a.id])
  await pg.query(`UPDATE students SET matched_unit_id = $1, status = 'Placed' WHERE id = $2`, [a.id, ana.id])
  assert.equal((await P.boardView(db, { cohortId: cohort.id })).accepted[ana.id], first.keith_provenance_id)
  // Undo: the board unmatched it; the suggestion is open again and the mark drafted.
  await pg.query(`DELETE FROM matches WHERE student_id = $1`, [ana.id])
  await pg.query(`UPDATE students SET matched_unit_id = NULL, status = 'Interviewed' WHERE id = $1`, [ana.id])
  await P.undoAccept(db, owner, { suggestionId: first.id })
  assert.equal((await pg.query(`SELECT state FROM placement_suggestions WHERE id = $1`, [first.id])).rows[0].state, 'open')
  assert.equal((await pg.query(`SELECT state FROM keith_provenance WHERE id = $1`, [first.keith_provenance_id])).rows[0].state, 'drafted')
  // Someone else takes the slot: Accept now refuses on the server.
  const cy = await student('Cy', ['A'])
  await pg.query(`INSERT INTO matches (cohort_id, student_id, unit_id) VALUES ($1, $2, $3)`, [cohort.id, cy.id, a.id])
  await assert.rejects(P.accept(db, owner, { suggestionId: first.id }), /no longer passes the placement rules/)
  await pg.query(`DELETE FROM matches WHERE student_id = $1`, [cy.id])
  // Reject: gone, and never suggested again this cohort.
  await P.reject(db, owner, { suggestionId: first.id })
  assert.equal((await pg.query(`SELECT state FROM keith_provenance WHERE id = $1`, [first.keith_provenance_id])).rows[0].state, 'rejected')
  await P.runSuggestions(db, { cohortId: cohort.id, actor: owner, complete: stubKeith() })
  const again = (await pg.query(`SELECT u.unit_name FROM placement_suggestions ps JOIN units u ON u.id = ps.unit_id WHERE ps.state = 'open' AND ps.student_id = $1 ORDER BY rank`, [ana.id])).rows
  assert.deepEqual(again.map(r => r.unit_name), ['B'])
})

test('shadow: computed quietly by the cron, never shown; the comparison card counts what you did', async () => {
  const { pg, db, cron, owner, cohort, unit, preceptor, student } = await world({ mode: 'shadow' })
  const a = await unit('A'); const b = await unit('B', 2)
  await preceptor(a, 'P-A'); await preceptor(b, 'P-B1'); await preceptor(b, 'P-B2')
  const ana = await student('Ana', ['A', 'B'])
  const ben = await student('Ben', ['B', 'A'])
  const cy = await student('Cy', ['A', 'B'])
  await student('Dee', ['A'], { demo: true })
  await assert.rejects(P.runSuggestions(db, { cohortId: cohort.id, actor: owner, source: 'manual', complete: stubKeith() }), /shadow mode/)
  assert.deepEqual(await P.cohortsToShadow(cron), [cohort.id])
  const r = await P.runSuggestions(cron, { cohortId: cohort.id, source: 'shadow_cron', complete: stubKeith() })
  assert.deepEqual([r.mode, r.students, r.suggested], ['shadow', 3, 3], 'the demo student is never read')
  assert.equal((await P.runSuggestions(cron, { cohortId: cohort.id, source: 'shadow_cron', complete: stubKeith() })).students, 0, 'each student once')
  const v0 = await P.boardView(db, { cohortId: cohort.id })
  assert.deepEqual([v0.mode, v0.suggestions.length], ['shadow', 0], 'nothing shown in shadow')
  // Keith's firsts: Ana A (earliest), Ben B, Cy B. You place Ana on A, Ben on A? No: Ben on B, Cy on A... A holds 1.
  const keithFirst = new Map((await pg.query(`SELECT student_id, unit_id FROM placement_suggestions WHERE rank = 1`)).rows.map(x => [x.student_id, x.unit_id]))
  assert.equal(keithFirst.get(ana.id), a.id)
  // You: Ana on B (a different unit, but her 2nd choice: not the same rank as Keith's 1st), Ben on B (agree).
  for (const [s, u] of [[ana, b], [ben, b]]) {
    await pg.query(`INSERT INTO matches (cohort_id, student_id, unit_id) VALUES ($1, $2, $3)`, [cohort.id, s.id, u.id])
    await pg.query(`UPDATE students SET matched_unit_id = $1, status = 'Placed' WHERE id = $2`, [u.id, s.id])
  }
  const c = (await P.boardView(db, { cohortId: cohort.id })).comparison
  assert.deepEqual([c.placed, c.matchedFirst, c.sameRank, c.hardRulesBroken], [2, 1, 0, 0])
  assert.deepEqual(c.disagreements, [{ student: 'Ana Reyes', keith: 'A', keithRank: 1, placed: 'B', placedRank: 2 }])
  void cy
})

test('Keith cannot add a candidate that failed a rule: an unexplained or failing option never becomes a suggestion', async () => {
  const { pg, db, owner, cohort, unit, preceptor, student } = await world()
  const a = await unit('A'); const n = await unit('N', 1, { shift: 'Night Shift Preferred' })
  await preceptor(a, 'P-A'); await preceptor(n, 'P-N')
  await student('Ana', ['N', 'A'], { nights: false })
  const seen = []
  await P.runSuggestions(db, { cohortId: cohort.id, actor: owner, complete: stubKeith(seen, () => 1) })
  assert.ok(!seen.some(x => /Unit: N/.test(x.messages[0].content)), 'Keith was never even asked about the failing unit')
  assert.deepEqual((await pg.query(`SELECT u.unit_name FROM placement_suggestions ps JOIN units u ON u.id = ps.unit_id`)).rows.map(x => x.unit_name), ['A'])
  // A failed explanation drops the option rather than guessing a fit.
  await pg.query(`UPDATE placement_suggestions SET state = 'superseded'`)
  const { pg: pg2, db: db2, owner: o2, cohort: c2, unit: u2, preceptor: p2, student: s2 } = await world()
  const x = await u2('X'); await p2(x, 'P-X'); await s2('Zoe', ['X'])
  const r = await P.runSuggestions(db2, { cohortId: c2.id, actor: o2, complete: async () => ({ ok: true, text: '{"experience_fit": 7, "reason": "x"}', model: 'm', usage: {} }) })
  assert.deepEqual([r.suggested, r.unexplained], [0, 1])
  assert.equal((await pg2.query(`SELECT count(*)::int n FROM placement_suggestions`)).rows[0].n, 0)
  void pg
})

test('the explain-placement skill declares exactly its four inputs, and its schema holds fit to 0..1', () => {
  const def = D.SKILL_DEFS['explain-placement']
  assert.deepEqual([...def.inputs], ['goals', 'experience', 'unit', 'preceptor_notes'])
  assert.equal(def.schema.properties.experience_fit.maximum, 1)
})

test('/api/keith-placement: placement roles only; the mode switch is the Owner’s; strict bodies', async () => {
  const { db, owner, admin, cohort } = await world({ mode: 'shadow' })
  const as = (profile) => createKeithPlacementHandler({ verifyCaller: async () => ({ authenticated: true, profile }), makeDb: () => db })
  for (const p of [owner, admin, { id: 'c', role: 'co-lead' }]) assert.equal((await call(as(p), { action: 'board', cohort_id: cohort.id })).status, 200, p.role)
  for (const p of [{ id: 'i', role: 'interviewer' }, { id: 's', role: 'student' }]) assert.equal((await call(as(p), { action: 'board', cohort_id: cohort.id })).status, 403, p.role)
  assert.equal((await call(as(admin), { action: 'set_mode', mode: 'on' })).status, 403)
  const on = await call(as(owner), { action: 'set_mode', mode: 'on' })
  assert.deepEqual([on.status, on.body.to], [200, 'on'])
  assert.equal((await call(as(owner), { action: 'board', cohort_id: cohort.id, extra: 1 })).status, 400)
  assert.equal((await call(as(owner), { action: 'accept', suggestion_id: 'nope' })).status, 400)
})

function call(handler, body) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.statusCode = c; return this }, json(b) { resolve({ status: this.statusCode, body: b }); return this }, end() { resolve({ status: this.statusCode }); return this } }
    handler({ method: 'POST', headers: {}, body }, res)
  })
}
