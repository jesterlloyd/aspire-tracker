// test/keithCommentThemes.test.mjs
//
// KEITH-THEMES-1 (2026-09-29): Keith themes the comments on Evaluation > Responses.
//   - the rules, pure: which fields are comments (never the preceptor's confidential comments),
//     consent, Keith's output held to one theme per comment, de-identification, the privacy floor,
//     the export and its review line
//   - on real Postgres (PGlite) with the foundation and this migration: Keith sees opaque ids and text
//     only; a run is a version; Rename, Merge, Move and Accept move the Keith mark; an edited version
//     is never replaced without a confirmation; leadership sees nothing in shadow (the Owner previews),
//     the de-identified cut once ON, and the portal only with a per-person grant; the daily run waits
//     for a timepoint to close and reads real cohorts only

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteRest } from './helpers/pgliteRest.mjs'

const M = await import('../src/lib/evaluation/commentThemesModel.js')
const T = await import('../lib/server/evaluation/commentThemes.js')
const D = await import('../lib/server/keith/skillDefs.js')
const { populationDb } = await import('../lib/server/demoScope.js')
const { createCommentThemesHandler } = await import('../api/keith-comment-themes.js')
const { createAcademicsThemesHandler, grantHasThemes, portalShape } = await import('../api/portal/academics-evaluation-themes.js')
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const runnable = (sql) => sql.replace(/NOTIFY pgrst, 'reload schema';/g, '')

// ── The rules, pure ─────────────────────────────────────────────────────────────

const asg = (id, responses, over = {}) => ({ id, student_id: `s-${id}`, evaluation_responses: { submitted_at: '2026-09-01T00:00:00Z', responses }, ...over })

test('every comment field is read except the preceptor’s confidential comments, which never are', () => {
  assert.deepEqual([...M.INSTRUMENTS].filter(M.qualifies), [...M.INSTRUMENTS], 'all four instruments carry comments')
  assert.ok(!M.COMMENT_FIELDS.preceptor_progress.some(f => /confidential/.test(f.key)))
  const out = M.extractComments('preceptor_progress', [asg('a1', {
    developmental_feedback: {
      competency: { C1: { rating: 4, comment: 'Charts carefully every shift' }, C2: { rating: 3, comment: '' } },
      narrative: { strengths_observed: 'Calm with families', areas_for_development: 'ok' },
    },
    confidential_team_comments: { confidential_comments: 'Private note for leadership only' },
  })])
  assert.deepEqual(out.map(c => c.field), ['developmental_feedback.competency.C1.comment', 'developmental_feedback.narrative.strengths_observed'],
    'a blank or two-letter answer is not a comment')
  assert.ok(!out.some(c => /Private note/.test(c.text)))
  assert.equal(out[0].consent, null, 'instruments that do not ask carry no consent')
})

test('consent: only Student’s Feedback on ASPIRE asks, and only a yes counts; an unsubmitted response is nothing', () => {
  const out = M.extractComments('post_rotation_evaluation', [
    asg('y', { most_valuable_part: 'The preceptor pairing', may_use_anonymized_comments: true }),
    asg('n', { most_valuable_part: 'The town hall', may_use_anonymized_comments: false }),
    asg('u', { most_valuable_part: 'Unanswered consent' }),
    asg('d', { most_valuable_part: 'Draft only' }, { evaluation_responses: { submitted_at: null, responses: { most_valuable_part: 'Draft only' } } }),
  ])
  assert.deepEqual(out.map(c => [c.assignmentId, c.consent]), [['n', false], ['u', false], ['y', true]])
})

test('Keith’s output is held to the rules: known ids only, one theme per comment, short names, own examples', () => {
  const r = M.normalizeThemes({ themes: [
    { name: 'Preceptor availability and consistency across every shift', comment_ids: ['c1', 'c2', 'c9'], example_ids: ['c2', 'c3'], reason: 'x' },
    { name: 'Scheduling', comment_ids: ['c2', 'c3', 'c4'], example_ids: [] },
    { name: 'Ghost', comment_ids: ['c77'] },
  ] }, ['c1', 'c2', 'c3', 'c4', 'c5'])
  assert.deepEqual(r.themes.map(t => [t.name, t.comment_ids, t.example_ids]), [
    ['Preceptor availability and consistency across', ['c1', 'c2'], ['c2']],
    ['Scheduling', ['c3', 'c4'], ['c3', 'c4']],
  ])
  assert.deepEqual(r.unthemed_ids, ['c5'])
})

