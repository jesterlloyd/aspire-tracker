// RESIDENCY-PORTAL-2b: preceptor feedback in the Residency Portal.
// Owner decisions: the roster shows only that feedback exists; Talent
// Acquisition asks; the Owner approves in the app; only the requester can then
// open it, for that one applicant, and every opening is recorded. The shaped
// view never carries the confidential comments, the attestation, the
// preceptor's identity, or record ids.
// Run: node --test test/residencyPreceptorFeedback.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  PRECEPTOR_FEEDBACK_FORM_TYPE, COMPETENCY_LABELS, ratingLabel, shapePreceptorFeedback, buildFeedbackSummary,
} from '../lib/server/ngrpPreceptorFeedback.js'
import { COMPETENCY_ITEMS } from '../lib/server/evaluation/preceptor_progress_validation.js'
import { allowedStaffNotificationDestination } from '../src/lib/staffNotificationNavigation.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = p => readFileSync(join(here, '..', p), 'utf8')
const code = src => src.split('\n').filter(l => !/^\s*(--|\/\/)/.test(l)).join('\n')

const MIDPOINT = {
  id: 'resp-SECRET-1', assignment_id: 'asg-SECRET', instrument_id: 'ins-SECRET', student_id: 'stu-SECRET',
  cohort_id: 'coh-SECRET', preceptor_id: 'pre-SECRET', timepoint: 'midpoint', submitted_at: '2026-08-20T17:00:00Z',
  responses: {
    developmental_feedback: {
      context: { feedback_period: 'midpoint', shifts_observed: '4–6 shifts', rotation_unit: '5 North' },
      competency: {
        clinical_judgment: { rating: 4, comment: 'Notices cues early.' },
        patient_centered_care: { rating: 5 },
        safety_quality: { rating: 9 },
        teamwork_communication_collaboration: { rating: 3 },
        professionalism_accountability: { rating: 4 },
        advanced_beginner_readiness: { rating: 1 },
      },
      narrative: { strengths_observed: 'Calm under pressure.', areas_for_development: 'Delegation.', suggested_support_plan: '' },
      preceptor_name: 'Dana SECRET-NAME',
    },
    readiness_endorsement: {
      transition_readiness: 'Progressing appropriately for student level',
      unit_endorsement_consideration: 'Yes',
      endorsement_explanation: 'Ready with support.',
      cedars_consideration_recommendation: 'Yes, enthusiastically',
      best_fit_environment: 'Med-surg with a structured preceptor',
    },
    confidential_team_comments: { comments: 'SECRET-CONFIDENTIAL' },
    attestation: { attestation_confirmed: true, signed_name: 'SECRET-SIGNATURE' },
  },
}
const END_OF_ROTATION = {
  ...MIDPOINT,
  timepoint: 'post_rotation',
  submitted_at: '2026-06-01T17:00:00Z',
  responses: { developmental_feedback: { context: {} }, confidential_team_comments: 'SECRET-CONFIDENTIAL' },
}

test('the shaped view is an allowlist: no confidential comments, attestation, preceptor, or ids', () => {
  const shaped = shapePreceptorFeedback([MIDPOINT, END_OF_ROTATION])
  const json = JSON.stringify(shaped)
  for (const leak of ['SECRET', 'confidential', 'attestation', 'preceptor_name', 'assignment', 'student_id']) {
    assert.ok(!json.includes(leak), `leaked ${leak}`)
  }
  for (const entry of shaped) {
    assert.deepEqual(Object.keys(entry).sort(),
      ['competencies', 'narrative', 'period', 'readiness', 'rotationUnit', 'shiftsObserved', 'submittedAt'])
  }
})

test('entries read oldest first, with the scale words and the form labels', () => {
  const [first, second] = shapePreceptorFeedback([MIDPOINT, END_OF_ROTATION])
  assert.equal(first.period, 'End of Rotation', 'period falls back to the timepoint')
  assert.equal(second.period, 'Midpoint')
  assert.equal(second.rotationUnit, '5 North')
  assert.equal(second.shiftsObserved, '4–6 shifts')
  const byKey = Object.fromEntries(second.competencies.map(c => [c.key, c]))
  assert.equal(byKey.clinical_judgment.ratingLabel, 'Meeting Expected Student Level')
  assert.equal(byKey.clinical_judgment.comment, 'Notices cues early.')
  assert.equal(byKey.safety_quality.ratingLabel, null, 'an out-of-range rating is no rating')
  assert.equal(byKey.advanced_beginner_readiness.ratingLabel, 'Not Observed / Unable to Assess')
  assert.equal(second.narrative.supportPlan, null, 'blank text is null')
  assert.equal(second.readiness.cedarsRecommendation, 'Yes, enthusiastically')
  assert.equal(ratingLabel('2'), 'Needs Close Support')
  assert.equal(ratingLabel(0), null)
  assert.equal(PRECEPTOR_FEEDBACK_FORM_TYPE, 'preceptor_progress')
})

