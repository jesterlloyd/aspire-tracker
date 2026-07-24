import { useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'

const MENU_WIDTH = 224
const GAP = 6
const EDGE = 8

export default function RowActionsMenu({ label, open, onToggle, onClose, items = [] }) {
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  const close = useCallback(() => {
    onClose?.()
    btnRef.current?.focus()
  }, [onClose])

  const placeMenu = useCallback((node) => {
    menuRef.current = node
    if (!node || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const left = Math.max(EDGE, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - EDGE))
    const height = node.offsetHeight || 48
    let top = r.bottom + GAP
    if (top + height > window.innerHeight - EDGE && r.top - GAP - height > EDGE) {
      top = r.top - GAP - height
    }
    node.style.left = `${Math.round(left)}px`
    node.style.top = `${Math.round(top)}px`
    node.style.width = `${MENU_WIDTH}px`
    node.querySelector('[role="menuitem"]:not([disabled])')?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); return }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const nodes = [...(menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])]
        if (nodes.length === 0) return
        const index = nodes.indexOf(document.activeElement)
        const next = event.key === 'ArrowDown'
          ? (index + 1) % nodes.length
          : (index - 1 + nodes.length) % nodes.length
        nodes[next]?.focus()
      }
    }
    const onPointerDown = (event) => {
      if (menuRef.current?.contains(event.target) || btnRef.current?.contains(event.target)) return
      close()
    }
    const onScrollResize = (event) => {
      if (event?.target && menuRef.current?.contains(event.target)) return
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
    <div className="shared-row-actions">
      <button
        ref={btnRef}
        type="button"
        className="shared-row-actions-btn"
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
          className="shared-row-actions-menu"
          role="menu"
          aria-label={label}
          style={{ position: 'fixed' }}
        >
          {items.map(item => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={`shared-row-actions-item ${item.danger ? 'shared-row-actions-item-danger' : ''}`}
              disabled={item.disabled}
              onClick={() => { item.onSelect?.(btnRef.current); close() }}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
