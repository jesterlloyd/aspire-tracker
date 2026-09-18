// STUDENT-CHART-1: how much of the window the chart gets.
//
// THE RULE (Owner, 2026-09-18): scrolling the page hides the KPI filter cards and the
// sub-tabs, the search and filter bar pins to the top, and everything left below it is
// the chart. The reader spends the screen on the record, not on filters they have
// finished using.
//
// This has to be measured rather than written as a constant. The pinned bar wraps at
// narrow widths - the search field, the school select, the view toggle and three action
// buttons do not always fit on one line - so its height is anywhere from one row to
// three. The old layout hard-coded `calc(100vh - 164px)` and was wrong at every width:
// at 1600x950 it left the chart 512px and the index rail 6px shorter than its own tabs.
//
// It reports a number, and the stylesheet decides what to do with it. Below 980px the
// split stacks and the media query overrides the variable outright, so this keeps
// measuring and is simply ignored.

import { useEffect, useRef, useState } from 'react'

// The chart never gets less than this, however short the window. Below it the page
// scrolls to reach the bottom of the binder, which beats crushing it.
const MIN_CHART_H = 420
// A gap under the binder so its bottom cover is never flush with the window edge.
const BOTTOM_GAP = 12

export function useChartViewport() {
  const barRef = useRef(null)
  const [chartHeight, setChartHeight] = useState(null)

  useEffect(() => {
    const bar = barRef.current
    if (!bar) return undefined

    const measure = () => {
      // The bar is sticky at top: 0, so once pinned its height IS the chrome above the
      // chart. Its margins count too: they are the gap the chart starts after.
      const style = window.getComputedStyle(bar)
      const margins = parseFloat(style.marginTop || 0) + parseFloat(style.marginBottom || 0)
      const pinned = bar.getBoundingClientRect().height + margins
      const next = Math.max(MIN_CHART_H, Math.round(window.innerHeight - pinned - BOTTOM_GAP))
      setChartHeight(prev => (prev === next ? prev : next))
    }

    measure()
    window.addEventListener('resize', measure)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(bar)
    return () => { window.removeEventListener('resize', measure); ro?.disconnect() }
  }, [])

  return { barRef, chartHeight }
}
