// test/surveyNames.test.mjs
//
// SURVEY-NAMES-1 (Owner, 2026-09-20). The four instruments are named in ONE module,
// src/lib/evaluation/surveyNames.js, and everything that prints a name reads it: the
// Review & Release catalog, the four respondent pages, the invitation, reminder and
// certificate emails, the reminder ledger, the Responses packet, the Unit Leader and
// Student portals, and the staff response viewers. These tests hold that in two ways:
// the readers are checked at runtime where they are pure, and the whole production tree
// is swept for the retired spellings so a name cannot quietly come back.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  SURVEY_NAMES, TIMEPOINT_QUALIFIERS, QUALIFIED_SLUGS,
  surveyName, surveyQualifier, surveyTitle, surveyLabel, timepointQualifier,
} from '../src/lib/evaluation/surveyNames.js'
import { SURVEY_CATALOG, SURVEY_WORKFLOWS, surveyByKey } from '../src/lib/evaluation/surveyCatalog.js'
import { INSTRUMENT_COMPACT_LABELS, instrumentCompactLabel } from '../src/lib/evaluationLabels.js'
import { TIMEPOINT_LABELS } from '../src/lib/evaluation/responsesPacketModel.js'
import { STEP_LABELS, PREREQ_REASONS } from '../src/lib/evaluation/postRotationSequence.js'
import { REMINDER_WORKFLOWS } from '../src/lib/evaluation/reminderSchedule.js'
import { APPROVED_UL_INSTRUMENTS, instrumentLabel } from '../src/lib/unitEvaluationDisplay.js'
import { POST_ROTATION_CONTENT } from '../lib/server/evaluation/postRotationEvalContent.js'
import { SCHEMA as STUDENT_EVAL_SCHEMA } from '../lib/server/evaluation/student_preceptor_eval_validation.js'
import { SCHEMA as PRECEPTOR_SCHEMA } from '../lib/server/evaluation/preceptor_progress_validation.js'
import { buildCaseyFinkPreRotationInvitationEmail } from '../lib/server/evaluation/caseyFinkPreRotationEmailTemplates.js'
import { buildCaseyFinkPostRotationInvitationEmail } from '../lib/server/evaluation/caseyFinkPostRotationEmailTemplates.js'
import { buildStudentEvalInvitationEmail } from '../lib/server/evaluation/studentEvalEmailTemplates.js'
import { buildPostRotationInvitationEmail } from '../lib/server/evaluation/postRotationEmailTemplates.js'
import { buildPreceptorInvitationEmail } from '../lib/server/evaluation/preceptorEmailTemplates.js'
import { buildPreceptorCertificateEmail } from '../lib/server/evaluation/preceptorCertificateEmail.js'
import { buildEvaluationReminderEmail } from '../lib/server/evaluation/reminderEmailTemplates.js'

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const CASEY = 'casey_fink_readiness_2024'
const FEEDBACK = 'student_preceptor_eval'
const NAMES = {
  casey: 'Casey-Fink Readiness for Practice',
  preceptor: "Preceptor's Assessment of Student Readiness",
  feedback: "Student's Feedback on Unit and Preceptor",
  aspire: "Student's Feedback on ASPIRE",
}

// ── The module ─────────────────────────────────────────────────────────────

test('the four instruments carry the names the Owner chose, and only Casey-Fink is qualified by timepoint', () => {
  assert.deepEqual(SURVEY_NAMES, {
    casey_fink_readiness_2024: NAMES.casey,
    preceptor_progress: NAMES.preceptor,
    student_preceptor_eval: NAMES.feedback,
    post_rotation_evaluation: NAMES.aspire,
  })
  assert.deepEqual([...QUALIFIED_SLUGS], [CASEY])
  assert.equal(surveyQualifier(CASEY, 'baseline'), 'Pre-Rotation')
  assert.equal(surveyQualifier(CASEY, 'early_rotation_baseline'), 'Pre-Rotation')
  assert.equal(surveyQualifier(CASEY, 'post_rotation'), 'Post-Rotation')
  assert.equal(surveyQualifier('preceptor_progress', 'midpoint'), null, 'one-timepoint instruments carry no qualifier')
  assert.equal(surveyQualifier(CASEY, 'midpoint or post_rotation'), null, 'a descriptive string is not a timepoint')
})

