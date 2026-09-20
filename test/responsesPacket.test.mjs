// test/responsesPacket.test.mjs
//
// RESPONSES-PACKET-1 (2026-09-19): Evaluation > Responses as a printed results packet.
// The model is pure, so every number the sheet prints is asserted here without a browser;
// the source assertions hold the parts of the spec that live in CSS and markup.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  PACKET_INSTRUMENTS, PACKET_SLUGS, TIMEPOINT_LABELS,
  effectiveStatus, statusGroup, statusPill,
  buildInstrumentTabs, buildBasis, buildDistribution, buildFollowUp,
  buildRosterRows, rosterColumns, rosterSortValue, buildBubbleSheet, buildPacket, statusDate,
  subscaleMean, bandOf, segmentText, LICENSED_NOTE, ITEM_NOT_OUTCOME_NOTE, LIKERT_BANDS, LIKERT_NOTE,
} from '../src/lib/evaluation/responsesPacketModel.js'
import { buildCaseyFinkComparison, caseyFinkResponsesByStudent } from '../src/lib/evaluation/caseyFinkComparison.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')

const NOW = Date.parse('2026-09-19T12:00:00Z')

// ── Fixtures ──────────────────────────────────────────────────────────────────

let seq = 0
function student(id, over = {}) {
  return { id, first_name: `First${id}`, preferred_first_name: null, last_name: `Last${id}`, school: 'Cal State Long Beach', program_type: 'Accelerated BSN', ...over }
}
function cf({ sid, tp, cps, la, pr, items = {}, status = 'completed', submitted = '2026-09-01T12:00:00Z', expires = null }) {
  const answers = {}
  for (let i = 1; i <= 15; i++) answers[`S1_Q${String(i).padStart(2, '0')}`] = 3
  Object.assign(answers, items)
  return {
    id: `cf-${++seq}`, timepoint: tp, status, expires_at: expires, sent_at: '2026-08-20T12:00:00Z',
    respondent_type: 'student', respondent_name: null,
    students: student(sid),
    evaluation_instruments: { slug: 'casey_fink_readiness_2024', display_name: 'Casey-Fink Readiness for Practice Survey' },
    evaluation_responses: status === 'completed' ? [{
      submitted_at: submitted, responses: answers,
      score_s1_clinical_problem_solving: cps, score_s1_learning_activities: la, score_s1_practice_readiness: pr,
    }] : [],
  }
}
function pp({ sid, ratings, status = 'completed', tp = 'post_rotation', name = 'R. Sanchez' }) {
  const competency = {}
  for (const [k, v] of Object.entries(ratings)) competency[k] = { rating: v }
  return {
    id: `pp-${++seq}`, timepoint: tp, status, expires_at: null, sent_at: '2026-08-20T12:00:00Z',
    respondent_type: 'preceptor', respondent_name: name,
    students: student(sid),
    evaluation_instruments: { slug: 'preceptor_progress', display_name: 'Preceptor Student Readiness' },
    evaluation_responses: status === 'completed' ? [{ submitted_at: '2026-09-02T12:00:00Z', responses: { developmental_feedback: { competency } } }] : [],
  }
}
function sf({ sid, ps, status = 'completed' }) {
  return {
    id: `sf-${++seq}`, timepoint: 'post_rotation', status, expires_at: null, sent_at: '2026-08-20T12:00:00Z',
    respondent_type: 'student', respondent_name: null,
    students: student(sid),
    evaluation_instruments: { slug: 'student_preceptor_eval', display_name: 'Student Feedback' },
    evaluation_responses: status === 'completed' ? [{ submitted_at: '2026-09-03T12:00:00Z', responses: {
      preceptor_support: { approachable_available: ps[0], clear_explanations: ps[1], useful_feedback: ps[2], skill_development: ps[3], preceptor_support_comment: 'x' },
      learning_environment: { included_in_care: 4, welcoming_unit: 4, practice_opportunities: 4, workflow_supported_learning: 4 },
      psychological_safety: { comfortable_questions: 5, comfortable_speaking_up: 5, comfortable_raising_concerns: 5, treated_with_respect: 5 },
      overall_experience: { valuable_experience: 5, would_recommend: 4, overall_rating: 5 },
    } }] : [],
  }
}
function ap({ sid, r, status = 'completed' }) {
  return {
    id: `ap-${++seq}`, timepoint: 'post_rotation', status, expires_at: null, sent_at: '2026-08-20T12:00:00Z',
    respondent_type: 'student', respondent_name: null,
    students: student(sid),
    evaluation_instruments: { slug: 'post_rotation_evaluation', display_name: 'ASPIRE Post-Rotation Evaluation' },
    evaluation_responses: status === 'completed' ? [{ submitted_at: '2026-09-04T12:00:00Z', responses: {
      overall_valuable_learning_experience: r, confidence_clinical_setting: r, readiness_transition_to_practice: r,
      supportive_learning_environment: r, included_as_care_team: r, increased_interest_cedars_sinai: r, understand_new_grad_expectations: r,
    } }] : [],
  }
}

