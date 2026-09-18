// RUBRIC-BOOK-1: one layout at every width (Owner, 2026-09-17).
//
// The rubric book is laid out at its natural size and scaled with a transform, so the
// spread keeps its proportions instead of reflowing into a second design. This hook
// measures the stage and reports the scale, and it flips to a single page when the
// spread can no longer be read.
//
// THE FLOOR, and why there are two of them. Body text on the page is 14px, so a scale
// of 0.72 renders it at 10px: that is where the SPREAD stops being worth showing, and
// the book turns to one page. One page then keeps its design but takes the width it
// is given (between MIN_PAGE and the full 810), so the scale stays near LEGIBLE_SCALE
// and the type lands at roughly 12px even on a phone. Nothing ever scrolls sideways,
// and nothing is ever laid out twice.
//
// The book's HEIGHT is derived, not fixed: the stage's height divided by the scale, so
// the scaled book lands exactly on the bottom of the stage and each page scrolls inside
// it. A very short window gets MIN_BOOK_H and the stage scrolls instead.

import { useEffect, useRef, useState } from 'react'

export const PAGE_WIDTH = 810     // the rubric page, at its natural size
export const LEFT_WIDTH = 600     // the candidate page
export const RAIL_WIDTH = 58      // the index down the fore edge
export const COVER_PAD = 26       // leather showing on each side
export const CHROME = RAIL_WIDTH + (2 * COVER_PAD)
export const SPREAD_WIDTH = LEFT_WIDTH + PAGE_WIDTH + CHROME   // 1520
export const SINGLE_WIDTH = PAGE_WIDTH + CHROME                // 920
export const SPREAD_FLOOR = 0.72  // below this the spread is not worth showing
export const LEGIBLE_SCALE = 0.86 // 14px * 0.86 is 12px, the floor the Owner named
export const MIN_PAGE = 340       // a page narrower than this is not a page
export const MIN_BOOK_H = 640

/** The scale, mode, page width and book height for a stage size. Pure, so tests read it. */
export function bookMetrics(width, height) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  const spread = w / SPREAD_WIDTH

  if (spread >= SPREAD_FLOOR) {
    // The height is derived from the SAME rounded scale the transform uses, so the
    // book lands on the bottom of the stage rather than a pixel past it.
    const scale = round(Math.min(1, spread))
    return {
      mode: 'spread',
      scale,
      pageWidth: PAGE_WIDTH,
      bookHeight: Math.max(MIN_BOOK_H, Math.round((h || MIN_BOOK_H) / scale)),
    }
  }

  // One page, sized so the type lands at a readable size rather than shrinking on.
  const pageWidth = Math.round(Math.min(PAGE_WIDTH, Math.max(MIN_PAGE, (w / LEGIBLE_SCALE) - CHROME)))
  const scale = round(Math.min(1, Math.max(0.35, w / (pageWidth + CHROME))))
  return {
    mode: 'single',
    scale,
    pageWidth,
    bookHeight: Math.max(MIN_BOOK_H, Math.round((h || MIN_BOOK_H) / scale)),
  }
}

const round = n => Math.round(n * 1000) / 1000

export function useBookScale() {
  const stageRef = useRef(null)
  const [metrics, setMetrics] = useState({ mode: 'spread', scale: 1, pageWidth: PAGE_WIDTH, bookHeight: MIN_BOOK_H })

  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      const next = bookMetrics(rect.width, rect.height)
      setMetrics(prev => (
        prev.mode === next.mode && prev.scale === next.scale
        && prev.bookHeight === next.bookHeight && prev.pageWidth === next.pageWidth
          ? prev
          : next
      ))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { stageRef, ...metrics }
}
