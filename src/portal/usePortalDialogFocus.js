import { useEffect } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function focusableWithin(root) {
  if (!root) return []
  return Array.from(root.querySelectorAll(FOCUSABLE))
    .filter(el => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true')
}

export default function usePortalDialogFocus({ open, dialogRef, returnFocusRef, onEscape, disabled = false }) {
  useEffect(() => {
    if (!open || disabled) return undefined
    const previous = returnFocusRef?.current || document.activeElement
    const node = dialogRef.current
    const t = setTimeout(() => {
      const first = focusableWithin(node)[0] || node
      first?.focus?.()
    }, 20)
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onEscape?.()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = focusableWithin(node)
      if (focusable.length === 0) {
        event.preventDefault()
        node?.focus?.()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [dialogRef, disabled, onEscape, open, returnFocusRef])
}