const COHORT = [
  // Three matched students: CPS up, up, down; LA same for all; PR up for all.
  cf({ sid: 'a', tp: 'baseline',      cps: 3.00, la: 3.40, pr: 3.00, items: { S1_Q01: 2, S1_Q12: 2 } }),
  cf({ sid: 'a', tp: 'post_rotation', cps: 3.50, la: 3.40, pr: 3.75, items: { S1_Q01: 4, S1_Q12: 3 } }),
  cf({ sid: 'b', tp: 'early_rotation_baseline', cps: 2.50, la: 3.00, pr: 3.25 }),
  cf({ sid: 'b', tp: 'post_rotation', cps: 3.00, la: 3.00, pr: 3.50 }),
  cf({ sid: 'c', tp: 'baseline',      cps: 3.67, la: 3.60, pr: 3.00 }),
  cf({ sid: 'c', tp: 'post_rotation', cps: 3.33, la: 3.60, pr: 4.00 }),
  // Baseline only, post only, an awaiting post, an expired post, a revoked pre.
  cf({ sid: 'd', tp: 'baseline',      cps: 3, la: 3, pr: 3 }),
  cf({ sid: 'e', tp: 'post_rotation', cps: 3, la: 3, pr: 3 }),
  cf({ sid: 'd', tp: 'post_rotation', status: 'sent', expires: '2026-12-01T00:00:00Z' }),
  cf({ sid: 'f', tp: 'post_rotation', status: 'opened', expires: '2026-09-01T00:00:00Z' }),
  cf({ sid: 'g', tp: 'baseline',      status: 'revoked' }),
  // Preceptor: two completed, one awaiting.
  pp({ sid: 'a', ratings: { clinical_judgment: 5, patient_centered_care: 4, safety_quality: 3, teamwork_communication_collaboration: 2, professionalism_accountability: 5, advanced_beginner_readiness: 4 } }),
  pp({ sid: 'b', ratings: { clinical_judgment: 4, patient_centered_care: 4, safety_quality: 4, teamwork_communication_collaboration: 3, professionalism_accountability: 3, advanced_beginner_readiness: 2 }, tp: 'midpoint' }),
  pp({ sid: 'c', ratings: {}, status: 'sent' }),
  // Student feedback: one with an n/a answer.
  sf({ sid: 'a', ps: [5, 5, 'na', 4] }),
  sf({ sid: 'b', ps: [2, 3, 3, 2] }),
  // ASPIRE feedback.
  ap({ sid: 'a', r: 5 }),
  ap({ sid: 'b', r: 3 }),
  ap({ sid: 'c', r: 2, status: 'sent' }),
]

const CF = PACKET_INSTRUMENTS[0]
const PP = PACKET_INSTRUMENTS[1]
const SF = PACKET_INSTRUMENTS[2]
const AP = PACKET_INSTRUMENTS[3]

// ── A1: names ─────────────────────────────────────────────────────────────────

test('four instruments carry the corrected names, in order, and Casey-Fink stays one instrument', () => {
  assert.deepEqual(PACKET_SLUGS, ['casey_fink_readiness_2024', 'preceptor_progress', 'student_preceptor_eval', 'post_rotation_evaluation'])
  assert.deepEqual(PACKET_INSTRUMENTS.map(i => i.name), [
    'Casey-Fink Readiness for Practice',
    "Preceptor's Assessment of Student Readiness",
    "Student's Feedback on Unit and Preceptor",
    "Student's Feedback on ASPIRE",
  ])
  assert.equal(CF.paired, true)
  assert.equal(CF.timepointsLabel, 'Pre-Rotation and Post-Rotation')
  for (const i of PACKET_INSTRUMENTS.slice(1)) assert.equal(i.paired, false, `${i.slug} is single-timepoint`)
  // Review & Release still lists the two Casey-Fink timepoints as two workflows.
  const catalog = read('src/lib/evaluation/surveyCatalog.js')
  assert.match(catalog, /key: 'caseyFinkPreRotation'/)
  assert.match(catalog, /key: 'caseyFinkPostRotation'/)
})

test('the tabs count completed of assigned per instrument, across all timepoints', () => {
  const tabs = buildInstrumentTabs(COHORT, NOW)
  assert.deepEqual(tabs.map(t => [t.slug, t.completed, t.assigned, t.pct]), [
    ['casey_fink_readiness_2024', 8, 11, 73],
    ['preceptor_progress', 2, 3, 67],
    ['student_preceptor_eval', 2, 2, 100],
    ['post_rotation_evaluation', 2, 3, 67],
  ])
})

// ── A2: the basis line ────────────────────────────────────────────────────────

test('effective status reads a sent or opened invitation past its expiry as expired', () => {
  assert.equal(effectiveStatus({ status: 'opened', expires_at: '2026-09-01T00:00:00Z' }, NOW), 'expired')
  assert.equal(effectiveStatus({ status: 'sent', expires_at: '2026-12-01T00:00:00Z' }, NOW), 'sent')
  assert.equal(effectiveStatus({ status: 'completed', expires_at: '2026-09-01T00:00:00Z' }, NOW), 'completed')
  assert.equal(statusGroup('reminder_due'), 'awaiting')
  assert.equal(statusGroup('non_responder'), 'awaiting')
  assert.deepEqual(statusPill('completed'), { tone: 'ok', label: 'Completed' })
  assert.deepEqual(statusPill('expired'), { tone: 'off', label: 'Expired' })
})

