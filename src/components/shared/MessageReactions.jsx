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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
//
// MESSAGES-REFINE-2: each emoji names itself in a tooltip while it is pointed
// at, keyboard-focused, or under a sliding finger. When the bar was opened by a
// long press, the press can keep going: slide across the emoji (the tooltip
// follows) and let go on one to pick it, as iMessage does. Letting go anywhere
// else leaves the bar open.
export function ReactionBar({
  message, anchorRef, onClose, onSetReaction, onAnnounce, disabled = false, reactionSetVersion = 1,
  pressActive = false,
}) {
  const barRef = useRef(null)
  const [tip, setTip] = useState(null) // { key, label, left }
  const showTip = useCallback((button) => {
    if (!button || !barRef.current?.contains(button)) { setTip(null); return }
    setTip({ key: button.dataset.key, label: button.dataset.label, left: button.offsetLeft + button.offsetWidth / 2 })
  }, [])
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
  const pick = useCallback((key) => {
    if (disabled) return
    const next = key === mineKey ? null : key
    onSetReaction?.(message?.id, next)
    onAnnounce?.(next ? `Reacted ${reactionByKey(key)?.label || ''}`.trim() : 'Removed reaction')
    onClose(true)
  }, [disabled, mineKey, message?.id, onSetReaction, onAnnounce, onClose])

  // The long press that opened the bar is still down: follow it across the
  // emoji, and pick the one it is released on. Runs once per press: after the
  // release, an ordinary click is the only way to pick (never both).
  const pickRef = useRef(pick)
  const showTipRef = useRef(showTip)
  useEffect(() => { pickRef.current = pick; showTipRef.current = showTip })
  useEffect(() => {
    if (!pressActive) return undefined
    const optionAt = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.msg-reaction-option')
    const inBar = (el) => (el && barRef.current?.contains(el) ? el : null)
    const onMove = (e) => { showTipRef.current(inBar(optionAt(e))) }
    // A finger that slides after a long press would otherwise scroll the thread.
    const noScroll = (e) => { if (e.cancelable) e.preventDefault() }
    const stop = () => {
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerup', finish, true)
      document.removeEventListener('pointercancel', stop, true)
      document.removeEventListener('touchmove', noScroll, { capture: true })
    }
    function finish(e) {
      stop()
      const el = inBar(optionAt(e))
      if (el && !el.disabled) pickRef.current(el.dataset.key)
    }
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerup', finish, true)
    document.addEventListener('pointercancel', stop, true)
    document.addEventListener('touchmove', noScroll, { capture: true, passive: false })
    return stop
  }, [pressActive])

  return createPortal(
    <div
      ref={barRef}
      className="msg-reaction-bar"
      role="toolbar"
      aria-label="Reactions"
      aria-orientation="horizontal"
      style={{ position: 'fixed', top: -9999, left: -9999 }}
      onKeyDown={onKeyDown}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setTip(null) }}
    >
      {tip && (
        <span className="msg-reaction-tip" aria-hidden="true" style={{ left: tip.left }}>{tip.label}</span>
      )}
      {definitions.map((def) => {
        const on = def.key === mineKey
        return (
          <button
            key={def.key}
            type="button"
            className="msg-reaction-option"
            aria-pressed={on}
            aria-label={on ? `${def.label}, selected. Select again to remove` : def.label}
            data-key={def.key}
            data-label={def.label}
            disabled={disabled}
            tabIndex={-1}
            onClick={() => pick(def.key)}
            onPointerEnter={(e) => { if (e.pointerType === 'mouse') showTip(e.currentTarget) }}
            onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) showTip(e.currentTarget) }}
          >
            <span aria-hidden="true" className="msg-reaction-option-glyph">{def.glyph}</span>
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
