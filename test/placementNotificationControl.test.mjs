// PLACEMENT-NOTIFICATION-CONTROL-1
//
// One compact, staff-controlled notification workflow for unit leaders and
// preceptors, and the remaining Preceptor Assignment template corrections.
//
// HOW THIS SUITE IS BUILT. The state rule is a pure module, so it is executed
// with real rows and real outputs. The two failing controls at the top run the
// SUPERSEDED rule against the same rows, so the defect this release fixes is
// reproduced before the replacement is proved. Everything the DOM decides -
// tooltip geometry, keyboard activation, narrow layout - is proved in the
// fixture browser QC, not asserted from source strings here; what this file
// asserts about components is confined to facts a source scan can honestly
// establish, such as "there is exactly one implementation" and "the retired
// chip has zero active occurrences".
//
// Endpoint behavior (confirm, correct, refusals, idempotency, the legacy
// projection) is proved by executing the REAL handler against a fake database
// in test/outreachAttachmentEndpoints.test.mjs - the harness for that already
// lives there, and duplicating it would create a second thing to keep in step.
//
// Run: node --test test/placementNotificationControl.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
// Strip comments so no assertion can be satisfied by prose I wrote ABOUT the
// code instead of by the code.
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/^\s*\*.*$/gm, '')

const {
  NOTIFICATION_TARGETS, NOTIFY_META,
  CONFIRMED_TYPE, CORRECTED_TYPE, CONFIRMED_STATUS, CORRECTED_STATUS,
  LEGACY_MANUAL_TYPE, LEGACY_MANUAL_STATUS,
  notificationKey, notificationStateIndex, notificationStateFor,
  NOTIFY_LABELS, labelsFor, confirmationPrompt, correctionPrompt,
} = await import('../src/lib/placementNotificationState.js')

const { preceptorSentIndex, preceptorSentState } =
  await import('../src/lib/placementPreceptorSent.js')

const { buildPreceptorAssignmentDraft } = await import('../src/lib/outreachTemplates.js')
const {
  PRECEPTOR_ASSIGNMENT_DOCUMENTS, resolveRequiredAttachments,
  attachmentClaimBlockReason, attachmentProblemText, attachmentWarningText,
} = await import('../src/lib/connect/catalogAttachments.js')

// ── A world of real placements ──────────────────────────────────────────────

const M = {
  A: 'ffffffff-0000-4000-8000-0000000000a1',   // Victoria on 5 South
  B: 'ffffffff-0000-4000-8000-0000000000b1',   // Victoria's SECOND placement
  REBUILT: 'ffffffff-0000-4000-8000-0000000000c1',
}
const P = {
  ROMELYN: 'eeeeeeee-0000-4000-8000-000000000001',
  OTHER: 'eeeeeeee-0000-4000-8000-000000000002',
}
const S = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'dddddddd-0000-4000-8000-000000000001'
const C = { ONE: 'cccccccc-0000-4000-8000-00000000000c', TWO: 'cccccccc-0000-4000-8000-00000000000d' }

let seq = 0
const meta = (over) => ({
  [NOTIFY_META.student]: S, [NOTIFY_META.unit]: U, [NOTIFY_META.cohort]: C.ONE,
  [NOTIFY_META.actor]: 'staff-1', [NOTIFY_META.actorName]: 'Test Owner', ...over,
})
const confirmRow = (over = {}, at = '2026-08-18T10:00:00.000Z') => ({
  id: `row-${++seq}`, notification_type: CONFIRMED_TYPE, status: CONFIRMED_STATUS,
  sent_at: at, metadata: meta(over),
})
const correctRow = (over = {}, at = '2026-08-18T11:00:00.000Z') => ({
  id: `row-${++seq}`, notification_type: CORRECTED_TYPE, status: CORRECTED_STATUS,
  sent_at: at, metadata: meta({ [NOTIFY_META.reason]: 'marked by mistake', ...over }),
})
const leaderMeta = (matchId = M.A) => ({
  [NOTIFY_META.target]: NOTIFICATION_TARGETS.UNIT_LEADER, [NOTIFY_META.match]: matchId,
})
const precMeta = (matchId = M.A, preceptorId = P.ROMELYN) => ({
  [NOTIFY_META.target]: NOTIFICATION_TARGETS.PRECEPTOR,
  [NOTIFY_META.match]: matchId, [NOTIFY_META.preceptor]: preceptorId,
})
const providerRow = (over = {}) => ({
  id: `send-${++seq}`, notification_type: 'direct_message_sent', status: 'delivered',
  sent_at: '2026-08-18T09:00:00.000Z',
  metadata: {
    placement_template_key: 'preceptor_assignment',
    placement_match_id: M.A, placement_preceptor_id: P.ROMELYN,
    placement_student_id: S, placement_unit_id: U, placement_cohort_id: C.ONE, ...over,
  },
})

const leaderState = (rows, matchId = M.A, opts) =>
  notificationStateFor(notificationStateIndex(rows),
    { target: NOTIFICATION_TARGETS.UNIT_LEADER, matchId }, opts)
const precState = (rows, matchId = M.A, preceptorId = P.ROMELYN, opts) =>
  notificationStateFor(notificationStateIndex(rows),
    { target: NOTIFICATION_TARGETS.PRECEPTOR, matchId, preceptorId }, opts)

// ── FAILING CONTROLS: the defect, reproduced against the same rows ──────────
//
// These two run the SUPERSEDED rule. They pass only while the old behavior is
// genuinely what it was, and they are what the rest of this file replaces.

