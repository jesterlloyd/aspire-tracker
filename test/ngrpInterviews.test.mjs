// NGRP-INTERVIEWS-1 Phase 1: the NGRP rubric (from the Owner's scoring sheet) and its tables.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import {
  NGRP_DOMAINS, SCORE_LEGEND, RECOMMENDATIONS, COMPOSITE_RANGES, compositeOf, rangeFor, closerLookDomains,
  missingForComplete, panelSummary, validateRubricSave, questionText,
} from '../src/lib/ngrp/ngrpRubric.js'
import { NGRP_AUDIT_EVENTS } from '../lib/server/ngrpAudit.js'
import { EVENT_LABELS } from '../src/lib/ngrp/residencyActivityModel.js'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const MIG = read('supabase/migrations/20261111000000_ngrp_interviews.sql')

test('RUBRIC 1: the sheet, as written: three domains, five questions each, a 1 to 5 legend, three recommendations', () => {
  assert.deepEqual(NGRP_DOMAINS.map(d => d.title), ['Clinical Judgment', 'Professional Presence', 'Goal Alignment'])
  for (const d of NGRP_DOMAINS) assert.equal(d.questions.length, 5)
  assert.deepEqual(SCORE_LEGEND.map(s => s.label), ['Not Yet Ready', 'Emerging', 'Competent', 'Strong', 'Highly Aligned / Practice-Ready'])
  assert.deepEqual(RECOMMENDATIONS.map(r => r.label), ['Recommend', 'Recommend with Reservations', 'Do Not Recommend at This Time'])
  const keys = NGRP_DOMAINS.flatMap(d => d.questions.map(q => q.key))
  assert.equal(new Set(keys).size, keys.length, 'question keys are unique')
  assert.equal(questionText('pp', 'other', 'Tell me about a code'), 'Other: Tell me about a code')
})

test('RUBRIC 2: composite, ranges and the closer look follow the sheet', () => {
  assert.equal(compositeOf({ cj_score: 5, pp_score: 4, ga_score: 4 }), 13)
  assert.equal(compositeOf({ cj_score: 5, pp_score: 4 }), null)
  assert.deepEqual([15, 13, 12, 10, 9, 7, 6, 3].map(c => rangeFor(c).recommendation),
    ['recommend', 'recommend', 'recommend', 'recommend', 'recommend_with_reservations', 'recommend_with_reservations', 'do_not_recommend', 'do_not_recommend'])
  assert.equal(rangeFor(12.5).label, 'Strong / Competent')
  assert.equal(COMPOSITE_RANGES.length, 4)
  assert.deepEqual(closerLookDomains({ cj_score: 2, pp_score: 5, ga_score: 1 }), ['cj', 'ga'])
  assert.deepEqual(missingForComplete({ cj_score: 3 }), ['Professional Presence score', 'Goal Alignment score', 'Recommendation'])
})

test('RUBRIC 3: the panel averages composites (the sheet\'s worked example) and flags divergence', () => {
  const r = (cj, pp, ga, rec = 'recommend') => ({ status: 'completed', cj_score: cj, pp_score: pp, ga_score: ga, individual_recommendation: rec })
  const p = panelSummary([r(5, 4, 4), r(4, 4, 4), r(5, 5, 4), { status: 'in_progress', cj_score: 1, pp_score: 1, ga_score: 1 }])
  assert.equal(p.count, 3, 'only completed rubrics count')
  assert.equal(p.average, 13, 'composites of 13, 12 and 14 average to 13.0')
  assert.equal(p.recommendation, 'recommend')
  assert.equal(p.diverged, false)
  assert.equal(panelSummary([r(5, 5, 5), r(4, 3, 3)]).diverged, true, '15 and 10 are 4 or more apart')
  assert.equal(panelSummary([r(4, 4, 4), r(4, 4, 4, 'recommend_with_reservations')]).diverged, true, 'a split recommendation')
  assert.deepEqual(panelSummary([r(2, 5, 5)]).closerLook, ['cj'])
  assert.equal(panelSummary([]).average, null)
})

