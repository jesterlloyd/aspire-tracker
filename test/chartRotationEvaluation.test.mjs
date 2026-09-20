// ASPIRE-CHART: static-source + functional guards for the Rotation and
// Evaluation reworks - the Placement Board rename, one capacity source,
// stored-rank match honesty, routed preceptor subviews, the assignment entry
// point, one-click support shifts, visible certificate blockers, unified
// release verbs, CSV export, and the responsive reflows.
// Run: node --test test/chartRotationEvaluation.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  unitOpenSlots, totalOpenSlots, matchRankOf, derivePrefCounts,
} from '../src/lib/placementDisplay.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const rotationTab = read('src/components/RotationTab.jsx')
const matching = read('src/components/MatchingTab.jsx')
const smc = read('src/components/StudentMatchingCard.jsx')
const embed = read('src/components/EmbedUnitCard.jsx')
const coverage = read('src/components/StudentCoverage.jsx')
const activity = read('src/components/RotationActivity.jsx')
const rotationTable = read('src/components/rotation/RotationStudentTable.jsx')
const evalTab = read('src/components/EvaluationTab.jsx')
const rrAdapters = read('src/lib/evaluation/reviewQueueAdapters.js') // REVIEW-RELEASE-2: the panels are retired
const cfDetect = read('src/lib/evaluation/caseyFinkPostRotationDueDetection.js')
const rrDash = read('src/components/evaluation/SurveyAutomationDashboard.jsx')
const rrQueue = read('src/components/evaluation/ReviewReleaseQueue.jsx')
const css = read('src/index.css')

test('capacity: one calculation source (functional)', () => {
  const unit = { id: 'u1', total_slots: 3 }
  const matches = [{ unit_id: 'u1' }, { unit_id: 'u1' }, { unit_id: 'u2' }]
  assert.equal(unitOpenSlots(unit, matches), 1, 'live count vs configured total')
  assert.equal(unitOpenSlots({ id: 'u3', total_slots: 2 }, matches), 2)
  assert.equal(unitOpenSlots({ id: 'u1', total_slots: 1 }, matches), 0, 'floors at zero')
  assert.equal(unitOpenSlots(null, matches), null)
  assert.equal(totalOpenSlots([unit, { id: 'u2', total_slots: 5 }], matches), 5)
})

test('capacity: no display source reads the drift-prone stored field', () => {
  // The write path for slots_remaining is untouched; displays no longer read it.
  // PLACEMENT-BOARD-FELT-1 retired MatchingBanner (the board's ribbons carry its content).
  for (const [name, src] of [['StudentMatchingCard', smc]]) {
    assert.doesNotMatch(src, /slots_remaining/, `${name} reads live capacity only`)
    assert.match(src, /unitOpenSlots/, `${name} uses the shared helper`)
  }
  assert.match(matching, /const slotsRemaining\s*=\s*totalOpenSlots\(participating, matches\)/)
  // PLACEMENT-BOARD-FELT-1: the unit sort control retired (Owner, 2026-09-17), so the
  // most-available sort that used live counts went with it. Boards are alphabetical,
  // and a selected student reorders them by preference. Capacity itself is unchanged:
  // no display reads the drift-prone stored field.
  assert.match(matching, /displayUnits\.sort\(\(a, b\) => a\.unit_name\.localeCompare\(b\.unit_name\)\)/)
  // Comments explaining why the stored field is not read do not count as reading it.
  const matchingCode = matching.replace(/^\s*\/\/[^\n]*$/gm, '')
  assert.ok(!matchingCode.includes('slots_remaining'), 'the board reads live counts only')
})

test('match rank honesty (functional)', () => {
  assert.equal(matchRankOf({ match_quality: 'top_choice' }, null), 'top')
  assert.equal(matchRankOf({}, { match_quality: 'second_choice' }), 'second')
  assert.equal(matchRankOf({ match_quality: 'third_choice' }, null), 'third')
  assert.equal(matchRankOf({ match_quality: 'other' }, null), 'other')
  assert.equal(matchRankOf({}, null), 'not_recorded', 'absent data says so, never a false Other')
  const counts = derivePrefCounts(
    [{ id: 'a', match_quality: 'top_choice' }, { id: 'b' }],
    [{ student_id: 'b' }],
  )
  assert.deepEqual(counts, { top: 1, second: 0, third: 0, other: 0, notRecorded: 1 })
})

test('match rank honesty (source): historical rank never re-derives from names', () => {
  // The PLACED-student row (historical record) reads the stored rank. The
  // live preference indicator for a student being placed right now may still
  // compare current preferences - that is a present-tense fact, not history.
  const placedRow = embed.slice(embed.indexOf('function PinnedNote'), embed.indexOf('// ── Open slot'))
  assert.ok(placedRow.length > 200, 'the pinned-note slice still resolves')
  assert.doesNotMatch(placedRow, /unit_preference_1 === unit\.unit_name/)
  assert.match(embed, /matchRankOf\(student, match\)/)
  assert.match(matching, /derivePrefCounts\(matchedStudents, matches\)/)
  // The headline never fabricates a percentage from absent data.
  assert.match(matching, /recorded > 0 \? Math\.round\(\(prefCounts\.top \/ recorded\) \* 100\) : null/)
  assert.match(matching, /'Match rank not recorded'/)
})

