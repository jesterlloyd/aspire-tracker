/**
 * FlagRibbon - the ribbon sewn into the top of the rubric's left page.
 *
 * RUBRIC-BOOK-1 (Owner, 2026-09-17): pulling the ribbon down flags the candidate for
 * the placement huddle, and the gesture is the whole interaction. There is NO note:
 * the flag says "the ASPIRE team sees this candidate first" and nothing more, so a
 * flag now reaches the Action Center without a reason. Notes written before this
 * change are still stored and still shown wherever they already appear.
 *
 * A pull is not an accessible control on its own, so the ribbon is a real <button>:
 * Enter, Space and a plain click do exactly what the pull does, and the drag is an
 * enhancement on top. The pull threshold is deliberately short (18px) because the
 * ribbon has nowhere else to go.
 */

import { useRef, useState } from 'react'

export const PULL_TO_FLAG = 18     // px down, from the top of the ribbon
export const PULL_TO_UNFLAG = 12   // px up, when it is already hanging
const CLICK_SLOP = 4               // a pointer that moved less than this is a click

// STUDENT-CHART-1 (2026-09-18): the student chart sews the same ribbon into its binder,
// so the gesture, the thresholds and the keyboard parity are defined once here and the
// two surfaces differ only in what they are named and what they write. The defaults are
// the rubric's, so the rubric's own call site did not change: `rb-ribbon`,
// `rb-ribbon-on` and `rb-ribbon-dragging` are still exactly the classes it renders.
export default function FlagRibbon({
  flagged,
  disabled = false,
  onFlag,
  onUnflag,
  classPrefix = 'rb-ribbon',
  text = 'FLAG',
  labelOn = 'Flagged for the placement huddle. Pull the ribbon up, or press, to remove the flag.',
  labelOff = 'Pull the ribbon down, or press, to flag this candidate for the placement huddle.',
}) {
  const startY = useRef(null)
  const moved = useRef(0)
  const [pull, setPull] = useState(0)

  const toggle = () => {
    if (disabled) return
    if (flagged) onUnflag?.(); else onFlag?.()
  }

  const onPointerDown = (e) => {
    if (disabled) return
    startY.current = e.clientY
    moved.current = 0
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e) => {
    if (startY.current == null) return
    const dy = e.clientY - startY.current
    moved.current = Math.max(moved.current, Math.abs(dy))
    // The ribbon follows the finger a little, in the direction that means something.
    setPull(flagged ? Math.max(-14, Math.min(0, dy)) : Math.max(0, Math.min(26, dy)))
  }

  const onPointerUp = (e) => {
    if (startY.current == null) return
    const dy = e.clientY - startY.current
    startY.current = null
    setPull(0)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (moved.current < CLICK_SLOP) { toggle(); return }        // a press, not a pull
    if (!flagged && dy >= PULL_TO_FLAG) { onFlag?.(); return }
    if (flagged && dy <= -PULL_TO_UNFLAG) onUnflag?.()
  }

  const onPointerCancel = () => { startY.current = null; setPull(0) }

  return (
    <button
      type="button"
      data-testid="flag-ribbon"
      className={`${classPrefix}${flagged ? ` ${classPrefix}-on` : ''}${pull ? ` ${classPrefix}-dragging` : ''}`}
      style={pull ? { transform: `translateY(${pull}px)` } : undefined}
      aria-pressed={flagged}
      disabled={disabled}
      aria-label={flagged ? labelOn : labelOff}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() }
      }}
    >
      {flagged ? 'FLAGGED' : text}
    </button>
  )
}