test('competency labels are the ones the preceptor saw', () => {
  const content = JSON.parse(read('lib/server/evaluation/content/preceptor_progress.json'))
  for (const key of COMPETENCY_ITEMS) {
    assert.equal(COMPETENCY_LABELS[key], content.section2.items[key].label, key)
  }
})

test('the roster summary: Talent Acquisition gets existence and its own request only; staff get the log', () => {
  const students = [{ id: 's1' }, { id: 's2' }, { id: 's3' }]
  const candidates = [{ id: 'k1', student_id: 's1' }, { id: 'k2', student_id: 's2' }, { id: 'k3', student_id: 's3' }]
  const requests = [
    { id: 'r-mine-old', candidate_id: 'k1', requester_profile_id: 'me', requested_at: '2026-09-01', status: 'declined', decided_at: '2026-09-02' },
    { id: 'r-mine', candidate_id: 'k1', requester_profile_id: 'me', requested_at: '2026-09-05', status: 'approved', request_note: 'Interview prep', decided_at: '2026-09-06' },
    { id: 'r-other', candidate_id: 'k1', requester_profile_id: 'robert', requested_at: '2026-09-07', status: 'pending' },
  ]
  const base = { students, candidates, responseStudentIds: ['s1', 's1', 's2'], requests }

  const ta = buildFeedbackSummary({ ...base, talentAcquisition: true, callerId: 'me' })
  assert.deepEqual(Object.keys(ta).sort(), ['s1', 's2'], 's3 has neither feedback nor a request')
  assert.equal(ta.s1.available, true)
  assert.equal(ta.s1.count, undefined, 'Talent Acquisition does not get the count')
  assert.equal(ta.s1.request.id, 'r-mine', 'the newest of the caller\'s own requests')
  assert.ok(!JSON.stringify(ta).includes('robert') && !JSON.stringify(ta).includes('r-other'), 'never another requester')
  assert.deepEqual(ta.s2, { available: true, request: null })

  const staff = buildFeedbackSummary({
    ...base,
    requesterNames: new Map([['me', 'Jenn TA'], ['robert', 'Robert TA']]),
    viewEvents: [
      { request_id: 'r-mine', created_at: '2026-09-06T10:00:00Z' },
      { request_id: 'r-mine', created_at: '2026-09-08T09:00:00Z' },
    ],
  })
  assert.equal(staff.s1.count, 2)
  assert.deepEqual(staff.s1.requests.map(r => r.id), ['r-other', 'r-mine', 'r-mine-old'])
  const mine = staff.s1.requests.find(r => r.id === 'r-mine')
  assert.equal(mine.requesterName, 'Jenn TA')
  assert.equal(mine.views, 2)
  assert.equal(mine.lastViewedAt, '2026-09-08T09:00:00Z')
  assert.equal(mine.note, 'Interview prep')
})

