// CONNECT-SCHEDULING-LINK-1: both scheduling-link actions route through ASPIRE Connect.
//
// Functional tests drive the pure flow module (lib/schedulingLinkFlow.js) directly: the school-email
// rule, resend labelling, launch payload, send-evidence gating, and the write-outcome resolver.
// Source guards prove the two surfaces launch instead of composing a mailto, that the template ships
// the CTA and copy, that the Action Center task is resolved by the logged communication, and that the
// return confirmation writes only on confirm.
//
// Run: node --test test/schedulingLinkConnectFlow.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  SCHEDULING_LINK_TEMPLATE_KEY,
  SCHEDULING_LINK_COMM_TYPE,
  DEFAULT_SCHEDULING_LINK_RETURN_PATH,
  schedulingLinkEmail,
  hasSchedulingLinkSent,
  canSendSchedulingLink,
  buildSchedulingLinkLaunch,
  resolveSchedulingLinkReturnPath,
  confirmedSchedulingLinkRecipients,
  buildSchedulingLinkConfirmPlan,
  resolveSchedulingLinkWrites,
} from '../src/lib/schedulingLinkFlow.js'
import { buildBulkTemplate } from '../src/lib/outreachTemplates.js'
import { LAUNCH_KINDS } from '../src/lib/connect/launchContext.js'
import { deriveEagerAttention } from '../src/lib/attention.js'
// templateRegistry.js is not imported: it resolves '../contactCategories' extensionlessly (bundler
// resolution), so it is asserted as source text below like the other registry-touching tests.

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const interviewsTab = read('src/components/InterviewRubricTab.jsx')
const sidePanel     = read('src/components/StudentSidePanel.jsx')
const actionCenter  = read('src/components/ActionCenter.jsx')
const returnConfirm = read('src/components/connect/SchedulingLinkReturnConfirm.jsx')
const appShell      = read('src/App.jsx')
const composer      = read('src/components/connect/BulkManualComposer.jsx')

// The three surfaces that may start a scheduling-link send.
const ENTRY_POINTS = [
  { name: 'Interviews worklist', src: interviewsTab },
  { name: 'Student Profiles',    src: sidePanel },
  { name: 'Action Center',       src: appShell },   // the panel hands off; App owns the launch
]

const student = (over = {}) => ({
  id: 's1', first_name: 'Ada', last_name: 'Lovelace', cohort_id: 'c1',
  status: 'Form Received', school_email: 'ada@school.edu', personal_email: 'ada@personal.com',
  ...over,
})
const COHORT = 'c1'

// ── Recipient rule: school email only ────────────────────────────────────────

test('the recipient is the school email; a personal email is never a fallback', () => {
  assert.equal(schedulingLinkEmail(student()), 'ada@school.edu')
  assert.equal(schedulingLinkEmail(student({ school_email: '' })), '')
  // Personal email present, school missing → still not sendable.
  const gate = canSendSchedulingLink(student({ school_email: '' }))
  assert.equal(gate.ok, false)
  assert.equal(gate.reason, 'no_school_email')
  assert.match(gate.disabledReason, /school email/i)
})

test('the gate offers both a full explanation and a compact badge', () => {
  // QC finding: the Action Center renders a warning BOTH in place of the description and as a pill,
  // so the long sentence appeared twice in the row. Compact surfaces get the short wording, matching
  // the existing 'Missing preceptor email' item; roomy surfaces keep the full reason.
  const gate = canSendSchedulingLink(student({ school_email: '' }))
  assert.equal(gate.shortReason, 'Missing school email')
  assert.ok(gate.disabledReason.length > gate.shortReason.length)
  assert.equal(canSendSchedulingLink(student()).shortReason, null)
  assert.match(actionCenter, /warning:gate\.shortReason/)
  assert.doesNotMatch(actionCenter, /warning:gate\.disabledReason/)
  // The roomy surfaces still show the full reason.
  assert.match(interviewsTab, /rowAction\.disabledReason/)
  assert.match(sidePanel, /\{gate\.disabledReason\}/)
})

test('a confirmed write refreshes the per-student communications query', () => {
  // QC finding: Student Profiles reads its own ['student_communications', id] query, so without an
  // invalidation its control kept reading "Send" after a confirmed send.
  assert.match(returnConfirm, /queryClient\.invalidateQueries\(\{ queryKey: \['student_communications', s\.id\] \}\)/)
  // Only on success - a failed write must not imply the record exists.
  assert.match(returnConfirm, /if \(!error\) queryClient\.invalidateQueries/)
})