test('paired basis: Assigned, Completed, Awaiting, Matched pairs, Baseline only, Post only, with the right tones', () => {
  const p = buildPacket(COHORT, CF.slug, { now: NOW })
  const by = Object.fromEntries(p.basis.map(b => [b.label, b]))
  assert.equal(by.Assigned.value, 11);        assert.equal(by.Assigned.tone, 'key')
  assert.equal(by.Completed.value, 8);        assert.equal(by.Completed.tone, '')
  assert.equal(by.Awaiting.value, 1);         assert.equal(by.Awaiting.tone, 'warn')
  assert.equal(by['Matched pairs'].value, 3); assert.equal(by['Matched pairs'].tone, 'key')
  assert.equal(by['Baseline only'].value, 1); assert.equal(by['Baseline only'].tone, 'warn')
  assert.equal(by['Post only'].value, 1);     assert.equal(by['Post only'].tone, '')
  // Expired and revoked are appended only because they are nonzero here.
  assert.equal(by.Expired.value, 1);          assert.equal(by.Expired.tone, 'warn')
  assert.equal(by.Revoked.value, 1);          assert.equal(by.Revoked.tone, '')
  const noExtras = buildBasis(CF, COHORT.slice(0, 6), buildCaseyFinkComparison(COHORT.slice(0, 6)), NOW)
  assert.deepEqual(noExtras.map(b => b.label), ['Assigned', 'Completed', 'Awaiting', 'Matched pairs', 'Baseline only', 'Post only'])
  // A zero is muted whatever it would otherwise be.
  assert.equal(noExtras.find(b => b.label === 'Awaiting').tone, 'zero')
  assert.equal(noExtras.find(b => b.label === 'Baseline only').tone, 'zero')
})

test('single-timepoint basis: Assigned, Completed, Awaiting, Scored, Expired, Revoked', () => {
  const p = buildPacket(COHORT, PP.slug, { now: NOW })
  assert.deepEqual(p.basis.map(b => [b.label, b.value, b.tone]), [
    ['Assigned', 3, 'key'], ['Completed', 2, ''], ['Awaiting', 1, 'warn'],
    ['Scored', 2, 'key'], ['Expired', 0, 'zero'], ['Revoked', 0, 'zero'],
  ])
})

// ── A3: distribution first ────────────────────────────────────────────────────

test('paired distribution: up, same, down and net per subscale over matched pairs; means and delta secondary', () => {
  const d = buildPacket(COHORT, CF.slug, { now: NOW }).distribution
  assert.equal(d.paired, true)
  assert.equal(d.total, 3)
  assert.match(d.subtitle, /3 paired students/)
  const cps = d.subscales.find(s => s.key === 'clinical_problem_solving')
  assert.deepEqual([cps.up, cps.same, cps.down, cps.net, cps.total], [2, 0, 1, 1, 3])
  assert.ok(Math.abs(cps.preMean - (3 + 2.5 + 3.67) / 3) < 1e-9)
  assert.ok(Math.abs(cps.delta - ((3.5 + 3 + 3.33) - (3 + 2.5 + 3.67)) / 3) < 1e-9)
  const la = d.subscales.find(s => s.key === 'learning_activities')
  assert.deepEqual([la.up, la.same, la.down, la.net], [0, 3, 0, 0])
  const pr = d.subscales.find(s => s.key === 'practice_readiness')
  assert.deepEqual([pr.up, pr.same, pr.down, pr.net], [3, 0, 0, 3])
  assert.deepEqual(d.labels, { up: 'higher post score', same: 'no change', down: 'lower post score' })
  assert.equal(segmentText(cps.up, cps.total, d.labels.up), '2 of 3 higher post score')
})

test("single-timepoint distribution: the preceptor instrument's own anchors are the bands, and 1 is not a rating", () => {
  // The stored definition: 1 Not Observed / Unable to Assess, 2 Needs Close Support,
  // 3 Developing, 4 Meeting, 5 Exceeding Expected Student Level.
  assert.equal(bandOf(5, PP), 'up'); assert.equal(bandOf(4, PP), 'up'); assert.equal(bandOf(3, PP), 'same'); assert.equal(bandOf(2, PP), 'down')
  assert.equal(bandOf(null, PP), null); assert.equal(bandOf(3, CF), null, 'a paired instrument has no bands')
  assert.deepEqual(PP.naValues, [1])
  const d = buildPacket(COHORT, PP.slug, { now: NOW }).distribution
  assert.equal(d.paired, false)
  assert.match(d.subtitle, /no baseline to compare against/)
  assert.match(d.subtitle, /2 preceptor responses/)
  assert.match(d.subtitle, /scale 1 Not Observed \/ Unable to Assess to 5 Exceeding Expected Student Level/)
  assert.deepEqual(d.labels, { up: 'meeting or exceeding expected level', same: 'developing', down: 'needing close support' })
  assert.deepEqual(d.heads, { up: 'Meeting or above', same: 'Developing', down: 'Close support' })
  assert.match(d.scoringNote, /excluded from every mean and count/)
  const cj = d.subscales.find(s => s.key === 'clinical_judgment')
  assert.deepEqual([cj.up, cj.same, cj.down, cj.total], [2, 0, 0, 2])
  assert.equal(cj.mean, 4.5)
  assert.equal(cj.net, null, 'net is a paired figure')
  const tcc = d.subscales.find(s => s.key === 'teamwork_communication_collaboration')
  assert.deepEqual([tcc.up, tcc.same, tcc.down], [0, 1, 1])
  assert.equal(tcc.delta, null)
  // A rating of 1 is excluded from the mean and from the count, like an N/A answer.
  const notObserved = pp({ sid: 'z', ratings: { clinical_judgment: 1, patient_centered_care: 5, safety_quality: 1, teamwork_communication_collaboration: 1, professionalism_accountability: 1, advanced_beginner_readiness: 1 } })
  const cjSub = PP.subscales.find(s => s.key === 'clinical_judgment')
  assert.equal(subscaleMean(PP, cjSub, notObserved.evaluation_responses[0]), null)
  const d2 = buildPacket([...COHORT, notObserved], PP.slug, { now: NOW }).distribution
  assert.equal(d2.subscales.find(s => s.key === 'clinical_judgment').total, 2, 'still two rated responses')
  assert.equal(d2.subscales.find(s => s.key === 'patient_centered_care').total, 3)
  // A one-item subscale prints as an integer rating in the roster.
  assert.equal(rosterColumns(PP)[4].decimals, 0); assert.equal(rosterColumns(CF)[4].decimals, 2)
})

