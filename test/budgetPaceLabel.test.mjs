// test/budgetPaceLabel.test.mjs
//
// BUDGET-PACE-LABEL-1 (Owner, 2026-09-30): on FY26 the June bar ($169) ended at the pace line ($167),
// so "$169" and "Pace $167/mo" were printed on top of each other. The label now finds room.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { paceLabelSpot, PACE_LABEL_W } from '../src/lib/budget/paceLabel.js'

// The chart's own geometry (BudgetSummary.jsx MonthlyChart).
const W = 720, H = 250, L = 58, R = 14, T = 18, B = 30
const cw = (W - L - R) / 12, bw = Math.min(24, cw * 0.56)
const chart = (spend, pace, max = 500) => {
  const y = (v) => T + (H - T - B) * (1 - v / max)
  const bars = spend.map((v, i) => (v > 0 ? { cx: L + i * cw + cw / 2, bw, top: y(v) } : null)).filter(Boolean)
  return { bars, paceY: y(pace), yBase: y(0), left: L, right: W - R, step: cw, y }
}
const boxOf = (spot, above) => ({ x1: spot.x - PACE_LABEL_W, x2: spot.x, y1: above ? spot.y - 11 : spot.y - 10, y2: spot.y + 2 })
const hits = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1

test('the Owner\'s FY26: the label moves clear of June\'s $169 and of every bar', () => {
  //            Jul Aug Sep Oct Nov Dec Jan Feb Mar Apr  May Jun
  const spend = [0, 54, 0, 0, 0, 0, 64, 25, 0, 381, 41, 169]
  const c = chart(spend, 166.67)
  const spot = paceLabelSpot(c)
  assert.ok(spot, 'there is room on this chart')
  assert.notDeepEqual([spot.x, spot.y], [W - R, c.paceY - 6], 'not where it collided')
  const label = boxOf(spot, spot.y < c.paceY)
  for (const b of c.bars) {
    assert.ok(!hits(label, { x1: b.cx - b.bw / 2, x2: b.cx + b.bw / 2, y1: b.top, y2: c.yBase }), 'clear of the bars')
    assert.ok(!hits(label, { x1: b.cx - 18, x2: b.cx + 18, y1: b.top - 17, y2: b.top - 4 }), 'clear of the values')
  }
  assert.ok(spot.x - PACE_LABEL_W >= L && spot.x <= W - R, 'inside the plot')
})

test('an empty right end keeps the label where it always was', () => {
  const c = chart([300, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 166.67)
  assert.deepEqual(paceLabelSpot(c), { x: W - R, y: c.paceY - 6, anchor: 'end' })
})

test('no room anywhere: the label is left out, and the legend still states the pace', () => {
  const c = chart(Array(12).fill(170), 166.67)
  assert.equal(paceLabelSpot(c), null)
  const src = readFileSync(new URL('../src/components/budget/BudgetSummary.jsx', import.meta.url), 'utf8')
  assert.match(src, /\{paceAt && <text x=\{paceAt\.x\} y=\{paceAt\.y\}/)
  assert.match(src, /Even pace \(\{usd\(s\.evenPace\)\} per month\)/)
})

test('the label never drops among the month names', () => {
  const c = chart([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40], 4)   // a pace line almost on the axis
  const spot = paceLabelSpot(c)
  assert.ok(spot && spot.y < c.paceY, 'above the line, never below the axis')
})
