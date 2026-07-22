// src/portal/unit/StudentActionsMenu.jsx
//
// UL-PORTAL: the student row's overflow ("kebab") action menu.
//
// WHY A PORTAL. The menu used to render as a position:absolute child of its <td>,
// which lives inside .ptl-stu-tablewrap { overflow-x: auto }. A container whose
// overflow is non-visible on either axis establishes a clipping box on BOTH axes, so
// the downward-dropping menu was cut off by the table wrapper. Rendering the menu into
// document.body with position:fixed takes it out of that clip entirely; nothing between
// the row and the viewport can crop it, and no arbitrary z-index arms race is needed.
//
// POSITION IS SET IMPERATIVELY, ONCE, IN THE REF CALLBACK. The menu is anchored under
// its button and clamped to the viewport (flipping above when there is no room below).
// This deliberately avoids setState-in-an-effect (which this repo's lint forbids and
// which caused a real bug before): the menu unmounts when closed and remounts fresh on
// every open, so the ref callback re-measures each time and there is no stale style to
// re-assert. The button owns no inline top/left, so React never fights the measurement.
//
// CLOSE BEHAVIOR: Escape, an outside pointer press, and any external scroll or resize
// all close the menu and RETURN FOCUS to the button. Arrow keys move between items, and
// the first item is focused on open. One-open-at-a-time is enforced by the parent, which
// stores a single open row id.

import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'

const MENU_WIDTH = 208
const GAP = 6
const EDGE = 8

export default function StudentActionsMenu({ label, open, onToggle, onClose, items }) {
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  // Close and hand focus back to the trigger, so keyboard users are never stranded.
  const close = useCallback(() => {
    onClose()
    btnRef.current?.focus()
  }, [onClose])

  // Measure the button and place the menu, clamped to the viewport, the instant the menu
  // mounts. Imperative on purpose (see file header): no state, no effect, no re-render.
  const placeMenu = useCallback((node) => {
    menuRef.current = node
    if (!node || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const left = Math.max(EDGE, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - EDGE))
    const height = node.offsetHeight || 48
    // Prefer below the button; flip above only when below overflows and above fits.
    let top = r.bottom + GAP
    if (top + height > window.innerHeight - EDGE && r.top - GAP - height > EDGE) {
      top = r.top - GAP - height
    }
    node.style.left = `${Math.round(left)}px`
    node.style.top = `${Math.round(top)}px`
    node.style.width = `${MENU_WIDTH}px`
    // Focus the first enabled item so the menu is immediately keyboard-operable.
    node.querySelector('[role="menuitem"]:not([disabled])')?.focus()
  }, [])

  // Escape / outside-press / external scroll / resize close the menu; arrows navigate.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); return }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const nodes = [...(menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])]
        if (nodes.length === 0) return
        const i = nodes.indexOf(document.activeElement)
        const next = e.key === 'ArrowDown'
          ? (i + 1) % nodes.length
          : (i - 1 + nodes.length) % nodes.length
        nodes[next]?.focus()
      }
    }
    const onPointerDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      close()
    }
    // A fixed menu does not follow the page; rather than drift, it closes on any scroll
    // outside itself (the capture listener sees scrolls on any ancestor).
    const onScrollResize = (e) => {
      if (e?.target && menuRef.current?.contains(e.target)) return
      close()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('scroll', onScrollResize, true)
    window.addEventListener('resize', onScrollResize)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('scroll', onScrollResize, true)
      window.removeEventListener('resize', onScrollResize)
    }
  }, [open, close])

  return (
    <div className="ptl-stu-kebab">
      <button
        ref={btnRef}
        type="button"
        className="ptl-icon-btn ptl-stu-kebab-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={onToggle}
      >
        <MoreVertical size={18} aria-hidden="true" />
      </button>
      {open && createPortal(
        <div
          ref={placeMenu}
          className="ptl-stu-menu"
          role="menu"
          aria-label={label}
          style={{ position: 'fixed' }}
        >
          {items.map(it => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className="ptl-stu-menuitem"
              disabled={it.disabled}
              onClick={() => { it.onSelect(); close() }}
            >
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