test('FAILING CONTROL: the old rule called a DELIVERED email "notified"', () => {
  const rows = [providerRow()]
  // The superseded reducer: provider delivery history WAS the board's state.
  const old = preceptorSentState(preceptorSentIndex(rows), { matchId: M.A, preceptorId: P.ROMELYN })
  assert.equal(old.sent, true,
    'the old board showed a notified state with no human confirmation anywhere')

  // The replacement: the same row, and nobody has said anything.
  assert.equal(precState(rows).confirmed, false,
    'delivery history alone must never read as a staff confirmation')
})

test('FAILING CONTROL: the two rows meant different things by "notified"', () => {
  // The unit-leader row read a boolean on the match; the preceptor row read
  // provider evidence. The same placement could therefore be simultaneously
  // "notified" on one line and not on the other, for reasons that had nothing
  // to do with each other.
  const rows = [providerRow()]
  const oldLeader = false                                  // matches.notification_sent
  const oldPreceptor = preceptorSentState(preceptorSentIndex(rows), { matchId: M.A, preceptorId: P.ROMELYN }).sent
  assert.notEqual(oldLeader, oldPreceptor, 'the two lines disagreed by construction')

  // Under one rule, both lines answer the same question the same way, and both
  // answer "no" until a person says otherwise.
  assert.equal(leaderState(rows).confirmed, false)
  assert.equal(precState(rows).confirmed, false)
})

// ── 1. One control, one state rule ──────────────────────────────────────────

test('PROOF 1: both rows render the SAME component, with no second implementation', () => {
  const board = strip(read('src/components/EmbedUnitCard.jsx'))
  const uses = board.match(/<NotificationControl\b/g) || []
  assert.equal(uses.length, 2, 'exactly the preceptor row and the unit-leader cluster')
  assert.match(board, /target=\{NOTIFICATION_TARGETS\.PRECEPTOR\}/)
  assert.match(board, /target=\{NOTIFICATION_TARGETS\.UNIT_LEADER\}/)

  // NEGATIVE CONTROL: the retired bespoke pieces are gone from the board.
  for (const dead of ['preceptorSentLabel', 'preceptorSentTooltip', 'ENVELOPE_BTN']) {
    assert.ok(!board.includes(dead), `${dead} is a second implementation and must be gone`)
  }
  // And the Action Center renders the same component rather than its own strip.
  const ac = strip(read('src/components/ActionCenter.jsx'))
  assert.match(ac, /<NotificationControl\b/)
  assert.ok(!ac.includes('ac-notify-confirm-yes'), 'the bespoke confirmation strip is retired')
})

test('PROOF 1b: exactly one file defines the control, and one defines the rule', () => {
  const control = strip(read('src/components/placement/NotificationControl.jsx'))
  assert.match(control, /export default function NotificationControl/)
  // The words come from the shared rule, not from the component.
  assert.match(control, /labelsFor|confirmationPrompt|correctionPrompt/)
  assert.ok(!/'(Notify Unit Leader|Notify Preceptor|Mark Unit Leader as Notified)'/.test(control),
    'labels must come from the shared module, never be re-typed in the component')
})

// ── 2. The exact words ──────────────────────────────────────────────────────

test('PROOF 2: all four pre-confirmation labels are EXACTLY as requested', () => {
  assert.equal(labelsFor(NOTIFICATION_TARGETS.UNIT_LEADER).envelope, 'Notify Unit Leader')
  assert.equal(labelsFor(NOTIFICATION_TARGETS.UNIT_LEADER).check, 'Mark Unit Leader as Notified')
  assert.equal(labelsFor(NOTIFICATION_TARGETS.PRECEPTOR).envelope, 'Notify Preceptor')
  assert.equal(labelsFor(NOTIFICATION_TARGETS.PRECEPTOR).check, 'Mark Preceptor as Notified')
  // And the confirmed status, which is a DIFFERENT string from the check.
  assert.equal(labelsFor(NOTIFICATION_TARGETS.UNIT_LEADER).confirmed, 'Unit Leader Notified')
  assert.equal(labelsFor(NOTIFICATION_TARGETS.PRECEPTOR).confirmed, 'Preceptor Notified')
})

test('PROOF 2b: an unconfirmed check is never labelled as though it were done', () => {
  for (const t of Object.values(NOTIFICATION_TARGETS)) {
    const l = labelsFor(t)
    assert.notEqual(l.check, l.confirmed,
      'before confirmation the check is an ACTION, not a status')
    assert.match(l.check, /^Mark /)
    assert.match(l.confirmed, / Notified$/)
  }
  // An unknown target falls back to a real label rather than undefined.
  assert.equal(labelsFor('nonsense').envelope, 'Notify Unit Leader')
})

test('PROOF 2c: the confirmation dialog names person, student, unit and consequence', () => {
  const text = confirmationPrompt({
    target: NOTIFICATION_TARGETS.PRECEPTOR,
    personName: 'Romelyn Martha Sanchez', studentName: 'Victoria Marquez', unitName: '5 South',
  })
  assert.match(text, /Romelyn Martha Sanchez/)
  assert.match(text, /Victoria Marquez/)
  assert.match(text, /5 South/)
  assert.match(text, /will show as notified on the Placement Board/)
  // NEGATIVE CONTROL: missing names degrade to honest generics, never "undefined".
  const bare = confirmationPrompt({ target: NOTIFICATION_TARGETS.UNIT_LEADER })
  assert.ok(!/undefined|null/.test(bare), bare)
  assert.match(bare, /the unit leader/)
})

// ── 5-9. Opening, abandoning and clicking record nothing ────────────────────