test('the migration: server-only tables, one open request, Owner-only decisions, a notification', () => {
  const sql = read('supabase/migrations/20260912000000_ngrp_preceptor_feedback_requests.sql')
  const body = code(sql)
  assert.match(body, /^BEGIN;$/m)
  assert.match(body, /^COMMIT;$/m)
  assert.match(body, /REVOKE ALL PRIVILEGES ON TABLE public\.ngrp_preceptor_feedback_requests FROM PUBLIC, anon, authenticated, service_role;/)
  assert.match(body, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.ngrp_preceptor_feedback_requests TO service_role;/)
  assert.match(body, /REVOKE ALL PRIVILEGES ON TABLE public\.ngrp_preceptor_feedback_access_events FROM PUBLIC, anon, authenticated, service_role;/)
  assert.match(body, /GRANT SELECT, INSERT ON TABLE public\.ngrp_preceptor_feedback_access_events TO service_role;/)
  assert.doesNotMatch(body, /GRANT[^;]*TO (anon|authenticated)/, 'nothing granted to client roles')
  assert.match(body, /CREATE UNIQUE INDEX IF NOT EXISTS uq_ngrp_pf_requests_open\s+ON public\.ngrp_preceptor_feedback_requests \(requester_profile_id, candidate_id\)\s+WHERE status IN \('pending', 'approved'\);/)
  for (const fn of ['ngrp_pf_request_tx(uuid, uuid, text)', 'ngrp_pf_decide_tx(uuid, uuid, text, text, text)']) {
    const esc = fn.replace(/[()]/g, '\\$&')
    assert.match(body, new RegExp(`REVOKE ALL ON FUNCTION public\\.${esc} FROM PUBLIC, anon, authenticated;`))
    assert.match(body, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${esc} TO service_role;`))
  }
  const decide = body.slice(body.indexOf('FUNCTION public.ngrp_pf_decide_tx('))
  assert.match(decide, /is_owner IS TRUE AND COALESCE\(is_active, true\) = true/)
  assert.match(decide, /FOR UPDATE/)
  assert.match(decide, /v_req\.status IS DISTINCT FROM p_expected_status/)
  const request = body.slice(body.indexOf('FUNCTION public.ngrp_pf_request_tx('), body.indexOf('FUNCTION public.ngrp_pf_decide_tx('))
  assert.match(request, /'ngrp_preceptor_feedback_requested'/)
  assert.match(request, /'\/ngrp\/profiles\?candidate=' \|\| p_candidate_id::text/)
  assert.doesNotMatch(body, /\bevaluation_responses\b[^;]*(UPDATE|DELETE|POLICY)/i, 'evaluation_responses is only indexed')
})

test('the endpoint: request is Talent Acquisition only, decide is the Owner only, a view is logged first', () => {
  const api = read('api/ngrp-preceptor-feedback.js')
  assert.match(api, /verifyNgrpCaller\(req\)/)
  assert.match(api, /const view = isTA \? narrowPayloadForTalentAcquisition\(payload\) : payload/)
  assert.match(api, /if \(isTA\) q = q\.eq\('requester_profile_id', caller\.profile\.id\)/)
  const reqBlock = api.slice(api.indexOf("if (action === 'request')"), api.indexOf("if (action === 'decide')"))
  assert.match(reqBlock, /if \(!isTA\) return res\.status\(403\)\.json\(\{ error: 'talent_acquisition_only' \}\)/)
  assert.match(reqBlock, /if \(!hasSubmittedForm\(live\.assignment\?\.status\)\) return res\.status\(404\)/)
  assert.match(reqBlock, /return res\.status\(409\)\.json\(\{ error: 'no_feedback' \}\)/)
  const decideBlock = api.slice(api.indexOf("if (action === 'decide')"), api.indexOf('// ── view'))
  // Owner, 2026-09-11: Admins decide too (20260913000000 widens the function to match).
  assert.match(decideBlock, /if \(isTA \|\| !isAdminLevel\(caller\.profile\)\) return res\.status\(403\)\.json\(\{ error: 'owner_required' \}\)/)
  const viewBlock = api.slice(api.indexOf('// ── view'))
  assert.match(viewBlock, /request\.requester_profile_id !== caller\.profile\.id \|\| request\.status !== 'approved'/)
  assert.match(viewBlock, /feedbackRows\(db, \[request\.student_id\], 'timepoint, responses, submitted_at'\)/)
  const logAt = viewBlock.indexOf('.from(EVENTS).insert(')
  assert.ok(logAt > 0 && logAt < viewBlock.indexOf('shapePreceptorFeedback(rows)'), 'the view is logged before content is returned')
  assert.match(viewBlock, /if \(logged\.error\) return internal\(res\)/)
})

test('the Owner/Admin notification links to the applicant and nowhere else', () => {
  const id = '33333333-3333-4333-8333-333333333333'
  assert.equal(allowedStaffNotificationDestination(`/ngrp/profiles?candidate=${id}`, null), `/ngrp/profiles?candidate=${id}`)
  for (const bad of [
    '/ngrp/profiles', '/ngrp/profiles?candidate=not-a-uuid', `/ngrp/profiles?candidate=${id}&next=/admin`,
    `/ngrp/residency?candidate=${id}`, `/ngrp/profiles?candidate=${id}#x`,
  ]) {
    assert.equal(allowedStaffNotificationDestination(bad, null), null, bad)
  }
  for (const file of ['lib/server/staffNotifications/emailContent.js', 'src/components/StaffNotificationsPanel.jsx']) {
    const src = read(file)
    assert.match(src, /ngrp_preceptor_feedback_requested: 'Preceptor feedback requested'/, file)
    assert.match(src, /'Talent Acquisition'/, file)
  }
})

