// UNIT-POOL-REFINEMENT-1
//
// The Placement Board stops being a unit-management surface, the placement rows
// get one aligned action column, unmatching becomes a visible confirmed act, and
// the consolidated unit-leader notification gets a review step and one batch
// confirmation that writes through the same endpoint as every individual check.
//
// HOW THIS SUITE IS BUILT. The inclusion rule and the state it reads are pure
// modules, executed with real rows. What the DOM decides - alignment, tooltip
// geometry, dialog flow, narrow layout - is proved in the fixture browser QC.
// Source assertions here are confined to facts a scan can honestly establish
// (a control exists exactly once, a retired control has zero occurrences), and
// each guard that matters carries a MUTATION CONTROL: the change it forbids is
// applied to a copy of the source and the guarding assertion is shown to catch
// it. A proof that cannot fail proves nothing.
//
// Run: node --test test/unitPoolRefinement.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const {
  NOTIFICATION_TARGETS, NOTIFY_META, CONFIRMED_TYPE, CONFIRMED_STATUS,
  CORRECTED_TYPE, CORRECTED_STATUS,
  notificationStateIndex, notificationStateFor,
} = await import('../src/lib/placementNotificationState.js')

const CARD = () => strip(read('src/components/EmbedUnitCard.jsx'))
const BOARD = () => strip(read('src/components/MatchingTab.jsx'))
const OVERVIEW = () => strip(read('src/components/OverviewTab.jsx'))
// App.jsx carries glob-like strings ('**/*') that a comment-stripper would eat
// along with the code after them, so App assertions run against the raw source.
const APP = () => read('src/App.jsx')

// ── 1-4. The board is not a unit-management surface ─────────────────────────

test('PROOF 1: Set Up Units is absent from the Placement Board', () => {
  const board = BOARD()
  assert.ok(!board.includes('Set Up Units</button>'), 'the button must be gone')
  assert.ok(!board.includes('setShowUnitSetup'), 'and its state with it')
  assert.ok(!/import UnitSetupPanel/.test(board), 'the board no longer knows the panel')
  // The unreachable CSV-import modal went with it: nothing had opened it since
  // its opener was removed, and unit creation does not belong on this surface.
  assert.ok(!board.includes('ImportUnitsCSV'), 'no unit-creating surface remains')
})