test('PROOF 5: opening either envelope performs no database write', () => {
  const board = strip(read('src/components/EmbedUnitCard.jsx'))

  const leaderOpener = board.slice(board.indexOf('const openUnitLeaderNotice'),
    board.indexOf('const reviewThenNotify'))
  assert.match(leaderOpener, /openMailtoLink\(message\.url\)/, 'it still opens the draft')
  for (const write of ['onUpdateMatch', 'notification_sent', 'notified_at', '.insert(', '.update(']) {
    assert.ok(!leaderOpener.includes(write), `opening must not ${write}`)
  }

  const precOpener = board.slice(board.indexOf('const handleEmailPreceptor'),
    board.indexOf('const borderColor'))
  assert.ok(!precOpener.includes('.insert('), 'the preceptor handoff writes no row')
  assert.ok(!precOpener.includes('.update('))
  assert.ok(!precOpener.includes('notification_sent'))
  // NEGATIVE CONTROL: the retired "remember the handoff" marker is gone, so a
  // return trip cannot resurrect a question that assumed a send.
  assert.ok(!board.includes('pendingPreceptorHandoff'),
    'opening a draft must leave no trace that later asks to be confirmed')
})

test('PROOF 6+9: nothing is recorded until the dialog is confirmed', () => {
  const control = strip(read('src/components/placement/NotificationControl.jsx'))
  // The check opens a dialog. It does not call onConfirm.
  const checkBtn = control.slice(control.indexOf('data-testid={`notify-check-'),
    control.indexOf('{dialog === \'confirm\''))
  assert.match(checkBtn, /setDialog\('confirm'\)/)
  assert.ok(!checkBtn.includes('onConfirm'), 'the check must not write; it must ask')
  // Cancel closes and writes nothing.
  const cancel = control.slice(control.indexOf('data-testid={`notify-cancel-'),
    control.indexOf('data-testid={`notify-confirm-'))
  assert.match(cancel, /setDialog\(null\)/)
  assert.ok(!cancel.includes('onConfirm'))
  // Only the confirm button runs the writer.
  assert.match(control, /data-testid=\{`notify-confirm-\$\{target\}`\}[\s\S]{0,200}onClick=\{runConfirm\}/)
})

test('PROOF 7+8: a successful send is history; it is not a confirmation', () => {
  const rows = [providerRow()]
  // The provider row is still readable as delivery history by its own reader.
  assert.equal(preceptorSentState(preceptorSentIndex(rows), { matchId: M.A, preceptorId: P.ROMELYN }).sent, true)
  // The confirmation ledger is untouched by it.
  assert.equal(precState(rows).confirmed, false)
  assert.equal(precState(rows).hasHistory, false)
  // Both can be true at once, and they stay separate facts.
  const both = [...rows, confirmRow(precMeta())]
  assert.equal(preceptorSentState(preceptorSentIndex(both), { matchId: M.A, preceptorId: P.ROMELYN }).sent, true)
  assert.equal(precState(both).confirmed, true)
  assert.equal(precState(both).source, 'ledger')
})

test('PROOF 32: a bounce or a failed send creates no confirmation', () => {
  for (const status of ['bounced', 'complained', 'failed']) {
    const rows = [{ ...providerRow(), status }]
    assert.equal(precState(rows).confirmed, false, `${status} must not read as confirmed`)
  }
})

// ── 10-11. Confirming records exactly one thing, once ───────────────────────

test('PROOF 10: a confirmation is placement-specific and singular', () => {
  const rows = [confirmRow(precMeta())]
  const index = notificationStateIndex(rows)
  assert.equal(index.size, 1, 'one placement, one entry')
  assert.equal(index.get(notificationKey({
    target: NOTIFICATION_TARGETS.PRECEPTOR, matchId: M.A, preceptorId: P.ROMELYN,
  })).confirmed, true)
  // Nothing else on the same board is touched by it.
  assert.equal(leaderState(rows).confirmed, false, 'the unit leader is a separate target')
  assert.equal(precState(rows, M.B).confirmed, false, 'the other placement is separate')
})

test('PROOF 11: repeated confirmation cannot create duplicate effective state', () => {
  const rows = [
    confirmRow(precMeta(), '2026-08-18T10:00:00.000Z'),
    confirmRow(precMeta(), '2026-08-18T10:05:00.000Z'),
    confirmRow(precMeta(), '2026-08-18T10:06:00.000Z'),
  ]
  const index = notificationStateIndex(rows)
  assert.equal(index.size, 1, 'three rows, ONE effective state')
  const st = precState(rows)
  assert.equal(st.confirmed, true)
  // The history is still countable for a details view.
  assert.equal(index.get(notificationKey({
    target: NOTIFICATION_TARGETS.PRECEPTOR, matchId: M.A, preceptorId: P.ROMELYN,
  })).count, 3)
})

test('PROOF 11b: same-instant events resolve identically for every reader', () => {
  const at = '2026-08-18T10:00:00.000Z'
  const a = { ...confirmRow(precMeta(), at), id: 'aaa' }
  const b = { ...correctRow(precMeta(), at), id: 'bbb' }
  // Whatever order they arrive in, the tiebreak is the row id - so two browsers
  // reading the same table never disagree about what the board says.
  const forward = notificationStateFor(notificationStateIndex([a, b]),
    { target: NOTIFICATION_TARGETS.PRECEPTOR, matchId: M.A, preceptorId: P.ROMELYN })
  const reverse = notificationStateFor(notificationStateIndex([b, a]),
    { target: NOTIFICATION_TARGETS.PRECEPTOR, matchId: M.A, preceptorId: P.ROMELYN })
  assert.deepEqual(forward, reverse)
})

// ── 12-15. The confirmed state ──────────────────────────────────────────────