test('the three forms: name, sentence title, and parenthesised label', () => {
  assert.equal(surveyName(CASEY), NAMES.casey)
  assert.equal(surveyTitle(CASEY, 'baseline'), 'Casey-Fink Readiness for Practice, Pre-Rotation')
  assert.equal(surveyLabel(CASEY, 'post_rotation'), 'Casey-Fink Readiness for Practice (Post-Rotation)')
  assert.equal(surveyTitle(FEEDBACK, 'post_rotation'), NAMES.feedback)
  assert.equal(surveyLabel('post_rotation_evaluation', 'post_rotation'), NAMES.aspire)
  // A slug the map does not know falls back to the stored display_name, then to nothing.
  assert.equal(surveyName('qa_test_instrument', 'QA Test Instrument'), 'QA Test Instrument')
  assert.equal(surveyName('qa_test_instrument'), '')
  assert.equal(timepointQualifier('post_rotation'), 'Post-Rotation')
  assert.equal(timepointQualifier('custom'), 'Custom')
  assert.equal(timepointQualifier('something_else'), 'something_else')
  assert.equal(TIMEPOINT_QUALIFIERS.baseline, 'Pre-Rotation')
})

// ── The readers ────────────────────────────────────────────────────────────

test('the catalog composes every label and title from the map and carries no old label', () => {
  assert.equal(surveyByKey('caseyFinkPreRotation').label, surveyLabel(CASEY, 'baseline'))
  assert.equal(surveyByKey('caseyFinkPreRotation').title, surveyTitle(CASEY, 'baseline'))
  assert.equal(surveyByKey('caseyFinkPostRotation').label, surveyLabel(CASEY, 'post_rotation'))
  assert.equal(surveyByKey('caseyFinkPostRotation').title, surveyTitle(CASEY, 'post_rotation'))
  assert.equal(surveyByKey('preceptor').label, NAMES.preceptor)
  assert.equal(surveyByKey('student').label, NAMES.feedback)
  assert.equal(surveyByKey('postRotation').label, NAMES.aspire)
  assert.equal(surveyByKey('unitLeaderRelease').label, `Release ${NAMES.feedback} to Unit Leaders`)
  assert.equal(surveyByKey('caseyFinkPostRotation').trigger, `${NAMES.feedback} submitted`)
  for (const s of SURVEY_CATALOG) assert.ok(!('was' in s), `${s.key} carries no old label`)
  for (const w of SURVEY_WORKFLOWS) assert.equal(w.label.replace(/ \((Pre|Post)-Rotation\)$/, ''), surveyName(w.slug))
})

test('the packet labels, the sequence, the reminder ledger and the Unit Leader portal read the same map', () => {
  assert.equal(INSTRUMENT_COMPACT_LABELS, SURVEY_NAMES)
  assert.equal(instrumentCompactLabel(CASEY, 'stored name'), NAMES.casey)
  assert.equal(instrumentCompactLabel('unknown_slug', 'stored name'), 'stored name')
  assert.equal(instrumentCompactLabel('unknown_slug'), '-')
  assert.equal(TIMEPOINT_LABELS, TIMEPOINT_QUALIFIERS)
  assert.deepEqual(STEP_LABELS, {
    feedback: NAMES.feedback,
    caseyFink: 'Casey-Fink Readiness for Practice (Post-Rotation)',
    aspire: NAMES.aspire,
  })
  assert.equal(PREREQ_REASONS.feedback_missing,
    `${NAMES.feedback} has not been released to this student yet, so it cannot have been completed.`)
  assert.equal(PREREQ_REASONS.casey_fink_incomplete,
    'The Casey-Fink Readiness for Practice (Post-Rotation) has been released but the student has not completed it yet.')
  assert.equal(REMINDER_WORKFLOWS.casey_fink_readiness_2024.label, NAMES.casey)
  assert.equal(REMINDER_WORKFLOWS.post_rotation_evaluation.label, NAMES.aspire)
  assert.equal(REMINDER_WORKFLOWS.student_preceptor_eval.label, NAMES.feedback)
  assert.equal(REMINDER_WORKFLOWS.preceptor_progress.label, NAMES.preceptor)
  assert.deepEqual(APPROVED_UL_INSTRUMENTS.map(i => i.label), [NAMES.feedback, NAMES.preceptor])
  assert.equal(instrumentLabel('preceptor_progress'), NAMES.preceptor)
  assert.equal(POST_ROTATION_CONTENT.title, NAMES.aspire, 'the inline questionnaire is titled from the map')
  assert.equal(STUDENT_EVAL_SCHEMA.displayName, NAMES.feedback)
  assert.equal(PRECEPTOR_SCHEMA.displayName, NAMES.preceptor)
})

