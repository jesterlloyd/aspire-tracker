// Connect send-and-confirm workflow: launch → Connect (Send to Many) → return → confirm.
//
// Functional tests drive the session launch-context contract (src/lib/connect/launchContext.js)
// against a sessionStorage shim, proving one-shot confirmation state, scoped result recording, and
// safe no-ops. Source guards prove the launch/preselect/return wiring: capacity requests and student
// forms open Connect with the right audience + template, nothing is written before the Owner's return
// confirmation, closing writes nothing, and unrelated Connect visits never trigger a confirmation.
//
// Run: node --test test/connectSendConfirm.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// sessionStorage shim BEFORE importing the lib (it reads window.sessionStorage at call time).
const store = new Map()
globalThis.window = {
  sessionStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
  },
}
const { writeLaunchContext, readLaunchContext, clearLaunchContext, recordLaunchSendResults, LAUNCH_KINDS } =
  await import('../src/lib/connect/launchContext.js')

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const overview = read('src/components/OverviewTab.jsx')
const outreach = read('src/components/connect/OutreachView.jsx')
const composer = read('src/components/connect/BulkManualComposer.jsx')
const modal = read('src/components/CohortResponseTargetsModal.jsx')

const baseCtx = () => ({
  kind: LAUNCH_KINDS.CAPACITY_REQUEST,
  cohortId: 'c1',
  cohortName: 'Fall 2026',
  templateKey: 'unit_capacity_response_request',
  units: [{ key: '6NE', name: '6 NE', email: 'Lead@X.org' }, { key: '6NW', name: '6 NW', email: 'nw@x.org' }],
})

// ─── Launch-context contract (functional) ───────────────────────────────────────

test('write/read round-trip: a valid launch stores a one-shot launched context', () => {
  store.clear()
  const rec = writeLaunchContext(baseCtx())
  assert.equal(rec.status, 'launched')
  const back = readLaunchContext()
  assert.equal(back.kind, 'capacity_request')
  assert.equal(back.cohortId, 'c1')
  assert.deepEqual(back.sentEmails, [])
  assert.equal(back.batchId, null)
})

test('invalid launches are rejected and store nothing', () => {
  store.clear()
  assert.equal(writeLaunchContext({ kind: 'capacity_request', templateKey: 't' }), null) // no cohortId
  assert.equal(writeLaunchContext({ kind: 'bogus', cohortId: 'c1', templateKey: 't' }), null)
  assert.equal(readLaunchContext(), null)
})

test('recordLaunchSendResults is scoped: only a matching template key updates the context', () => {
  store.clear()
  writeLaunchContext(baseCtx())
  // An unrelated Connect bulk send (different template) never touches the context.
  assert.equal(recordLaunchSendResults('student_profile_invitation', { batch_id: 'zzz', sent: [{ email: 'a@b.c' }] }), false)
  assert.equal(readLaunchContext().batchId, null)
  // The matching send records batch id + lowercased sent emails.
  assert.equal(recordLaunchSendResults('unit_capacity_response_request', {
    batch_id: 'b-1', summary: { sent: 1, skipped: 0, failed: 1 }, sent: [{ email: 'Lead@X.org' }],
  }), true)
  const ctx = readLaunchContext()
  assert.equal(ctx.batchId, 'b-1')
  assert.deepEqual(ctx.sentEmails, ['lead@x.org'])
  assert.equal(ctx.summary.failed, 1)
})

test('results merge across retries within one launch (union of sent emails)', () => {
  store.clear()
  writeLaunchContext(baseCtx())
  recordLaunchSendResults('unit_capacity_response_request', { batch_id: 'b-1', sent: [{ email: 'lead@x.org' }] })
  recordLaunchSendResults('unit_capacity_response_request', { batch_id: 'b-2', sent: [{ email: 'NW@x.org' }, { email: 'lead@x.org' }] })
  assert.deepEqual(readLaunchContext().sentEmails.sort(), ['lead@x.org', 'nw@x.org'])
})

test('clear is final: after a decision nothing can reopen or record', () => {
  store.clear()
  writeLaunchContext(baseCtx())
  clearLaunchContext()
  assert.equal(readLaunchContext(), null)
  assert.equal(recordLaunchSendResults('unit_capacity_response_request', { batch_id: 'x', sent: [] }), false)
})

test('corrupt or foreign payloads read as null and are cleared', () => {
  store.clear()
  store.set('aspire.connect.launchContext.v1', '{not json')
  assert.equal(readLaunchContext(), null)
  assert.equal(store.has('aspire.connect.launchContext.v1'), false)
})