test('de-identification: known names and units go, ordinary words stay, contact details or too much loss drop the quote', () => {
  const names = M.nameList({ students: [{ first_name: 'Will', last_name: 'Garcia' }], preceptors: [{ full_name: 'Grace Lee' }], staff: [], units: [{ unit_name: '4 SCCT' }] })
  assert.deepEqual(M.deidentify('Grace on 4 SCCT will always make time to teach me and the team', names),
    { ok: true, text: '[name] on [unit] will always make time to teach me and the team' })
  assert.equal(M.deidentify('Email me at ana@example.com any time', names).ok, false)
  assert.equal(M.deidentify('Call 310-555-0100 about the schedule', names).ok, false)
  assert.equal(M.deidentify('Will Garcia and Grace', names).ok, false, 'more than 30% removed')
})

test('the leadership cut: small themes fold into Other and say why; quotes only with consent; counts always', () => {
  const c = (text, consent) => ({ text, consent })
  const commentsById = new Map([['c1', c('Great support from my preceptor', true)], ['c2', c('Preceptor was busy', false)], ['c3', c('Preceptor taught me a lot', true)],
    ['c4', c('Parking was hard', true)], ['c5', c('Parking again', true)], ['c6', c('Loose comment', true)]])
  const cut = M.leadershipCut({
    themes: [{ name: 'Preceptor support', comment_ids: ['c1', 'c2', 'c3'], example_ids: ['c1', 'c2'] }, { name: 'Parking', comment_ids: ['c4', 'c5'], example_ids: ['c4'] }],
    commentsById, total: 6, floor: 3, names: { people: [], units: [] },
  })
  assert.deepEqual(cut.themes.map(t => [t.name, t.count, t.quotes, t.quotesWithheld]), [['Preceptor support', 3, ['Great support from my preceptor'], 1]])
  assert.deepEqual([cut.other.count, cut.other.folded], [3, ['Parking']], 'two folded plus one unthemed')
  assert.match(cut.other.note, /fewer than 3 comments/)
  assert.match(cut.note, /agreed to share anonymized comments/)
})

test('the export: a BOM, no formula can run, and the review line names the person and the date', () => {
  const cut = { total: 4, themes: [{ name: '=HYPERLINK("x")', count: 3, share: 0.75, quotes: ['A "quoted" word'] }], other: { count: 1 } }
  const csv = M.exportCsv(cut, { instrumentName: 'Student’s Feedback on ASPIRE', timepointLabel: '', reviewer: 'Jester Lloyd Bautista', reviewedAt: '2026-09-29' })
  assert.ok(csv.startsWith('﻿"Theme"'))
  assert.match(csv, /"'=HYPERLINK\(""x""\)","3","75%","A ""quoted"" word"/)
  assert.match(csv, /"Themes generated by Keith and reviewed by Jester Lloyd Bautista on 2026-09-29\."/)
  assert.match(M.exportCsv(cut, { instrumentName: 'X' }), /Not yet reviewed by a person/)
})

test('the theme-comments skill declares one input, and SKILL.md is what the migration seeds', () => {
  const def = D.SKILL_DEFS['theme-comments']
  assert.deepEqual([...def.inputs], ['comments'])
  const body = read('skills/theme-comments/SKILL.md').split('---\n').slice(2).join('---\n').trim()
  const seeded = read('supabase/migrations/20261019000000_keith_comment_themes.sql').match(/E'(You group[\s\S]*?)'\n\)/)[1].replace(/''/g, "'").replace(/\\n/g, '\n')
  assert.equal(seeded, body)
})

// ── The world, on Postgres ──────────────────────────────────────────────────────