test('Placement Board: honest name, routed preceptor subviews', () => {
  // SEGMENTED-PICKER-1: the three views are options on the shared control now, so the
  // label is a string in a list rather than a button's text child. Same words, same
  // routes, and the honest name is still the honest name.
  assert.match(rotationTab, /label: 'Placement Board'/)
  assert.doesNotMatch(rotationTab, /label: 'Matrix'/)
  assert.doesNotMatch(rotationTab, />\s*Matrix\s*<\/button>/)
  assert.match(rotationTab, /'\/rotation\/preceptors\/coverage'/)
  assert.match(rotationTab, /location\.pathname === '\/rotation\/preceptors\/coverage' \? 'coverage' : 'directory'/)
  assert.doesNotMatch(rotationTab, /setPrecView/, 'inner view is routed, not component state')
})

test('preceptor assignment is reachable from the Preceptors route', () => {
  assert.match(coverage, /import PreceptorAssignmentModal from '\.\/PreceptorAssignmentModal'/)
  assert.match(coverage, /Assign preceptor/)
  assert.match(coverage, /onAssign=\{canEdit \? setAssignStudent : null\}/, 'canEdit-gated, same modal the board uses')
})

test('support badge opens the exact flagged shift', () => {
  assert.match(activity, /const openSupportShift = \(studentId\) => \{/)
  assert.match(activity, /unreadSupportShifts\(mine, profileId, supportReceipts\)/)
  // ROTATION-ACTIVITY-CALENDAR-1: the progress cards became a table, so the badge that
  // triggers this now lives in RotationStudentTable. Same click, same fallback of
  // expanding the row when no handler is supplied.
  assert.match(rotationTable, /onClick=\{\(\) => onSupportOpen \? onSupportOpen\(s\.id\)/)
  // Receipt discipline unchanged: the modal writes it, never the click.
  assert.match(activity, /receipt is still written only by the Details modal after the\s*\n\s*\/\/ text renders/)
})

test('evaluation: blockers visible, verbs unified, export, reflow', async (t) => {
  await t.test('not-yet-eligible students render as blocked rows with reasons', () => {
    assert.match(cfDetect, /const blocked = status === 'not_eligible' \|\| status === 'not_eligible_hours'/)
    assert.match(cfDetect, /Required hours not met/)
    assert.match(cfDetect, /blocked,\n\s*\}\)/)
    assert.match(rrAdapters, /r\.status === 'not_eligible_hours' \? 'Hours not set' : 'Below threshold'/)
    // Blockers are amber states, never red; actions exist only for a new release or
    // an explicitly safe expired/revoked reissue.
    assert.match(rrAdapters, /const reissue = r\.status === 'readiness_reissue'/)
  })

  await t.test('summary counts and release safety are untouched', () => {
    assert.match(cfDetect, /summary\.ineligible_hours \+= 1/)
    assert.match(rrDash, /expected_instrument_slug: route\.instrumentSlug/)
    assert.match(rrDash, /setIdentityHold\(true\)/)
  })

  await t.test('one release verb across panels', () => {
    // REVIEW-RELEASE-1: one confirmation for every survey workflow, one verb.
    assert.match(rrQueue, /reissue \? `Reissue \$\{workflow\.label\}\?` : `Release \$\{workflow\.label\}\?`/)
    assert.match(rrQueue, /\{releasing \? 'Sending…' : reissue \? 'Confirm & Reissue' : 'Confirm & Send'\}/)
  })

  await t.test('CSV export mirrors the current filtered view', () => {
    assert.match(evalTab, /const exportResponsesCSV = \(\) => \{/)
    assert.match(evalTab, /const rows = sorted\.map\(a => \{/)
    assert.match(evalTab, /aspire_evaluations_\$\{dateSlug\}\.csv/)
  })

  // RESPONSES-PACKET-1 (2026-09-19): the six KPI tiles and the old table are gone. The
  // Responses tab is a results packet: file tabs, an analysis sheet, then the shared
  // DataSheet. test/responsesPacket.test.mjs holds the packet's own assertions.
  await t.test('the KPI band is gone and the roster is the shared DataSheet', () => {
    assert.doesNotMatch(evalTab, /className="eval-kpis"/)
    assert.doesNotMatch(css, /\.eval-kpis/)
    assert.doesNotMatch(evalTab, /<table style=\{\{ width: '100%', minWidth: 720/)
    assert.match(evalTab, /<DataSheet\s*\n\s*level="full"/)
  })

  await t.test('Casey-Fink pairs are built once, in the model, and the sheet reads them', () => {
    assert.match(evalTab, /buildPacket\(assignments, activeInstrumentFilter/)
    assert.match(read('src/lib/evaluation/responsesPacketModel.js'), /buildCaseyFinkComparison\(assignments\)/)
    assert.doesNotMatch(evalTab, /SECTION I AVERAGES/)
    assert.doesNotMatch(evalTab, /CaseyFinkComparisonPanel/)
  })

  await t.test('the sheet comes before the roster, and the roster filters live in its head', () => {
    const tabsIndex = evalTab.indexOf('<InstrumentTabs')
    const sheetIndex = evalTab.indexOf('<AnalysisSheet')
    const rosterIndex = evalTab.indexOf('<DataSheet')
    assert.ok(tabsIndex >= 0 && tabsIndex < sheetIndex && sheetIndex < rosterIndex, 'tabs, then sheet, then roster')
    assert.match(evalTab, /toolbar=\{rosterToolbar\}/)
    assert.match(evalTab, /aria-label="Timepoint filter"/)
    assert.match(evalTab, /aria-label="Status filter"/)
  })
})
