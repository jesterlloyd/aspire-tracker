// UL-CHOICE-WORDS-1 (Owner, 2026-10-07): unit leaders see the Preceptor's Assessment answers as
// words. Only the question's own fixed phrases pass, in the database and on the server; a typed
// comment or an unknown word never does.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CHOICE_OPTIONS, QUANTITATIVE_PATHS } from '../lib/server/unitEvaluations/config.js'
import { sanitizeQuantitative, sanitizeChoiceCounts, serializeUnitLeaderEvaluations, assertUnitLeaderShape, leaderSeesFromResponses } from '../lib/server/unitEvaluations/serialize.js'
import { SHIFTS_OBSERVED_OPTIONS, TRANSITION_READINESS_OPTIONS, ENDORSEMENT_OPTIONS } from '../lib/server/evaluation/preceptor_progress_validation.js'
import { fmtMetric } from '../src/lib/unitEvaluationDisplay.js'
import { leaderSees } from '../src/lib/evaluation/moderationStacks.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const SQL = read('supabase/migrations/20261113000000_ul_eval_choice_answers.sql')
const TR = 'readiness_endorsement.transition_readiness'

test('the phrase lists are the instrument\'s own, on allowlisted paths, and the migration seeds them word for word', () => {
  assert.equal(CHOICE_OPTIONS['developmental_feedback.context.shifts_observed'], SHIFTS_OBSERVED_OPTIONS)
  assert.equal(CHOICE_OPTIONS[TR], TRANSITION_READINESS_OPTIONS)
  assert.equal(CHOICE_OPTIONS['readiness_endorsement.unit_endorsement_consideration'], ENDORSEMENT_OPTIONS)
  for (const path of Object.keys(CHOICE_OPTIONS)) {
    assert.ok(QUANTITATIVE_PATHS.preceptor_progress.includes(path), `${path} is an allowlisted path`)
    const [section, ...rest] = path.split('.')
    const seed = SQL.match(new RegExp(`ARRAY\\['${section}', '${rest.join("', '")}'\\],\\s*ARRAY\\[([^\\]]+)\\]`))
    assert.ok(seed, `${path} is seeded`)
    const words = [...seed[1].matchAll(/'([^']+)'/g)].map(m => m[1])
    assert.deepEqual(words, [...CHOICE_OPTIONS[path]], `${path} seeds the same phrases`)
  }
})

