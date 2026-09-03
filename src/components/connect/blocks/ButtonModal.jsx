// src/components/connect/blocks/ButtonModal.jsx
//
// RICH-COMPOSE-2A-2 - shared modal form for inserting/editing a Linked Button. Owned by
// RichTextEditor and reused for both insert and edit. Client-side validation is for UX only; the
// server (renderContentBlocks + buttonUrl) is the authority and re-validates/escapes on render.

import { useState, useCallback } from 'react'
import { X } from 'lucide-react'
import { validateButtonUrl } from '../../../lib/connect/buttonUrl'

const F = 'Plus Jakarta Sans, sans-serif'
const NAVY = '#1D2567'
const LABEL_MAX = 60

// The parent (RichTextEditor) gives this component a remount `key` per open, so useState initializes
// fresh from initialLabel/initialUrl each time - no open-sync effect needed.
export default function ButtonModal({ open, mode = 'insert', initialLabel = '', initialUrl = '', onSave, onCancel }) {
  const [label, setLabel] = useState(initialLabel)
  const [url, setUrl] = useState(initialUrl)
  const [error, setError] = useState('')

  const submit = useCallback(() => {
    const lbl = String(label || '').trim()
    if (!lbl) { setError('Enter a button label.'); return }
    if (lbl.length > LABEL_MAX) { setError(`Label must be ${LABEL_MAX} characters or fewer.`); return }
    const v = validateButtonUrl(url)
    if (!v.ok) { setError('Enter a valid https or email link (http and unsafe links are not allowed).'); return }
    onSave?.({ label: lbl, url: v.url })
  }, [label, url, onSave])

  if (!open) return null

  const field = { width: '100%', boxSizing: 'border-box', height: 38, padding: '0 11px', fontSize: 13, fontFamily: F, border: '1.5px solid #e5e7eb', borderRadius: 8, color: '#191919', outline: 'none' }

  return (
    <div
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'edit' ? 'Edit button' : 'Insert button'}
      style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(420px, 100%)', background: '#fff', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.18)', fontFamily: F, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #eee' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{mode === 'edit' ? 'Edit button' : 'Insert button'}</div>
          <button onClick={onCancel} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 6, minWidth: 40, minHeight: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
        </div>
        <div style={{ padding: '16px' }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Button label</label>
          <input autoFocus value={label} maxLength={LABEL_MAX} onChange={e => { setLabel(e.target.value); setError('') }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
            placeholder="e.g. Complete your profile" style={field} />
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', margin: '14px 0 6px' }}>Button URL</label>
          <input value={url} onChange={e => { setUrl(e.target.value); setError('') }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
            placeholder="https://aspireintelligence.app/... or name@example.edu" style={field} />
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6, lineHeight: 1.5 }}>Only https and email links are allowed. A link without a protocol becomes https.</div>
          {error && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 10 }}>{error}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 16px 16px' }}>
          <button onClick={onCancel} style={{ height: 38, padding: '0 14px', fontSize: 13, fontWeight: 600, fontFamily: F, background: '#fff', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} style={{ height: 38, padding: '0 18px', fontSize: 13, fontWeight: 600, fontFamily: F, background: NAVY, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>{mode === 'edit' ? 'Save' : 'Insert'}</button>
        </div>
      </div>
    </div>
  )
}
