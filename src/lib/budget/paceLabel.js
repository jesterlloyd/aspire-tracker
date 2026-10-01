// BUDGET-PACE-LABEL-1 (Owner, 2026-09-30): where the Monthly Spend chart writes "Pace $167/mo".
//
// The label used to sit at the right end of the pace line, always. A bar whose top is near the line in
// the last months (June at $169 against a $167 pace) put its own value in the same place, and neither
// could be read. So the label looks for room: above or below the line, from the right end leftward,
// clear of every bar and every bar's value. With no room anywhere it is not drawn; the legend under the
// chart already states the pace. Pure geometry in the chart's own units, tested without a browser.

export const PACE_LABEL_W = 84   // "Pace $1.2k/mo" at 11px, with a little air
const TEXT_H = 13
const GAP = 4                    // between the line and the label
const VALUE_HALF_W = 22          // half of a bar's value label ("$1.2k")

const overlaps = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1

/**
 * @param bars   one per month WITH something drawn: { cx, bw, top } (top = y of the bar's top edge)
 * @param paceY  y of the pace line; yBase = y of the axis; left/right = the plot's x range
 * @returns { x, y, anchor: 'end' } for the <text>, or null when nothing is clear
 */
export function paceLabelSpot({ bars = [], paceY, yBase, left, right, step, width = PACE_LABEL_W }) {
  const blocks = bars.flatMap(b => [
    { x1: b.cx - b.bw / 2 - 2, x2: b.cx + b.bw / 2 + 2, y1: b.top, y2: yBase },                          // the bar
    { x1: b.cx - VALUE_HALF_W, x2: b.cx + VALUE_HALF_W, y1: b.top - 6 - TEXT_H, y2: b.top - 2 },          // its value
  ])
  const rows = [
    { y1: paceY - GAP - TEXT_H, y2: paceY - GAP, baseline: paceY - 6 },          // above the line
    { y1: paceY + GAP, y2: paceY + GAP + TEXT_H, baseline: paceY + 14 },         // below it
  ].filter(r => r.y2 <= yBase - 2)   // never down among the month names
  const stride = step > 0 ? step / 2 : width / 2
  for (let x2 = right; x2 - width >= left; x2 -= stride) {
    for (const r of rows) {
      const box = { x1: x2 - width, x2, y1: r.y1, y2: r.y2 }
      if (!blocks.some(b => overlaps(box, b))) return { x: x2, y: r.baseline, anchor: 'end' }
    }
  }
  return null
}