test('PROOF 2: no unit-delete action remains on any Unit Pool card', () => {
  const card = CARD()
  assert.ok(!card.includes('"Delete unit"'), 'the delete tooltip/label is gone')
  assert.ok(!card.includes('confirmDelete'), 'the delete confirmation is gone')
  assert.ok(!/\bonDelete\b/.test(card), 'the card accepts no delete handler at all')
  const board = BOARD()
  assert.ok(!board.includes('onDeleteUnit'), 'the board neither accepts nor forwards one')
  // NEGATIVE CONTROL (hidden path): nothing in the board or card deletes a unit
  // row by any other name.
  for (const src of [card, board]) {
    assert.ok(!/from\('units'\)[\s\S]{0,120}\.delete\(/.test(src), 'no direct unit delete')
  }
})

test('PROOF 3: legitimate unit setup remains reachable, in the hosting workflow', () => {
  const ov = OVERVIEW()
  assert.match(ov, /import UnitSetupPanel from '\.\/UnitSetupPanel'/)
  assert.match(ov, /data-testid="overview-set-up-units"/)
  assert.match(ov, /Set Up Units/)
  assert.match(ov, /<UnitSetupPanel cohortId=\{cohortId\} currentUnits=\{units\} students=\{students\}/,
    'the SAME panel, not a copy')
  // Gated by the SAME authority the board button had (canPerformMatching:
  // owner, admin, co-lead) - the relocation must not narrow who can use it.
  assert.match(ov, /\{canPerformMatching\(userProfile\) && \(\s*<button type="button" className="ov-send-btn" data-testid="overview-set-up-units"/)
  assert.match(ov, /import \{ canPerformMatching \} from '\.\.\/lib\/permissions'/)
  assert.match(APP(), /<OverviewTab[\s\S]{0,400}onRefreshUnits=\{\(\) => fetchUnits\(activeCohortId\)\}/)
  // The empty state points people to the new home rather than a button that left.
  assert.match(BOARD(), /At a Glance → Placement Capacity → Set Up Units/)
})

test('PROOF 4: the guarded unit-delete logic survives, with no trigger on the board', () => {
  // App keeps the ONE guarded deletion path (primary-preceptor clears first,
  // one failure aborts) exactly as the primaryPreceptorClear suite pins it -
  // this release removes every Placement Board trigger, not the safety logic a
  // future legitimate surface will need.
  const app = APP()
  assert.match(app, /const deleteUnit = async unit => \{/)
  assert.match(app, /'unit delete match revert'/)
  // And the board no longer destructures the prop, so no code path from the
  // board can reach it even though App still offers it.
  assert.ok(!BOARD().includes('onDeleteUnit'))
})

// ── 5. Capacity inputs unchanged ─────────────────────────────────────────────

test('PROOF 5: unit filtering and capacity calculations are untouched', () => {
  const board = BOARD()
  assert.match(board, /const participating\s*=\s*units\.filter\(u => u\.is_participating\)/)
  assert.match(board, /totalOpenSlots\(participating, matches\)/)
  const card = CARD()
  assert.match(card, /filledCount\} of \{unit\.total_slots\} filled/)
})

// ── 6. One aligned action column ─────────────────────────────────────────────

test('PROOF 6: both lines place their actions in the same fixed-slot grid', () => {
  const card = CARD()
  // The alignment is structural: each action cell is [control][ACTION_SLOT px].
  assert.match(card, /const ACTION_SLOT = 28/)
  const cells = card.match(/gridTemplateColumns: `auto \$\{ACTION_SLOT\}px`/g) || []
  assert.equal(cells.length, 2, 'exactly the student line and the preceptor line')
  // Line 1's slot is the unmatch control; line 2's is the same-width spacer.
  assert.match(card, /data-testid="unmatch-student"/)
  assert.match(card, /<span aria-hidden="true" \/>/)
})

// ── 7. Notification controls unchanged ───────────────────────────────────────

test('PROOF 7: the shared NotificationControl and its labels are untouched', () => {
  const card = CARD()
  const uses = card.match(/<NotificationControl\b/g) || []
  assert.equal(uses.length, 2, 'still exactly the two targets')
  assert.match(card, /target=\{NOTIFICATION_TARGETS\.UNIT_LEADER\}/)
  assert.match(card, /target=\{NOTIFICATION_TARGETS\.PRECEPTOR\}/)
  // The labels module is byte-identical in meaning: still the four exact strings.
  const state = read('src/lib/placementNotificationState.js')
  for (const label of ['Notify Unit Leader', 'Mark Unit Leader as Notified',
    'Notify Preceptor', 'Mark Preceptor as Notified', 'Unit Leader Notified', 'Preceptor Notified']) {
    assert.ok(state.includes(`'${label}'`), label)
  }
})

// ── 8-12. Unmatch ────────────────────────────────────────────────────────────

test('PROOF 8: Unmatch Student is a real control with the exact label', () => {
  const card = CARD()
  assert.match(card, /aria-label="Unmatch Student"/)
  assert.match(card, /<Tooltip label="Unmatch Student" placement="top">/)
  assert.match(card, /<XCircle size=\{15\}/)
  // An adequate target: 26px button, not a bare glyph.
  assert.match(card, /data-testid="unmatch-student"[\s\S]{0,700}width: 26, height: 26/)
  // NEGATIVE CONTROL: the old faint × glyph as an unmatch trigger is gone.
  assert.ok(!/Unmatch student/.test(card), 'the old lowercase label has zero occurrences')
  assert.ok(!/>\s*×\s*<\/button>\s*<\/Tooltip>/.test(card), 'no bare × action remains on the rows')
})

test('PROOF 9+10: the dialog states the consequences of the branch that will run', () => {
  const card = CARD()
  const dlg = card.slice(card.indexOf('data-testid="unmatch-confirm-modal"'),
    card.indexOf('<PreceptorAssignmentModal'))
  // The dialog computes the SAME plan the removal consumes - it cannot promise
  // one behavior while App performs another.
  assert.match(card, /const unmatchPlanned = planUnmatch\(\{ student: confirmUnmatch, match: unmatchMatch, matches \}\)/)
  assert.match(dlg, /data-plan-kind=\{unmatchPlanned\.kind\}/)
  assert.match(dlg, /studentNaturalName\(confirmUnmatch\)/, 'names the student')
  assert.match(dlg, /unit\.unit_name/, 'names the unit')

  // FINAL: the classic revert copy, unchanged in meaning.
  assert.match(dlg, /The placement ends and the slot reopens\./)
  assert.match(dlg, /returns to the pool with their pre-match status/)
  assert.match(dlg, /preceptor assignment for this placement is cleared/)
  assert.match(dlg, /notification records for this placement[\s\S]{0,160}no longer apply/)

  // ADDITIONAL: primary explicitly unchanged; no status change; primary
  // preceptor untouched.
  assert.match(dlg, /Their primary placement is unchanged/)
  assert.match(dlg, /The primary preceptor relationship is not touched/)

  // PRIMARY WITH SURVIVOR: the successor is NAMED, status does not change,
  // the relationship is ended and never transferred.
  assert.match(dlg, /\{successorName\}<\/strong> becomes their primary placement/)
  assert.match(dlg, /is ended - never transferred/)
  assert.match(dlg, /surviving\s+placement&rsquo;s\s+records are unaffected/)

  // Both survivor branches say the student stays placed.
  const stays = dlg.match(/the student stays placed,\s+and their status does not change/g) || []
  assert.equal(stays.length, 2)

  // NEGATIVE CONTROL: the old unconditional copy is gone - no branchless
  // "returns to the pool" claim can reach a survivor case.
  assert.match(dlg, /unmatchPlanned\.kind === 'final' && \(<>[\s\S]{0,200}returns to the pool/)

  assert.match(dlg, />\s*Unmatch Student\s*<\/button>/, 'exact primary action')
  assert.match(dlg, />Cancel<\/button>/, 'exact secondary action')
  // The trigger only OPENS the dialog; the dialog's confirm is the only caller.
  assert.match(card, /data-testid="unmatch-student"[\s\S]{0,400}onClick=\{e => \{ e\.stopPropagation\(\); onUnmatch\(student\) \}\}/)
  assert.match(card, /onUnmatch=\{\(\) => setConfirmUnmatch\(student\)\}/,
    'the row prop opens the modal, never the removal itself')
  assert.match(dlg, /onClick=\{\(\) => \{ onUnmatch\(confirmUnmatch\); setConfirmUnmatch\(null\) \}\}/)
})

test('PROOF 11: unmatch removes only the selected placement (semantics unchanged)', () => {
  const app = APP()
  const fn = app.slice(app.indexOf('const unmatch = async (student, unit)'),
    app.indexOf('const updateMatch'))
  // ONE match row - the (student, unit) pair - never a student-wide sweep.
  assert.match(fn, /matches\.find\(m => m\.student_id === student\.id && m\.unit_id === unit\.id\)/)
  assert.match(fn, /\.delete\(\)\.eq\('id', match\.id\)/)
  assert.ok(!/\.delete\(\)\.eq\('student_id'/.test(fn),
    'NEGATIVE CONTROL: deleting by student_id would sweep a multi-unit student\'s other placements')
  // Nothing else is deleted: the student is UPDATED, the unit is UPDATED.
  assert.match(fn, /from\('students'\)\.update\(/)
  assert.match(fn, /from\('units'\)\.update\(/)
  assert.ok(!/from\('students'\)[\s\S]{0,60}\.delete\(/.test(fn))
  assert.ok(!/from\('units'\)[\s\S]{0,60}\.delete\(/.test(fn))
  assert.ok(!/from\('notification_log'\)/.test(fn), 'history rows are never touched')
})

// ── 13-16, 20. The consolidated notification ────────────────────────────────

const S = { A: 'stu-a', B: 'stu-b', C: 'stu-c' }
const matchRow = (id, student, { notified = false } = {}) =>
  ({ id: `match-${id}`, student_id: student, notification_sent: notified })
const confirmEvent = (matchId, at = '2026-08-19T10:00:00.000Z') => ({
  id: `evt-${matchId}-${at}`, notification_type: CONFIRMED_TYPE, status: CONFIRMED_STATUS,
  sent_at: at,
  metadata: { [NOTIFY_META.target]: NOTIFICATION_TARGETS.UNIT_LEADER, [NOTIFY_META.match]: matchId },
})
const correctEvent = (matchId, at = '2026-08-19T11:00:00.000Z') => ({
  id: `rev-${matchId}-${at}`, notification_type: CORRECTED_TYPE, status: CORRECTED_STATUS,
  sent_at: at,
  metadata: {
    [NOTIFY_META.target]: NOTIFICATION_TARGETS.UNIT_LEADER, [NOTIFY_META.match]: matchId,
    [NOTIFY_META.reason]: 'test',
  },
})

// The card's inclusion rule, executed against the same modules it reads.
function unnotifiedOf(students, matches, ledgerRows) {
  const index = notificationStateIndex(ledgerRows)
  const confirmed = (student) => {
    const m = matches.find(x => x.student_id === student.id)
    if (!m) return false
    return notificationStateFor(index,
      { target: NOTIFICATION_TARGETS.UNIT_LEADER, matchId: m.id },
      { legacyNotified: !!m.notification_sent }).confirmed
  }
  return students.filter(s => !confirmed(s))
}

test('PROOF 13: the consolidated feature is the EXISTING one, extended in place', () => {
  const card = CARD()
  // Still ONE builder call, still multi-aware, still writing nothing on open.
  assert.match(card, /const openUnitLeaderNotice = \(studentRows, \{ multi \}\) => \{/)
  assert.match(card, /buildUnitLeaderPlacementMessage\(\{/)
  assert.match(card, /isMultiStudent: multi,/)
  const opener = card.slice(card.indexOf('const openUnitLeaderNotice'),
    card.indexOf('const reviewThenNotify'))
  for (const w of ['onUpdateMatch', 'notification_sent', '.insert(', '.update(', 'onConfirmNotified', 'onBatchConfirmNotified']) {
    assert.ok(!opener.includes(w), `opening the draft must not ${w}`)
  }
  // And the exact requested group label, built from the FROZEN eligible count.
  assert.match(card, /const groupNotifyLabel = `Notify Unit Leader About \$\{unnotifiedStudents\.length\} Students`/)
})

test('PROOF 14+15: the default set is exactly the current unnotified placements', () => {
  const students = [{ id: S.A }, { id: S.B }, { id: S.C }]
  const matches = [matchRow('a', S.A), matchRow('b', S.B), matchRow('c', S.C)]

  // Nobody confirmed: all three included.
  assert.deepEqual(unnotifiedOf(students, matches, []).map(s => s.id), [S.A, S.B, S.C])

  // Two confirmed in the ledger: only the third is included.
  const twoConfirmed = [confirmEvent('match-a'), confirmEvent('match-b')]
  assert.deepEqual(unnotifiedOf(students, matches, twoConfirmed).map(s => s.id), [S.C],
    'NEGATIVE CONTROL: including an already-confirmed match in the default set must fail here')

  // A legacy boolean confirmation counts too.
  const legacyMatches = [matchRow('a', S.A, { notified: true }), matchRow('b', S.B), matchRow('c', S.C)]
  assert.deepEqual(unnotifiedOf(students, legacyMatches, []).map(s => s.id), [S.B, S.C])

  // A corrected confirmation returns to the default set.
  const corrected = [confirmEvent('match-a'), correctEvent('match-a')]
  assert.deepEqual(unnotifiedOf(students, matches, corrected).map(s => s.id), [S.A, S.B, S.C])
})

test('PROOF 20: a newly matched student is independently eligible next time', () => {
  // Yesterday: A and B confirmed. Today: C matched. The next consolidated set is
  // exactly C - the confirmed two are not silently re-marked.
  const matches = [matchRow('a', S.A), matchRow('b', S.B), matchRow('c-new', S.C)]
  const ledger = [confirmEvent('match-a'), confirmEvent('match-b')]
  const next = unnotifiedOf([{ id: S.A }, { id: S.B }, { id: S.C }], matches, ledger)
  assert.deepEqual(next.map(s => s.id), [S.C])
})

test('PROOF 14b: the review step precedes the draft, and freezes the set at open', () => {
  const card = CARD()
  // handleNotifyAll goes to the review step - it never opens the draft directly.
  const handler = card.slice(card.indexOf('const handleNotifyAll'),
    card.indexOf('const openConsolidatedDraft'))
  assert.match(handler, /setNotifyFlow\(\{ step: 'review', rows, missing \}\)/)
  assert.ok(!handler.includes('openUnitLeaderNotice'), 'no draft before the review')
  // The open step snapshots the match ids THEN - a match created after the
  // draft opened can never join the confirmation set.
  const open = card.slice(card.indexOf('const openConsolidatedDraft'),
    card.indexOf('const confirmConsolidated'))
  assert.match(open, /matchIds: rows\.map\(r => r\.match\?\.id\)\.filter\(Boolean\)/)
  assert.match(open, /openUnitLeaderNotice\(rows, \{ multi: rows\.length > 1 \}\)/)
})

test('PROOF 16-19: the batch confirm writes per included match, unit-leader only', () => {
  const board = BOARD()
  const batch = board.slice(board.indexOf('const handleBatchConfirmNotified'),
    board.indexOf('const handleCorrectNotified'))
  // Through the ONE shared writer, target pinned to the unit leader.
  assert.match(batch, /await writeNotification\(\{\s*target: NOTIFICATION_TARGETS\.UNIT_LEADER, action: 'confirm', student, match,\s*\}\)/)
  assert.ok(!batch.includes('PRECEPTOR'),
    'NEGATIVE CONTROL: conflating unit and preceptor notification must fail here')
  // Per-row outcome; partial failure named, never rolled into a false success.
  assert.match(batch, /failed\.push\(\{ name: studentNameOf\(student\), reason:/)
  assert.match(batch, /Partially recorded/)
  assert.match(batch, /return \{ ok, failed \}/)
  // The card surfaces failures and keeps the confirm open for a retry.
  const card = CARD()
  assert.match(card, /if \(result\?\.failed\?\.length\) \{\s*setNotifyErrors\(result\.failed\)/)
  assert.match(card, /data-testid="notify-batch-errors"/)
})

test('PROOF 17: opening or abandoning the consolidated draft records nothing', () => {
  const card = CARD()
  // Cancel in review, ✕, and Not Yet all just clear local state.
  assert.match(card, /data-testid="notify-batch-notyet"[\s\S]{0,120}onClick=\{\(\) => setNotifyFlow\(null\)\}/)
  const open = card.slice(card.indexOf('const openConsolidatedDraft'),
    card.indexOf('const confirmConsolidated'))
  for (const w of ['writeNotification', 'onBatchConfirmNotified', 'onConfirmNotified', 'fetch(']) {
    assert.ok(!open.includes(w), `opening must not reach ${w}`)
  }
})

test('PROOF 18+21: the exact confirmation wording, and idempotency by the endpoint', () => {
  const card = CARD()
  assert.match(card, /`Mark the Unit Leader as Notified for These \$\{notifyFlow\.rows\.length\} Placements`/)
  assert.match(card, /'Mark the Unit Leader as Notified for This Placement'/)
  // Idempotency lives at the endpoint (confirm of a confirmed placement answers
  // already:true and appends nothing) - executed in the endpoint suite; asserted
  // here as the wiring: the batch writer calls that same endpoint via
  // writeNotification, no bespoke second path.
  const board = BOARD()
  const batch = board.slice(board.indexOf('const handleBatchConfirmNotified'),
    board.indexOf('const handleCorrectNotified'))
  assert.ok(!batch.includes("fetch('/api/"), 'no second write path beside writeNotification')
})

test('PROOF 22: partial failure is visible and never claims completeness', () => {
  const card = CARD()
  const errors = card.slice(card.indexOf('data-testid="notify-batch-errors"'),
    card.indexOf('data-testid="notify-batch-notyet"'))
  assert.match(errors, /Some placements were recorded; these were not:/)
  assert.match(errors, /Nothing was recorded\./)
  assert.match(errors, /placements already recorded are never double-counted/)
})

test('PROOF 23: individual unit-leader notification still exists per row', () => {
  const card = CARD()
  assert.match(card, /const handleNotifyOne = \(student\) => reviewThenNotify\(rowsFor\(\[student\]\), \{ multi: false \}\)/)
  assert.match(card, /onNotify=\{handleNotifyOne\}/)
  // The row's envelope still opens it through the shared control.
  assert.match(card, /onOpenDraft=\{\(\) => onNotify\(student, match\)\}/)
})

test('PROOF 24: the Action Center predicate and writers are untouched', () => {
  assert.match(strip(read('src/lib/attention.js')), /return m && !m\.notification_sent/)
  const ac = strip(read('src/components/ActionCenter.jsx'))
  assert.match(ac, /placement-notification-confirm/)
  // The batch writer mirrors the projection per match exactly like a single
  // confirm - because it IS the single confirm, run N times.
  assert.match(BOARD(), /onMatchLocalSync\?\.\(/)
})

// ── The unit-level status line ───────────────────────────────────────────────

test('the all-notified summary is explicit about WHOSE status it is', () => {
  const card = CARD()
  assert.match(card, /data-testid="unit-leader-all-notified"/)
  assert.match(card, /✓ Unit Leader Notified · \{notifiedCount\} of \{filledCount\}/)
  assert.match(card, /Preceptor notification is tracked per row\./)
})

// ── MULTI-UNIT: rows come from match rows, not the single pointer ───────────

const { studentsMatchedToUnit } = await import('../src/lib/placementDisplay.js')

const COHORT = { A: 'cohort-a', B: 'cohort-b' }
const UNITS = { A: { id: 'unit-a' }, B: { id: 'unit-b' } }
const PEOPLE = {
  kai: { id: 'stu-kai', matched_unit_id: 'unit-b' },   // the pointer names ONE unit
  ana: { id: 'stu-ana', matched_unit_id: 'unit-a' },
  zoe: { id: 'stu-zoe', matched_unit_id: null },       // cohort-B student
}
const byId = Object.fromEntries(Object.values(PEOPLE).map(s => [s.id, s]))
const MULTI_MATCHES = [
  { id: 'm-kai-a', student_id: 'stu-kai', unit_id: 'unit-a', cohort_id: COHORT.A },
  { id: 'm-kai-b', student_id: 'stu-kai', unit_id: 'unit-b', cohort_id: COHORT.A },
  { id: 'm-ana-a', student_id: 'stu-ana', unit_id: 'unit-a', cohort_id: COHORT.A },
  // A foreign-cohort row CLAIMING a cohort-A unit: must never yield a row.
  { id: 'm-zoe-x', student_id: 'stu-zoe', unit_id: 'unit-a', cohort_id: COHORT.B },
]

test('MULTI 1+11: a two-unit student appears once on EACH applicable card', () => {
  const a = studentsMatchedToUnit(UNITS.A, MULTI_MATCHES, byId, COHORT.A)
  const b = studentsMatchedToUnit(UNITS.B, MULTI_MATCHES, byId, COHORT.A)
  assert.deepEqual(a.map(s => s.id), ['stu-kai', 'stu-ana'])
  assert.deepEqual(b.map(s => s.id), ['stu-kai'])
  // Once each - a duplicated match row cannot duplicate the row.
  const dup = studentsMatchedToUnit(UNITS.B,
    [...MULTI_MATCHES, { id: 'm-kai-b2', student_id: 'stu-kai', unit_id: 'unit-b', cohort_id: COHORT.A }],
    byId, COHORT.A)
  assert.equal(dup.length, 1, 'deduped by student per unit')
})

test('MULTI 1b: the pointer no longer decides visibility', () => {
  // Kai's matched_unit_id names unit-b, yet unit-a lists him - because the
  // MATCH does. And a pointer with NO match row yields nothing: the pointer is
  // a projection, not a placement.
  const ghost = { id: 'stu-ghost', matched_unit_id: 'unit-a' }
  const rows = studentsMatchedToUnit(UNITS.A, MULTI_MATCHES, { ...byId, 'stu-ghost': ghost }, COHORT.A)
  assert.ok(rows.some(s => s.id === 'stu-kai'))
  assert.ok(!rows.some(s => s.id === 'stu-ghost'), 'no match row, no card row')
})

test('MULTI 9: filled counts now read the same records as the capacity guard', () => {
  // unit-a holds two match rows -> two rows -> filledCount 2. The guard has
  // always counted match rows, so the two can no longer disagree about a
  // multi-unit student. (This is the PROVEN CORRECTION to the old display:
  // the pointer-based count read 1 here.)
  const a = studentsMatchedToUnit(UNITS.A, MULTI_MATCHES, byId, COHORT.A)
  assert.equal(a.length, 2)
  const pointerCount = Object.values(byId).filter(s => s.matched_unit_id === 'unit-a').length
  assert.equal(pointerCount, 1, 'the old derivation undercounted, which is why it was replaced')
})

test('MULTI 10: a single-placement student is unchanged', () => {
  const a = studentsMatchedToUnit(UNITS.A, MULTI_MATCHES, byId, COHORT.A)
  assert.ok(a.some(s => s.id === 'stu-ana'))
  assert.ok(!studentsMatchedToUnit(UNITS.B, MULTI_MATCHES, byId, COHORT.A).some(s => s.id === 'stu-ana'))
})

test('MULTI 12: cohort isolation is enforced in the derivation itself', () => {
  const a = studentsMatchedToUnit(UNITS.A, MULTI_MATCHES, byId, COHORT.A)
  assert.ok(!a.some(s => s.id === 'stu-zoe'),
    'a foreign-cohort match row claiming this unit must never yield a row')
  // And reading the same world as cohort B sees ONLY the foreign row.
  const asB = studentsMatchedToUnit(UNITS.A, MULTI_MATCHES, byId, COHORT.B)
  assert.deepEqual(asB.map(s => s.id), ['stu-zoe'])
})

test('MULTI 2: each rendered row carries its own exact match id', () => {
  const card = CARD()
  assert.match(card, /data-match-id=\{match\?\.id \|\| ''\}/)
  // And the row's match is resolved by (student, THIS unit) - never by student
  // alone, which would hand a multi-unit student the wrong placement.
  assert.match(card, /matches\.find\(m => m\.student_id === raw\.id && m\.unit_id === unit\.id\)/)
  assert.match(card, /matches\.find\(m => m\.student_id === student\.id && m\.unit_id === unit\.id\)/)
})

test('MULTI 13: the pool, the projection, and the writers are untouched', () => {
  const board = BOARD()
  // The Student Pool still filters by readiness from the students list.
  assert.match(board, /filterPoolByReadiness/)
  // Both card sites derive from the shared helper with the cohort pinned.
  const sites = board.match(/studentsMatchedToUnit\(unit, matches, studentMap, cohortId\)/g) || []
  assert.equal(sites.length, 2)
  assert.ok(!board.includes('students.filter(s => s.matched_unit_id === unit.id)'),
    'the pointer-based derivation has zero occurrences on the board')
  // App's unmatch consumes the ONE tested plan; the final-revert projection
  // literal lives in the plan module, not hand-rolled in App.
  assert.match(APP(), /const plan = planUnmatch\(\{ student, match, matches \}\)/)
  assert.match(APP(), /const studentPatch = unmatchStudentPatch\(plan, \{ revertStatus \}\)/)
  assert.match(read('src/lib/unmatchPlan.js'), /matched_unit_id: null, shift_assigned: '', match_quality: null,/)
})

test('MULTI 14: MUTATION CONTROL - the pointer-only filter fails these proofs', () => {
  // The forbidden regression: derive rows from students.matched_unit_id only.
  const pointerOnly = (unit, _matches, studentsByIdMap) =>
    Object.values(studentsByIdMap).filter(s => s.matched_unit_id === unit.id)
  const mutated = pointerOnly(UNITS.A, MULTI_MATCHES, byId)
  const real = studentsMatchedToUnit(UNITS.A, MULTI_MATCHES, byId, COHORT.A)
  assert.ok(!mutated.some(s => s.id === 'stu-kai'), 'the mutation hides the second placement')
  assert.ok(real.some(s => s.id === 'stu-kai'))
  assert.notDeepEqual(mutated.map(s => s.id).sort(), real.map(s => s.id).sort(),
    'MULTI 1 would fail against this build')
  // And the mutation also readmits the foreign-cohort blindspot: it cannot see
  // cohort at all, so isolation would rest on the caller alone.
  assert.equal(pointerOnly(UNITS.B, [], byId).length, 1, 'pointer-only cannot enforce cohort rules')
})

// ── GROUP ENVELOPE: consolidated action only when it consolidates ────────────

test('GROUP 1+2: one unnotified placement shows NO card-level action; the row keeps its own', () => {
  const card = CARD()
  // The ONLY render of the consolidated trigger is guarded by >= 2.
  const uses = card.match(/data-testid="notify-unit-leader-consolidated"/g) || []
  assert.equal(uses.length, 1, 'one trigger definition')
  assert.match(card, /\{unnotifiedStudents\.length >= 2 && \(/,
    'the group action exists only when there is a group')
  // The row-level unit-leader control is untouched (PROOF 7 pins the shared
  // component; this pins that the row still opens the individual draft).
  assert.match(card, /onOpenDraft=\{\(\) => onNotify\(student, match\)\}/)
})

test('GROUP 3-5: the badge and label carry the exact eligible count, never filled slots', () => {
  const card = CARD()
  assert.match(card, /data-testid="notify-consolidated-count"/)
  assert.match(card, /\{unnotifiedStudents\.length\}\s*<\/span>/,
    'the badge is the unnotified count')
  assert.match(card, /aria-label=\{groupNotifyLabel\}/)
  assert.match(card, /<Tooltip label=\{groupNotifyLabel\} placement="top">/)
  // NEGATIVE CONTROL: neither the badge nor the label reads filledCount. The
  // slice starts AT the trigger so the capacity text beside it (which honestly
  // says "filled") is not misread as the badge's source.
  const zone = card.slice(card.indexOf('data-testid="notify-unit-leader-consolidated"'),
    card.indexOf('data-testid="notify-consolidated-count"') + 400)
  assert.ok(!zone.includes('filledCount'), 'the count is eligibility, not capacity')
  assert.match(read('src/components/EmbedUnitCard.jsx'),
    /const groupNotifyLabel = `Notify Unit Leader About \$\{unnotifiedStudents\.length\} Students`/)
  // House badge red, not a bespoke color.
  assert.match(card, /import \{ BADGE_COUNT_BG, BADGE_COUNT_FG \} from '\.\.\/lib\/badgeTokens'/)
})

test('GROUP 6: already-confirmed placements are excluded from badge and review alike', () => {
  // Both read unnotifiedStudents, the ledger-derived filter proved in
  // PROOF 14+15 - one source, so the badge and the review cannot disagree.
  const card = CARD()
  const handler = card.slice(card.indexOf('const handleNotifyAll'), card.indexOf('const openConsolidatedDraft'))
  assert.match(handler, /rowsFor\(unnotifiedStudents\)/)
  assert.match(card, /\{unnotifiedStudents\.length\}\s*<\/span>/)
})

test('GROUP 8: the icon opens the SAME review flow and freezes the same ids', () => {
  const card = CARD()
  assert.match(card, /data-testid="notify-unit-leader-consolidated"[\s\S]{0,120}aria-label=\{groupNotifyLabel\}[\s\S]{0,60}onClick=\{handleNotifyAll\}/)
  // The freeze is unchanged: ids snapshot at draft-open (pinned in PROOF 14b).
  assert.match(card, /matchIds: rows\.map\(r => r\.match\?\.id\)\.filter\(Boolean\)/)
})

test('GROUP: no full-width card-level notify row remains', () => {
  const card = CARD()
  assert.ok(!card.includes('notifyButtonLabel'), 'the big button label is gone')
  // Order-independent: the consolidated trigger region may carry NEITHER the
  // navy fill NOR the padded-button geometry, however the properties are
  // arranged. (The reviewer showed the old ordered regex missed a reordered
  // restoration.)
  const trigger = card.slice(card.indexOf('data-testid="notify-unit-leader-consolidated"'),
    card.indexOf('data-testid="notify-consolidated-count"'))
  assert.ok(!trigger.includes("background: '#1D2567'"), 'no navy fill on the trigger')
  assert.ok(!trigger.includes("padding: '6px 12px'"), 'no button padding on the trigger')
  assert.ok(!card.includes('already notified'), 'no supplemental text row either')
})

test('GROUP 10: MUTATION CONTROL - a one-student card-level action fails these proofs', () => {
  const raw = read('src/components/EmbedUnitCard.jsx')
  // Forbidden change A: show the group action for a single placement.
  const single = raw.replace('{unnotifiedStudents.length >= 2 && (', '{unnotifiedStudents.length >= 1 && (')
  assert.notEqual(single, raw)
  assert.ok(!/\{unnotifiedStudents\.length >= 2 && \(/.test(strip(single)),
    'GROUP 1 would fail against this build')
  // Forbidden change B: restore the large full-width button - in ANY property
  // order. The guarding test slices the trigger region and checks the fill and
  // the padding independently, so this reordered restoration trips it too.
  const big = raw.replace(
    "background: 'none', padding: 0, lineHeight: 1, cursor: 'pointer', color: '#475467' }}",
    "background: '#1D2567', padding: '6px 12px', borderRadius: 8, color: '#fff' }}")
  assert.notEqual(big, raw)
  const bigStripped = strip(big)
  const bigTrigger = bigStripped.slice(bigStripped.indexOf('data-testid="notify-unit-leader-consolidated"'),
    bigStripped.indexOf('data-testid="notify-consolidated-count"'))
  assert.ok(bigTrigger.includes("background: '#1D2567'") && bigTrigger.includes("padding: '6px 12px'"),
    'the no-full-width proof would fail against this build')
})

// ── UNMATCH: survivor-aware plan (UNIT-POOL-REFINEMENT-1 correction) ─────────

const { planUnmatch, unmatchStudentPatch } = await import('../src/lib/unmatchPlan.js')

const UM = {
  student: { id: 'stu-kai', cohort_id: 'cohort-a', matched_unit_id: 'unit-b', status: 'Active Rotation' },
  primary: { id: 'm-b', student_id: 'stu-kai', unit_id: 'unit-b', cohort_id: 'cohort-a', match_quality: 'top_choice', shift_assigned: 'Night', created_at: '2026-08-01T00:00:00Z' },
  extra:   { id: 'm-a', student_id: 'stu-kai', unit_id: 'unit-a', cohort_id: 'cohort-a', match_quality: 'other', shift_assigned: 'Day', created_at: '2026-08-10T00:00:00Z' },
  foreign: { id: 'm-x', student_id: 'stu-kai', unit_id: 'unit-x', cohort_id: 'cohort-b', created_at: '2026-08-05T00:00:00Z' },
}
const bothMatches = [UM.primary, UM.extra]

test('UNMATCH 1: removing an ADDITIONAL placement touches nothing student-level', () => {
  const plan = planUnmatch({ student: UM.student, match: UM.extra, matches: bothMatches })
  assert.equal(plan.kind, 'additional')
  assert.equal(unmatchStudentPatch(plan), null,
    'no student patch exists for an additional removal - not the pointer, not the status')
})

test('UNMATCH 2: removing the PRIMARY with a survivor moves the projection to it', () => {
  const plan = planUnmatch({ student: UM.student, match: UM.primary, matches: bothMatches })
  assert.equal(plan.kind, 'primary_with_survivor')
  assert.equal(plan.successor.id, 'm-a')
  const patch = unmatchStudentPatch(plan)
  assert.equal(patch.matched_unit_id, 'unit-a', 'the survivor owns the pointer')
  assert.equal(patch.match_quality, 'other', 'the survivor\'s OWN recorded rank')
  assert.equal(patch.shift_assigned, 'Day', 'the survivor\'s OWN shift')
  assert.ok(!('status' in patch), 'status is never reverted while a placement survives')
  assert.ok(!('interview_outcome' in patch), 'nor the interview outcome')
})

test('UNMATCH 3: removing the FINAL placement keeps the existing revert rules', () => {
  const plan = planUnmatch({ student: UM.student, match: UM.primary, matches: [UM.primary] })
  assert.equal(plan.kind, 'final')
  const patch = unmatchStudentPatch(plan, { revertStatus: 'Not Proceeding' })
  assert.deepEqual(patch, {
    matched_unit_id: null, shift_assigned: '', match_quality: null,
    interview_outcome: 'Pending Interview', status: 'Not Proceeding',
  }, 'the disposition-aware revert is supplied by the caller and applied verbatim')
})

test('UNMATCH 9+10: lifecycle states pass through untouched in survivor cases', () => {
  for (const status of ['Placed', 'Active Rotation', 'Completed', 'Not Proceeding']) {
    const st = { ...UM.student, status }
    for (const removed of [UM.extra, UM.primary]) {
      const plan = planUnmatch({ student: st, match: removed, matches: bothMatches })
      const patch = unmatchStudentPatch(plan)
      assert.ok(patch === null || !('status' in patch),
        `${status}: a survivor case must never carry a status write`)
    }
  }
})

test('UNMATCH 11: cross-cohort rows neither block a revert nor become a successor', () => {
  // Only the foreign-cohort row "survives": that is NOT a survivor here.
  const plan = planUnmatch({ student: UM.student, match: UM.primary, matches: [UM.primary, UM.foreign] })
  assert.equal(plan.kind, 'final', 'a foreign-cohort match is not a surviving placement')
  // And with a real survivor present, the foreign row can never be the successor.
  const plan2 = planUnmatch({ student: UM.student, match: UM.primary, matches: [UM.primary, UM.extra, UM.foreign] })
  assert.equal(plan2.successor.id, 'm-a')
})

test('UNMATCH 11b: a recreated match is its own placement, not an inherited one', () => {
  // The successor rule is deterministic: earliest surviving created_at.
  const recreated = { ...UM.extra, id: 'm-a2', created_at: '2026-08-15T00:00:00Z' }
  const older = { ...UM.extra, id: 'm-old', unit_id: 'unit-c', created_at: '2026-08-02T00:00:00Z' }
  const plan = planUnmatch({ student: UM.student, match: UM.primary, matches: [UM.primary, recreated, older] })
  assert.equal(plan.successor.id, 'm-old', 'earliest surviving placement becomes primary')
})

test('UNMATCH 6+7: evidence never transfers - it is keyed to the match id', () => {
  // The ledger key is the match id (placementNotificationState.notificationKey).
  // Removing m-b cannot make m-b\'s confirmation answer for m-a: different key.
  const confirmed = notificationStateIndex([{
    id: 'e1', notification_type: CONFIRMED_TYPE, status: CONFIRMED_STATUS,
    sent_at: '2026-08-19T10:00:00.000Z',
    metadata: { [NOTIFY_META.target]: NOTIFICATION_TARGETS.UNIT_LEADER, [NOTIFY_META.match]: 'm-b' },
  }])
  const survivor = notificationStateFor(confirmed, { target: NOTIFICATION_TARGETS.UNIT_LEADER, matchId: 'm-a' })
  assert.equal(survivor.confirmed, false, 'the removed placement\'s evidence never applies to the survivor')
  const removed = notificationStateFor(confirmed, { target: NOTIFICATION_TARGETS.UNIT_LEADER, matchId: 'm-b' })
  assert.equal(removed.confirmed, true, 'and it remains intact history for the id it names')
})

test('UNMATCH wiring: App consumes the plan; the additional branch writes nothing student-level', () => {
  const app = APP()
  const fn = app.slice(app.indexOf('const unmatch = async (student, unit)'), app.indexOf('const updateMatch'))
  assert.match(fn, /const plan = planUnmatch\(\{ student, match, matches \}\)/)
  const addBranch = fn.slice(fn.indexOf("if (plan.kind === 'additional')"), fn.indexOf('// The rubric lookup'))
  assert.ok(!addBranch.includes("from('students')"))
  assert.ok(!addBranch.includes('clearPrimaryPreceptor'))
  assert.match(addBranch, /update\(\{ slots_remaining: additionalRemaining \}\)\.eq\('id', unit\.id\)/,
    'capacity updates only for the removed placement\'s unit')
  // The revert path still clears FIRST, through the canonical guarded call.
  assert.ok(fn.indexOf('clearPrimaryPreceptor') < fn.indexOf("'delete match on unmatch'"))
  // And no branch invents a client-side sync of assignment rows: the pointer
  // write is the whole transition, the DB trigger owns the mirror.
  assert.ok(!fn.includes("from('student_unit_assignments')"),
    'no second projection rule in the client - the comments may NAME the table; no code may write it')
})

test('UNMATCH 12: MUTATION CONTROL - unconditional clearing fails the survivor proofs', () => {
  // The forbidden regression: every unmatch reverts, whatever survives.
  const mutatedPlan = () => ({ kind: 'final', survivors: [], successor: null })
  const patch = unmatchStudentPatch(mutatedPlan(), { revertStatus: 'Interviewed' })
  assert.equal(patch.matched_unit_id, null)
  assert.equal(patch.status, 'Interviewed')
  // UNMATCH 1 would fail: the additional removal now carries a student write.
  assert.notEqual(patch, null, 'UNMATCH 1 would fail against this build')
  // UNMATCH 2 would fail: the pointer goes null instead of to the survivor.
  const real = unmatchStudentPatch(planUnmatch({ student: UM.student, match: UM.primary, matches: bothMatches }))
  assert.notEqual(patch.matched_unit_id, real.matched_unit_id, 'UNMATCH 2 would fail against this build')
  // And UNMATCH 9: the mutated patch reverts an Active Rotation student.
  assert.ok('status' in patch, 'UNMATCH 9 would fail against this build')
})

// ── MUTATION CONTROLS ────────────────────────────────────────────────────────
//
// Each forbidden change is applied to a COPY of today's source; the assertion
// that guards it must catch the mutated copy. A guard that cannot fail is not a
// guard.

test('MUTATION CONTROLS: each forbidden change trips its named proof', () => {
  const card = read('src/components/EmbedUnitCard.jsx')
  const board = read('src/components/MatchingTab.jsx')

  // 1. Restoring the unit delete button → PROOF 2 catches it.
  const withDelete = card.replace('{isFocusedUnit && (',
    '<Tooltip label="Delete unit" placement="top"><button aria-label="Delete unit">✕</button></Tooltip>{isFocusedUnit && (')
  assert.notEqual(withDelete, card)
  assert.ok(strip(withDelete).includes('"Delete unit"'), 'PROOF 2 would fail against this build')

  // 2. Conflating unit and preceptor notification in the batch → PROOF 16-19.
  const conflated = board.replace(
    "target: NOTIFICATION_TARGETS.UNIT_LEADER, action: 'confirm', student, match,",
    "target: NOTIFICATION_TARGETS.PRECEPTOR, action: 'confirm', student, match,")
  assert.notEqual(conflated, board)
  const mutatedBatch = strip(conflated)
  const batchSlice = mutatedBatch.slice(mutatedBatch.indexOf('const handleBatchConfirmNotified'),
    mutatedBatch.indexOf('const handleCorrectNotified'))
  assert.ok(batchSlice.includes('PRECEPTOR'), 'PROOF 16-19 would fail against this build')

  // 3. Including an already-confirmed match in the default consolidated set →
  //    PROOF 14+15. The mutation: drop the confirmation filter entirely.
  const students = [{ id: S.A }, { id: S.B }]
  const matches = [matchRow('a', S.A), matchRow('b', S.B)]
  const ledger = [confirmEvent('match-a')]
  const mutatedInclusion = students                     // filter removed
  assert.notDeepEqual(mutatedInclusion.map(s => s.id),
    unnotifiedOf(students, matches, ledger).map(s => s.id),
    'PROOF 14+15 would fail against this build')

  // 4. Unmatching ALL of a multi-unit student's placements → PROOF 11.
  const app = read('src/App.jsx')
  const sweeping = app.replace(
    "if (match) await safeWrite(() => supabase.from('matches').delete().eq('id', match.id), { name: 'delete match on unmatch' })",
    "await safeWrite(() => supabase.from('matches').delete().eq('student_id', student.id), { name: 'delete match on unmatch' })")
  assert.notEqual(sweeping, app)
  // Raw source, like every other App assertion (the stripper eats glob strings).
  const slice = sweeping.slice(sweeping.indexOf('const unmatch = async (student, unit)'), sweeping.indexOf('const updateMatch'))
  assert.ok(/\.delete\(\)\.eq\('student_id'/.test(slice), 'PROOF 11 would fail against this build')
})