test('the roster and drawer: an indicator, a deep link, and the section', () => {
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(tab, /<PreceptorFeedbackChip entry=\{feedback\.byStudent\[s\.id\]\} \/>/)
  assert.match(tab, /searchParams\.get\('candidate'\)/)
  assert.match(tab, /viewFeedback: req => postNgrpPreceptorFeedback\('view', \{ request_id: req\.id \}\)/)
  const drawer = read('src/components/ngrp/ApplicantDrawer.jsx')
  assert.match(drawer, /<PreceptorFeedbackSection row=\{row\} feedback=\{feedback\} actions=\{actions\} \/>/)
  assert.match(drawer, /title="Preceptor Feedback"/)
  // RESIDENCY-ROSTER-1 retired the Confirm Application button beside it, so the
  // send button now sits directly under the gateNote check. The GATE itself is
  // what this pins, and it is unchanged: a send action must exist, and the
  // pending-migration note still suppresses it.
  assert.match(drawer, /actions\.sendForm && \(/, 'the send gate is untouched')
  assert.match(drawer, /\{!gateNote && actions\.sendForm/)
})

test('the notification link switches to the applicant\'s residency cohort first', () => {
  const ws = read('api/ngrp-workspace.js')
  const locate = ws.slice(ws.indexOf("if (action === 'locate')"), ws.indexOf("// action === 'applicants' | 'export'"))
  assert.match(locate, /select\('id, cycle_id'\)/)
  assert.match(locate, /if \(caller\.audience === TALENT_ACQUISITION\) \{[\s\S]*hasSubmittedForm\(live\.assignment\?\.status\)[\s\S]*404/)
  const tab = read('src/components/ngrp/ProfilesTab.jsx')
  assert.match(tab, /locateNgrpCandidate\(linkedCandidate\)\.then/)
  assert.match(tab, /if \(res\.ok && res\.cycle_id !== cycle\?\.id\) onSelectCycle\(res\.cycle_id\)/)
  assert.match(tab, /if \(locatedRef\.current === linkedCandidate\) return/, 'looked up once, never in a loop')
  assert.match(read('src/components/ngrp/NgrpWorkspace.jsx'), /<ProfilesTab [^>]*onSelectCycle=\{onSelectCycle\}/)
  assert.match(read('src/App.jsx'), /onSelectCycle=\{selectNgrpCycle\}/)
  assert.match(read('src/portal/residency/ResidencyPortal.jsx'), /onSelectCycle=\{selectCycle\}/)
})

test('Admins can decide too: the widened function matches the API and the notification fan-out', () => {
  const sql = code(read('supabase/migrations/20260913000000_ngrp_preceptor_feedback_admin_decide.sql'))
  assert.match(sql, /^BEGIN;$/m)
  assert.match(sql, /^COMMIT;$/m)
  assert.match(sql, /AND \(is_owner IS TRUE OR role IN \('owner', 'admin'\)\)\s+AND COALESCE\(is_active, true\) = true/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.ngrp_pf_decide_tx\(uuid, uuid, text, text, text\) FROM PUBLIC, anon, authenticated;/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.ngrp_pf_decide_tx\(uuid, uuid, text, text, text\) TO service_role;/)
  assert.doesNotMatch(sql, /co-lead|co_lead|interviewer/i, 'no one beyond the Owner and Admins')
  // The same people the request notification reaches.
  const emitter = read('supabase/migrations/20260723000000_preceptor_assignment_authorization.sql')
  assert.match(emitter, /up\.role IN \('owner', 'admin'\) OR up\.is_owner IS TRUE/)
  const access = read('lib/server/access.js')
  assert.match(access, /return c\.isOwner \|\| c\.role === 'admin' \|\| c\.role === 'owner'/)
  assert.match(read('api/ngrp-preceptor-feedback.js'), /canDecide: !isTA && isAdminLevel\(caller\.profile\)/)
})
