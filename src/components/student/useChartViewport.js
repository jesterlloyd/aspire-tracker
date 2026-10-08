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

import { useCallback, useEffect, useRef, useState } from 'react'

// The chart never gets less than this, however short the window. Below it the page
// scrolls to reach the bottom of the binder, which beats crushing it.
const MIN_CHART_H = 420
// A gap under the binder so its bottom cover is never flush with the window edge.
const BOTTOM_GAP = 12

/** The height of whatever is pinned above this page's own content. */
// RESIDENCY-PORTAL-WIDTH-1: the portals' pinned chrome is `.ptl-topsection` (header plus
// section nav), not the staff app's `.top-section`. Looking for the staff one alone put the
// Residency Portal's pinned search bar at top 0, over the portal's own header.
const CHROME_SELECTOR = '.top-section, .ptl-topsection'

function stickyChrome() {
  if (typeof document === 'undefined') return null
  return [...document.querySelectorAll(CHROME_SELECTOR)].find(el => getComputedStyle(el).position === 'sticky') || null
}

function stickyChromeHeight() {
  const chrome = stickyChrome()
  return chrome ? Math.round(chrome.getBoundingClientRect().height) : 0
}

/**
 * What the page draws BELOW the chart's tab (a portal's footer and bottom padding), measured
 * from the elements themselves: every in-flow sibling after the tab, and every ancestor's
 * bottom padding, up to <body>. VIEWPORT-REVERT-1 (Owner, 2026-10-07): the first version read
 * `document.scrollHeight - tab.bottom`, and the app shell's `min-height: 100vh` made the EMPTY
 * space under a short page count as trailing content. One measurement taken while the chart
 * was short (a warmed-up tab is display:none, and reads as 0px tall) then locked it there: the
 * split shrank until the page no longer scrolled, the KPI cards never scrolled away, and the
 * binder lost a third of the window. Elements cannot lie about that.
 */
function trailingBelow(tab) {
  let total = parseFloat(getComputedStyle(tab).marginBottom || 0)
  let el = tab
  while (el && el.parentElement && el !== document.body) {
    for (let sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
      const cs = getComputedStyle(sib)
      if (cs.display === 'none' || cs.position === 'fixed' || cs.position === 'absolute') continue
      total += sib.getBoundingClientRect().height + parseFloat(cs.marginTop || 0) + parseFloat(cs.marginBottom || 0)
    }
    const pcs = getComputedStyle(el.parentElement)
    total += parseFloat(pcs.paddingBottom || 0) + parseFloat(pcs.borderBottomWidth || 0)
    el = el.parentElement
  }
  return Math.round(total)
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
      const barH = bar.getBoundingClientRect().height
      // A hidden bar (a tab mounted by the warm-up but not shown) measures nothing true; keep
      // the last real measurement and wait for the ResizeObserver to fire when it is shown.
      if (!barH) return
      // The bar's margins count: they are the gap the chart starts after.
      const style = window.getComputedStyle(bar)
      const margins = parseFloat(style.marginTop || 0) + parseFloat(style.marginBottom || 0)
      const pinned = chromeH + barH + margins
      // RESIDENCY-PORTAL-WIDTH-1: whatever the page draws BELOW the chart's tab (a portal's
      // footer and bottom padding) is still scrolled to, and it pushed the split up under the
      // pinned bar by exactly that much (77px in the Residency Portal). The chart leaves room
      // for it, so the page's last scroll position puts the split right under the bar. The
      // staff app draws nothing there, so its gap stays BOTTOM_GAP.
      const tab = bar.parentElement
      const trailing = tab ? trailingBelow(tab) : 0
      const next = Math.max(MIN_CHART_H, Math.round(window.innerHeight - pinned - Math.max(BOTTOM_GAP, trailing)))
      setChartHeight(prev => (prev === next ? prev : next))
      setToolbarTop(prev => (prev === chromeH ? prev : chromeH))
      setChartTop(prev => (prev === pinned ? prev : pinned))
    }

    measure()
    window.addEventListener('resize', measure)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(bar)
    // The chrome can change height too (a wrapped nav on a narrow window).
    const chrome = stickyChrome()
    if (chrome && ro) ro.observe(chrome)
    return () => { window.removeEventListener('resize', measure); ro?.disconnect() }
  }, [])

  return { barRef, chartHeight, toolbarTop, chartTop }
}

/**
 * NA-CONTACTS-LOCK-1 (Owner, 2026-10-07): a page that is LOCKED below the chrome. Nothing above
 * the element scrolls away (Student Profiles' rule hides its KPI cards; this one keeps them), the
 * element takes exactly what the window has left under its own top edge, less whatever the page
 * draws after it (a portal's footer), and the page itself never scrolls: only the element's
 * contents do. NE&L Portal > Contacts is the first host (the list and the record are its two
 * scrollers). Measured the same way the chart is, from elements, never from scrollHeight.
 */
export function useLockedHeight(minHeight = 360, gap = BOTTOM_GAP) {
  // A callback ref, not a ref object: the host mounts the element AFTER its loading state, so
  // an effect keyed on mount would run once with no element and never again.
  const [el, setEl] = useState(null)
  const ref = useCallback(node => setEl(node), [])
  const [height, setHeight] = useState(null)

  useEffect(() => {
    if (!el) return undefined
    const measure = () => {
      const rect = el.getBoundingClientRect()
      if (!rect.height) return
      const top = rect.top + window.scrollY
      const next = Math.max(minHeight, Math.round(window.innerHeight - top - Math.max(gap, trailingBelow(el))))
      setHeight(prev => (prev === next ? prev : next))
    }
    measure()
    window.addEventListener('resize', measure)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    // The element's own size, and whatever sits above it in the page (a wrapped KPI row moves
    // its top edge).
    ro?.observe(el)
    if (el.parentElement && ro) ro.observe(el.parentElement)
    const chrome = stickyChrome()
    if (chrome && ro) ro.observe(chrome)
    return () => { window.removeEventListener('resize', measure); ro?.disconnect() }
  }, [el, minHeight, gap])

  return { ref, height }
}