test('the two student instruments read a mean on the Likert rule: agreed at 4.0, neutral from 3.0, disagreed below', () => {
  assert.equal(SF.bands, LIKERT_BANDS); assert.equal(AP.bands, LIKERT_BANDS)
  assert.equal(bandOf(4.0, SF), 'up'); assert.equal(bandOf(3.99, SF), 'same'); assert.equal(bandOf(3.0, AP), 'same'); assert.equal(bandOf(2.99, AP), 'down')
  const d = buildPacket(COHORT, SF.slug, { now: NOW }).distribution
  assert.deepEqual(d.labels, { up: 'agreed', same: 'neutral', down: 'disagreed' })
  assert.equal(d.scoringNote, LIKERT_NOTE)
  assert.match(d.subtitle, /scale 1 Strongly Disagree to 5 Strongly Agree/)
  // Casey-Fink prints its published rule and its anchors.
  const cf = buildPacket(COHORT, CF.slug, { now: NOW }).distribution
  assert.match(cf.scoringNote, /Casey-Fink scoring instructions \(2024\)/)
  assert.match(cf.scoringNote, /No individual item is an outcome measure/)
  assert.match(cf.subtitle, /scale 1 Strongly Disagree to 4 Strongly Agree/)
  assert.deepEqual(cf.heads, { up: 'Higher', same: 'Same', down: 'Lower' })
})

test('a domain mean skips n/a and blanks rather than counting them as zero', () => {
  const ps = SF.subscales.find(s => s.key === 'preceptor_support')
  const rowA = COHORT.find(a => a.id.startsWith('sf-') && a.students.id === 'a')
  assert.ok(Math.abs(subscaleMean(SF, ps, rowA.evaluation_responses[0]) - (5 + 5 + 4) / 3) < 1e-9)
  const d = buildPacket(COHORT, SF.slug, { now: NOW }).distribution
  const psRow = d.subscales.find(s => s.key === 'preceptor_support')
  assert.deepEqual([psRow.up, psRow.same, psRow.down, psRow.total], [1, 0, 1, 2])
})

test("Student's Feedback on ASPIRE groups its seven rating items by section and reads a 1 to 5 scale", () => {
  assert.equal(AP.scaleMax, 5)
  assert.deepEqual(AP.subscales.map(s => [s.short, s.itemCodes.length]), [['OV', 1], ['CG', 2], ['UE', 2], ['RR', 2]])
  const d = buildPacket(COHORT, AP.slug, { now: NOW }).distribution
  const ov = d.subscales.find(s => s.short === 'OV')
  assert.deepEqual([ov.up, ov.same, ov.down, ov.mean], [1, 1, 0, 4])
})

// ── A2 follow-up ──────────────────────────────────────────────────────────────

test('the baseline-only strip names the count and carries exactly those students', () => {
  const p = buildPacket(COHORT, CF.slug, { now: NOW })
  assert.equal(p.followUp.kind, 'baselineOnly')
  assert.equal(p.followUp.text, '1 student submitted a baseline and no post-rotation response.')
  assert.deepEqual(p.followUp.studentIds, ['d'])
  assert.equal(p.followUp.action, 'See who')
  // And the roster, focused on them, shows their rows and nothing else.
  const rows = buildRosterRows(CF, p.rows, { focusStudentIds: new Set(p.followUp.studentIds) }, NOW)
  assert.deepEqual([...new Set(rows.map(r => r.studentId))], ['d'])
  // No baseline-only students, no strip.
  assert.equal(buildFollowUp(CF, COHORT.slice(0, 6), null, caseyFinkResponsesByStudent(COHORT.slice(0, 6)), NOW), null)
  // A single-timepoint instrument follows up on what has been sent and not returned.
  const pp = buildPacket(COHORT, PP.slug, { now: NOW })
  assert.equal(pp.followUp.kind, 'awaiting')
  assert.equal(pp.followUp.status, 'awaiting')
  assert.match(pp.followUp.text, /1 preceptor survey has been sent and not returned/)
})

// ── A4: the roster ────────────────────────────────────────────────────────────

test('roster rows: name · program, school, submitted, status pill, one number per subscale, en dash when absent', () => {
  const p = buildPacket(COHORT, CF.slug, { now: NOW })
  const rows = buildRosterRows(CF, p.rows, {}, NOW)
  assert.equal(rows.length, 11)
  const a = rows.find(r => r.studentId === 'a' && r.timepoint === 'post_rotation')
  assert.equal(a.name, 'Firsta Lasta')
  assert.equal(a.program, 'ABSN')
  assert.equal(a.school, 'Cal State Long Beach')
  assert.equal(a.submittedAt, '2026-09-01T12:00:00Z')
  assert.deepEqual(a.pill, { tone: 'ok', label: 'Completed' })
  assert.deepEqual(a.scores, { clinical_problem_solving: 3.5, learning_activities: 3.4, practice_readiness: 3.75 })
  assert.deepEqual([a.dateKind, a.date], ['Submitted', '2026-09-01T12:00:00Z'], 'a Completed row dates its submission')
  const awaiting = rows.find(r => r.studentId === 'd' && r.timepoint === 'post_rotation')
  assert.equal(awaiting.submittedAt, null)
  assert.deepEqual(awaiting.pill, { tone: 'info', label: 'Sent' })
  assert.deepEqual([awaiting.dateKind, awaiting.date], ['Sent', '2026-08-20T12:00:00Z'], 'a Sent row dates its sending')
  assert.deepEqual(Object.values(awaiting.scores), [null, null, null])
  const expired = rows.find(r => r.studentId === 'f')
  assert.deepEqual(expired.pill, { tone: 'off', label: 'Expired' })
  assert.deepEqual([expired.dateKind, expired.date], ['Expired', '2026-09-01T00:00:00Z'], 'an Expired row dates the window closing')
  assert.deepEqual(statusDate({ opened_at: '2026-08-21T00:00:00Z' }, 'opened', null), { kind: 'Opened', date: '2026-08-21T00:00:00Z' })
  assert.deepEqual(statusDate({ revoked_at: '2026-08-22T00:00:00Z' }, 'revoked', null), { kind: 'Revoked', date: '2026-08-22T00:00:00Z' })
  assert.deepEqual(statusDate({ sent_at: '2026-08-20T00:00:00Z' }, 'reminder_due', null), { kind: 'Sent', date: '2026-08-20T00:00:00Z' })
})

