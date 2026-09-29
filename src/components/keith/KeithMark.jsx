// src/components/keith/KeithMark.jsx
//
// KEITH-FOUNDATION-1 (2026-09-28): the Keith mark. It shows what Keith did to the thing beside it:
//   drafted   the orb alone
//   edited    the orb with an amber badge holding a dark brown pencil, lower right
//   accepted  the orb with a green badge holding a navy check mark, lower right
// Reference: the legend at the top of docs/mockups/keith-workflow.html.
//
// It reads its state from the provenance record (useKeithProvenance). It NEVER takes the state as a
// prop, so it cannot say something the record does not. rejected and reverted draw nothing, because
// that output is not on screen.
//
// INTERNAL ONLY. It renders nothing for a viewer who is not staff (isStaffViewer), and the server
// sends a card only to someone who may see its entity (lib/server/keith/provenanceCards.js). It must
// never be placed in an email, a student's or a school's portal page, an export or a PDF.
//
// It is a real <button>. Hover, keyboard focus or a tap opens the card; Escape closes it. The card
// is portalled to <body> so a scrolling Sheet or a clipped slip never cuts it off.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../contexts/AuthContext'
import { accessibleName, cardView, isStaffViewer, markFor, BADGES } from '../../lib/keith/provenanceModel'
import { useKeithProvenance } from './keithProvenanceStore'
import './keithMark.css'

export const ORB_SRC = '/brand/keith-orb-160.png'

function Badge({ state }) {
  if (state === 'edited') {
    return (
      <svg className="km-badge" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ background: BADGES.edited.fill }}>
        <path d="M5 19l1-4 9-9 3 3-9 9z" fill={BADGES.edited.ink} />
        <path d="M16 5l1.5-1.5 3 3L19 8z" fill={BADGES.edited.ink} />
      </svg>
    )
  }
  if (state === 'accepted') {
    return (
      <svg className="km-badge" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ background: BADGES.accepted.fill }}>
        <path d="M5.5 12.5l4 4 9-9" fill="none" stroke={BADGES.accepted.ink} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return null
}

/** The drawn mark alone, for the card's own title row. Decorative. */
export function KeithGlyph({ state, size = 'sm' }) {
  return (
    <span className={`km km-${size} km-glyph`} aria-hidden="true">
      <img className="km-orb" src={ORB_SRC} alt="" draggable="false" />
      <Badge state={state} />
    </span>
  )
}

/**
 * The mark for a record the caller already holds. Exported for the render tests; features use
 * <KeithMark provenanceId>. Still refuses a non-staff viewer and a state with no mark.
 */
export function KeithMarkView({ record, size = 'sm', viewer }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btn = useRef(null)
  const card = useRef(null)
  const pinned = useRef(false)          // opened by a click or tap: stays until dismissed
  const cardId = useId()
  const state = markFor(record?.state)
  const view = state ? cardView(record) : null

  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect()
    if (!b) return
    const w = Math.min(300, window.innerWidth - 24)
    const x = Math.min(Math.max(12, b.left - 10), window.innerWidth - w - 12)
    let y = b.bottom + 8
    const h = card.current?.offsetHeight || 0
    if (h && y + h > window.innerHeight - 12) y = Math.max(12, b.top - h - 8)
    setPos({ left: x, top: y, width: w })
  }, [])

  const show = useCallback(() => { setOpen(true) }, [])
  const hide = useCallback(() => { pinned.current = false; setOpen(false) }, [])

  useLayoutEffect(() => { if (open) place() }, [open, place])
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') { hide(); btn.current?.focus() } }
    const onDown = (e) => { if (!btn.current?.contains(e.target) && !card.current?.contains(e.target)) hide() }
    const onMove = () => place()
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, hide, place])

  if (!isStaffViewer(viewer) || !state || !view) return null

  const leave = (e) => {
    if (pinned.current) return
    if (card.current?.contains(e.relatedTarget) || btn.current?.contains(e.relatedTarget)) return
    if (document.activeElement === btn.current) return
    setOpen(false)
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`km km-${size === 'lg' ? 'lg' : 'sm'}`}
        data-state={state}
        aria-label={accessibleName(state)}
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        onMouseEnter={show}
        onMouseLeave={leave}
        onFocus={show}
        onBlur={(e) => { if (!card.current?.contains(e.relatedTarget)) hide() }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (open && pinned.current) hide(); else { pinned.current = true; setOpen(true) } }}
      >
        <img className="km-orb" src={ORB_SRC} alt="" draggable="false" />
        <Badge state={state} />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={card}
          id={cardId}
          className="km-card"
          role="dialog"
          aria-label="Keith details"
          style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: 'hidden' }}
          onMouseLeave={leave}
        >
          <div className="km-card-head"><KeithGlyph state={state} />{view.title}</div>
          {view.rows.length > 0 && (
            <dl className="km-card-rows">
              {view.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
          )}
          {view.why && <div className="km-card-why"><b>Why:</b> <span>{view.why}</span></div>}
          <div className="km-card-foot">{view.footer}</div>
        </div>,
        document.body,
      )}
    </>
  )
}

/** The Keith mark for one provenance record. `size` is 'sm' (inline) or 'lg'. */
export default function KeithMark({ provenanceId, size = 'sm' }) {
  const { userProfile } = useAuth() || {}
  const staff = isStaffViewer(userProfile)
  const record = useKeithProvenance(staff ? provenanceId : null)
  if (!staff || !provenanceId || !record) return null
  return <KeithMarkView record={record} size={size} viewer={userProfile} />
}
