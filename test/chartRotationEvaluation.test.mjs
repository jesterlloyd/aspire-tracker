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
const banner = read('src/components/MatchingBanner.jsx')
const smc = read('src/components/StudentMatchingCard.jsx')
const embed = read('src/components/EmbedUnitCard.jsx')
const coverage = read('src/components/StudentCoverage.jsx')
const activity = read('src/components/RotationActivity.jsx')
const evalTab = read('src/components/EvaluationTab.jsx')
const cfPanel = read('src/components/evaluation/CaseyFinkPostRotationAutomationPanel.jsx')
const cfDetect = read('src/lib/evaluation/caseyFinkPostRotationDueDetection.js')
const sePanel = read('src/components/evaluation/StudentEvalAutomationPanel.jsx')
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
  for (const [name, src] of [['MatchingBanner', banner], ['StudentMatchingCard', smc]]) {
    assert.doesNotMatch(src, /slots_remaining/, `${name} reads live capacity only`)
    assert.match(src, /unitOpenSlots/, `${name} uses the shared helper`)
  }
  assert.match(matching, /const slotsRemaining\s*=\s*totalOpenSlots\(participating, matches\)/)
  assert.match(matching, /unitOpenSlots\(b, matches\).*unitOpenSlots\(a, matches\)/, 'availability sort uses live counts')
})

test('match rank honesty (functional)', () => {
  assert.equal(matchRankOf({ match_quality: 'top_choice' }, null), 'top')
  assert.equal(matchRankOf({}, { match_quality: 'second_choice' }), 'second')
  assert.equal(matchRankOf({ match_quality: 'other' }, null), 'other')
  assert.equal(matchRankOf({}, null), 'not_recorded', 'absent data says so, never a false Other')
  const counts = derivePrefCounts(
    [{ id: 'a', match_quality: 'top_choice' }, { id: 'b' }],
    [{ student_id: 'b' }],
  )
  assert.deepEqual(counts, { top: 1, second: 0, other: 0, notRecorded: 1 })
})

test('match rank honesty (source): historical rank never re-derives from names', () => {
  // The PLACED-student row (historical record) reads the stored rank. The
  // live preference indicator for a student being placed right now may still
  // compare current preferences - that is a present-tense fact, not history.
  const placedRow = embed.slice(embed.indexOf('function CompactPlacementRow'), embed.indexOf('// ── Compact'))
  assert.doesNotMatch(placedRow, /unit_preference_1 === unit\.unit_name/)
  assert.match(embed, /matchRankOf\(student, match\)/)
  assert.match(matching, /derivePrefCounts\(matchedStudents, matches\)/)
  // The headline never fabricates a percentage from absent data.
  assert.match(matching, /recorded > 0 \? Math\.round\(\(prefCounts\.top \/ recorded\) \* 100\) : null/)
  assert.match(matching, /'Match rank not recorded'/)
})

test('Placement Board: honest name, routed preceptor subviews', () => {
  assert.match(rotationTab, />\s*Placement Board\s*</)
  assert.doesNotMatch(rotationTab, />\s*Matrix\s*<\/button>/)
  assert.match(rotationTab, /navigate\('\/rotation\/preceptors\/coverage'\)/)
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
  assert.match(activity, /onClick=\{\(\) => onSupportOpen \? onSupportOpen\(s\.id\)/)
  // Receipt discipline unchanged: the modal writes it, never the click.
  assert.match(activity, /receipt is\s*\n\s*\/\/ still written only by the Details modal after the text renders/)
})

test('evaluation: blockers visible, verbs unified, export, reflow', async (t) => {
  await t.test('not-yet-eligible students render as blocked rows with reasons', () => {
    assert.match(cfDetect, /const blocked = status === 'not_eligible' \|\| status === 'not_eligible_hours'/)
    assert.match(cfDetect, /Required hours not met/)
    assert.match(cfDetect, /blocked,\n\s*\}\)/)
    assert.match(cfPanel, /not_eligible_hours:\s*\{ label: 'Blocked · hours not set'/)
    // Blockers are amber states, never red; no release action for blocked rows.
    assert.match(cfPanel, /r\.status === 'eligible_for_review' \? \(/)
  })

  await t.test('summary counts and release safety are untouched', () => {
    assert.match(cfDetect, /summary\.ineligible_hours \+= 1/)
    assert.match(cfPanel, /expected_instrument_slug: ROUTE\.instrumentSlug/)
    assert.match(cfPanel, /setIdentityHold\(true\)/)
  })

  await t.test('one release verb across panels', () => {
    assert.match(sePanel, /Release student survey\?/)
    assert.match(sePanel, /\{releasing \? 'Releasing…' : 'Confirm & Release'\}/)
    assert.doesNotMatch(sePanel, /Confirm & Send/)
  })

  await t.test('CSV export mirrors the current filtered view', () => {
    assert.match(evalTab, /const exportResponsesCSV = \(\) => \{/)
    assert.match(evalTab, /const rows = sorted\.map\(a => \{/)
    assert.match(evalTab, /aspire_evaluations_\$\{dateSlug\}\.csv/)
  })

  await t.test('the KPI band and table finally reflow', () => {
    assert.match(evalTab, /className="eval-kpis"/)
    assert.match(css, /\.eval-kpis \{ grid-template-columns: repeat\(7, 1fr\); \}/)
    assert.match(evalTab, /overflowX: 'auto' \}\}>\s*\n\s*<table style=\{\{ width: '100%', minWidth: 720/)
  })
})
