// NGRP-PLANNING-2: the form furniture shared by the cohort settings modal and
// the create dialog. Components only, so react-refresh stays happy; the style
// tokens and shapers they use live in lib/ngrp/ngrpCohortForm.js.
//
// ModalShell PORTALS TO document.body. The residency cohort settings open from
// inside the header's Scope dropdown, which sits in a positioned, clipped band;
// a fixed child of that band is still clipped by it, so the dialog has to leave
// the tree entirely. (Same lesson the masthead city picker learned.)
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { F, labelStyle, btn } from '../../lib/ngrp/ngrpCohortForm'

export function Field({ label, children, span2 = false }) {
  // The label WRAPS the control (implicit association), so every Field input
  // is screen-reader-labeled and clickable-by-label without per-input ids.
  return (
    <div style={{ gridColumn: span2 ? '1 / -1' : undefined }}>
      <label style={{ display: 'block' }}>
        <span style={labelStyle}>{label}</span>
        {children}
      </label>
    </div>
  )
}

// `saveDisabledReason` is a sentence, not a boolean: a Save that refuses to fire
// has to say why, in the card, next to the field at fault. A silently dead button
// reads as a broken form.
export function Card({ title, dirty, onSave, onDiscard, saving, children, footNote, saveDisabledReason = null }) {
  // Only meaningful while dirty - deriving it avoids a reset effect.
  const [confirmDiscardRaw, setConfirmDiscard] = useState(false)
  const confirmDiscard = confirmDiscardRaw && dirty
  return (
    <section className="snap" style={{ margin: '0 0 14px', padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#1D2567' }}>{title}</h2>
        {dirty && (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#92400E', background: '#FEF3C7', borderRadius: 999, padding: '2px 9px', fontFamily: F }}>
            Unsaved
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {confirmDiscard ? (
            <>
              <span style={{ fontSize: 12, color: '#4A5560', fontFamily: F }}>Discard changes?</span>
              <button type="button" style={btn()} onClick={() => setConfirmDiscard(false)}>Keep editing</button>
              <button type="button" style={btn(false, true)} onClick={() => { onDiscard(); setConfirmDiscard(false) }}>Discard</button>
            </>
          ) : (
            <>
              {dirty && <button type="button" style={btn()} onClick={() => setConfirmDiscard(true)}>Discard</button>}
              {/* A disabled Save has to LOOK disabled. In a tab it was one dark
                  button on a long page; in the settings modal there are six of
                  them, and a row of full-strength primary buttons that do
                  nothing reads as a broken form. */}
              <button
                type="button"
                style={{ ...btn(true), ...(!dirty || saving || saveDisabledReason ? { background: '#C7CBD6', cursor: 'default' } : null) }}
                disabled={!dirty || saving || Boolean(saveDisabledReason)}
                title={saveDisabledReason || undefined}
                onClick={onSave}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>
      {children}
      {dirty && saveDisabledReason && (
        <p role="alert" style={{ margin: '12px 0 0', fontSize: 12.5, fontWeight: 600, color: '#B3282D', fontFamily: F }}>
          {saveDisabledReason}
        </p>
      )}
      {footNote && <p style={{ margin: '12px 0 0', fontSize: 11.5, color: '#6B7785', lineHeight: 1.55, fontFamily: F }}>{footNote}</p>}
    </section>
  )
}

// A centred dialog on the body, with Escape-to-close and focus restored to
// whatever opened it. `z` lets a nested confirm stack above its host.
export function ModalShell({ label, onClose, width = 560, z = 1998, children, dismissOnBackdrop = true }) {
  const openerRef = useRef(typeof document !== 'undefined' ? document.activeElement : null)
  const panelRef = useRef(null)

  useEffect(() => {
    const opener = openerRef.current
    panelRef.current?.focus()
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.() } }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
    }
  }, [onClose])

  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      <div onClick={dismissOnBackdrop ? onClose : undefined} style={{ position: 'fixed', inset: 0, background: 'rgba(15,20,25,0.40)', zIndex: z }} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          width: `min(${width}px, calc(100vw - 32px))`, maxHeight: '88vh',
          display: 'flex', flexDirection: 'column',
          background: '#fff', borderRadius: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          // CLIP, NOT HIDDEN. The body paints its own background to the panel's
          // edge, so without clipping it squared off the two bottom corners
          // while the header kept its radius. `hidden` would fix the corners and
          // introduce a worse bug: it makes the panel a scroll container, and a
          // single pixel of overflow is enough for scrollIntoView - or the
          // browser's own scroll-on-focus when you tab to a field near the
          // bottom - to push the header off the top with no way to bring it
          // back. `clip` rounds the corners and refuses to scroll. Only the body
          // scrolls, which is the whole intent.
          overflow: 'clip',
          zIndex: z + 1, fontFamily: F, outline: 'none',
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}

export function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', busy, onConfirm, onCancel }) {
  if (!open) return null
  return (
    <ModalShell label={title} onClose={onCancel} width={520} z={2098}>
      <div style={{ flexShrink: 0, padding: '16px 20px', borderBottom: '1px solid #F3F4F6', fontSize: 15, fontWeight: 700 }}>{title}</div>
      <div style={{ flex: 1, minHeight: 0, padding: '14px 20px', fontSize: 13, color: '#4A5560', lineHeight: 1.6, overflowY: 'auto' }}>{body}</div>
      <div style={{ flexShrink: 0, padding: '12px 20px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button type="button" style={btn()} onClick={onCancel}>Cancel</button>
        <button type="button" style={btn(true)} disabled={busy} onClick={onConfirm}>{busy ? 'Working…' : confirmLabel}</button>
      </div>
    </ModalShell>
  )
}
