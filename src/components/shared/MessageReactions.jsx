// src/components/shared/MessageReactions.jsx
//
// MESSAGES-LIFECYCLE-PHASE3A-REACTIONS: the chips row plus "Add reaction"
// popover rendered at the bottom of a message bubble (staff and portal share
// this one component, the same way both surfaces already share MessageBubble).
//
// Reactions are quiet acknowledgements: this component never implies a
// notification, an unread change, or an archive change. It only ever calls
// onSetReaction(messageId, keyOrNull); everything else is the caller's
// responsibility.
//
// Interaction model is deliberately the same shape as RowActionsMenu.jsx (read
// first for this): a trigger button opens a document-body portal menu that
// closes on Escape, closes on an outside click, returns focus to the trigger on
// close, and supports Up/Down arrow navigation between options. It is a
// separate implementation (not a reuse of RowActionsMenu itself) because the
// trigger, the chip row, and the "current reaction" marking are all specific to
// reactions and use their own msg-reaction- classes rather than
// RowActionsMenu's shared-row-actions- classes.
//
// No long-press, no double-tap, no hover-only affordance: every action here is
// a real <button> reachable by click, Enter/Space, and Tab/arrow-key focus.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SmilePlus } from 'lucide-react'
import { MESSAGE_REACTIONS, reactionByKey } from '../../lib/messages/reactionConstants'

const MENU_WIDTH = 200
const GAP = 6
const EDGE = 8

export default function MessageReactions({ message, onSetReaction, disabled = false }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  const rawReactions = Array.isArray(message?.reactions) ? message.reactions : []
  // Defensive: never render a key outside the server-enforced allowlist, and
  // never render a chip with a non-positive count.
  const chips = rawReactions.filter((r) => r && reactionByKey(r.key) && r.count > 0)
  const mineKey = rawReactions.find((r) => r?.mine)?.key || null

  const close = useCallback(() => {
    setOpen(false)
    btnRef.current?.focus()
  }, [])

  const toggleMenu = useCallback(() => {
    if (disabled) return
    setOpen((o) => !o)
  }, [disabled])

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
    node.querySelector('[role="menuitemradio"]')?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); return }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const nodes = [...(menuRef.current?.querySelectorAll('[role="menuitemradio"]') || [])]
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

  // A key equal to the caller's current reaction always REMOVES it (sends
  // null); any other key always REPLACES it. This is the one rule both the
  // chip row and the popover follow, so neither can send a redundant
  // "re-select the same key" request.
  const pick = (key) => {
    const next = key === mineKey ? null : key
    onSetReaction?.(message?.id, next)
  }

  const onChipClick = (key) => {
    if (disabled) return
    pick(key)
  }

  const onOptionSelect = (key) => {
    pick(key)
    close()
  }

  return (
    <div className="msg-reaction-row">
      {chips.map((r) => {
        const def = reactionByKey(r.key)
        if (!def) return null
        const mine = !!r.mine
        const accessibleName = `${def.label}, ${r.count} reaction${r.count === 1 ? '' : 's'}${mine ? ', including yours' : ''}`
        return (
          <button
            key={r.key}
            type="button"
            className={`msg-reaction-chip${mine ? ' msg-reaction-chip-mine' : ''}`}
            aria-pressed={mine}
            aria-label={accessibleName}
            disabled={disabled}
            onClick={() => onChipClick(r.key)}
          >
            <span aria-hidden="true">{def.glyph}</span>
            <span aria-hidden="true" className="msg-reaction-count">{r.count}</span>
          </button>
        )
      })}

      <button
        ref={btnRef}
        type="button"
        className="msg-reaction-add"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add reaction"
        disabled={disabled}
        onClick={toggleMenu}
      >
        <SmilePlus size={14} aria-hidden="true" />
      </button>

      {open && createPortal(
        <div
          ref={placeMenu}
          className="msg-reaction-menu"
          role="menu"
          aria-label="Add reaction"
          style={{ position: 'fixed' }}
        >
          {MESSAGE_REACTIONS.map((def) => {
            const checked = def.key === mineKey
            return (
              <button
                key={def.key}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                className={`msg-reaction-option${checked ? ' msg-reaction-option-checked' : ''}`}
                onClick={() => onOptionSelect(def.key)}
              >
                <span aria-hidden="true" className="msg-reaction-option-glyph">{def.glyph}</span>
                <span className="msg-reaction-option-label">{def.label}</span>
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
