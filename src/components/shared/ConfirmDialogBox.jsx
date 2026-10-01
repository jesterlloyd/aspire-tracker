// src/components/shared/ConfirmDialogBox.jsx
//
// CONFIRM-DIALOG-1: the box confirmDialog() shows. Never rendered directly: call confirmDialog().
import { useEffect, useRef } from 'react'
import './confirmDialog.css'

export default function ConfirmDialogBox({ title, message, confirmLabel, cancelLabel, danger, onDone }) {
  const box = useRef(null)
  const first = useRef(null)
  useEffect(() => { first.current?.focus() }, [])
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(false); return }
    if (e.key !== 'Tab') return
    const f = [...(box.current?.querySelectorAll('button') || [])]
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus() }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
  }
  return (
    <div className="cfm-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onDone(false) }}>
      <div className="cfm" role="alertdialog" aria-modal="true" aria-labelledby="cfm-title" aria-describedby={message ? 'cfm-text' : undefined} ref={box} onKeyDown={onKey}>
        <h2 id="cfm-title">{title}</h2>
        {message && <p id="cfm-text">{message}</p>}
        <div className="cfm-acts">
          <button type="button" className="cfm-btn" ref={danger ? first : undefined} onClick={() => onDone(false)}>{cancelLabel}</button>
          <button type="button" className={`cfm-btn ${danger ? 'cfm-danger' : 'cfm-primary'}`} ref={danger ? undefined : first} onClick={() => onDone(true)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