const PRELUDE = `
  DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  -- As on Supabase: the service role is granted everything on new tables, so a missing REVOKE shows.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
  CREATE OR REPLACE FUNCTION public.append_only_refuse() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501'; END $f$;
  CREATE TABLE public.organizations (id uuid PRIMARY KEY);
  INSERT INTO public.organizations VALUES ('a5f1e000-0000-4000-8000-000000000001');
  CREATE TABLE public.user_profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, email text, role text, is_owner boolean DEFAULT false, is_active boolean DEFAULT true);
  CREATE TABLE public.user_role_grants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_profile_id uuid, role text NOT NULL);
  CREATE TABLE public.cohorts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, is_demo boolean DEFAULT false);
  CREATE TABLE public.students (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cohort_id uuid, first_name text, last_name text, preferred_first_name text, is_demo boolean DEFAULT false);
  CREATE TABLE public.units (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cohort_id uuid, unit_name text, is_demo boolean DEFAULT false);
  CREATE TABLE public.preceptors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, is_demo boolean DEFAULT false);
  CREATE TABLE public.evaluation_instruments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE);
  CREATE TABLE public.evaluation_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cohort_id uuid, student_id uuid, instrument_id uuid, timepoint text, status text,
    sent_at timestamptz DEFAULT now(), expires_at timestamptz, revoked_at timestamptz, is_demo boolean DEFAULT false);
  CREATE TABLE public.evaluation_responses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), assignment_id uuid, responses jsonb, submitted_at timestamptz);
  CREATE TABLE public.keith_skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, display_name text NOT NULL, description text NOT NULL DEFAULT '',
    version integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'draft', enabled boolean NOT NULL DEFAULT false,
    allowed_roles text[] NOT NULL DEFAULT '{}', required_tools text[] NOT NULL DEFAULT '{}', required_data text[] NOT NULL DEFAULT '{}',
    trigger_phrases text[] NOT NULL DEFAULT '{}', data_classification text NOT NULL DEFAULT 'internal', model_route text NOT NULL DEFAULT 'default',
    io_contract jsonb NOT NULL DEFAULT '{}'::jsonb, instruction_body text NOT NULL DEFAULT '', owner_label text NOT NULL DEFAULT 'ASPIRE', provenance text NOT NULL DEFAULT '', updated_by uuid);
  CREATE TABLE public.keith_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id text, profile_id uuid, role text, intent text, skill_id uuid, skill_version integer, model text, model_route text, rounds integer, input_tokens integer, output_tokens integer, duration_ms integer, outcome text, rate_limited boolean, created_at timestamptz DEFAULT now());
  CREATE TABLE public.keith_skill_invocations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), skill_id uuid, skill_slug text, skill_version integer, request_id text, invoked_by uuid, invoked_role text, cohort_id uuid, student_id uuid, invocation_mode text, data_sources jsonb, outcome text, denial_reason text, model text, input_tokens integer, output_tokens integer, duration_ms integer, created_at timestamptz DEFAULT now());
`
const MIGRATION = runnable(read('supabase/migrations/20261019000000_keith_comment_themes.sql'))
const SLUG = 'post_rotation_evaluation'