// ─── Launch wiring (source guards) ──────────────────────────────────────────────

test('capacity launch: context + navigation only; recipients are resolvable-lead units not yet targets', () => {
  const launch = overview.slice(overview.indexOf('const handleLaunchCapacityRequest'), overview.indexOf('// ── Return confirmation'))
  assert.match(launch, /r\.hasRecipient && !r\.alreadyTarget/)
  assert.match(launch, /kind: LAUNCH_KINDS\.CAPACITY_REQUEST/)
  assert.match(launch, /navigate\('\/connect\/outreach\?launch=1'\)/)
  assert.doesNotMatch(launch, /createCohortResponseTargets|onStudentUpdate/)  // nothing written at launch
})

test('no mailto remains for the migrated actions', () => {
  assert.doesNotMatch(overview, /openOutlookCompose|openMailto|mailto:/)
})

test('Connect opens launched: bulk mode, launched template, audience preselection mapping', () => {
  assert.match(outreach, /searchParams\.get\('launch'\) \? readLaunchContext\(\) : null/)
  assert.match(outreach, /if \(launchCtx\) return 'bulk'/)
  assert.match(outreach, /useState\(launchCtx\?\.templateKey \|\| 'survey_invitation'\)/)
  assert.match(outreach, /contactCategory: 'Unit Leadership'/)
  assert.match(outreach, /source: 'students', studentIds: launchCtx\.studentIds/)
  assert.match(outreach, /initialAudience=\{launchAudience\}/)
})

test('composer: one-shot preselection, email-matched contacts, results recorded only on real success', () => {
  assert.match(composer, /const ia = hydratedType === null \? initialAudience : null/)  // first hydrate only
  assert.match(composer, /launchDraftSkippedRef/)                                        // draft cannot clobber
  assert.match(composer, /wantedSet\.has\(normalizeEmailForLookup\(c\.email\)\)/)        // identity by email
  // recordLaunchSendResults sits inside the success branch of the real send.
  const sendIdx = composer.indexOf('if (res.ok && data?.success)')
  const successBlock = composer.slice(sendIdx, sendIdx + 700)
  assert.match(successBlock, /recordLaunchSendResults\(bulkMsgType, data\)/)
  // Opening Connect never sends: the send still requires the typed confirmation phrase.
  assert.match(composer, /CONFIRM_PHRASE = 'SEND MESSAGES'/)
})

// ─── Return confirmation (source guards) ────────────────────────────────────────

test('unit confirmation modal: exact copy and the three decisions (ASPIRE-DESIGN-CORRECTION-1)', () => {
  assert.match(overview, /Were the capacity requests sent\?/)
  assert.match(overview, /Confirm whether the Unit Leader Capacity Request was sent\. Only confirmed units will be counted as expected to respond\./)
  assert.match(overview, /Sent to All Selected Units/)
  assert.match(overview, /Identify Units Sent/)
  assert.match(overview, /Not Sent/)
  // The first (choice) step is COMPACT: the unit list renders ONLY in identify mode (the checklist),
  // never as an inline joined string in the choice step.
  assert.doesNotMatch(overview, /\.map\(u => u\.name\)\.join\(' · '\)/)
  // Identify preselects from REAL recorded results; close/Not Sent write nothing and clear the context.
  assert.match(overview, /sent\.has\(String\(u\.email \|\| ''\)\.toLowerCase\(\)\)/)
  const close = overview.slice(overview.indexOf('const closeCapacityConfirm'), overview.indexOf('// Record the confirmed units'))
  assert.match(close, /clearLaunchContext\(\)/)
  assert.doesNotMatch(close, /createCohortResponseTargets/)
})

test('only confirmation records targets, via the idempotent staff RPC path', () => {
  const idx = overview.indexOf('const recordConfirmedCapacityUnits')
  assert.ok(idx > 0)
  const rec = overview.slice(idx, idx + 1400)
  assert.match(rec, /createCohortResponseTargets\(capacityConfirm\.cohortId, payload\)/)
  assert.match(rec, /refetchTargets\(\)/)
})

test('return effect is scoped: same cohort, launched context only, never while a decision is open', () => {
  assert.match(overview, /if \(location\.pathname !== '\/aggregate'\) return/)
  assert.match(overview, /if \(capacityConfirm \|\| sendFormPlan\) return/)
  assert.match(overview, /if \(!ctx \|\| ctx\.cohortId !== cohortId\) return/)
})