test('the four respondent pages take their heading from the map, and Casey-Fink carries the timepoint like the clipboard', () => {
  for (const page of ['EvaluationPage', 'StudentEvaluationPage', 'PreceptorEvaluationPage', 'PostRotationEvaluationPage']) {
    assert.match(read(`src/pages/${page}.jsx`), /from '\.\.\/lib\/evaluation\/surveyNames\.js'/, `${page} reads the map`)
  }
  const casey = read('src/pages/EvaluationPage.jsx')
  assert.match(casey, /\{surveyName\(CASEY_FINK_SLUG\)\}/)
  assert.match(casey, /const qualifier = surveyQualifier\(CASEY_FINK_SLUG, timepoint\)/)
  assert.match(casey, /\{qualifier && \(/, 'the qualifier renders only once the token has said which administration this is')
  assert.match(casey, /\{surveyTitle\(CASEY_FINK_SLUG, timepoint\)\}/, 'the greeting card names the instrument and its timepoint from the map')
  assert.doesNotMatch(casey, /instrumentDisplayName/, 'the stored display_name is no longer rendered to the respondent')
  const validate = read('api/evaluation-token-validate.js')
  assert.match(validate, /timepoint:\s+rpcResult\.timepoint,/, 'the token endpoint tells the page its raw timepoint')
  assert.match(validate, /TIMEPOINT_QUALIFIERS\[rpcResult\.timepoint\]/, 'and labels it in the shared vocabulary')
  assert.match(read('src/pages/StudentEvaluationPage.jsx'), /\{surveyName\('student_preceptor_eval'\)\}/)
  assert.match(read('src/pages/PreceptorEvaluationPage.jsx'), /\{surveyName\('preceptor_progress'\)\}/)
  assert.match(read('src/pages/PostRotationEvaluationPage.jsx'), /content\?\.title \|\| surveyName\('post_rotation_evaluation'\)/)
})

test('the staff viewers and the Student Portal map a stored display_name through the slug', () => {
  assert.match(read('src/components/EvaluationResponseDetail.jsx'),
    /surveyName\(assignment\.evaluation_instruments\?\.slug, assignment\.evaluation_instruments\?\.display_name\)/)
  assert.match(read('src/portal/StudentPortal.jsx'),
    /surveyName\(e\.instrument_slug, e\.instrument_title\) \|\| e\.instrument_slug/)
  assert.match(read('src/components/evaluation/StudentEvalResponseDetail.jsx'), /\{surveyName\('student_preceptor_eval'\)\}/)
  assert.match(read('src/components/evaluation/PreceptorResponseDetail.jsx'), /\{surveyName\('preceptor_progress'\)\}/)
  assert.match(read('src/components/evaluation/PreceptorFeedbackPanel.jsx'), /Send the \{surveyName\('preceptor_progress'\)\} to each/)
})

// ── The emails: subjects stay sentences, the body names the survey ──────────

test('every invitation, reminder and certificate email names the survey from the map, and subjects stay sentences', () => {
  const url = 'https://aspireintelligence.app/evaluation/readiness#t=abc'
  const pre = buildCaseyFinkPreRotationInvitationEmail({ studentFirstName: 'Ava', surveyUrl: url })
  assert.equal(pre.subject, 'Before Your Rotation: Complete Your ASPIRE Readiness Survey')
  assert.match(pre.html, /Casey-Fink Readiness for Practice \(Pre-Rotation\) survey/)
  const post = buildCaseyFinkPostRotationInvitationEmail({ studentFirstName: 'Ava', surveyUrl: url })
  assert.equal(post.subject, 'Complete Your ASPIRE Readiness Survey')
  assert.match(post.html, /Casey-Fink Readiness for Practice \(Post-Rotation\) survey/)
  const student = buildStudentEvalInvitationEmail({ studentFirstName: 'Ava', expiresAtHuman: 'October 1, 2026', surveyUrl: url })
  assert.equal(student.subject, 'ASPIRE: Share Feedback on Your Preceptor and Unit', 'the invitation and its reminder now agree on "and"')
  assert.match(student.html, /This is Student's Feedback on Unit and Preceptor, a short survey/)
  const aspire = buildPostRotationInvitationEmail({ studentFirstName: 'Ava', surveyUrl: url })
  assert.equal(aspire.subject, 'Share Your ASPIRE Rotation Feedback')
  assert.match(aspire.html, /complete Student's Feedback on ASPIRE\./)
  assert.doesNotMatch(aspire.html, /Post-Rotation Evaluation/)
  const preceptor = buildPreceptorInvitationEmail({ period: 'end_of_rotation', studentName: 'Ava Wong', preceptorFirstName: 'Dana', expiresAtHuman: 'October 1, 2026', surveyUrl: url })
  assert.equal(preceptor.subject, 'ASPIRE: Student Readiness Feedback Requested for Ava Wong')
  assert.match(preceptor.html, /Preceptor(&#39;|')s Assessment of Student Readiness/, 'the details card escapes the apostrophe')
  assert.doesNotMatch(preceptor.html, /Preceptor Student Readiness Assessment/)
  const cert = buildPreceptorCertificateEmail({ preceptorFirstName: 'Dana', certificateNumber: 'ASPIRE-2026-001', downloadUrl: url })
  assert.match(cert.html, /We received your\s*\nPreceptor's Assessment of Student Readiness/)
  const reminder = buildEvaluationReminderEmail({ workflowKey: 'casey_fink_readiness', reminderNumber: 1, recipientName: 'Ava Wong', surveyUrl: url })
  assert.equal(reminder.subject, 'Reminder: Complete Your ASPIRE Readiness Survey')
  assert.match(reminder.html, /We recently sent you the Casey-Fink Readiness for Practice survey/)
  const studentReminder = buildEvaluationReminderEmail({ workflowKey: 'student_preceptor_eval', reminderNumber: 1, recipientName: 'Ava Wong', surveyUrl: url })
  assert.equal(studentReminder.subject, 'Reminder: Share Feedback on Your Preceptor and Unit')
})

// ── The sweep: the retired spellings are gone from production code ─────────

const RETIRED = [
  'Preceptor Student Readiness Assessment',
  'Student Feedback: Preceptor',
  'ASPIRE Post-Rotation Evaluation',
  'Casey-Fink Post-Rotation Survey',
  'Casey-Fink Readiness for Practice Survey',
  'Preceptor Readiness Assessment',
  'Preceptor & Unit Feedback',
  'Preceptor and Unit Feedback',
  'Student Readiness Assessment',
  "'s Student Feedback first",
  'Student Feedback stack',
  'Student Feedback complete',
  'completed Student Feedback',
]
// Keith's retrieval aliases keep the old spellings on purpose: the governed knowledge
// documents still use them, and an alias that is not in the index finds nothing.
const ALLOWED = new Set(['lib/server/keith/knowledgeRetrieval.js', 'src/lib/keithKnowledge.js'])

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.(js|jsx|json)$/.test(entry.name) && !/ \d+\.(js|jsx|json)$/.test(entry.name)) yield full
  }
}

test('no production file still spells an instrument by a retired name', () => {
  const hits = []
  for (const top of ['api', 'lib', 'src']) {
    for (const file of walk(path.join(ROOT, top))) {
      const rel = path.relative(ROOT, file)
      if (ALLOWED.has(rel)) continue
      const text = fs.readFileSync(file, 'utf8')
      for (const needle of RETIRED) if (text.includes(needle)) hits.push(`${rel}: ${needle}`)
    }
  }
  assert.deepEqual(hits, [], 'retired survey names still present:\n' + hits.join('\n'))
})
