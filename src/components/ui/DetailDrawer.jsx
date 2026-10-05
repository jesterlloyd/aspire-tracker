// KT-3a-2a / UI: governance detail drawer - a right-side panel + backdrop in the
// Settings/KC governance language: white surface, plain header (title + close),
// scrollable body, optional sticky footer. No gradient hero (heroes are reserved
// for people records). Reusable for KT-3a-2b / KT-3b. z-index matches the existing
// governance drawers (UserManagement/Interviewers: 1999 panel / 1998 backdrop).
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// SUPPORT-STANDALONE-1: `trapFocus` (opt-in, so no existing drawer changes) makes the
// drawer a real modal for the keyboard: focus moves in on open, Tab cycles inside it,
// Escape closes it, and focus returns to whatever opened it.
function useModalFocus(enabled, ref, onClose) {
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    if (!enabled) return undefined
    const opener = document.activeElement
    const el = ref.current
    const items = () => [...(el?.querySelectorAll(FOCUSABLE) || [])].filter(n => n.offsetParent !== null || n === document.activeElement)
    const body = el?.querySelector('[data-drawer-body]')
    const first = (body && [...body.querySelectorAll(FOCUSABLE)][0]) || items()[0]
    first?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current?.(); return }
      if (e.key !== 'Tab') return
      const list = items()
      if (list.length === 0) return
      const head = list[0]
      const tail = list[list.length - 1]
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus() }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus() }
    }
    el?.addEventListener('keydown', onKey)
    return () => {
      el?.removeEventListener('keydown', onKey)
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
    }
  }, [enabled, ref])
}

export default function DetailDrawer({ open, title, onClose, footer, width = 580, trapFocus = false, children }) {
  const ref = useRef(null)
  useModalFocus(open && trapFocus, ref, onClose)
  if (!open) return null
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'var(--color-bg-overlay, rgba(15,20,25,0.40))', zIndex: 1998 }}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Detail'}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: '100%', maxWidth: width, zIndex: 1999,
          background: 'var(--color-bg-surface, #ffffff)',
          boxShadow: '-8px 0 24px rgba(16,24,40,0.12)',
          display: 'flex', flexDirection: 'column', fontFamily: 'Plus Jakarta Sans, sans-serif',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '16px 20px', borderBottom: '1px solid var(--color-border-subtle, #f3f4f6)', flexShrink: 0,
        }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary, #191919)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--color-text-secondary, #6b7280)', display: 'flex', flexShrink: 0 }}
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div data-drawer-body style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', minHeight: 0 }}>
          {children}
        </div>

        {footer && (
          <div style={{
            padding: '12px 20px', borderTop: '1px solid var(--color-border-subtle, #f3f4f6)', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
          }}>
            {footer}
          </div>
        )}
      </div>
    </>
  )
}
