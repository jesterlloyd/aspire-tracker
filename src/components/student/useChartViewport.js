// STUDENT-CHART-1: how much of the window the chart gets.
//
// THE RULE (Owner, 2026-09-18): scrolling the page hides the KPI filter cards and the
// sub-tabs, the search and filter bar pins to the top, and everything left below it is
// the chart. The reader spends the screen on the record, not on filters they have
// finished using.
//
// TWO THINGS SIT ABOVE THE CHART, not one. `.top-section` (the app header plus the
// section nav) is `position: sticky; top: 0`, so it never leaves. The first version of
// this hook only measured the toolbar and pinned it at `top: 0`, which put the toolbar
// *underneath* the header and hid the first 40px of the binder behind it (measured at
// 1600x950). The chart looked cut off because it was: its top was under the chrome.
//
// So the pinned stack is: sticky chrome + the toolbar. Both are measured, because the
// chrome's height is 110px and the `--app-chrome-height` token says 112, and neither is
// a number this file should be guessing at.

import { useEffect, useRef, useState } from 'react'

// The chart never gets less than this, however short the window. Below it the page
// scrolls to reach the bottom of the binder, which beats crushing it.
const MIN_CHART_H = 420
// A gap under the binder so its bottom cover is never flush with the window edge.
const BOTTOM_GAP = 12

/** The height of whatever is pinned above this page's own content. */
function stickyChromeHeight() {
  if (typeof document === 'undefined') return 0
  const chrome = document.querySelector('.top-section')
  if (chrome && getComputedStyle(chrome).position === 'sticky') {
    return Math.round(chrome.getBoundingClientRect().height)
  }
  return 0
}

export function useChartViewport() {
  const barRef = useRef(null)
  const [chartHeight, setChartHeight] = useState(null)
  const [toolbarTop, setToolbarTop] = useState(0)
  const [chartTop, setChartTop] = useState(0)

  useEffect(() => {
    const bar = barRef.current
    if (!bar) return undefined

    const measure = () => {
      const chromeH = stickyChromeHeight()
      // The bar's margins count: they are the gap the chart starts after.
      const style = window.getComputedStyle(bar)
      const margins = parseFloat(style.marginTop || 0) + parseFloat(style.marginBottom || 0)
      const pinned = chromeH + bar.getBoundingClientRect().height + margins
      const next = Math.max(MIN_CHART_H, Math.round(window.innerHeight - pinned - BOTTOM_GAP))
      setChartHeight(prev => (prev === next ? prev : next))
      setToolbarTop(prev => (prev === chromeH ? prev : chromeH))
      setChartTop(prev => (prev === pinned ? prev : pinned))
    }

    measure()
    window.addEventListener('resize', measure)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(bar)
    // The chrome can change height too (a wrapped nav on a narrow window).
    const chrome = document.querySelector('.top-section')
    if (chrome && ro) ro.observe(chrome)
    return () => { window.removeEventListener('resize', measure); ro?.disconnect() }
  }, [])

  return { barRef, chartHeight, toolbarTop, chartTop }
}
