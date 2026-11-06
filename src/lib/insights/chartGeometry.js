// ASPIRE-INSIGHTS-1: the arithmetic the chart marks share with the cards that hold them. Pure.
// A card reserves a chart's natural height (hbarHeight, funnelHeight) before it is drawn, so the
// chart can fill the card without sizing it.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** A round scale end just above the largest value, so the longest bar nearly fills the plot. */
export function niceMax(v, cap = null) {
  const top = Math.max(0, v || 0)
  if (!top) return cap || 1
  const mag = 10 ** Math.floor(Math.log10(top))
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(m => m * mag >= top * 1.04) || 10
  const end = step * mag
  return cap ? Math.min(cap, end) : end
}

export const HBAR_ROW = 30
export const hbarTop = (items, refValue) => (refValue != null && items.some(i => !i.suppressed) ? 20 : 4)
export const hbarHeight = (items, refValue = null) => hbarTop(items, refValue) + items.length * HBAR_ROW + 4
export const funnelHeight = steps => steps.filter(s => s.count != null).length * 34 + 6