test('the roster filters by timepoint and by status group, and the filters compose', () => {
  const p = buildPacket(COHORT, CF.slug, { now: NOW })
  assert.equal(buildRosterRows(CF, p.rows, { timepoint: 'post_rotation' }, NOW).length, 6)
  assert.equal(buildRosterRows(CF, p.rows, { status: 'awaiting' }, NOW).length, 1)
  assert.equal(buildRosterRows(CF, p.rows, { status: 'expired' }, NOW).length, 1)
  // "Pre-Rotation" is one option and matches both stored baseline values.
  assert.equal(buildRosterRows(CF, p.rows, { status: 'completed', timepoint: 'baseline' }, NOW).length, 4)
  assert.equal(buildRosterRows(CF, p.rows, { timepoint: 'early_rotation_baseline' }, NOW).length, 5)
  assert.deepEqual(p.timepoints, ['baseline', 'post_rotation'])
  assert.equal(TIMEPOINT_LABELS.baseline, 'Pre-Rotation')
})

test('columns follow the canon: Student first, then School, Status, Date, then one right-aligned column per figure, all sortable', () => {
  const cols = rosterColumns(CF)
  assert.deepEqual(cols.map(c => c.label), ['Student', 'School', 'Status', 'Date', 'CPS', 'LA', 'PR'])
  assert.equal(cols[0].priority, 1, 'the name column is never dropped')
  for (const c of cols.slice(4)) { assert.equal(c.align, 'right'); assert.equal(c.kind, 'num') }
  // The weighted spread: min + grow, no literal widths; name widest, figures least.
  assert.deepEqual(cols.map(c => c.grow), [2.2, 1.4, 1, 1, 0.7, 0.7, 0.7])
  assert.ok(cols.every(c => c.width === undefined && c.min > 0))
  assert.deepEqual(rosterColumns(PP).slice(4).map(c => c.label), ['CJ', 'PCC', 'SQ', 'TCC', 'PA', 'ABR'])
  const p = buildPacket(COHORT, CF.slug, { now: NOW })
  const rows = buildRosterRows(CF, p.rows, {}, NOW)
  const row = rows.find(r => r.studentId === 'a' && r.timepoint === 'post_rotation')
  assert.equal(rosterSortValue(row, cols[0]), 'lasta firsta')
  assert.equal(rosterSortValue(row, cols[4]), 3.5)
  assert.equal(rosterSortValue(rows.find(r => r.studentId === 'd' && r.timepoint === 'post_rotation'), cols[4]), null)
  const dated = rows.find(r => r.studentId === 'f')
  assert.equal(rosterSortValue(dated, cols[3]), '2026-09-01T00:00:00Z', 'Date sorts on the status timestamp')
})

// ── B6: the bubble sheet ──────────────────────────────────────────────────────

test('a Casey-Fink row opens both timepoints, item by item, with the shift; the licensed text is not shown', () => {
  const p = buildPacket(COHORT, CF.slug, { now: NOW })
  const rows = buildRosterRows(CF, p.rows, {}, NOW)
  const sheet = buildBubbleSheet(CF, rows.find(r => r.studentId === 'a' && r.timepoint === 'baseline'), p.byStudent, null)
  assert.equal(sheet.paired, true)
  assert.equal(sheet.scaleMax, 4)
  assert.equal(sheet.subtitle, 'Casey-Fink Readiness for Practice · Pre-Rotation and Post-Rotation')
  assert.equal(sheet.note, `${LICENSED_NOTE} ${ITEM_NOT_OUTCOME_NOTE}`)
  assert.deepEqual(sheet.groups.map(g => [g.label, g.items.length]), [['Clinical Problem-Solving', 6], ['Learning Activities', 5], ['Practice Readiness', 4]])
  const q1 = sheet.groups[0].items[0]
  assert.deepEqual([q1.label, q1.pre, q1.post, q1.shift], ['Item 1', 2, 4, 2])
  const q12 = sheet.groups[2].items[0]
  assert.deepEqual([q12.label, q12.pre, q12.post, q12.shift], ['Item 12', 2, 3, 1])
  assert.deepEqual([sheet.groups[0].items[1].pre, sheet.groups[0].items[1].post, sheet.groups[0].items[1].shift], [3, 3, 0])
  // Casey-Fink stems never enter the model or the tab.
  for (const f of ['src/lib/evaluation/responsesPacketModel.js', 'src/components/EvaluationTab.jsx', 'src/components/evaluation/BubbleSheet.jsx']) {
    assert.doesNotMatch(read(f), /Recognizing a change in a patient|Prioritizing a full patient/, `${f} must not carry the mockup's placeholder stems`)
  }
})

