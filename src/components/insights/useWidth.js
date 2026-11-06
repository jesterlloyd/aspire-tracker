// ASPIRE-INSIGHTS-1: a chart's drawing box, followed as its card resizes.
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

const read = (node, fallback) => {
  const r = node.getBoundingClientRect()
  return { w: Math.max(200, Math.floor(r.width)) || fallback, h: Math.max(0, Math.floor(r.height)) }
}

/**
 * The width and height of an element, followed as it resizes. The ref is a callback, so an
 * element that mounts after the first render (a card that was loading) is still measured. It is
 * also measured after every render, because a backgrounded pane delivers no ResizeObserver
 * reports and a card's height follows the tallest card in its row.
 */
export function useBox(fallback = 600) {
  const [el, setEl] = useState(null)
  const [box, setBox] = useState({ w: fallback, h: 0 })
  const update = useCallback(next => setBox(b => (b.w === next.w && b.h === next.h ? b : next)), [])
  const ref = useCallback(node => {
    setEl(node)
    if (node) update(read(node, fallback))
  }, [fallback, update])
  // Guarded: it sets state only when the box really changed, so it settles after one pass.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useLayoutEffect(() => { if (el) update(read(el, fallback)) })
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => update(read(el, fallback)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, fallback, update])
  return [ref, box]
}

/** The width alone. */
export function useWidth(fallback = 600) {
  const [ref, box] = useBox(fallback)
  return [ref, box.w]
}