test('the database passes a string only when it equals a listed phrase, and changes no release predicate', () => {
  assert.match(SQL, /jsonb_typeof\(w\.val\) = 'string'\s+AND \(w\.val #>> '\{\}'\) = ANY \(c\.allowed_values\)/)
  assert.match(SQL, /CREATE OR REPLACE FUNCTION public\._ul_eval_safe_quantitative\(p_slug text, p_responses jsonb\)/)
  assert.match(SQL, /AND rel\.free_text_visible = false/)
  assert.match(SQL, /'choice_counts', COALESCE/)
  assert.match(SQL, /chk_uck_safe_section/)
  assert.doesNotMatch(SQL, /FUNCTION public\.ul_eval_response_list/, 'the list function is untouched')
  assert.match(SQL, /^BEGIN;[\s\S]*COMMIT;/m)
})

test('the server keeps a listed phrase, drops typed text, and fails closed on anything else', () => {
  const q = sanitizeQuantitative('preceptor_progress', {
    [TR]: 'Progressing appropriately for student level',
    'readiness_endorsement.unit_endorsement_consideration': 'He was great, call me',
    'readiness_endorsement.cedars_consideration_recommendation': 'Yes, enthusiastically',
  })
  assert.deepEqual(q, { [TR]: 'Progressing appropriately for student level', 'readiness_endorsement.cedars_consideration_recommendation': 'Yes, enthusiastically' })
  assert.deepEqual(sanitizeQuantitative('student_preceptor_eval', { [TR]: 'Yes' }), {}, 'another instrument\'s path never passes')
  assert.deepEqual(sanitizeChoiceCounts('preceptor_progress', { [TR]: { 'Unable to assess': 2, 'made up': 4, 'Not yet demonstrating expected readiness': 0 } }), { [TR]: { 'Unable to assess': 2 } })
  const payload = serializeUnitLeaderEvaluations({ instrument: 'preceptor_progress', summary: { released_response_count: 1, choice_counts: { [TR]: { 'Unable to assess': 1 } } }, list: [{ quantitative: q }] })
  assert.doesNotThrow(() => assertUnitLeaderShape(payload))
  const leak = structuredClone(payload); leak.responses[0].quantitative[TR] = 'typed comment'
  assert.throws(() => assertUnitLeaderShape(leak), /text/)
  const leak2 = structuredClone(payload); leak2.choice_counts[TR] = { 'typed comment': 1 }
  assert.throws(() => assertUnitLeaderShape(leak2), /choices:word/)
  const leak3 = structuredClone(payload); leak3.quantitative_averages[TR] = 'Unable to assess'
  assert.throws(() => assertUnitLeaderShape(leak3))
})

test('staff and leaders see the same phrase', () => {
  const sees = leaderSeesFromResponses('preceptor_progress', { readiness_endorsement: { transition_readiness: 'Unable to assess', unit_endorsement_consideration: 'free text' } })
  assert.deepEqual(sees, { [TR]: 'Unable to assess' })
  assert.deepEqual(leaderSees({ instrument_slug: 'preceptor_progress', leader_sees: sees }).map(m => m.text), ['Transition Readiness: Unable to assess'])
  assert.equal(fmtMetric('Yes'), 'Yes')
  assert.equal(fmtMetric(4), '4')
  assert.match(read('src/portal/unit/UnitEvaluationsWorkspace.jsx'), /Preceptor Answers/)
})

test('the migration runs on Postgres and shows only listed phrases to a unit leader', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = new PGlite()
  await pg.exec(`
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE FUNCTION public.is_active_owner_or_admin() RETURNS boolean LANGUAGE sql AS $f$ SELECT false $f$;
    CREATE FUNCTION public.has_active_role_grant(text) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
    CREATE FUNCTION public.my_unit_scope_keys() RETURNS TABLE (unit_key text, cohort_id uuid) LANGUAGE sql AS $f$ SELECT '6 NE'::text, NULL::uuid $f$;
    CREATE TABLE public.evaluation_unit_quantitative_keys (instrument_slug text, json_path text[], label text, PRIMARY KEY (instrument_slug, json_path));
    INSERT INTO evaluation_unit_quantitative_keys VALUES ('preceptor_progress', ARRAY['readiness_endorsement','transition_readiness'], 't'),
      ('preceptor_progress', ARRAY['readiness_endorsement','unit_endorsement_consideration'], 'u');
    CREATE TABLE public.evaluation_responses (id uuid PRIMARY KEY, responses jsonb);
    CREATE TABLE public.evaluation_response_unit_release (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), response_id uuid, instrument_slug text, timepoint text,
      hist_unit_key text, hist_cohort_id uuid, hist_preceptor_id uuid, unit_leader_eligible_at timestamptz, snapshot_source text,
      release_state text, moderation_state text, quantitative_visible boolean, free_text_visible boolean);
    INSERT INTO evaluation_responses VALUES
      ('00000000-0000-4000-8000-000000000001', '{"readiness_endorsement":{"transition_readiness":"Unable to assess","unit_endorsement_consideration":"typed comment"}}'),
      ('00000000-0000-4000-8000-000000000002', '{"readiness_endorsement":{"transition_readiness":"Unable to assess","unit_endorsement_consideration":"Yes"}}');
    INSERT INTO evaluation_response_unit_release (response_id, instrument_slug, timepoint, hist_unit_key, hist_preceptor_id, unit_leader_eligible_at, snapshot_source, release_state, moderation_state, quantitative_visible, free_text_visible)
      SELECT id, 'preceptor_progress', 'post_rotation', '6 NE', gen_random_uuid(), now() - interval '1 day', 'submission_trigger', 'released', 'cleared', true, false FROM evaluation_responses;`)
  await pg.exec(SQL.replace(/NOTIFY pgrst[^;]*;/, ''))
  const one = async q => (await pg.query(q)).rows[0]
  const safe = (await one(`SELECT public._ul_eval_safe_quantitative('preceptor_progress', responses) AS q FROM evaluation_responses WHERE id = '00000000-0000-4000-8000-000000000001'`)).q
  assert.deepEqual(safe, { [TR]: 'Unable to assess' }, 'the typed comment is dropped')
  const sum = (await one(`SELECT public.ul_eval_dashboard_summary('preceptor_progress') AS s`)).s
  assert.equal(sum.released_response_count, 2)
  assert.deepEqual(sum.choice_counts, { [TR]: { 'Unable to assess': 2 }, 'readiness_endorsement.unit_endorsement_consideration': { Yes: 1 } })
  assert.deepEqual(sum.quantitative_averages, {})
  await pg.close()
})
