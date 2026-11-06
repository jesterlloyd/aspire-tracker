// ASPIRE-INSIGHTS-1: a chart's drawing width, followed as its card resizes.
import { useCallback, useEffect, useState } from 'react'

/**
 * The width of an element, followed as it resizes. The ref is a callback, so an element that
 * mounts after the first render (a card that was loading) is still measured.
 */
export function useWidth(fallback = 600) {
  const [el, setEl] = useState(null)
  const [w, setW] = useState(fallback)
  // Measured once on mount too, so the first drawing is the right size before any resize report.
  const ref = useCallback(node => {
    setEl(node)
    if (node) setW(Math.max(200, Math.floor(node.getBoundingClientRect().width)) || fallback)
  }, [fallback])
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [ref, w]
}