async function world({ mode = 'shadow' } = {}) {
  const pg = new PGlite()
  await pg.exec(PRELUDE)
  await pg.exec(runnable(read('supabase/migrations/20261016000000_keith_foundation.sql')))
  await pg.exec(MIGRATION)
  const one = async (sql, args = []) => (await pg.query(sql, args)).rows[0]
  const owner = await one(`INSERT INTO user_profiles (full_name, role, is_owner) VALUES ('Jester Lloyd Bautista', 'owner', true) RETURNING *`)
  const admin = await one(`INSERT INTO user_profiles (full_name, role) VALUES ('An Admin', 'admin') RETURNING *`)
  const cohort = await one(`INSERT INTO cohorts (name) VALUES ('Fall 2026') RETURNING *`)
  await pg.query(`INSERT INTO units (cohort_id, unit_name) VALUES ($1, '4 SCCT')`, [cohort.id])
  await pg.query(`INSERT INTO preceptors (full_name) VALUES ('Rosa Tan')`)
  const instruments = {}
  for (const slug of M.INSTRUMENTS) instruments[slug] = await one(`INSERT INTO evaluation_instruments (slug) VALUES ($1) RETURNING *`, [slug])
  if (mode) await pg.query(`UPDATE keith_skills SET status = 'active', enabled = true, version = 1, run_mode = $1 WHERE slug = 'theme-comments'`, [mode])
  // One student and one submitted response per call.
  const respond = async (first, responses, { slug = SLUG, timepoint = 'post_rotation', status = 'completed', c = cohort, demo = false } = {}) => {
    const s = await one(`INSERT INTO students (cohort_id, first_name, last_name, is_demo) VALUES ($1, $2, 'Reyes', $3) RETURNING *`, [c.id, first, demo])
    const a = await one(`INSERT INTO evaluation_assignments (cohort_id, student_id, instrument_id, timepoint, status, is_demo) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [c.id, s.id, instruments[slug].id, timepoint, status, demo])
    if (status === 'completed') await pg.query(`INSERT INTO evaluation_responses (assignment_id, responses, submitted_at) VALUES ($1, $2, now())`, [a.id, JSON.stringify(responses)])
    return a
  }
  const db = pgliteRest(pg)
  return { pg, db, owner, admin, cohort, instruments, respond, one }
}

// Keith, stubbed: a theme per keyword, everything else unthemed. Records what it was sent.
function stubKeith(seen = []) {
  return async (args) => {
    seen.push(args)
    const lines = args.messages[0].content.split('\n').slice(1).map(l => l.match(/^\[(c\d+)\] (.*)$/)).filter(Boolean)
    const by = (re) => lines.filter(([, , t]) => re.test(t)).map(([, id]) => id)
    const themes = [
      // Examples are chosen by text, not by position: ids follow row uuids, which are random.
      { name: 'Preceptor support', comment_ids: by(/preceptor/i), example_ids: by(/Rosa|every shift/), reason: 'They talk about their preceptor.' },
      { name: 'Scheduling', comment_ids: by(/schedul/i), example_ids: by(/changed/), reason: 'Shifts and schedules.' },
    ].filter(t => t.comment_ids.length)
    return { ok: true, text: JSON.stringify({ themes, unthemed_ids: [] }), model: 'claude-test', usage: { inputTokens: 300, outputTokens: 80 } }
  }
}

async function seedFour(w) {
  await w.respond('Ana', { most_valuable_part: 'My preceptor Rosa taught me so much about cardiac care on 4 SCCT', may_use_anonymized_comments: true })
  await w.respond('Ben', { most_valuable_part: 'Having one preceptor every shift', improve_learning_experience: 'The schedule changed too often', may_use_anonymized_comments: false })
  await w.respond('Cy', { most_valuable_part: 'A patient preceptor who explained things', may_use_anonymized_comments: true })
  await w.respond('Dee', { final_reflection: 'Scheduling was confusing at first', may_use_anonymized_comments: true })
}
const KEY = (w, over = {}) => ({ cohortId: w.cohort.id, slug: SLUG, timepoint: 'post_rotation', ...over })
// REVIEWED-THEMES-1 (2026-09-29): leadership sees accepted themes only, so a test that looks at the
// leadership cut accepts Keith's themes first.
async function acceptAll(w) {
  for (const t of (await T.themesView(w.db, { ...KEY(w) })).themes) await T.accept(w.db, w.owner, { themeId: t.id })
}

test('the migration: three tables locked to the service role, versions append-only, the grant only for NE&L, safe to re-run', async () => {
  const { pg, cohort } = await world({ mode: null })
  const [skill] = (await pg.query(`SELECT status, enabled, run_mode, model_route, io_contract->>'surface' AS surface FROM keith_skills WHERE slug = 'theme-comments'`)).rows
  assert.deepEqual(skill, { status: 'draft', enabled: false, run_mode: 'shadow', model_route: 'quality', surface: 'evaluation_responses' })
  assert.equal((await pg.query(`SELECT privacy_floor FROM evaluation_theme_settings`)).rows[0].privacy_floor, 3)
  await assert.rejects(pg.query(`UPDATE evaluation_theme_settings SET privacy_floor = 0`))
  const privs = (await pg.query(`SELECT c.relname, has_table_privilege('service_role', c.oid, 'DELETE') AS del FROM pg_class c WHERE c.relname IN ('comment_theme_versions', 'comment_themes', 'evaluation_theme_settings') ORDER BY 1`)).rows
  assert.deepEqual(privs.map(r => r.del), [false, false, false], 'the service role deletes nothing in these tables')
  await pg.query(`INSERT INTO comment_theme_versions (cohort_id, instrument_slug, timepoint, version, source, mode) VALUES ($1, 'x', 'y', 1, 'manual', 'shadow')`, [cohort.id])
  await assert.rejects(pg.query(`UPDATE comment_theme_versions SET comment_count = 9`), /append-only/)
  await assert.rejects(pg.query(`DELETE FROM comment_theme_versions`), /append-only/)
  await pg.query(`INSERT INTO user_role_grants (role) VALUES ('nursing_academic'), ('academic_partner')`)
  assert.deepEqual((await pg.query(`SELECT DISTINCT evaluation_themes_access FROM user_role_grants`)).rows, [{ evaluation_themes_access: 'none' }], 'off by default')
  await pg.query(`UPDATE user_role_grants SET evaluation_themes_access = 'view' WHERE role = 'nursing_academic'`)
  await assert.rejects(pg.query(`UPDATE user_role_grants SET evaluation_themes_access = 'view' WHERE role = 'academic_partner'`))
  await assert.rejects(pg.query(`UPDATE user_role_grants SET evaluation_themes_access = 'edit' WHERE role = 'nursing_academic'`))
  await pg.exec(MIGRATION)
  assert.equal((await pg.query(`SELECT count(*)::int n FROM keith_skills WHERE slug = 'theme-comments'`)).rows[0].n, 1)
})

test('a run: Keith gets opaque ids and the comment text only; the version records where each came from', async () => {
  const w = await world()
  await seedFour(w)
  const seen = []
  const r = await T.runThemes(w.db, { ...KEY(w), actor: w.owner, complete: stubKeith(seen) })
  assert.deepEqual(r, { version: 1, themes: 2, comments: 5, mode: 'shadow' })
  const sent = seen[0].messages[0].content
  assert.match(sent, /^COMMENTS \(5\)\n\[c1\] /)
  assert.doesNotMatch(sent, /Reyes|may_use|[0-9a-f]{8}-[0-9a-f]{4}/, 'no surname, no consent flag, no ids of rows')
  const [v] = (await w.pg.query(`SELECT version, comment_count, comment_refs, keith_provenance_id FROM comment_theme_versions`)).rows
  assert.equal(Object.keys(v.comment_refs).length, 5)
  assert.ok(Object.values(v.comment_refs).every(x => x.assignment_id && x.field))
  const prov = (await w.pg.query(`SELECT entity_type, state, mode, jsonb_array_length(input_refs) AS refs FROM keith_provenance WHERE entity_type = 'eval_theme' ORDER BY refs DESC`)).rows
  assert.deepEqual(prov, [{ entity_type: 'eval_theme', state: 'drafted', mode: 'shadow', refs: 3 }, { entity_type: 'eval_theme', state: 'drafted', mode: 'shadow', refs: 2 }])
  // The Owner view: largest first, verbatim quotes that point at their response.
  const view = await T.themesView(w.db, { ...KEY(w), audience: 'owner' })
  assert.deepEqual(view.themes.map(t => [t.name, t.count]), [['Preceptor support', 3], ['Scheduling', 2]])
  assert.ok(view.themes[0].quotes.some(q => q.text === 'My preceptor Rosa taught me so much about cardiac care on 4 SCCT'), 'the Owner reads it verbatim')
  assert.ok(view.themes[0].quotes.every(q => q.assignmentId))
  assert.deepEqual([view.total, view.other.length, view.version.version, view.version.edited], [5, 0, 1, false])
})

test('Rename, Merge, Move and Accept each move the Keith mark; an edited version is never replaced without asking', async () => {
  const w = await world()
  await seedFour(w)
  await T.runThemes(w.db, { ...KEY(w), actor: w.owner, complete: stubKeith() })
  let view = await T.themesView(w.db, { ...KEY(w) })
  const [pre, sched] = view.themes
  const state = async (id) => (await w.pg.query(`SELECT state FROM keith_provenance WHERE id = $1`, [id])).rows[0].state
  await T.accept(w.db, w.owner, { themeId: sched.id })
  assert.equal(await state(sched.provenanceId), 'accepted')
  await T.rename(w.db, w.owner, { themeId: pre.id, name: 'Preceptor consistency' })
  assert.equal(await state(pre.provenanceId), 'edited')
  // THEMES-FOLD-1 (2026-09-29) changed this: Accept is the sign-off whether or not the theme was edited,
  // so the theme reads 'accepted' (it folds and counts as reviewed); the Keith mark still says Edited.
  assert.equal((await T.accept(w.db, w.owner, { themeId: pre.id })).state, 'accepted', 'accepted with changes is accepted')
  assert.equal(await state(pre.provenanceId), 'edited', 'the mark still says a person changed Keith’s work')
  assert.equal((await T.accept(w.db, w.owner, { themeId: pre.id })).unchanged, true, 'a second accept writes nothing')
  // Move a Scheduling comment to Other, then into Preceptor support.
  const cid = sched.commentIds[0]
  await T.move(w.db, w.admin, { versionId: view.version.id, commentId: cid, toThemeId: null })
  view = await T.themesView(w.db, { ...KEY(w) })
  assert.deepEqual(view.other.map(o => o.id), [cid])
  await T.move(w.db, w.admin, { versionId: view.version.id, commentId: cid, toThemeId: pre.id })
  await assert.rejects(T.move(w.db, w.admin, { versionId: view.version.id, commentId: 'c99', toThemeId: pre.id }), /not in these themes/)
  let states = Object.fromEntries((await T.themesView(w.db, { ...KEY(w) })).themes.map(t => [t.id, t.state]))
  assert.equal(states[pre.id], 'edited', 'a comment moved into an accepted theme reopens it for review')
  // Merge Scheduling into Preceptor consistency.
  await T.merge(w.db, w.owner, { themeId: sched.id, intoId: pre.id })
  view = await T.themesView(w.db, { ...KEY(w) })
  assert.deepEqual(view.themes.map(t => [t.name, t.count, t.state]), [['Preceptor consistency', 5, 'edited']])
  assert.equal(view.version.reviewer.name, 'Jester Lloyd Bautista')
  assert.equal(view.version.reviewer.at, new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }), 'the review day on ASPIRE’s clock')
  // Run again: refused until confirmed, then a new version; the old one can no longer be edited.
  await assert.rejects(T.runThemes(w.db, { ...KEY(w), actor: w.owner, complete: stubKeith() }), e => e.code === 'edited')
  const again = await T.runThemes(w.db, { ...KEY(w), actor: w.owner, force: true, complete: stubKeith() })
  assert.equal(again.version, 2)
  await assert.rejects(T.rename(w.db, w.owner, { themeId: pre.id, name: 'Late edit' }), e => e.code === 'old_version')
  assert.equal((await w.pg.query(`SELECT count(*)::int n FROM comment_themes WHERE name = 'Preceptor consistency'`)).rows[0].n, 1, 'the edited version stays in the history')
})

test('leadership: nothing in shadow (the Owner previews), the de-identified cut once ON; the portal needs its own grant', async () => {
  const w = await world()
  await seedFour(w)
  await T.runThemes(w.db, { ...KEY(w), actor: w.owner, complete: stubKeith() })
  const hidden = await T.themesView(w.db, { ...KEY(w), audience: 'leadership' })
  assert.deepEqual([hidden.published, hidden.version, hidden.themes], [false, null, undefined])
  // Nothing accepted yet: no theme reaches leadership, and Other says how many are waiting.
  const unreviewed = await T.themesView(w.db, { ...KEY(w), audience: 'leadership', preview: true })
  assert.deepEqual([unreviewed.themes, unreviewed.other.count, unreviewed.other.pending], [[], 5, 5])
  assert.match(unreviewed.other.note, /5 comments are in themes the ASPIRE team has not reviewed yet/)
  await acceptAll(w)
  const preview = await T.themesView(w.db, { ...KEY(w), audience: 'leadership', preview: true })
  assert.equal(preview.published, false)
  assert.equal(preview.themes[0].name, 'Preceptor support')
  // Ana consented and is de-identified; Ben did not, so his example is withheld and only counted.
  assert.deepEqual(preview.themes[0].quotes, ['My preceptor [name] taught me so much about cardiac care on [unit]'])
  assert.equal(preview.themes[0].quotesWithheld, 1)
  assert.equal(preview.themes.find(t => t.name === 'Scheduling'), undefined, 'two comments: under the floor, folded into Other')
  assert.deepEqual([preview.other.count, preview.other.folded], [2, ['Scheduling']])

  // The portal: a grant without the column's yes is refused; with it, the cut without any ids.
  const grant = await w.one(`INSERT INTO user_role_grants (role) VALUES ('nursing_academic') RETURNING *`)
  const portal = (over = {}) => createAcademicsThemesHandler({ verifyCaller: async () => ({ ok: true, grant, ...over }), makeDb: () => w.db })
  assert.equal((await get(portal(), {})).status, 403)
  assert.equal(await grantHasThemes(w.db, grant.id), false)
  await w.pg.query(`UPDATE user_role_grants SET evaluation_themes_access = 'view' WHERE id = $1`, [grant.id])
  assert.deepEqual((await get(portal(), { probe: '1' })).body, { enabled: true })
  assert.deepEqual((await get(portal(), {})).body, { enabled: true, published: false, cohorts: [] }, 'in shadow the portal lists nothing')
  const shadowCut = await get(portal(), { cohort_id: w.cohort.id, instrument: SLUG, timepoint: 'post_rotation' })
  assert.deepEqual(shadowCut.body.themes, [])

  await w.pg.query(`UPDATE keith_skills SET run_mode = 'on' WHERE slug = 'theme-comments'`)
  const index = (await get(portal(), {})).body
  assert.deepEqual(index.cohorts.map(c => [c.name, c.items]), [['Fall 2026', [{ slug: SLUG, timepoint: 'post_rotation' }]]])
  const cut = (await get(portal(), { cohort_id: w.cohort.id, instrument: SLUG, timepoint: 'post_rotation' })).body
  assert.equal(cut.published, true)
  assert.deepEqual(cut.themes.map(t => [t.name, t.count]), [['Preceptor support', 3]])
  const json = JSON.stringify(cut)
  assert.doesNotMatch(json, /assignment|provenance|"id"|Rosa|4 SCCT|Reyes|every shift/, 'nothing that points back to a response or a person')
  assert.equal((await get(portal(), { cohort_id: 'nope', instrument: SLUG, timepoint: 'post_rotation' })).status, 400)
  // Owner and Admin previewing the portal are admitted without a grant.
  assert.equal((await get(createAcademicsThemesHandler({ verifyCaller: async () => ({ ok: true, staffPreview: true }), makeDb: () => w.db }), { probe: '1' })).status, 200)
  assert.equal(portalShape(null).themes.length, 0)
})

test('the privacy floor is a setting: lowering it to 2 shows Scheduling, with only consented, de-identified quotes', async () => {
  const w = await world({ mode: 'on' })
  await seedFour(w)
  await T.runThemes(w.db, { ...KEY(w), actor: w.owner, complete: stubKeith() })
  await T.setPrivacyFloor(w.db, w.owner, { floor: 2 })
  await acceptAll(w)
  const cut = await T.themesView(w.db, { ...KEY(w), audience: 'leadership' })
  assert.equal(cut.floor, 2)
  assert.deepEqual(cut.themes.map(t => [t.name, t.count]), [['Preceptor support', 3], ['Scheduling', 2]])
  assert.deepEqual(cut.themes[1].quotes, [], 'Ben did not consent, and his is Scheduling’s one example')
  await assert.rejects(T.setPrivacyFloor(w.db, w.owner, { floor: 0 }), e => e.code === 'invalid_floor')
  const { csv } = await T.exportThemes(w.db, { ...KEY(w), instrumentName: 'Student’s Feedback on ASPIRE', timepointLabel: '' })
  assert.match(csv, /"Scheduling","2","40%",""/)
  assert.match(csv, /Themes generated by Keith and reviewed by Jester Lloyd Bautista on /)
  // Renaming an accepted theme reopens it, so it leaves leadership and the export until accepted again.
  const sched = (await T.themesView(w.db, { ...KEY(w) })).themes.find(t => t.name === 'Scheduling')
  await T.rename(w.db, w.owner, { themeId: sched.id, name: 'Schedule changes' })
  const after = await T.themesView(w.db, { ...KEY(w), audience: 'leadership' })
  assert.deepEqual([after.themes.map(t => t.name), after.other.pending], [['Preceptor support'], 2])
  assert.doesNotMatch((await T.exportThemes(w.db, { ...KEY(w), instrumentName: 'X', timepointLabel: '' })).csv, /Schedule changes/)
})

test('the daily run waits for a timepoint to close, runs once, and reads real cohorts only', async () => {
  const w = await world()
  await seedFour(w)
  const waiting = await w.respond('Eve', {}, { status: 'sent' })
  const cron = populationDb(w.db)
  const seen = []
  assert.equal((await T.autoRun(cron, { complete: stubKeith(seen) })).ran, 0, 'one survey still out')
  await w.pg.query(`UPDATE evaluation_assignments SET expires_at = now() - interval '1 day' WHERE id = $1`, [waiting.id])
  const r = await T.autoRun(cron, { complete: stubKeith(seen) })
  assert.equal(r.ran, 1)
  assert.equal((await w.pg.query(`SELECT source FROM comment_theme_versions`)).rows[0].source, 'auto')
  assert.equal((await T.autoRun(cron, { complete: stubKeith(seen) })).ran, 0, 'nothing new: no second version')
  // A demo cohort, closed and full of comments, is never read.
  const demo = await w.one(`INSERT INTO cohorts (name, is_demo) VALUES ('Demo', true) RETURNING *`)
  await w.respond('Zed', { most_valuable_part: 'Demo preceptor comment' }, { c: demo, demo: true })
  assert.equal((await T.autoRun(cron, { complete: stubKeith(seen) })).ran, 0)
  assert.ok(!seen.some(s => /Demo preceptor/.test(s.messages[0].content)))
  await w.pg.query(`UPDATE keith_skills SET enabled = false WHERE slug = 'theme-comments'`)
  assert.equal((await T.autoRun(cron, { complete: stubKeith() })).mode, 'off')
})

test('/api/keith-comment-themes: Owner and Admin only; sharing and the floor are the Owner’s; strict bodies', async () => {
  const w = await world()
  await seedFour(w)
  const as = (profile) => createCommentThemesHandler({ verifyCaller: async () => ({ authenticated: true, profile }), makeDb: () => w.db, complete: stubKeith() })
  const body = { action: 'view', cohort_id: w.cohort.id, instrument: SLUG, timepoint: 'post_rotation' }
  for (const p of [w.owner, w.admin]) assert.equal((await call(as(p), body)).status, 200, p.role)
  for (const p of [{ id: 'i', role: 'interviewer' }, { id: 'c', role: 'co-lead' }]) assert.equal((await call(as(p), body)).status, 403, p.role)
  const run = await call(as(w.admin), { ...body, action: 'run' })
  assert.deepEqual([run.status, run.body.version], [200, 1])
  assert.equal((await call(as(w.admin), { action: 'set_mode', mode: 'on' })).status, 403)
  assert.equal((await call(as(w.admin), { action: 'set_floor', floor: 4 })).status, 403)
  assert.equal((await call(as(w.owner), { action: 'set_floor', floor: 4 })).status, 200)
  const on = await call(as(w.owner), { action: 'set_mode', mode: 'on' })
  assert.deepEqual([on.status, on.body.to], [200, 'on'])
  assert.equal((await call(as(w.owner), { ...body, extra: 1 })).status, 400)
  assert.equal((await call(as(w.owner), { ...body, instrument: 'mystery' })).status, 400)
  assert.equal((await call(as(w.owner), { action: 'move', version_id: w.cohort.id, comment_id: 'x1' })).status, 400)
  const exp = await call(as(w.owner), { ...body, action: 'export' })
  assert.ok(exp.body.csv.startsWith('﻿') && exp.body.fileName === 'aspire_comment_themes_post_rotation_evaluation_post_rotation.csv')
})

test('where it shows: Responses for Owner and Admin, the portal tab and the grant checkbox for the Owner', () => {
  const tab = read('src/components/EvaluationTab.jsx')
  assert.match(tab, /\{\(isOwner \|\| isAdmin\) && \(\s*<CommentThemes/)
  const nav = read('src/portal/na/NursingAcademicsChrome.jsx')
  assert.match(nav, /\.\.\.\(themesEnabled \? \[EVALUATION_SECTION\] : \[\]\)/)
  const app = read('src/portal/PortalApp.jsx')
  assert.match(app, /fetchAcademicsEvaluationThemes\(\{ probe: '1' \}\)\.then\(r => \{ if \(live\) setNaThemesEnabled\(!!\(r\.ok && r\.data\?\.enabled\)\) \}\)/)
  const modal = read('src/components/settings/GrantPortalAccessModal.jsx')
  assert.match(modal, /if \(role === 'nursing_academic' && isOwner\) base\.evaluation_themes_access = themesAccess/)
  const invite = read('api/invite-portal-user.js')
  assert.match(invite, /themesAccess != null && !auth\.isOwner/)
  assert.match(read('vercel.json'), /"\/api\/cron\/keith-comment-themes"/)
})

function call(handler, body) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.statusCode = c; return this }, json(b) { resolve({ status: this.statusCode, body: b }); return this }, end() { resolve({ status: this.statusCode }); return this } }
    handler({ method: 'POST', headers: {}, body }, res)
  })
}
function get(handler, query) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.statusCode = c; return this }, json(b) { resolve({ status: this.statusCode, body: b }); return this }, end() { resolve({ status: this.statusCode }); return this } }
    handler({ method: 'GET', headers: {}, query }, res)
  })
}
