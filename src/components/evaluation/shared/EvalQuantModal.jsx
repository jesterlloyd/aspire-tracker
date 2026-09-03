// src/components/evaluation/shared/EvalQuantModal.jsx
//
// Role-safe quantitative response viewer for a Unit Leader. It renders a single response
// from the in-memory row already returned by the list API — NOT from a database fetch and
// NOT keyed by any durable id. It may show only: the anonymous positional label, instrument,
// timepoint, unit, and the allowlisted quantitative fields. It NEVER shows identity,
// preceptor, dates, free text, moderation/release metadata, notes, or any stable key.
//
// Accessible dialog: focus trap, Escape to close, focus restoration to the opener, internal
// scroll, and responsive to 320px / 200% zoom (max-width with % + overflow).

import { useEffect, useRef } from 'react'
import { fmtMetric, instrumentLabel, metricKind, metricLabel } from '../../../lib/unitEvaluationDisplay'

const F = "'Plus Jakarta Sans', system-ui, sans-serif"

export default function EvalQuantModal({ response, instrumentSlug, timepointLabel, metricPaths = [], returnFocusRef, onClose }) {
  const panelRef = useRef(null)

  useEffect(() => {
    const prev = returnFocusRef?.current || null
    const t = setTimeout(() => panelRef.current?.querySelector('button, [tabindex]')?.focus?.(), 20)
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return }
      if (e.key !== 'Tab' || !panelRef.current) return
      const els = Array.from(panelRef.current.querySelectorAll('button, [tabindex="0"]'))
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

  if (!response) return null
  const entries = metricPaths.filter(p => response.quantitative?.[p] !== undefined)

  return (
    <>
      <div onClick={onClose} aria-hidden="true"
        style={{ position: 'fixed', inset: 0, background: 'rgba(25,25,25,0.5)', backdropFilter: 'blur(2px)', zIndex: 600 }} />
      <div role="dialog" aria-modal="true" aria-label={`${response.anon_label} details`} ref={panelRef}
        style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(520px, 92vw)', maxHeight: '85vh', overflowY: 'auto', background: '#fff',
          borderRadius: 12, borderTop: '3px solid #1D2567', boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
          zIndex: 601, fontFamily: F }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0E1428' }}>{response.anon_label}</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6b7280' }}>
              {instrumentLabel(instrumentSlug)}
              {timepointLabel ? ` · ${timepointLabel}` : ''}
              {response.unit_key ? ` · ${response.unit_key}` : ''}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ flexShrink: 0, background: 'none', border: '1px solid #e5e7eb', borderRadius: 8, height: 30, padding: '0 12px', fontFamily: F, fontSize: 12.5, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
            Close
          </button>
        </div>

        <div style={{ padding: '16px 20px' }}>
          {entries.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>No approved quantitative fields for this response.</p>
          ) : (
            <dl style={{ margin: 0, display: 'grid', gap: 12 }}>
              {entries.map(p => (
                <div key={p} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                  <dt style={{ fontSize: 12.5, color: '#4A5560', fontWeight: 600 }}>
                    {metricLabel(p)}
                    {metricKind(p) === 'context' && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#9ca3af' }}>Context</span>}
                  </dt>
                  <dd style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#0E1428', fontVariantNumeric: 'tabular-nums' }}>{fmtMetric(response.quantitative[p])}</dd>
                </div>
              ))}
            </dl>
          )}
          <p style={{ margin: '16px 0 0', fontSize: 11.5, color: '#9ca3af', lineHeight: 1.5 }}>
            Quantitative responses only. Written comments and identifying details are not shown.
          </p>
        </div>
      </div>
    </>
  )
}