test('a baseline-only student opens one side, with no shift', () => {
  const p = buildPacket(COHORT, CF.slug, { now: NOW })
  const rows = buildRosterRows(CF, p.rows, {}, NOW)
  const sheet = buildBubbleSheet(CF, rows.find(r => r.studentId === 'd' && r.timepoint === 'baseline'), p.byStudent, null)
  assert.equal(sheet.paired, false); assert.equal(sheet.hasPre, true); assert.equal(sheet.hasPost, false)
  assert.equal(sheet.subtitle, 'Casey-Fink Readiness for Practice · Pre-Rotation only')
  assert.equal(sheet.groups[0].items[0].shift, null)
  // The same student's PENDING post row opens what they said at baseline, and says so.
  const pending = buildBubbleSheet(CF, rows.find(r => r.studentId === 'd' && r.timepoint === 'post_rotation'), p.byStudent, null)
  assert.equal(pending.hasPre, true); assert.equal(pending.hasPost, false)
  assert.equal(pending.subtitle, 'Casey-Fink Readiness for Practice · Pre-Rotation only')
  // A student with nothing submitted on either side has nothing to draw, and the sheet says so.
  const none = buildBubbleSheet(CF, rows.find(r => r.studentId === 'f'), p.byStudent, null)
  assert.equal(none.empty, true)
  assert.match(none.message, /No submitted answers/)
})

test('a stored-content instrument reads its stems from the loaded definition, and falls back to the item number', () => {
  const p = buildPacket(COHORT, PP.slug, { now: NOW })
  const rows = buildRosterRows(PP, p.rows, {}, NOW)
  const row = rows.find(r => r.studentId === 'a')
  const bare = buildBubbleSheet(PP, row, null, null)
  assert.equal(bare.paired, false); assert.equal(bare.hasPost, true)
  assert.equal(bare.subtitle, "Preceptor's Assessment of Student Readiness · Post-Rotation · completed by R. Sanchez")
  assert.equal(bare.groups[0].items[0].label, 'Item 1')
  assert.equal(bare.groups[0].items[0].post, 5)
  assert.match(bare.note, /A rating of 1 \(Not Observed \/ Unable to Assess\) is shown but excluded/)
  // A not-observed rating is drawn as the answer it is, and named as excluded.
  const z = buildRosterRows(PP, [pp({ sid: 'z', ratings: { clinical_judgment: 1, patient_centered_care: 5, safety_quality: 3, teamwork_communication_collaboration: 3, professionalism_accountability: 3, advanced_beginner_readiness: 3 } })], {}, NOW)[0]
  const zs = buildBubbleSheet(PP, z, null, null)
  assert.deepEqual([zs.groups[0].items[0].post, zs.groups[0].items[0].excluded, zs.groups[1].items[0].excluded], [1, true, false])
  const content = { section2: { items: { clinical_judgment: { label: 'Uses sound clinical judgment' } } } }
  const named = buildBubbleSheet(PP, row, null, content)
  assert.equal(named.groups[0].label, 'Uses sound clinical judgment')
  assert.equal(named.groups[0].items[0].label, 'Uses sound clinical judgment')
})

test("an n/a answer draws no bubble and is announced as not applicable", () => {
  const p = buildPacket(COHORT, SF.slug, { now: NOW })
  const rows = buildRosterRows(SF, p.rows, {}, NOW)
  const sheet = buildBubbleSheet(SF, rows.find(r => r.studentId === 'a'), null, null)
  const useful = sheet.groups[0].items[2]
  assert.equal(useful.code, 'useful_feedback')
  assert.equal(useful.post, null)
  assert.equal(useful.na, true)
  assert.equal(sheet.scaleMax, 5)
})

test("Student's Feedback on ASPIRE resolves its stems from the instrument module, never from a copy", () => {
  const p = buildPacket(COHORT, AP.slug, { now: NOW })
  const rows = buildRosterRows(AP, p.rows, {}, NOW)
  const sheet = buildBubbleSheet(AP, rows.find(r => r.studentId === 'a'), null, null)
  assert.equal(sheet.groups[0].label, 'Overall ASPIRE Experience')
  assert.equal(sheet.groups[0].items[0].label, 'Overall, ASPIRE was a valuable learning experience.')
  assert.doesNotMatch(read('src/lib/evaluation/responsesPacketModel.js'), /valuable learning experience/)
})

// ── What lives in CSS and markup ─────────────────────────────────────────────

