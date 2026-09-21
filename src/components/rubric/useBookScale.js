// RUBRIC-BOOK-1: how the book takes the screen it is given.
//
// THE RULE (Owner, 2026-09-17, revised after seeing it run): the book fills the real
// estate it has, and resizing changes the PAGES, not the book. The cover is the same
// thickness at every width, the index down the fore edge keeps its width, and the two
// pages share whatever is left in the proportion they were designed in. Nothing is
// transform-scaled any more, so type stays at its own size: a narrow window means a
// narrower page, never smaller print. (The first build scaled the whole spread, which
// shrank the cover along with it.)
//
// The one thing that does change is HOW MANY pages are open. Below SPREAD_MIN the two
// pages would each be too narrow to write in, so the book shows one at a time: the
// rubric by default, the candidate a tap away.
//
// This module measures; the stylesheet lays out. It reports the mode and the height the
// shell may claim, and nothing else.

import { useEffect, useRef, useState } from 'react'

export const RAIL_WIDTH = 58      // the index down the fore edge, constant
// The shared cover's boards (BOOK-COVER-1): --aspire-book-board, --aspire-book-board-x
// and --aspire-book-stack-w in aspireBrand.css. Only the mode is used at runtime; these
// keep the arithmetic in bookMetrics true to what the stylesheet draws.
export const COVER_PAD = 15       // leather above and below the pages, constant
export const COVER_BOARD_X = 16   // leather outside the page stack at each side
export const PAGE_STACK = 13      // the fore edge's block of pages at each side
export const COVER_PAD_X = COVER_BOARD_X + PAGE_STACK   // 29
export const CHROME = RAIL_WIDTH + (2 * COVER_PAD_X)
export const LEFT_SHARE = 42.5    // the candidate page's share of the paper
export const RIGHT_SHARE = 57.5   // the rubric page's share
export const SPREAD_MIN = 1000    // narrower than this, one page at a time
export const MIN_BOOK_H = 560
export const BOTTOM_GAP = 16      // the book's bottom edge is never flush with the window

/** What the book does at a given stage size. Pure, so tests can read it. */
export function bookMetrics(width, height) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  const mode = w >= SPREAD_MIN ? 'spread' : 'single'
  // What the paper actually gets, once the cover and the index have taken theirs.
  const paper = Math.max(0, w - CHROME)
  const pages = mode === 'spread'
    ? {
        left: Math.round(paper * (LEFT_SHARE / (LEFT_SHARE + RIGHT_SHARE))),
        right: Math.round(paper * (RIGHT_SHARE / (LEFT_SHARE + RIGHT_SHARE))),
      }
    : { left: 0, right: Math.round(paper) }
  return { mode, pages, bookHeight: Math.max(MIN_BOOK_H, Math.round(h || MIN_BOOK_H)) }
}

export function useBookScale() {
  const shellRef = useRef(null)
  const stageRef = useRef(null)
  const [shellHeight, setShellHeight] = useState(null)
  const [mode, setMode] = useState('spread')

  // The whole book has to be visible, bottom cover included (Owner, 2026-09-17), and
  // the chrome above it is not a fixed number: the app header, the section nav and a
  // browser's own bars all differ. So the shell takes exactly what is left below its
  // own top edge rather than guessing with calc(100vh - 164px).
  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    const measure = () => {
      const top = el.getBoundingClientRect().top
      const available = Math.round(window.innerHeight - top - BOTTOM_GAP)
      setShellHeight(prev => (prev === available ? prev : Math.max(MIN_BOOK_H, available)))
    }
    measure()
    window.addEventListener('resize', measure)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(document.documentElement)
    return () => { window.removeEventListener('resize', measure); ro?.disconnect() }
  }, [])

  // How many pages are open follows the width of the STAGE, not the window: the book
  // sits inside whatever column the app gives it.
  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const next = bookMetrics(el.getBoundingClientRect().width).mode
      setMode(prev => (prev === next ? prev : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { shellRef, stageRef, shellHeight, mode }
}