test('RUBRIC 4: the server check refuses a bad score or question and an incomplete "completed"', () => {
  assert.equal(validateRubricSave({ cj_score: 6 }).ok, false)
  assert.equal(validateRubricSave({ cj_question: 'zz9' }).ok, false)
  assert.deepEqual(validateRubricSave({ cj_question: 'cj2', cj_score: '4' }).fields, { cj_question: 'cj2', cj_score: 4 })
  const incomplete = validateRubricSave({ status: 'completed' }, { cj_score: 3, pp_score: 3 })
  assert.equal(incomplete.ok, false)
  assert.ok(validateRubricSave({ status: 'completed', ga_score: 3, individual_recommendation: 'recommend' }, { cj_score: 3, pp_score: 3 }).ok)
})

test('MIGRATION 1: the audit CHECK equals the code\'s list, and every type has words', () => {
  const check = MIG.slice(MIG.indexOf('CHECK (event_type IN ('), MIG.indexOf("));", MIG.indexOf('CHECK (event_type IN (')))
  const inSql = [...check.replace(/--[^\n]*/g, '').matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort()
  assert.deepEqual(inSql, [...NGRP_AUDIT_EVENTS].sort())
  for (const t of NGRP_AUDIT_EVENTS) assert.ok(EVENT_LABELS[t], `${t} has a label`)
  assert.match(MIG, /'recommend', 'recommend_with_reservations', 'do_not_recommend'/)
})

test('MIGRATION 2: on real Postgres: one rubric per interviewer, a generated composite, complete means complete, one booking per applicant', async () => {
  const db = new PGlite()
  await db.exec(`
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE TABLE public.user_profiles (id uuid PRIMARY KEY);
    CREATE TABLE public.ngrp_cycles (id uuid PRIMARY KEY);
    CREATE TABLE public.ngrp_candidates (id uuid PRIMARY KEY, cycle_id uuid);
    CREATE TABLE public.ngrp_audit_events (id serial PRIMARY KEY, event_type text CONSTRAINT ngrp_audit_events_event_type_check CHECK (event_type IN ('form_sent')));
    INSERT INTO public.user_profiles VALUES ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
    INSERT INTO public.ngrp_cycles VALUES ('00000000-0000-4000-8000-0000000000c1');
    INSERT INTO public.ngrp_candidates VALUES ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1'), ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000c1');
  `)
  await db.exec(MIG.replace(/NOTIFY pgrst[^;]*;/g, ''))
  const C = "'00000000-0000-4000-8000-0000000000c1'", A1 = "'00000000-0000-4000-8000-0000000000a1'", A2 = "'00000000-0000-4000-8000-0000000000a2'"
  const P1 = "'00000000-0000-4000-8000-000000000001'", P2 = "'00000000-0000-4000-8000-000000000002'"
  const ins = (cand, prof, extra = '', vals = '') => db.exec(`INSERT INTO public.ngrp_interview_rubrics (cycle_id, candidate_id, unit_key, interviewer_profile_id, interviewer_name${extra}) VALUES (${C}, ${cand}, '6 NE', ${prof}, 'Dana'${vals})`)
  await ins(A1, P1, ', cj_score, pp_score, ga_score', ', 5, 4, 4')
  const { rows } = await db.query('SELECT composite_score FROM public.ngrp_interview_rubrics')
  assert.equal(rows[0].composite_score, 13, 'the composite is generated from the three scores')
  await assert.rejects(ins(A1, P1), /duplicate key|unique/i, 'a second rubric by the same interviewer for the same applicant is refused')
  await ins(A1, P2)
  await assert.rejects(ins(A2, P1, ", status, completed_at", ", 'completed', now()"), /chk_ngrp_interview_rubric_complete/, 'completed needs every score and a recommendation')
  await db.exec(`INSERT INTO public.ngrp_interview_blocks (id, cycle_id, unit_key, block_date, start_time, end_time, duration_minutes, created_by_profile_id) VALUES ('00000000-0000-4000-8000-0000000000b1', ${C}, '6 NE', '2026-12-10', '09:00', '12:00', 30, ${P1})`)
  const slot = (id, at) => db.exec(`INSERT INTO public.ngrp_interview_slots (id, block_id, cycle_id, unit_key, slot_at, duration_minutes) VALUES ('${id}', '00000000-0000-4000-8000-0000000000b1', ${C}, '6 NE', '${at}', 30)`)
  await slot('00000000-0000-4000-8000-0000000000d1', '2026-12-10T17:00:00Z')
  await slot('00000000-0000-4000-8000-0000000000d2', '2026-12-10T17:30:00Z')
  const book = id => db.exec(`UPDATE public.ngrp_interview_slots SET status = 'booked', booked_candidate_id = ${A1}, booked_at = now() WHERE id = '${id}'`)
  await book('00000000-0000-4000-8000-0000000000d1')
  await assert.rejects(book('00000000-0000-4000-8000-0000000000d2'), /duplicate key|unique/i, 'one booked slot per applicant per cohort')
  await assert.rejects(db.exec(`UPDATE public.ngrp_interview_slots SET status = 'booked' WHERE id = '00000000-0000-4000-8000-0000000000d2'`), /chk_ngrp_interview_slot_booking/)
  await db.exec("INSERT INTO public.ngrp_audit_events (event_type) VALUES ('interview_booked')")
  await assert.rejects(db.exec("INSERT INTO public.ngrp_audit_events (event_type) VALUES ('not_a_type')"), /check/i)
  await db.close()
})

// ── Phase 2: results in the binder ───────────────────────────────────────────
import { loadPanelSummaries } from '../lib/server/ngrpInterviewRubrics.js'
import { buildResidencyCsv } from '../lib/server/ngrpResidencyExport.js'

const fakeDb = (rows, error = null) => ({ from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: rows, error }) }) }) })