test('B1: the tokens are in the theme file, light then dark, the paper is the slate clipboard paper, and down is amber, never red', () => {
  const theme = read('src/styles/theme.css')
  const light = theme.slice(theme.indexOf(':root,'), theme.indexOf(':root[data-theme="dark"]'))
  const dark = theme.slice(theme.indexOf(':root[data-theme="dark"]'))
  // Owner, 2026-09-20: one paper family. The sheet reads the clipboard's slate, not the
  // mockup's faint green, so the two can never drift.
  for (const block of [light, dark]) {
    for (const [k, v] of [['--paper', '--aspire-paper'], ['--paper-2', '--aspire-paper-2'], ['--paper-ink', '--aspire-paper-ink'], ['--paper-muted', '--aspire-paper-muted'], ['--rule', '--aspire-rule']]) {
      assert.match(block, new RegExp(`${k.replace(/-/g, '\\-')}:\\s*var\\(${v.replace(/-/g, '\\-')}\\);`), `${k} aliases ${v}`)
    }
  }
  assert.match(light, /--aspire-paper:\s*#FDFCFA;/); assert.match(dark, /--aspire-paper:\s*#1C1F2C;/)
  for (const [k, v] of [['--folder', '#EAE1CA'], ['--folder-deep', '#DDD2B5'], ['--folder-ink', '#3A2E14'], ['--grid', 'rgba(15, 122, 77, 0.05)'], ['--grid-5', 'rgba(15, 122, 77, 0.09)'],
    ['--band', 'rgba(15, 122, 77, 0.045)'], ['--hole', '#EDEAE2'], ['--hole-in', '#DAD5C8'], ['--up', '#0F7A4D'], ['--same', '#767D97'], ['--down', '#8F5A0A']]) {
    assert.match(light, new RegExp(`${k.replace(/-/g, '\\-')}:\\s*${v.replace(/[().]/g, '\\$&')};`), `light ${k}`)
  }
  for (const [k, v] of [['--folder', '#2B2619'], ['--folder-deep', '#211D13'], ['--folder-ink', '#EFE6CF'], ['--grid', 'rgba(60, 203, 138, 0.035)'], ['--grid-5', 'rgba(60, 203, 138, 0.065)'],
    ['--band', 'rgba(60, 203, 138, 0.055)'], ['--hole', '#12151F'], ['--hole-in', '#0C0E16'], ['--up', '#3CCB8A'], ['--same', '#9198B4'], ['--down', '#E6A544']]) {
    assert.match(dark, new RegExp(`${k.replace(/-/g, '\\-')}:\\s*${v.replace(/[().]/g, '\\$&')};`), `dark ${k}`)
  }
  assert.doesNotMatch(light, /--down:\s*#A32A32/)
})

test('B2 to B5: the sheet, the tabs, the roster chrome and the mandatory secondary encoding', () => {
  const css = read('src/components/evaluation/responsesPacket.css')
  // Graph paper: four gradients, a 22px fine grid and a 132px major grid, 1px lines.
  assert.match(css, /background-size: 132px 132px, 132px 132px, 22px 22px, 22px 22px;/)
  assert.match(css, /linear-gradient\(var\(--grid-5\) 1px, transparent 1px\)/)
  assert.match(css, /padding: 20px 24px 16px;/)
  // The sheet sits inside a manila frame; there is no stack of paper behind it.
  assert.doesNotMatch(css, /rp-sheetwrap/)
  assert.match(css, /\.rp-folder \{[^}]*background: var\(--folder\);[^}]*border: 1px solid var\(--folder-edge\);[^}]*padding: 0 14px 14px;/s)
  assert.match(css, /\.rp-sheet \{[^}]*margin-top: 8px;/s)
  // Text halo on every text block.
  assert.match(css, /\.rp-spec, \.rp-stamp, \.rp-basis, \.rp-findtitle, \.rp-findsub, \.rp-name, \.rp-counts, \.rp-means,\n\.rp-caveat[^{]*\{\n\s*text-shadow: 0 0 3px var\(--paper\), 0 0 7px var\(--paper\);/)
  // Header closed by a 2px ink rule.
  assert.match(css, /\.rp-sheethead \{[^}]*border-bottom: 2px solid var\(--paper-ink\);/s)
  // File tabs on the frame's band: 9px top corners via token, no bottom border, no overlap
  // with the page; the selected one rises to the band and joins it; the meter is a block.
  assert.match(css, /\.rp-tab \{[^}]*top: 3px;[^}]*background: var\(--folder-deep\);[^}]*border-bottom: none;[^}]*border-radius: var\(--aspire-radius-filetab\) var\(--aspire-radius-filetab\) 0 0;/s)
  assert.doesNotMatch(css, /margin-bottom: -11px/)
  assert.match(css, /\.rp-tab\[aria-pressed="true"\] \{[^}]*top: 0;[^}]*background: var\(--folder\);[^}]*margin-bottom: -1px;[^}]*box-shadow:/s)
  assert.match(css, /\.rp-meter \{\n\s*display: block;/)
  assert.match(read('src/styles/aspireBrand.css'), /--aspire-radius-filetab: 9px;/)
  // The down segment is textured, segments are gapped 2px, narrow ones hide their number.
  assert.match(css, /\.rp-seg-down \{[^}]*background-color: var\(--down\);[^}]*repeating-linear-gradient\(135deg/s)
  assert.match(css, /\.rp-seg \{[^}]*margin-right: 2px;/s)
  assert.match(css, /\.rp-seg\[data-narrow="1"\] b \{ display: none; \}/)
  // The delta is an outline chip: a border and no fill.
  const delta = css.match(/\.rp-delta \{([^}]*)\}/)[1]
  assert.match(delta, /border: 1px solid var\(--rule\)/)
  assert.doesNotMatch(delta, /background/)
  // Breakpoints and motion.
  assert.match(css, /@media \(max-width: 880px\) \{\n\s*\.rp-sub \{ grid-template-columns: 1fr;/)
  assert.match(css, /@media \(max-width: 760px\) \{[^@]*\.rp-item \.rp-shift \{ display: none; \}/s)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  // Bubbles: before is a 2px ring, after is filled, unchanged is filled with an offset ring.
  assert.match(css, /\.rp-bub-pre\s*\{ border: 2px solid var\(--color-accent-primary\); \}/)
  assert.match(css, /\.rp-bub-post \{ background: var\(--color-accent-primary\);/)
  assert.match(css, /\.rp-bub-both \{[^}]*box-shadow: 0 0 0 2px var\(--paper\), 0 0 0 4px var\(--color-accent-primary\);/s)

  const ds = read('src/components/shared/dataSheet.css')
  assert.match(ds, /\.ds-holes \{[^}]*width: 38px;[^}]*radial-gradient\(circle at 19px 13px, var\(--hole-in\) 0 5\.5px, transparent 6px\);[^}]*background-size: 38px 26px;/s)
  assert.match(ds, /\.ds-holes-l \{ left: 0; border-right: 1px dashed var\(--rule\); \}/)
  assert.match(ds, /\.ds-hrow \{ border-bottom: 1\.5px solid var\(--paper-ink\);/)
  // Content is inset inside the hole strips; the crease stays full-bleed.
  assert.match(ds, /\.ds \{[^}]*--ds-inset: 20px;/s)
  assert.match(ds, /\.ds-head \{[^}]*padding: 13px var\(--ds-inset\) 9px;/s)
  assert.match(ds, /\.ds-row \{[^}]*padding: 7px var\(--ds-inset\);/s)
  assert.match(ds, /\.ds-crease \{[^}]*margin: 0 -38px;/s)
  assert.match(read('src/components/shared/dataSheetSort.js'), /export const PAGE_ROWS = 10/)
  assert.match(ds, /\.ds-crease \{[^}]*border-top: 1px dashed var\(--rule\);[^}]*linear-gradient\(180deg, rgba\(24, 32, 63, 0\.055\), transparent 55%\);/s)
  assert.match(ds, /\.ds-detail \{[^}]*background: var\(--paper-2\);[^}]*border-left: 3px solid var\(--color-accent-primary\);/s)
  assert.doesNotMatch(ds, /border-radius:\s*[0-9.]+px/, 'the sheet reads radius tokens, never numbers')
  assert.doesNotMatch(css, /border-radius:\s*[0-9.]+px/, 'the packet reads radius tokens, never numbers')
})