test('a launch is impossible without a school email', () => {
  assert.equal(buildSchedulingLinkLaunch({
    student: student({ school_email: '' }), cohortId: COHORT, returnPath: '/students',
  }), null)
  // Missing cohort or return path also refuses, so a context can never be half-formed.
  assert.equal(buildSchedulingLinkLaunch({ student: student(), returnPath: '/students' }), null)
  assert.equal(buildSchedulingLinkLaunch({ student: student(), cohortId: COHORT }), null)
})

test('the launch payload carries the template, the student, and the launching workspace', () => {
  const ctx = buildSchedulingLinkLaunch({
    student: student(), cohortId: COHORT, cohortName: 'Fall 2026',
    source: 'interviews_worklist', returnPath: '/interviews',
  })
  assert.deepEqual(ctx, {
    cohortId: 'c1', cohortName: 'Fall 2026', source: 'interviews_worklist',
    templateKey: 'student_interview_scheduling', returnPath: '/interviews', studentIds: ['s1'],
  })
  assert.equal(ctx.templateKey, SCHEDULING_LINK_TEMPLATE_KEY)
})

// ── Resend ───────────────────────────────────────────────────────────────────

test('a previously sent link offers an intentional resend, not a duplicate task', () => {
  const comms = [{ student_id: 's1', type: SCHEDULING_LINK_COMM_TYPE }]
  assert.equal(hasSchedulingLinkSent(comms, 's1'), true)
  assert.equal(hasSchedulingLinkSent(comms, 's2'), false)
  const first = canSendSchedulingLink(student(), [])
  const again = canSendSchedulingLink(student(), comms)
  assert.equal(first.label, 'Send Scheduling Link')
  assert.equal(again.label, 'Resend Scheduling Link')
  assert.equal(again.ok, true, 'a resend stays available')
  // Resolution is by existence, so a second logged send leaves the task resolved (never re-opened).
  const twice = [...comms, { student_id: 's1', type: SCHEDULING_LINK_COMM_TYPE }]
  assert.equal(hasSchedulingLinkSent(twice, 's1'), true)
})

// ── Send evidence gates every write ──────────────────────────────────────────

test('only students Connect reported as sent are confirmable', () => {
  const students = [student(), student({ id: 's2', school_email: 'bob@school.edu' })]
  const ctx = { studentIds: ['s1', 's2'], sentEmails: ['ADA@SCHOOL.EDU'] }
  const confirmed = confirmedSchedulingLinkRecipients(ctx, students)
  assert.deepEqual(confirmed.map(s => s.id), ['s1'], 'case-insensitive match, unsent student excluded')
})

test('no send evidence confirms nobody (cancel, draft-save, and failed send all land here)', () => {
  const students = [student()]
  assert.deepEqual(confirmedSchedulingLinkRecipients({ studentIds: ['s1'], sentEmails: [] }, students), [])
  assert.deepEqual(confirmedSchedulingLinkRecipients(null, students), [])
  // A failed/skipped recipient is simply absent from sentEmails.
  assert.deepEqual(confirmedSchedulingLinkRecipients({ studentIds: ['s1'], sentEmails: ['other@x.edu'] }, students), [])
})

test('a personal-email send is NOT accepted as evidence for the scheduling link', () => {
  // The composer can be switched to the personal source; that email cannot open the scheduling page,
  // so it must not mark the link as sent.
  const ctx = { studentIds: ['s1'], sentEmails: ['ada@personal.com'] }
  assert.deepEqual(confirmedSchedulingLinkRecipients(ctx, [student()]), [])
})

test('cohort isolation: a student outside the launched set is never confirmed', () => {
  const students = [student(), student({ id: 'other', school_email: 'x@school.edu' })]
  const ctx = { studentIds: ['s1'], sentEmails: ['ada@school.edu', 'x@school.edu'] }
  assert.deepEqual(confirmedSchedulingLinkRecipients(ctx, students).map(s => s.id), ['s1'])
})

// ── Confirmation copy + write outcome ────────────────────────────────────────

