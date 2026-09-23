// src/components/catalog/useModalFocus.js
//
// CATALOG-REVAMP-1: every Catalog modal traps focus and closes on Escape (spec section 8).
// On open, focus moves to the first field the caller marks with data-autofocus, else the
// first focusable control; Tab and Shift+Tab wrap inside the dialog; on close, focus goes
// back to whatever opened it.
import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function useModalFocus(onClose, { disabled = false } = {}) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  const disabledRef = useRef(disabled)
  useEffect(() => { closeRef.current = onClose; disabledRef.current = disabled }, [onClose, disabled])

  useEffect(() => {
    const opener = document.activeElement
    const node = ref.current
    const first = node?.querySelector('[data-autofocus]') || node?.querySelector(FOCUSABLE)
    first?.focus()
    const onKey = (e) => {
      if (!ref.current) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (!disabledRef.current) closeRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      const items = [...ref.current.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null)
      if (!items.length) return
      const firstEl = items[0], lastEl = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus() }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
    }
  }, [])

  return ref
}