test('PHASE 2 1: the roster carries each applicant\'s panel, and a missing table is "not enabled"', async () => {
  const c = (cand, cj, pp, ga, rec, status = 'completed') => ({ candidate_id: cand, status, cj_score: cj, pp_score: pp, ga_score: ga, individual_recommendation: rec })
  const r = await loadPanelSummaries(fakeDb([c('a', 5, 4, 4, 'recommend'), c('a', 4, 4, 4, 'recommend'), c('a', 1, 1, 1, null, 'in_progress'), c('b', 3, 2, 3, 'recommend_with_reservations')]), 'cy')
  assert.equal(r.provisioned, true)
  assert.deepEqual(r.byCandidate.get('a'), { completed: 2, in_progress: 1, average: 12.5, recommendation: 'recommend', range: 'Strong / Competent', diverged: false, closer_look: [] })
  assert.deepEqual(r.byCandidate.get('b').closer_look, ['pp'])
  const missing = await loadPanelSummaries(fakeDb(null, { code: '42P01', message: 'relation does not exist' }), 'cy')
  assert.equal(missing.provisioned, false)
})

test('PHASE 2 2: the binder, the board and the CSV read the panel; the roster never fails for it', () => {
  const lib = read('lib/server/ngrpApplicants.js')
  assert.match(lib, /try \{\s*const p = await loadPanelSummaries\(db, cycleId\)/)
  assert.match(lib, /rubricsProvisioned: panels\.provisioned === true/)
  assert.match(read('api/ngrp-workspace.js'), /if \(action === 'rubrics'\)/)
  assert.match(read('src/components/ngrp/InterviewBoard.jsx'), /data-testid="interviewee-panel-chip"/)
  const csv = buildResidencyCsv({
    cycle: { name: 'W27' }, students: [{ id: 's1', first_name: 'A', last_name: 'B', status: 'Completed' }],
    candidates: [{ id: 'c1', student_id: 's1', interview_panel: { completed: 2, average: 12.5, recommendation: 'recommend' } }],
    revisionsByAssignment: new Map(),
  }).csv
  const [head, row] = csv.replace(/^﻿/, '').split(/\r?\n/)
  const cols = head.split(','), cells = row.split(',')
  assert.equal(cells[cols.indexOf('Panel Composite')], '12.5')
  assert.equal(cells[cols.indexOf('Panel Recommendation')], 'Recommend')
  assert.equal(cells[cols.indexOf('Rubrics Completed')], '2')
})
