// src/components/shared/MessageReactions.jsx
//
// MESSAGES-SIMPLIFY-1: reactions work like iMessage. Nothing shows on an idle
// bubble; a long press (450 ms, mouse, pen or finger), a right-click, or Enter
// or Space on the focused bubble opens a bar of six emoji above it. Reactions
// show as one small round badge on the bubble's top outer corner: up to three
// distinct emoji, then the total when more than one person reacted. Hover and
// the accessible name say who reacted. Staff and every portal share this file
// through MessageBubble.
//
// Reactions are quiet acknowledgements: this component never implies a
// notification, an unread change, or an archive change. It only ever calls
// onSetReaction(messageId, keyOrNull); everything else is the caller's.

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  reactionByKey, reactionsForVersion, reactionSentences, reactionBadgeContent,
} from '../../lib/messages/reactionConstants'

const GAP = 10
const EDGE = 8

export function ReactionBadge({ message, viewerId, side }) {
  const { glyphs, total } = reactionBadgeContent(message)
  if (total === 0) return null
  const label = reactionSentences(message, viewerId).join(', ')
  return (
    <span
      className={`msg-reaction-badge msg-reaction-badge--${side}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {glyphs.map((g) => <span key={g} aria-hidden="true" className="msg-reaction-badge__glyph">{g}</span>)}
      {total > 1 && <span aria-hidden="true" className="msg-reaction-badge__count">{total}</span>}
    </span>
  )
}

// The bar of six. Opens above the bubble, flips below when there is no room,
// and always stays inside the viewport.
export function ReactionBar({
  message, anchorRef, onClose, onSetReaction, onAnnounce, disabled = false, reactionSetVersion = 1,
}) {
  const barRef = useRef(null)
  const definitions = reactionsForVersion(reactionSetVersion)
  const mineKey = (Array.isArray(message?.reactions) ? message.reactions : []).find((r) => r?.mine)?.key || null

  // Above the bubble, below it when there is no room, always in the viewport.
  // Returns false when the bubble has scrolled out of view.
  const place = useCallback(() => {
    const bar = barRef.current
    const anchor = anchorRef.current
    if (!bar || !anchor) return false
    const r = anchor.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (r.bottom < 0 || r.top > vh) return false
    const w = bar.offsetWidth
    const h = bar.offsetHeight
    let top = r.top - GAP - h
    let placement = 'up'
    if (top < EDGE) {
      top = r.bottom + GAP
      placement = 'down'
    }
    top = Math.max(EDGE, Math.min(top, vh - h - EDGE))
    const alignRight = anchor.classList.contains('msg-bubble-outgoing')
    let left = alignRight ? r.right - w : r.left
    left = Math.max(EDGE, Math.min(left, vw - w - EDGE))
    bar.style.top = `${Math.round(top)}px`
    bar.style.left = `${Math.round(left)}px`
    bar.dataset.placement = placement
    return true
  }, [anchorRef])

  useLayoutEffect(() => {
    place()
    const bar = barRef.current
    const first = bar?.querySelector('[aria-pressed="true"]') || bar?.querySelector('button')
    first?.focus()
  }, [place])

  useEffect(() => {
    const onPointerDown = (e) => {
      if (barRef.current?.contains(e.target)) return
      onClose(!anchorRef.current?.contains(e.target) ? false : true)
    }
    // The thread scrolls itself (new messages, polling), so a scroll follows
    // the bubble rather than closing the bar, unless the bubble has left view.
    const onScrollResize = () => {
      if (!place()) onClose(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScrollResize, true)
    window.addEventListener('resize', onScrollResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScrollResize, true)
      window.removeEventListener('resize', onScrollResize)
    }
  }, [onClose, anchorRef, place])

  const onKeyDown = (e) => {
    const buttons = [...(barRef.current?.querySelectorAll('button') || [])]
    const i = buttons.indexOf(document.activeElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); return }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault(); buttons[(i + 1) % buttons.length]?.focus()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault(); buttons[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault(); buttons[buttons.length - 1]?.focus()
    } else if (e.key === 'Tab') {
      onClose(false)
    }
  }

  // Picking the current reaction removes it; any other replaces it.
  const pick = (key) => {
    if (disabled) return
    const next = key === mineKey ? null : key
    onSetReaction?.(message?.id, next)
    onAnnounce?.(next ? `Reacted ${reactionByKey(key)?.label || ''}`.trim() : 'Removed reaction')
    onClose(true)
  }

  return createPortal(
    <div
      ref={barRef}
      className="msg-reaction-bar"
      role="toolbar"
      aria-label="Reactions"
      aria-orientation="horizontal"
      style={{ position: 'fixed', top: -9999, left: -9999 }}
      onKeyDown={onKeyDown}
    >
      {definitions.map((def) => {
        const on = def.key === mineKey
        return (
          <button
            key={def.key}
            type="button"
            className="msg-reaction-option"
            aria-pressed={on}
            aria-label={on ? `${def.label}, selected. Select again to remove` : def.label}
            title={def.label}
            disabled={disabled}
            tabIndex={-1}
            onClick={() => pick(def.key)}
          >
            <span aria-hidden="true" className="msg-reaction-option-glyph">{def.glyph}</span>
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
