// src/components/shared/useReactionTrigger.js
//
// MESSAGES-SIMPLIFY-1: how a bubble opens its reaction bar. A long press
// (450 ms, mouse, pen or finger, through pointer events), a right-click, or
// Enter or Space on the focused bubble. Moving more than 8 px or releasing
// early cancels the press, so text selection and scrolling keep working.
// The bar and the badge are in MessageReactions.jsx.

import { useCallback, useEffect, useRef, useState } from 'react'

export const LONG_PRESS_MS = 450
export const LONG_PRESS_SLOP_PX = 8

// Long press, right-click and keyboard for one bubble. Returns the props the
// bubble spreads and whether its bar is open.
export function useReactionTrigger({ enabled }) {
  const [open, setOpen] = useState(false)
  // True while the long press that opened the bar is still held, so the bar
  // can follow a slide across the emoji (MESSAGES-REFINE-2).
  const [pressActive, setPressActive] = useState(false)
  const [pressing, setPressing] = useState(false)
  const bubbleRef = useRef(null)
  const timerRef = useRef(null)
  const startRef = useRef(null)

  const cancelPress = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = null
    startRef.current = null
    setPressing(false)
  }, [])
  useEffect(() => cancelPress, [cancelPress])

  const close = useCallback((returnFocus = true) => {
    setOpen(false)
    setPressActive(false)
    if (returnFocus) bubbleRef.current?.focus()
  }, [])

  if (!enabled) return { open: false, close, bubbleRef, pressing: false, pressActive: false, triggerProps: {} }

  const triggerProps = {
    tabIndex: 0,
    'aria-haspopup': 'true',
    'aria-expanded': open,
    onPointerDown: (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      startRef.current = { x: e.clientX, y: e.clientY }
      setPressing(true)
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        startRef.current = null
        setPressing(false)
        // A completed press would otherwise leave a word selected under it.
        window.getSelection?.()?.removeAllRanges?.()
        setPressActive(true)
        setOpen(true)
      }, LONG_PRESS_MS)
    },
    onPointerMove: (e) => {
      const start = startRef.current
      if (!start) return
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_SLOP_PX) cancelPress()
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    onPointerLeave: cancelPress,
    onContextMenu: (e) => {
      e.preventDefault()
      cancelPress()
      setPressActive(false)
      setOpen(true)
    },
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setPressActive(false)
        setOpen(true)
      }
    },
  }
  return { open, close, bubbleRef, pressing, pressActive, triggerProps }
}

