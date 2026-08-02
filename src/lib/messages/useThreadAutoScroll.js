// MESSAGES-AUTOSCROLL-1: ONE shared bottom-anchor scroll manager for every
// message-thread host (staff ThreadPanel, PortalMessagesThread, and therefore
// the docked PortalTeamMessagesPanel which reuses it).
//
// Contract:
//   - Opening or switching a thread anchors the HISTORY CONTAINER to the
//     newest message once messages finish rendering (instant positioning, so
//     there is never a visible jump from the oldest message).
//   - Scrolling happens ONLY via the container's own scrollTop - never an
//     element-into-view call, never the document - so the page position is
//     untouched and the composer below the container stays exactly where it was.
//   - While the reader stays near the bottom (< NEAR_BOTTOM_PX), a newer
//     newestKey (an incoming message, or the reader's own send landing in the
//     thread query) re-pins to the bottom. If the reader intentionally
//     scrolled upward, nothing moves; a restrained "New messages" affordance
//     is offered instead (showNewIndicator + jumpToLatest).
//   - Variable-height content (attachments, images, link previews) settles
//     after first paint, so the anchor re-pins on a short settle schedule as
//     long as the reader is still at the bottom.
//   - prefers-reduced-motion suppresses smooth scrolling (instant jumps only).
//
// The pure helpers are exported for node tests; the hook owns only refs and
// one small piece of indicator state.

import { useCallback, useEffect, useRef, useState } from 'react'

export const NEAR_BOTTOM_PX = 80

// Re-pin passes after an anchor, in ms: paint, layout settle, late images.
export const SETTLE_PASSES_MS = [0, 120, 400]

// True when the container is scrolled to (or near) its bottom edge.
export function isNearBottom(el, threshold = NEAR_BOTTOM_PX) {
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold
}

function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  } catch { return false }
}

export function useThreadAutoScroll({ threadId, ready, newestKey }) {
  const scrollRef = useRef(null)
  const nearBottomRef = useRef(true)
  const lastNewestRef = useRef(null)
  const anchoredThreadRef = useRef(null)
  const timersRef = useRef([])
  const [showNewIndicator, setShowNewIndicator] = useState(false)

  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = [] }

  // Container-only scrolling. 'smooth' downgrades to instant under reduced motion.
  const pinToBottom = useCallback((behavior = 'auto') => {
    const el = scrollRef.current
    if (!el) return
    if (behavior === 'smooth' && !prefersReducedMotion() && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else {
      el.scrollTop = el.scrollHeight
    }
  }, [])

  // Anchor instantly, then re-pin on the settle schedule while the reader has
  // not scrolled away (late-loading images grow the content under us).
  const anchor = useCallback(() => {
    nearBottomRef.current = true
    setShowNewIndicator(false)
    clearTimers()
    for (const delay of SETTLE_PASSES_MS) {
      timersRef.current.push(setTimeout(() => {
        if (nearBottomRef.current) pinToBottom('auto')
      }, delay))
    }
  }, [pinToBottom])

  // Opening or switching a thread: anchor as soon as messages are rendered.
  // The cleanup UN-anchors as well as clearing timers: under StrictMode's
  // double-invoked effects (and any future remount with warm cache, where
  // `ready` is true from the very first render) the cleanup cancels the settle
  // timers before they fire, so the re-run must be allowed to anchor again.
  useEffect(() => {
    if (!ready || !threadId) return
    if (anchoredThreadRef.current === threadId) return
    anchoredThreadRef.current = threadId
    lastNewestRef.current = newestKey ?? null
    anchor()
    return () => { clearTimers(); anchoredThreadRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, ready])

  // A NEW newest message after the initial anchor: follow it while near the
  // bottom; otherwise leave the reader alone and show the affordance.
  useEffect(() => {
    if (!ready || anchoredThreadRef.current !== threadId) return
    const key = newestKey ?? null
    if (key === lastNewestRef.current) return
    lastNewestRef.current = key
    if (nearBottomRef.current) pinToBottom('smooth')
    else setShowNewIndicator(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestKey, ready, threadId])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    nearBottomRef.current = isNearBottom(el)
    if (nearBottomRef.current) setShowNewIndicator(false)
  }, [])

  const jumpToLatest = useCallback(() => {
    nearBottomRef.current = true
    setShowNewIndicator(false)
    pinToBottom('smooth')
  }, [pinToBottom])

  return { scrollRef, onScroll, showNewIndicator, jumpToLatest }
}