test('PROOF 12+13: confirmation retires BOTH actions for one compact status', () => {
  const control = strip(read('src/components/placement/NotificationControl.jsx'))
  const confirmed = control.slice(control.indexOf('if (confirmed) {'),
    control.indexOf('return (\n    <span', control.indexOf('if (confirmed) {')))
  // The confirmed branch returns before the two action buttons can be reached.
  assert.ok(!confirmed.includes('notify-envelope-'), 'the envelope is retired')
  assert.ok(!confirmed.includes('notify-check-'), 'the check is retired')
  assert.match(confirmed, /notify-status-\$\{target\}/)
  assert.match(confirmed, /\{compact \? '' : 'Notified'\}/)
})

test('PROOF 14: the confirmed status cannot notify by mouse, Enter or Space', () => {
  const control = strip(read('src/components/placement/NotificationControl.jsx'))
  const status = control.slice(control.indexOf('data-testid={`notify-status-'),
    control.indexOf('{onCorrect && ('))
  assert.match(status, /aria-disabled="true"/)
  assert.match(status, /if \(e\.key === 'Enter' \|\| e\.key === ' '\)[\s\S]{0,80}preventDefault/)
  assert.ok(!status.includes('onConfirm'), 'the status is inert')
  assert.ok(!status.includes('onOpenDraft'), 'and it opens nothing')
  // NEGATIVE CONTROL: it is NOT natively disabled, or it would lose focus and
  // its tooltip would become unreachable exactly when it is wanted.
  assert.ok(!/(^|[^-])\bdisabled=/.test(status), 'must stay focusable for its tooltip')
})

test('PROOF 15: the confirmed state survives refresh and navigation', () => {
  // It is derived from stored rows, not from anything a component remembers.
  const rows = [confirmRow(precMeta())]
  const afterRefresh = notificationStateIndex(JSON.parse(JSON.stringify(rows)))
  assert.equal(notificationStateFor(afterRefresh,
    { target: NOTIFICATION_TARGETS.PRECEPTOR, matchId: M.A, preceptorId: P.ROMELYN }).confirmed, true)
  // And the board reads those rows on every mount, scoped to the open cohort.
  const board = strip(read('src/components/MatchingTab.jsx'))
  const q = board.slice(board.indexOf("queryKey: ['placement_notification_state'"),
    board.indexOf('const notificationIndex'))
  assert.match(q, /refetchOnMount: 'always'/)
  assert.match(q, /\.eq\('metadata->>placement_cohort_id', cohortId\)/)
  assert.ok(!q.includes('.insert('), 'the board only reads')
  assert.ok(!q.includes('.update('))
})

// ── 16-18. Identity and reset ───────────────────────────────────────────────

test('PROOF 16: a different preceptor starts unnotified', () => {
  const rows = [confirmRow(precMeta(M.A, P.ROMELYN))]
  assert.equal(precState(rows, M.A, P.ROMELYN).confirmed, true)
  assert.equal(precState(rows, M.A, P.OTHER).confirmed, false,
    'replacing the preceptor must not inherit the previous person\'s confirmation')
  // And the original record survives for the person it was about.
  assert.equal(precState(rows, M.A, P.ROMELYN).hasHistory, true)
})

test('PROOF 17: a deleted and recreated match starts unnotified', () => {
  const rows = [confirmRow(precMeta(M.A)), confirmRow(leaderMeta(M.A))]
  assert.equal(precState(rows, M.REBUILT).confirmed, false)
  assert.equal(leaderState(rows, M.REBUILT).confirmed, false)
})

test('PROOF 18: multi-unit placements and cohorts stay isolated', () => {
  // Victoria has two placements. Only one preceptor has been confirmed.
  const rows = [confirmRow(precMeta(M.A, P.ROMELYN))]
  assert.equal(precState(rows, M.A, P.ROMELYN).confirmed, true)
  assert.equal(precState(rows, M.B, P.OTHER).confirmed, false)
  assert.equal(precState(rows, M.B, P.ROMELYN).confirmed, false,
    'the same preceptor on a DIFFERENT placement is a different question')
  assert.equal(leaderState(rows, M.B).confirmed, false)

  // Cohort isolation is enforced where the rows are read: a foreign-cohort row
  // never reaches the reducer, and it would not match this board's keys anyway.
  const foreign = [confirmRow({ ...precMeta(M.A), [NOTIFY_META.cohort]: C.TWO })]
  const board = strip(read('src/components/MatchingTab.jsx'))
  assert.match(board, /\.eq\('metadata->>placement_cohort_id', cohortId\)/)
  assert.equal(foreign[0].metadata[NOTIFY_META.cohort], C.TWO, 'the row is stamped with its cohort')
})

test('PROOF 18b: a malformed or incomplete row is not usable state', () => {
  const bad = [
    confirmRow({ [NOTIFY_META.target]: NOTIFICATION_TARGETS.PRECEPTOR }),           // no match
    confirmRow({ [NOTIFY_META.target]: NOTIFICATION_TARGETS.PRECEPTOR, [NOTIFY_META.match]: M.A }), // no preceptor
    { id: 'x', notification_type: CONFIRMED_TYPE, status: CONFIRMED_STATUS, metadata: null },
    { id: 'y', notification_type: CONFIRMED_TYPE, status: 'queued', metadata: meta(precMeta()) },
  ]
  assert.equal(notificationStateIndex(bad).size, 0)
  assert.equal(notificationStateIndex(null).size, 0)
  assert.equal(notificationKey({ target: NOTIFICATION_TARGETS.PRECEPTOR, matchId: M.A }), '',
    'a preceptor key without a preceptor is no key at all')
})

// ── 19-21. Correction ───────────────────────────────────────────────────────

