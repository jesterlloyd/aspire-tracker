// src/portal/unit/UnitShiftDayDrawer.jsx
//
// UL-PHASE1: one day's rotation activity.
//
// PROPS ONLY. Shifts arrive already scoped and already field-filtered by
// api/portal/unit-shift-activity.js. This component performs no fetch and holds no
// authorization, so there is no path here through which a support narrative, an internal
// note, or review metadata could appear: those fields never leave the server.
//
// Accessibility mirrors StudentDetailDrawer, which is the established pattern in this
// portal: modal dialog, trapped and cycling Tab, Escape to close, focus moved in on open
// and returned to the trigger on close.

import { useEffect, useRef } from 'react'
import { X, Clock } from 'lucide-react'
import { EMPTY, orDash } from './unitLeaderApi'

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

function fmtClock(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtDay(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number)
  if (!y || !m || !d) return ymd || ''
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US',
    { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** Hours line: a live shift has no total yet, so show what is expected instead. */
function hoursLine(s) {
  if (s.state === 'in_progress') {
    return s.expected_hours != null ? `${s.expected_hours} hours expected` : 'In progress'
  }
  if (s.hours == null) return EMPTY
  return `${s.hours} hours${s.hours_state === 'approved' ? ' approved' : ' pending'}`
}

export default function UnitShiftDayDrawer({ ymd, shifts = [], onClose, returnFocusRef }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)

  useEffect(() => {
    const prev = returnFocusRef?.current || null
    const t = setTimeout(() => closeRef.current?.focus?.(), 20)
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const els = Array.from(panelRef.current.querySelectorAll(FOCUSABLE)).filter(el => el.offsetParent !== null)
      if (els.length === 0) return
      const first = els[0], last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      if (prev?.focus) prev.focus()
    }
  }, [onClose, returnFocusRef])

  return (
    <>
      <div className="ptl-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        className="ptl-drawer ptl-day-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Rotation activity for ${fmtDay(ymd)}`}
      >
        <div className="ptl-drawer-head">
          <div style={{ minWidth: 0 }}>
            <h2 className="ptl-drawer-title">{fmtDay(ymd)}</h2>
            <p className="ptl-muted" style={{ margin: '3px 0 0', fontSize: 12 }}>
              {shifts.length} shift{shifts.length === 1 ? '' : 's'} recorded
            </p>
          </div>
          <button ref={closeRef} type="button" className="ptl-icon-btn"
            aria-label="Close day details" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="ptl-drawer-body">
          {shifts.length === 0 ? (
            <p className="ptl-muted">No rotation activity was recorded on this day.</p>
          ) : (
            <ul className="ptl-day-list">
              {shifts.map(s => {
                const inProgress = s.state === 'in_progress'
                const inAt = fmtClock(s.checked_in_at)
                const outAt = fmtClock(s.checked_out_at)
                return (
                  <li key={s.id} className={`ptl-day-item${inProgress ? ' ptl-day-item-live' : ''}`}>
                    <div className="ptl-day-item-head">
                      <span className="ptl-day-name">{orDash(s.student_name)}</span>
                      {inProgress && (
                        <span className="ptl-pill ptl-pill-live">
                          <Clock size={11} aria-hidden="true" /> On shift now
                        </span>
                      )}
                    </div>
                    <dl className="ptl-day-meta">
                      <div><dt>Preceptor</dt><dd>{orDash(s.preceptor_name)}</dd></div>
                      <div><dt>Shift</dt><dd>{orDash(s.shift_type)}</dd></div>
                      <div><dt>Unit</dt><dd>{orDash(s.unit_name)}</dd></div>
                      <div>
                        <dt>Times</dt>
                        <dd>{inAt ? `${inAt}${outAt ? ` to ${outAt}` : ' onward'}` : EMPTY}</dd>
                      </div>
                      <div><dt>Hours</dt><dd>{hoursLine(s)}</dd></div>
                    </dl>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  )
}