test('student return confirmation reuses the existing confirm-gated Form Sent flow and clears context', () => {
  assert.match(overview, /buildSchoolSendPlan\(ctx\.school, affectedSent\)/)
  assert.match(overview, /buildStudentSendPlan\(affectedSent\[0\]\)/)
  const confirm = overview.slice(overview.indexOf('const handleConfirmFormSent'), overview.indexOf('const handleCancelFormSent'))
  assert.match(confirm, /status: 'Form Sent'/)
  assert.match(confirm, /clearLaunchContext\(\)/)
  const cancelIdx = overview.indexOf('const handleCancelFormSent')
  const cancel = overview.slice(cancelIdx, cancelIdx + 400)
  assert.match(cancel, /clearLaunchContext\(\)/)
  assert.doesNotMatch(cancel, /onStudentUpdate/)
})

// ─── Partial-send gating (final pre-release check, item 1) ──────────────────────

test('direct student confirmation is gated on Connect-reported successes only', () => {
  // Only students whose email is in the recorded sentEmails are confirmable.
  assert.match(overview, /const sentSet = new Set\(\(ctx\.sentEmails \|\| \[\]\)\.map\(lowEmail\)\)/)
  assert.match(overview, /sentSet\.has\(lowEmail\(s\.school_email\)\) \|\| sentSet\.has\(lowEmail\(s\.personal_email\)\)/)
  // Zero successes: safe no-success result, context cleared, nothing written, no Mark as sent offered.
  const zero = overview.slice(overview.indexOf('if (affectedSent.length === 0)'), overview.indexOf('if (affectedSent.length === 0)') + 400)
  assert.match(zero, /clearLaunchContext\(\)/)
  assert.match(zero, /did not report any successful student sends\. No status was changed\./)
  assert.match(zero, /return/)
})

test('school confirmation is gated per student on Connect-reported successes (design correction)', () => {
  // ASPIRE-DESIGN-CORRECTION-1: the school flow sends to the STUDENTS themselves, so its return
  // confirmation shares the direct flow's per-student gate - only successfully sent students are
  // confirmable, and the coordinator-mediated gate is gone.
  assert.doesNotMatch(overview, /coordinatorSent/)
  assert.match(overview, /ctx\.kind === LAUNCH_KINDS\.SCHOOL_FORM\s*\n\s*\? buildSchoolSendPlan\(ctx\.school, affectedSent\)/)
})

test('school launch preselects the intended STUDENTS (Owner design correction, not a Contacts category)', () => {
  const school = overview.slice(overview.indexOf('const handleSendSchool'), overview.indexOf('const handleSendStudent'))
  assert.match(school, /studentIds: plan\.students\.map\(s => s\.id\)/)
  assert.doesNotMatch(school, /coordinator|contactEmails/)         // no coordinator mediation remains
  // Connect preset: audience Students with the launched student ids preselected; the school flow
  // must NOT open on Contacts → Academic Partners.
  assert.match(outreach, /source: 'students', studentIds: launchCtx\.studentIds/)
  assert.doesNotMatch(outreach, /contactCategory: 'Academic Partners'/)
})

test('launch context persists contactEmails for contact-mediated launches', () => {
  store.clear()
  writeLaunchContext({ kind: LAUNCH_KINDS.SCHOOL_FORM, cohortId: 'c1', templateKey: 'student_profile_invitation', studentIds: ['s1'], school: 'CSUN', contactEmails: ['Coord@School.edu'] })
  const ctx = readLaunchContext()
  assert.deepEqual(ctx.contactEmails, ['Coord@School.edu'])
  assert.deepEqual(ctx.studentIds, ['s1'])
  // The gate compares case-insensitively: a sent record for the coordinator matches.
  recordLaunchSendResults('student_profile_invitation', { batch_id: 'b9', sent: [{ email: 'coord@school.edu' }] })
  assert.deepEqual(readLaunchContext().sentEmails, ['coord@school.edu'])
})

// ─── Manual fallback (source guards) ────────────────────────────────────────────

test('manual fallback is clearly labeled and gated by the explicit outside-Connect confirmation', () => {
  assert.match(modal, /Mark units as already contacted/)
  assert.match(modal, /I confirm these units already received the capacity request outside ASPIRE Connect\./)
  assert.match(modal, /disabled=\{!counts\.selected \|\| !confirmContacted \|\| saving\}/)
})