test('PROOF 19: a correction requires a reason, in the UI and at the server', () => {
  const control = strip(read('src/components/placement/NotificationControl.jsx'))
  assert.match(control, /if \(r\.length < 3\) \{ setReasonError/)
  assert.match(control, /notify-correct-reason-\$\{target\}/)
  const endpoint = strip(read('api/placement-notification-confirm.js'))
  assert.match(endpoint, /action === 'correct' && reason\.length < 3/)
  assert.match(endpoint, /A correction requires a reason\./)
})

test('PROOF 20: a correction preserves the original and carries its own audit', () => {
  const original = confirmRow(precMeta(), '2026-08-18T10:00:00.000Z')
  const correction = correctRow(precMeta(), '2026-08-18T12:00:00.000Z')
  const rows = [original, correction]
  const st = precState(rows)
  assert.equal(st.confirmed, false, 'the correction is now the effective state')
  assert.equal(st.corrected, true)
  assert.equal(st.reason, 'marked by mistake')
  // The original row is still in the ledger, unmodified.
  assert.equal(rows[0].notification_type, CONFIRMED_TYPE)
  assert.equal(rows[0].status, CONFIRMED_STATUS)
  assert.equal(notificationStateIndex(rows).get(notificationKey({
    target: NOTIFICATION_TARGETS.PRECEPTOR, matchId: M.A, preceptorId: P.ROMELYN,
  })).count, 2, 'both events are countable history')
})

test('PROOF 21: after a correction the two actions come back, and can be redone', () => {
  const rows = [confirmRow(precMeta(), '2026-08-18T10:00:00.000Z'),
    correctRow(precMeta(), '2026-08-18T11:00:00.000Z')]
  assert.equal(precState(rows).confirmed, false, 'unnotified again - so [✉] [✓] render')
  // And confirming again is honest rather than blocked.
  const again = [...rows, confirmRow(precMeta(), '2026-08-18T12:00:00.000Z')]
  assert.equal(precState(again).confirmed, true)
  assert.equal(precState(again).corrected, false)
})

test('PROOF 21b: correction never touches the match, unit or preceptor', () => {
  const endpoint = strip(read('api/placement-notification-confirm.js'))
  const updates = endpoint.match(/\.update\(([\s\S]{0,220}?)\)\n/g) || []
  assert.equal(updates.length, 1, 'exactly one projection write exists in the endpoint')
  assert.match(updates[0], /notification_sent/)
  for (const forbidden of ['preceptor_id', 'preceptor_assigned', 'unit_id', 'student_id:', 'shift_assigned']) {
    assert.ok(!updates[0].includes(forbidden), `a notification must never write ${forbidden}`)
  }
  // And no delete path exists at all.
  assert.ok(!endpoint.includes('.delete('), 'delivery history and confirmations are never deleted')
})

test('PROOF 19b: the correction affordance is Owner/Admin only, enforced server-side', () => {
  const endpoint = strip(read('api/placement-notification-confirm.js'))
  assert.match(endpoint, /profile\.is_owner === true \|\| \['owner', 'admin'\]\.includes\(profile\.role\)/)
  assert.match(endpoint, /return \{ ok: false, status: 403 \}/)
  // The board decides visibility with the same rule, and passes null otherwise -
  // so a non-owner's control has no correction handler to call at all.
  const board = strip(read('src/components/MatchingTab.jsx'))
  assert.match(board, /canCorrectNotifications = notifyActor\?\.is_owner === true/)
  const card = strip(read('src/components/EmbedUnitCard.jsx'))
  assert.match(card, /onCorrect=\{canCorrect \? \(reason\)/)
})

// ── 22. The Action Center ───────────────────────────────────────────────────

test('PROOF 22: the Action Center uses the same state, writer and semantics', () => {
  const ac = strip(read('src/components/ActionCenter.jsx'))
  // Same component.
  assert.match(ac, /<NotificationControl[\s\S]{0,400}target=\{NOTIFICATION_TARGETS\.UNIT_LEADER\}/)
  // Same writer.
  assert.match(ac, /fetch\('\/api\/placement-notification-confirm'/)
  assert.ok(!/notifiedPatch\(\)/.test(ac), 'no second way to write notified state')

  // Opening the mailto does not clear the task.
  const branch = ac.slice(ac.indexOf("if (item.actionType === 'unit_notification_needed'"),
    ac.indexOf("if (item.emailHref && item.markDoneType === 'log_communication')"))
  assert.match(branch, /openHref\(item\.emailHref\)/)
  assert.ok(!branch.includes('logCompleted'), 'opening must not clear the task')
  assert.ok(!branch.includes('logComm'), 'opening must not log a communication')
  assert.ok(!branch.includes('notification_sent'))

  // Human confirmation clears it, and only after the server has recorded.
  const confirm = ac.slice(ac.indexOf('const handleConfirmNotified'), ac.indexOf('  // ── Mark Complete'))
  assert.ok(confirm.indexOf('logCompleted') > confirm.indexOf('await fetch'),
    'the task is cleared only after the write succeeds')
  assert.match(confirm, /setActioning\(null\)[\s\S]{0,200}throw e/, 'a failure leaves the work to do')
})

test('PROOF 22b: an audited correction restores the task', () => {
  // The task predicate is matches.notification_sent (lib/attention.js), and the
  // endpoint mirrors the ledger onto it in BOTH directions - so a correction
  // makes the task applicable again rather than stranding it.
  const attention = strip(read('src/lib/attention.js'))
  assert.match(attention, /return m && !m\.notification_sent/)
  const endpoint = strip(read('api/placement-notification-confirm.js'))
  assert.match(endpoint, /\? \{ notification_sent: true, notified_at: now \}[\s\S]{0,120}notification_sent: false, notified_at: null/)
  // And both surfaces bring the in-memory projection into step without a second
  // database write of their own.
  for (const f of ['src/components/ActionCenter.jsx', 'src/components/MatchingTab.jsx']) {
    assert.match(strip(read(f)), /onMatchLocalSync\?\.\(/, `${f} syncs the projection locally`)
  }
  const app = strip(read('src/App.jsx'))
  const sync = app.slice(app.indexOf('const syncMatchLocal'), app.indexOf('const exportCSV'))
  assert.ok(!sync.includes('supabase'), 'the local sync performs no database write')
})

// ── 23-24. The retired UI has zero active occurrences ───────────────────────

test('PROOF 23+24: the giant tooltip and the blue dated chip are gone', () => {
  const surfaces = [
    'src/components/EmbedUnitCard.jsx', 'src/components/MatchingTab.jsx',
    'src/components/ActionCenter.jsx', 'src/components/placement/NotificationControl.jsx',
  ]
  for (const f of surfaces) {
    const src = strip(read(f))
    assert.ok(!src.includes('preceptorSentTooltip'), `the sentence tooltip survives in ${f}`)
    assert.ok(!src.includes('preceptorSentLabel'), `the dated chip label survives in ${f}`)
    assert.ok(!/has not been sent the assignment email/.test(src), `the sentence survives in ${f}`)
    assert.ok(!/Sent \$\{/.test(src), `a dated Sent chip survives in ${f}`)
  }
  // The shared labels are SHORT - the point of the change.
  for (const t of Object.values(NOTIFICATION_TARGETS)) {
    for (const [k, v] of Object.entries(labelsFor(t))) {
      assert.ok(v.length <= 30, `${t}.${k} is a paragraph, not a label: ${v}`)
    }
  }
})

test('PROOF 23b: the post-draft "were you able to send it?" prompt is retired', () => {
  const board = strip(read('src/components/MatchingTab.jsx'))
  assert.ok(!board.includes('pendingHandoff'))
  assert.ok(!/Were you able to send/.test(board))
  assert.ok(!board.includes('placement-preceptor-confirm'),
    'the superseded endpoint has no callers')
})

// ── 25-30. The template ─────────────────────────────────────────────────────

const PLACEMENT = {
  studentName: 'Victoria Marquez', school: 'Mount Saint Mary’s University',
  unit: '5 South', schedule: 'August 4 to September 12, 2026', hoursRequired: '120 hours',
  preceptorFirstName: 'Romelyn',
}

test('PROOF 25: the exact subject appears on BOTH template entry paths', () => {
  const EXPECTED = 'ASPIRE: Student Assignment and Introduction Details'
  const handoff = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: true })
  const manual = buildPreceptorAssignmentDraft({ firstName: 'Romelyn', attachmentsAttached: true })
  assert.equal(handoff.subject, EXPECTED)
  assert.equal(manual.subject, EXPECTED)
  // NEGATIVE CONTROL: the superseded subject is unreachable from any state.
  for (const attachmentsAttached of [true, false]) {
    const d = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached })
    assert.ok(!/Preceptor Assignment & Details/.test(d.subject))
  }
})

test('PROOF 26: the attachment bullet is exact, and sits under A Few Quick Reminders', () => {
  const EXPECTED = 'Please see the attached ASPIRE Brochure and General Guidelines for Pre-Licensure Students for your reference.'
  for (const d of [
    buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: true }),
    buildPreceptorAssignmentDraft({ firstName: 'Romelyn', attachmentsAttached: true }),
  ]) {
    assert.ok(d.body.includes(EXPECTED), 'plain text carries the exact sentence')
    assert.ok(d.richBody.includes(EXPECTED), 'the rich body carries it too')
    // It is inside the reminders section, not floating somewhere else.
    const heading = d.body.indexOf('A Few Quick Reminders')
    assert.ok(heading > 0 && d.body.indexOf(EXPECTED) > heading,
      'the bullet must follow the A Few Quick Reminders heading')
    const richHeading = d.richBody.indexOf('A Few Quick Reminders')
    assert.ok(richHeading > 0 && d.richBody.indexOf(EXPECTED) > richHeading)
    // NEGATIVE CONTROLS: the two superseded wordings.
    assert.ok(!d.body.includes('Scope of practice: Please see attached'))
    assert.ok(!d.body.includes('can be added before sending or shared separately'))
  }
})

