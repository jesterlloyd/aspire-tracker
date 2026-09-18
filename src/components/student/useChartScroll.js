// STUDENT-CHART-1: how the binder behaves as you read it.
//
// Three small behaviours that all hang off one scroll container, so they live together
// rather than as three listeners scattered through a 3,000-line component:
//
//   1. THE INDEX FOLLOWS THE READER. The current tab is whichever sheet is in view, not
//      whichever tab was last clicked. An IntersectionObserver rooted on the scroller
//      with a tall bottom margin means "the sheet nearest the top of the window", which
//      is what a reader would say is the one they are reading.
//   2. THE PLATE LIFTS. Once paper has travelled under the name plate, the plate casts a
//      shadow. At rest it is flat, so the chart is not permanently shadowed for no
//      reason.
//   3. A NEW STUDENT STARTS AT THE TOP. Switching records resets the scroll and the
//      index. Leaving the reader halfway down a different student's record is how you
//      read the wrong person's notes.
//
// Clicking a tab SCROLLS; it never swaps a panel. Every sheet is mounted all the time,
// so a half-typed field three sheets up survives a trip to the index and back.
//
// The record change is handled by adjusting state DURING RENDER against a remembered
// key, which is React's own answer for "reset state when a prop changes". Doing it in an
// effect would render the new student's record at the old scroll position first and then
// correct itself, which is a visible flash of the wrong thing.

import { useCallback, useEffect, useRef, useState } from 'react'
import { CHART_SHEETS, FIRST_SHEET, sheetDomId } from './chartSheets'

// "In view" means the sheet crossing the upper eighth of the scroller. The bottom margin
// is deliberately huge: without it every sheet below the fold counts as visible and the
// last one wins, so the index would sit on Notes the whole way down.
const SPY_MARGIN = '-12% 0px -72% 0px'
const LIFT_AT = 2   // px of travel before the plate is considered to be over paper

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

export function useChartScroll(studentId) {
  const scrollerRef = useRef(null)
  const [activeSheet, setActiveSheet] = useState(FIRST_SHEET)
  const [lifted, setLifted] = useState(false)
  const [shownStudent, setShownStudent] = useState(studentId)

  // A different student is a different record: first sheet, flat plate, every time.
  if (shownStudent !== studentId) {
    setShownStudent(studentId)
    setActiveSheet(FIRST_SHEET)
    setLifted(false)
  }

  // Clicking a tab: scroll, do not mount. `activeSheet` is set straight away so the tab
  // responds to the click even before the smooth scroll has carried the sheet into view.
  const goToSheet = useCallback((id) => {
    setActiveSheet(id)
    const root = scrollerRef.current
    const el = root?.querySelector(`#${sheetDomId(id)}`)
    if (!root || !el) return
    root.scrollTo({ top: el.offsetTop, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [])

  // The DOM half of the reset. This is an effect because it drives an external system
  // (the scroll container), which is what effects are for.
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
  }, [studentId])

  useEffect(() => {
    const root = scrollerRef.current
    if (!root) return

    const onScroll = () => setLifted(root.scrollTop > LIFT_AT)
    root.addEventListener('scroll', onScroll, { passive: true })

    let observer = null
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        const top = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top?.target?.dataset?.sheet) setActiveSheet(top.target.dataset.sheet)
      }, { root, rootMargin: SPY_MARGIN, threshold: 0 })
      for (const s of CHART_SHEETS) {
        const el = root.querySelector(`#${sheetDomId(s.id)}`)
        if (el) observer.observe(el)
      }
    }

    return () => {
      root.removeEventListener('scroll', onScroll)
      observer?.disconnect()
    }
  }, [studentId])

  return { scrollerRef, activeSheet, goToSheet, lifted }
}

// The cross-fade when the reader turns to a different student.
//
// Only what is WRITTEN on the binder fades: the plate's identity block and the sheets.
// The plate band, the index rail and the binder itself hold still, because a new student
// is not a new object arriving, it is a different record in the same one. Moving the
// binder would say the wrong thing.
//
// Under prefers-reduced-motion the swap is instant: no fade, no delay, no flicker.
const FADE_MS = 160

export function useCrossFade(key) {
  const [fading, setFading] = useState(false)
  const [shownKey, setShownKey] = useState(key)

  if (shownKey !== key) {
    setShownKey(key)
    setFading(!prefersReducedMotion())
  }

  useEffect(() => {
    if (!fading) return undefined
    const t = setTimeout(() => setFading(false), FADE_MS)
    return () => clearTimeout(t)
  }, [fading])

  return fading
}