test('the confirmation states it records a communication, not a status change', () => {
  assert.equal(buildSchedulingLinkConfirmPlan([]), null)
  const plan = buildSchedulingLinkConfirmPlan([student()])
  assert.match(plan.confirmTitle, /Mark the scheduling link as sent\?/)
  assert.match(plan.confirmBody, /does not change the student's ASPIRE status/)
  assert.match(buildSchedulingLinkConfirmPlan([student(), student({ id: 's2' })]).confirmTitle, /Mark 2 scheduling links/)
})

test('a partial write failure keeps exactly the failed students retryable', () => {
  const plan = buildSchedulingLinkConfirmPlan([student(), student({ id: 's2' })])
  const ok = resolveSchedulingLinkWrites(plan, [{ student: student(), error: null }])
  assert.equal(ok.status, 'done')
  const partial = resolveSchedulingLinkWrites(plan, [
    { student: student(), error: null },
    { student: student({ id: 's2' }), error: { message: 'boom' } },
  ])
  assert.equal(partial.status, 'retry')
  assert.deepEqual(partial.plan.students.map(s => s.id), ['s2'])
  assert.match(partial.plan.confirmTitle, /^Retry:/)
})

// ── Action Center resolution ─────────────────────────────────────────────────

test('the Action Center task clears once the scheduling link is logged, and only then', () => {
  const base = { students: [student()], matches: [], activeCohort: null, canEdit: true, now: new Date('2026-07-31T12:00:00Z') }
  const open = deriveEagerAttention({ ...base, communications: [] })
  assert.deepEqual(open.schedulingLink.map(s => s.id), ['s1'])

  const resolved = deriveEagerAttention({
    ...base, communications: [{ student_id: 's1', type: SCHEDULING_LINK_COMM_TYPE }],
  })
  assert.deepEqual(resolved.schedulingLink, [], 'logged scheduling link resolves the task')
  assert.equal(open.count - resolved.count, 1, 'the badge count drops with it')

  // A different communication type must not resolve it.
  const unrelated = deriveEagerAttention({
    ...base, communications: [{ student_id: 's1', type: 'student_form' }],
  })
  assert.deepEqual(unrelated.schedulingLink.map(s => s.id), ['s1'])
  // Another student's scheduling link must not resolve this one.
  const otherStudent = deriveEagerAttention({
    ...base, communications: [{ student_id: 's2', type: SCHEDULING_LINK_COMM_TYPE }],
  })
  assert.deepEqual(otherStudent.schedulingLink.map(s => s.id), ['s1'])
})

// ── Template ─────────────────────────────────────────────────────────────────

test('the template carries the Owner subject, copy, and the Schedule Interview CTA', () => {
  const tpl = buildBulkTemplate(SCHEDULING_LINK_TEMPLATE_KEY)
  assert.equal(tpl.subject, 'Schedule Your ASPIRE Interview')
  assert.ok(tpl.richBody, 'ships a Content Block richBody for the Tiptap composer')

  // CTA button block with the exact label, pointing at the static scheduling-link token.
  assert.match(tpl.richBody, /data-aspire-block="button" data-label="Schedule Interview" data-url="\[Insert Interview Schedule Link\]"/)

  for (const body of [tpl.body, tpl.richBody]) {
    assert.match(body, /\[Student First Name\]/, 'uses the canonical first-name merge token')
    assert.match(body, /Thank you for completing your ASPIRE Student Profile/)
    assert.match(body, /enter your school email address/)
    assert.match(body, /Microsoft Teams/)
    assert.match(body, /aspire@cshs\.org/)
    assert.match(body, /\[Insert Interview Schedule Link\]/)
  }
  // The closing + signature are appended server-side by "Include my email signature"; a literal one
  // here would duplicate them.
  assert.doesNotMatch(tpl.body, /Kind regards|Warm regards|Jester Lloyd Bautista/)
  assert.doesNotMatch(tpl.richBody, /Kind regards|Warm regards|Jester Lloyd Bautista/)
  // The retired copy is gone.
  assert.doesNotMatch(tpl.body, /first-come, first-served|\[Insert Deadline\]/)
})

test('the CTA token resolves to the public scheduling route, not a hard-coded host', () => {
  assert.match(composer, /student_interview_scheduling: \{ token: '\[Insert Interview Schedule Link\]', path: '\/interview-schedule' \}/)
  // Registered for Send-to-many, Students audience, students source (asserted as source text: the
  // registry module imports '../contactCategories' extensionlessly and is bundler-only).
  const registry = read('src/lib/connect/templateRegistry.js')
  assert.match(registry, /key: 'student_interview_scheduling'[\s\S]{0,220}?defaultSource: 'students', audiences: \[AUDIENCES\.STUDENT\]/)
})

// ── Both surfaces launch Connect; no mailto remains ──────────────────────────

test('the Interviews worklist launches Connect and no longer builds a compose URL', () => {
  assert.match(interviewsTab, /writeLaunchContext\(\{ kind: LAUNCH_KINDS\.INTERVIEW_SCHEDULING_LINK, \.\.\.ctx \}\)/)
  assert.match(interviewsTab, /returnPath: '\/interviews'/)
  assert.match(interviewsTab, /navigate\('\/connect\/outreach\?launch=1'\)/)
  assert.doesNotMatch(interviewsTab, /buildSchedulingComposeUrl|buildOutlookComposeUrl|mailto:/)
  // Role gate matches the send endpoint (Owner/Admin).
  assert.match(interviewsTab, /if \(!canEdit\) return null/)
})

test('Student Profiles launches the same flow, returning to its own workspace', () => {
  assert.match(sidePanel, /writeLaunchContext\(\{ kind: LAUNCH_KINDS\.INTERVIEW_SCHEDULING_LINK, \.\.\.ctx \}\)/)
  assert.match(sidePanel, /returnPath: '\/students'/)
  assert.match(sidePanel, /navigate\('\/connect\/outreach\?launch=1'\)/)
  // The old inline mailto draft is gone (the preceptor email buttons keep their own compose).
  assert.doesNotMatch(sidePanel, /Schedule Your ASPIRE Interview/)
  assert.doesNotMatch(sidePanel, /openOutlookCompose\(\{ to: data\.school_email/)
  // Missing school email disables with an inline reason instead of hiding the control.
  assert.match(sidePanel, /disabled=\{!gate\.ok\}/)
  assert.match(sidePanel, /\{gate\.disabledReason\}/)
})

test('the Action Center launches the same flow instead of opening a draft', () => {
  // The task no longer carries a compose href and no longer marks itself done on click.
  assert.match(actionCenter, /actionType:'interview_link_not_sent', canMarkDone:false, markDoneType:null, launchSchedulingLink:canEdit && gate\.ok/)
  assert.doesNotMatch(actionCenter, /buildSchedulingLinkEmail/)
  assert.doesNotMatch(actionCenter, /markDonePayload:\{type:'scheduling_link'\}/)
  // The handoff branch runs BEFORE the log-on-compose branch and writes nothing.
  const handler = actionCenter.slice(actionCenter.indexOf('const handleAction'))
  const launchIdx = handler.indexOf('if (item.launchSchedulingLink)')
  const logIdx = handler.indexOf("item.markDoneType === 'log_communication'")
  assert.ok(launchIdx > -1 && logIdx > launchIdx, 'the launch branch precedes the log-on-compose branch')
  const launchBranch = handler.slice(launchIdx, handler.indexOf('}', handler.indexOf('onClose()', launchIdx)))
  assert.doesNotMatch(launchBranch, /logComm|insert/)
  // Gate + label: no action offered without the launch (non-editor, or no school email).
  assert.match(actionCenter, /const gate = canSendSchedulingLink\(s, communications\)/)
  assert.match(actionCenter, /if \(item\.actionType === 'interview_link_not_sent'\) return item\.launchSchedulingLink \? 'Send Scheduling Link' : null/)
  // The item itself stays visible to every role, so the panel and the bell badge cannot drift.
  assert.doesNotMatch(actionCenter, /canEdit \? act2/)
  // The other tasks keep their own compose builders (out of scope, deliberately unchanged).
  assert.match(actionCenter, /buildStudentFormEmail|buildInterviewReminderEmail/)
})

test('the Action Center returns to a real workspace, never into Connect', () => {
  assert.equal(resolveSchedulingLinkReturnPath('/aggregate'), '/aggregate')
  assert.equal(resolveSchedulingLinkReturnPath('/students'), '/students')
  assert.equal(resolveSchedulingLinkReturnPath('/interviews'), '/interviews')
  // Anything else (Connect, Settings, Catalog, Rotation, unknown) falls back to Interviews, so the
  // confirmation can never open while the Owner is still in the composer.
  for (const p of ['/connect/outreach', '/settings/accounts', '/catalog', '/rotation/matrix', '/nope', '', null]) {
    assert.equal(resolveSchedulingLinkReturnPath(p), DEFAULT_SCHEDULING_LINK_RETURN_PATH)
  }
  assert.match(appShell, /returnPath: resolveSchedulingLinkReturnPath\(location\.pathname\)/)
  assert.match(appShell, /onLaunchSchedulingLink=\{launchSchedulingLinkFromActionCenter\}/)
})

test('all three entry points use the same launch kind, builder, and template key', () => {
  assert.equal(LAUNCH_KINDS.INTERVIEW_SCHEDULING_LINK, 'interview_scheduling_link')
  for (const { name, src } of ENTRY_POINTS) {
    assert.match(src, /writeLaunchContext\(\{ kind: LAUNCH_KINDS\.INTERVIEW_SCHEDULING_LINK, \.\.\.ctx \}\)/, name)
    assert.match(src, /buildSchedulingLinkLaunch\(\{/, `${name} uses the shared builder`)
    assert.match(src, /navigate\('\/connect\/outreach\?launch=1'\)/, name)
    // No surface hard-codes the template key or its own recipient/copy rules.
    assert.doesNotMatch(src, /templateKey: 'student_interview_scheduling'/, name)
    assert.doesNotMatch(src, /Schedule Your ASPIRE Interview/, `${name} carries no inline copy`)
  }
})

test('no scheduling-link Outlook or mailto path survives on any surface', () => {
  for (const { name, src } of [...ENTRY_POINTS, { name: 'Action Center panel', src: actionCenter }]) {
    // A scheduling-link compose would have to name the public route to be useful.
    const schedulingCompose = /(outlookCompose|buildOutlookComposeUrl|openOutlookCompose|mailto:)[^\n]*interview-schedule/
    assert.doesNotMatch(src, schedulingCompose, name)
  }
  // The one place the scheduling email exists is the template.
  assert.doesNotMatch(interviewsTab, /appUrl\('\/interview-schedule'\)/)
  assert.doesNotMatch(sidePanel, /appUrl\('\/interview-schedule'\)/)
  assert.doesNotMatch(actionCenter, /appUrl\('\/interview-schedule'\)/)
})

// ── Completion mechanism ─────────────────────────────────────────────────────

test('one shared return confirmation is mounted at the shell for both surfaces', () => {
  assert.match(appShell, /<SchedulingLinkReturnConfirm/)
  assert.match(appShell, /onRefreshCommunications=\{\(\) => fetchCommunications\(activeCohortId\)\}/)
  // The Interviews worklist needs the communications to label sent vs resend.
  assert.match(appShell, /communications=\{communications\}\s*\n\s*onStudentUpdate=\{updateStudent\}/)
})

test('the return confirmation writes only on confirm, and clears the context on every decision', () => {
  // Cohort + workspace scoping before anything opens.
  assert.match(returnConfirm, /ctx\.kind !== LAUNCH_KINDS\.INTERVIEW_SCHEDULING_LINK/)
  assert.match(returnConfirm, /ctx\.cohortId !== cohortId/)
  assert.match(returnConfirm, /location\.pathname !== ctx\.returnPath/)
  // Zero send evidence → clear, notify, write nothing.
  assert.match(returnConfirm, /if \(confirmed\.length === 0\) \{[\s\S]*?clearLaunchContext\(\)[\s\S]*?return/)
  // The only insert is the scheduling_link communication, and it lives in the confirm handler.
  const confirmHandler = returnConfirm.slice(returnConfirm.indexOf('const handleConfirm'))
  assert.match(confirmHandler, /from\('communications'\)\.insert\(\{/)
  assert.match(confirmHandler, /type: SCHEDULING_LINK_COMM_TYPE/)
  assert.match(confirmHandler, /sent_to_email: schedulingLinkEmail\(s\)/)
  assert.match(confirmHandler, /sent_by: userProfile\?\.full_name \|\| 'ASPIRE Team'/)
  // "Not sent" clears without writing.
  assert.match(returnConfirm, /onClick=\{\(\) => close\('No scheduling link was recorded\.'\)\}/)
  const closeFn = returnConfirm.slice(returnConfirm.indexOf('const close ='), returnConfirm.indexOf('const handleConfirm'))
  assert.doesNotMatch(closeFn, /insert|update\(/)
  // No status write anywhere in this component.
  assert.doesNotMatch(returnConfirm, /from\('students'\)|status:\s*'/)
})

test('no em dash in the new scheduling-link sources', () => {
  for (const src of [read('src/lib/schedulingLinkFlow.js'), returnConfirm]) {
    assert.doesNotMatch(src, /—/)
  }
})