test('PROOF 26b: an unattached draft says NOTHING rather than claiming attachments', () => {
  const d = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: false })
  assert.ok(!/see the attached/i.test(d.body), 'no claim without the files')
  assert.ok(!/see attached/i.test(d.body))
  assert.match(d.body, /A Few Quick Reminders/, 'the other reminders still stand')
})

test('PROOF 27: the bullet survives the rich-text seed the composer actually uses', () => {
  // The composer seeds the editor from the SAME builder output it shows in
  // preview and sends - there is no second copy for the editor to overwrite.
  const view = strip(read('src/components/connect/OutreachView.jsx'))
  assert.match(view, /handoffSeed/, 'the merged body is seeded, not written after mount')
  const d = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: true })
  // The rich body is a real list item, so an editor round trip keeps it as one.
  assert.match(d.richBody, /<li>Please see the attached ASPIRE Brochure and General Guidelines for Pre-Licensure Students for your reference\.<\/li>/)
})

test('PROOF 28: the already-correct greeting stays two paragraphs (regression)', () => {
  const d = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: true })
  assert.match(d.richBody, /<p>Dear Romelyn,<\/p>\s*<p>Thank you for agreeing/,
    'the salutation is its own paragraph, and the opening begins the next')
  // The plain body keeps the blank line between them.
  assert.match(d.body, /Dear Romelyn,\n\nThank you for agreeing/)
  // NEGATIVE CONTROL: they are never collapsed into one paragraph.
  assert.ok(!/<p>Dear Romelyn,\s*Thank you/.test(d.richBody))
  assert.ok(!/Dear Romelyn,\s?Thank you/.test(d.body))
})

