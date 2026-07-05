// src/components/ui/Tooltip.jsx
//
// Reusable Nightfall/navy tooltip following the house style established by
// Keith.jsx and StatusLegendPopover.jsx. Uses position:fixed so it escapes
// overflow:hidden parents without a portal.
//
// Usage:
//   <Tooltip label="Action Center">
//     <button ...>...</button>
//   </Tooltip>
//
// Props:
//   label        string   - tooltip text (required)
//   placement    'top' | 'bottom' | 'left' | 'right'  - default 'bottom'
//   delay        number   - ms before tooltip appears   - default 300
//   hideDelay    number   - ms before tooltip hides     - default 100
//   applyAriaLabel boolean - inject aria-label on DOM children missing it - default true
//   disabled     boolean  - suppress tooltip entirely   - default false
//   children     React element (required)

import { useState, useRef, useCallback, cloneElement, useEffect, Children } from 'react'

// Detect reduced-motion preference once at module load.
const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Merge two event handler functions - calls both if both exist.
function mergeHandler(existing, next) {
  if (!existing) return next
  return (e) => { existing(e); next(e) }
}

export default function Tooltip({
  label,
  placement  = 'bottom',
  delay      = 300,
  hideDelay  = 100,
  applyAriaLabel = true,
  disabled   = false,
  children,
}) {
  const [visible, setVisible] = useState(false)
  const [pos,     setPos]     = useState({ top: 0, left: 0 })
  const showTimer = useRef(null)
  const hideTimer = useRef(null)

  // Compute fixed position from the trigger's bounding rect + desired placement.
  // Flips to the opposite side if the tooltip would overflow the viewport.
  const computePos = useCallback((rect) => {
    const GAP  = 7
    // Rough tooltip dimensions for off-screen detection
    const TW   = Math.min(label.length * 7.5 + 24, 360)
    const TH   = 30

    let top, left

    if (placement === 'top' || placement === 'bottom') {
      left = rect.left + rect.width / 2 - TW / 2
    } else {
      top = rect.top + rect.height / 2 - TH / 2
    }

    if (placement === 'bottom') {
      top = rect.bottom + GAP
      // Flip to top if no room below
      if (top + TH > window.innerHeight - 8) top = rect.top - TH - GAP
    } else if (placement === 'top') {
      top = rect.top - TH - GAP
      // Flip to bottom if no room above
      if (top < 8) top = rect.bottom + GAP
    } else if (placement === 'right') {
      left = rect.right + GAP
      if (left + TW > window.innerWidth - 8) left = rect.left - TW - GAP
    } else { // left
      left = rect.left - TW - GAP
      if (left < 8) left = rect.right + GAP
    }

    // Horizontal clamp for top/bottom placements
    if (placement === 'top' || placement === 'bottom') {
      if (left < 8) left = 8
      if (left + TW > window.innerWidth - 8) left = window.innerWidth - TW - 8
    }
    // Vertical clamp for left/right placements
    if (placement === 'left' || placement === 'right') {
      if (top < 8) top = 8
      if (top + TH > window.innerHeight - 8) top = window.innerHeight - TH - 8
    }

    return { top, left }
  }, [label, placement])

  const show = useCallback((e) => {
    if (disabled) return
    clearTimeout(hideTimer.current)
    const rect = e.currentTarget.getBoundingClientRect()
    if (delay === 0) {
      setPos(computePos(rect))
      setVisible(true)
    } else {
      showTimer.current = setTimeout(() => {
        setPos(computePos(rect))
        setVisible(true)
      }, REDUCED_MOTION ? 0 : delay)
    }
  }, [disabled, delay, computePos])

  const hide = useCallback(() => {
    clearTimeout(showTimer.current)
    hideTimer.current = setTimeout(() => setVisible(false), hideDelay)
  }, [hideDelay])

  const hideImmediate = useCallback(() => {
    clearTimeout(showTimer.current)
    clearTimeout(hideTimer.current)
    setVisible(false)
  }, [])

  // Dismiss on Escape
  useEffect(() => {
    if (!visible) return
    const handler = (e) => { if (e.key === 'Escape') hideImmediate() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [visible, hideImmediate])

  // Clean up timers on unmount
  useEffect(() => () => {
    clearTimeout(showTimer.current)
    clearTimeout(hideTimer.current)
  }, [])

  const tooltipEl = visible && !disabled ? (
    <div
      role="tooltip"
      aria-hidden="true"
      style={{
        position:   'fixed',
        top:        pos.top,
        left:       pos.left,
        background: '#1D2567',
        color:      '#ffffff',
        fontFamily: 'DM Sans, sans-serif',
        fontSize:   '12px',
        fontWeight: 500,
        padding:    '6px 12px',
        borderRadius: '8px',
        whiteSpace: 'nowrap',
        zIndex:     9999,
        pointerEvents: 'none',
        boxShadow:  '0 2px 8px rgba(29,37,103,0.25)',
      }}
    >
      {label}
    </div>
  ) : null

  const child = Children.only(children)
  const isDomEl = typeof child.type === 'string'

  if (isDomEl) {
    // For native DOM elements: inject handlers via cloneElement
    const extraProps = {
      onMouseEnter: mergeHandler(child.props.onMouseEnter, show),
      onMouseLeave: mergeHandler(child.props.onMouseLeave, hide),
      onFocus:      mergeHandler(child.props.onFocus,      show),
      onBlur:       mergeHandler(child.props.onBlur,       hide),
    }
    if (applyAriaLabel && !child.props['aria-label']) {
      extraProps['aria-label'] = label
    }
    return (
      <>
        {cloneElement(child, extraProps)}
        {tooltipEl}
      </>
    )
  }

  // For React component children: use a display:contents span to capture
  // hover/focus events without affecting the layout.
  return (
    <span
      style={{ display: 'contents' }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {child}
      {tooltipEl}
    </span>
  )
}