test('the markup carries the accessibility contract', () => {
  const rp = read('src/components/evaluation/ResponsesPacket.jsx')
  assert.match(rp, /aria-pressed=\{tab\.slug === selected\}/, 'tabs are pressed')
  assert.match(rp, /tabIndex=\{0\}\s*\n\s*role="img"\s*\n\s*aria-label=\{text\}/, 'segments are focusable and speak their count')
  assert.match(rp, /data-tip=\{text\}/, 'and carry the same text as a tooltip')
  assert.match(rp, /data-narrow=\{w < 9 \? 1 : 0\}/)
  assert.match(rp, /<caption className="sr-only">\{title\} as a table<\/caption>/, 'the Table view has a screen-reader caption')
  assert.match(rp, /aria-pressed=\{tableView\}/)
  assert.match(rp, /<b aria-hidden="true">\{count\}<\/b>/, 'the inline number is decorative; the count line is the text')
  const ds = read('src/components/shared/DataSheet.jsx')
  assert.match(ds, /aria-expanded=\{open\}/)
  assert.match(ds, /aria-sort=\{on \? \(dir === 'asc' \? 'ascending' : 'descending'\) : 'none'\}/)
  assert.match(ds, /aria-live="polite"/)
  assert.match(ds, /\{on \? \(dir === 'asc' \? ' ↑' : ' ↓'\) : ''\}/, 'the arrow appears only on the active column')
  const tab = read('src/components/EvaluationTab.jsx')
  assert.match(tab, /<div className="rp-folder">\s*<InstrumentTabs/, 'the tabs and the sheet share one frame')
  assert.doesNotMatch(tab, /Paired scores|handlePairedScores|onPairedScores/)
  assert.doesNotMatch(rp, /Paired scores/)
  assert.match(tab, /<button type="button" onClick=\{\(\) => \{ setRosterFocus\(null\); setLive\('Showing all students'\) \}\}>Show all<\/button>/, 'the way back is a word')
  assert.match(tab, /setLive\(`\$\{tab\?\.name \|\| 'Instrument'\} selected`\)/, 'instrument changes are announced')
  assert.match(tab, /<p className="sr-only" aria-live="polite">\{live\}<\/p>/)
  const bs = read('src/components/evaluation/BubbleSheet.jsx')
  assert.match(bs, /role="img" aria-label=\{spoken\}/)
})

test('A5: the caveat keeps its wording, and the old surfaces are gone', () => {
  assert.equal(CF.caveat, 'Observed change in student-reported readiness. This does not independently measure retention, objective competence, or financial savings.')
  assert.equal(existsSync(join(root, 'src/components/evaluation/CaseyFinkComparisonPanel.jsx')), false)
  const index = read('src/index.css')
  assert.doesNotMatch(index, /\.casey-compare|\.eval-kpis/)
  const tab = read('src/components/EvaluationTab.jsx')
  assert.doesNotMatch(tab, /KPI_CARD_DEFS|EvalKPICard|TOTAL ASSIGNED/)
  // The export survives with its columns and its filename.
  assert.match(tab, /'S1 Clinical Problem Solving', 'S1 Learning Activities', 'S1 Practice Readiness'\]/)
  assert.match(tab, /aspire_evaluations_\$\{dateSlug\}\.csv/)
  // The fetch reads what the roster shows.
  assert.match(tab, /students!inner \( id, first_name, preferred_first_name, last_name, school, program_type \)/)
  // The cohort name reaches the sheet.
  assert.match(read('src/staff/StaffApp.jsx'), /<EvaluationTab cohortId=\{activeCohortId\} cohortLabel=\{activeCohort\?\.name \|\| ''\} \/>/)
})