test('PROOF 29+30: both documents resolve canonically, or are NAMED as missing', () => {
  assert.equal(PRECEPTOR_ASSIGNMENT_DOCUMENTS.length, 2)
  // The Catalog titles the second document differently from the way the bullet
  // words it, so identity is by canonical key plus aliases - not by one fragile
  // display spelling.
  const catalog = [
    { slug: 'brochure', title: 'ASPIRE Brochure' },
    { slug: 'guidelines', title: 'General Guidelines for Pre-Licensure Students' },
  ]
  const ok = resolveRequiredAttachments(catalog)
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.resolved.map(r => r.slug).sort(), ['brochure', 'guidelines'])
  assert.deepEqual(ok.resolved.map(r => r.requiredKey).sort(), ['aspire_brochure', 'prelicensure_guidelines'])
  assert.equal(ok.problems.length, 0)

  // The other spelling resolves to the SAME document.
  const alt = resolveRequiredAttachments([
    { slug: 'brochure', title: 'ASPIRE Program Brochure' },
    { slug: 'guidelines', title: 'Pre-Licensure Student General Guidelines' },
  ])
  assert.equal(alt.ok, true)

  // One missing: it is NAMED, and it is never described as attached.
  const partial = resolveRequiredAttachments([catalog[0]])
  assert.equal(partial.ok, false)
  assert.equal(partial.problems.length, 1)
  assert.equal(partial.problems[0].code, 'missing')
  assert.match(attachmentProblemText(partial.problems[0]), /Pre-Licensure Student General Guidelines/)
  assert.match(attachmentWarningText(partial.problems), /does not promise a document it does not carry/)

  // A Catalog that could not be READ is unavailable, not missing - different
  // facts, and only one of them is the Owner's to fix.
  const unreadable = resolveRequiredAttachments(null)
  assert.equal(unreadable.problems.every(p => p.code === 'unavailable'), true)
})

test('PROOF 30b: the claim is BLOCKED whenever the files are not both carried', () => {
  const BODY = 'Please see the attached ASPIRE Brochure and General Guidelines for Pre-Licensure Students for your reference.'
  const slugs = ['brochure', 'guidelines']
  const attached = [{ slug: 'brochure' }, { slug: 'guidelines' }]

  // Everything present and server-verified: it may send.
  assert.equal(attachmentClaimBlockReason({
    body: BODY, selected: attached, serverResolved: attached, requiredSlugs: slugs,
  }), null)

  // One removed after the claim was written.
  assert.match(attachmentClaimBlockReason({
    body: BODY, selected: [attached[0]], serverResolved: attached, requiredSlugs: slugs,
  }), /Re-attach/)

  // Selected but not yet verified by the server.
  assert.match(attachmentClaimBlockReason({
    body: BODY, selected: attached, serverResolved: [], requiredSlugs: slugs,
  }), /not been verified by the server/)

  // The Catalog could not identify them at all.
  assert.match(attachmentClaimBlockReason({
    body: BODY, selected: attached, serverResolved: attached, requiredSlugs: null,
  }), /could not be identified in the ASPIRE Catalog/)

  // NEGATIVE CONTROL: a body that claims nothing is never blocked.
  const d = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: false })
  assert.equal(attachmentClaimBlockReason({
    body: d.body, selected: [], serverResolved: [], requiredSlugs: null,
  }), null)
})

test('PROOF 25b: the obsolete subject and wording have zero ACTIVE occurrences', () => {
  const OBSOLETE_BULLETS = [
    'Please see attached ASPIRE Brochure',
    'Scope of practice: Please see attached',
    'can be added before sending or shared separately',
  ]
  const files = [
    'src/lib/outreachTemplates.js', 'src/lib/connect/catalogAttachments.js',
    'src/components/connect/OutreachView.jsx', 'src/components/EmbedUnitCard.jsx',
    'src/components/ActionCenter.jsx', 'src/components/MatchingTab.jsx',
    'src/lib/keithKnowledge.js', 'src/lib/connect/templateRegistry.js',
  ]
  for (const f of files) {
    const src = strip(read(f))
    for (const old of OBSOLETE_BULLETS) {
      assert.ok(!src.includes(old), `the retired wording is still active in ${f}: ${old}`)
    }
  }
  // No builder state can produce the obsolete SUBJECT.
  for (const attachmentsAttached of [true, false]) {
    for (const args of [{ placement: PLACEMENT }, { firstName: 'Romelyn' }, {}]) {
      const d = buildPreceptorAssignmentDraft({ ...args, attachmentsAttached })
      assert.equal(d.subject, 'ASPIRE: Student Assignment and Introduction Details')
    }
  }
})

test('PARITY: the block heading opens BOTH bodies, exactly once each', () => {
  const HEADING = 'Preceptor Assignment & Details'
  for (const args of [
    { placement: PLACEMENT, attachmentsAttached: true },
    { placement: PLACEMENT, attachmentsAttached: false },
    { firstName: 'Romelyn', attachmentsAttached: true },
    {},
  ]) {
    const d = buildPreceptorAssignmentDraft(args)

    // HTML: the heading, then the greeting as its own paragraph.
    assert.match(d.richBody, /^<h2>Preceptor Assignment &amp; Details<\/h2><p>Dear [^<]+,<\/p><p>Thank you for agreeing/,
      'the rich body must open with the heading, then the greeting paragraph')

    // Plain text: the heading, a blank line, then the greeting.
    assert.match(d.body, /^Preceptor Assignment & Details\n\nDear [^\n]+,\n\nThank you for agreeing/,
      'the plain body must open with the heading, a blank line, then the greeting')

    // ONCE each. A heading that appears twice is a different defect from one
    // that appears in only one representation, and both are worth failing on.
    const inRich = (d.richBody.match(/Preceptor Assignment &amp; Details/g) || []).length
    const inPlain = (d.body.match(/Preceptor Assignment & Details/g) || []).length
    assert.equal(inRich, 1, `the heading appears ${inRich} times in the rich body`)
    assert.equal(inPlain, 1, `the heading appears ${inPlain} times in the plain body`)

    // The subject is untouched by any of this.
    assert.equal(d.subject, 'ASPIRE: Student Assignment and Introduction Details')
  }
})

test('PARITY: the two bodies now begin with the same words', () => {
  const d = buildPreceptorAssignmentDraft({ placement: PLACEMENT, attachmentsAttached: true })
  const firstLine = (t) => t.split('\n')[0].trim()
  const stripTags = (h) => h.replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&')
  assert.equal(firstLine(d.body), 'Preceptor Assignment & Details')
  assert.equal(firstLine(stripTags(d.richBody).replace(/^\n+/, '')), 'Preceptor Assignment & Details')
  // NEGATIVE CONTROL: the pre-parity plain body began at the greeting.
  assert.ok(!/^Dear /.test(d.body), 'the plain body must no longer open at the greeting')
})

// ── 31. Detached and tampered references ────────────────────────────────────

test('PROOF 31: a detached or tampered placement produces no confirmation', () => {
  // The client cannot record anything without a match id, and the server proves
  // the rest. Both halves are asserted; the server half is EXECUTED against a
  // fake database in test/outreachAttachmentEndpoints.test.mjs.
  const board = strip(read('src/components/MatchingTab.jsx'))
  const writer = board.slice(board.indexOf('const writeNotification'),
    board.indexOf('const handleConfirmNotified'))
  assert.match(writer, /if \(!match\?\.id \|\| !student\?\.id\) throw/)
  assert.match(writer, /if \(!res\.ok \|\| !payload\?\.success\) throw/,
    'a refused write must never be reported as recorded')

  const endpoint = strip(read('api/placement-notification-confirm.js'))
  assert.match(endpoint, /verifyPlacementSend\(\{/)
  assert.match(endpoint, /skipRecipientCheck: true/)
  assert.match(endpoint, /student_mismatch|unit_mismatch|cohort_mismatch/)
  // Detached drafts: the composer drops the placement reference deliberately,
  // and a send without one is an ordinary message that records no placement.
  const view = strip(read('src/components/connect/OutreachView.jsx'))
  assert.match(view, /detachPlacement\(/)
})

// ── 34. Nothing real is touched by QC ───────────────────────────────────────

test('PROOF 34: every notification write goes through one interceptable endpoint', () => {
  // If QC can intercept ONE route, it has intercepted every path to notified
  // state - which is what makes fixture QC safe to run against production.
  const surfaces = ['src/components/MatchingTab.jsx', 'src/components/ActionCenter.jsx',
    'src/components/EmbedUnitCard.jsx', 'src/components/placement/NotificationControl.jsx']
  let writers = 0
  for (const f of surfaces) {
    const src = strip(read(f))
    writers += (src.match(/placement-notification-confirm/g) || []).length
    assert.ok(!/from\('matches'\)[\s\S]{0,120}\.update\(/.test(src),
      `${f} must not write the match row directly`)
    assert.ok(!/from\('notification_log'\)[\s\S]{0,120}\.insert\(/.test(src),
      `${f} must not write the ledger directly`)
  }
  assert.equal(writers, 2, 'exactly the board and the Action Center call the one endpoint')
})

// ── The legacy baselines ────────────────────────────────────────────────────

test('a pre-ledger manual confirmation is preserved, and stays correctable', () => {
  // Real production rows exist from PRECEPTOR-DRAFT-CONTINUITY-1.
  const legacy = {
    id: 'legacy-1', notification_type: LEGACY_MANUAL_TYPE, status: LEGACY_MANUAL_STATUS,
    sent_at: '2026-08-13T10:00:00.000Z',
    metadata: { placement_match_id: M.A, placement_preceptor_id: P.ROMELYN },
  }
  assert.equal(precState([legacy]).confirmed, true, 'a real human confirmation is not discarded')
  assert.equal(leaderState([legacy]).confirmed, false, 'it was only ever about the preceptor')
  // And it can be corrected like any other confirmation.
  const corrected = [legacy, correctRow(precMeta(), '2026-08-18T10:00:00.000Z')]
  assert.equal(precState(corrected).confirmed, false)
})

test('the legacy match boolean is a BASELINE, never an override', () => {
  // No ledger event: the old boolean still reads as confirmed.
  assert.equal(leaderState([], M.A, { legacyNotified: true }).confirmed, true)
  assert.equal(leaderState([], M.A, { legacyNotified: true }).source, 'legacy')
  // A correction in the ledger wins over it, which is what makes a legacy
  // confirmation correctable at all.
  const rows = [correctRow(leaderMeta(M.A))]
  assert.equal(leaderState(rows, M.A, { legacyNotified: true }).confirmed, false)
  assert.equal(leaderState(rows, M.A, { legacyNotified: true }).source, 'ledger')
})

test('the board counter and the row statuses come from ONE derivation', () => {
  const card = strip(read('src/components/EmbedUnitCard.jsx'))
  assert.match(card, /const unitLeaderConfirmed = \(student\) => \{/)
  assert.match(card, /notificationStateFor\(/)
  assert.match(card, /notifiedCount = matchedStudents\.filter\(unitLeaderConfirmed\)\.length/)
  assert.match(card, /unnotifiedStudents = matchedStudents\.filter\(s => !unitLeaderConfirmed\(s\)\)/,
    'the count and the "notify all" list cannot disagree with the rows')
})
