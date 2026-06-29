// src/components/connect/blocks/NoteModal.jsx
//
// RICH-COMPOSE-2A-3 — shared modal form for inserting/editing a Note callout. Owned by RichTextEditor;
// reused for insert + edit. Plain-text title + body (one default style). Client-side validation is for
// UX only; the server (renderContentBlocks) re-validates, escapes, and caps on render.
// The parent gives this component a remount `key` per open, so useState initializes fresh.

import { useState, useCallback } from 'react'
import { X } from 'lucide-react'

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'
const TITLE_MAX = 80
const BODY_MAX = 600

export default function NoteModal({ open, mode = 'insert', initialTitle = '', initialBody = '', onSave, onCancel }) {
  const [title, setTitle] = useState(initialTitle)
  const [body, setBody] = useState(initialBody)
  const [error, setError] = useState('')

  const submit = useCallback(() => {
    const t = String(title || '').trim()
    const b = String(body || '').trim()
    if (!t) { setError('Enter a note title.'); return }
    if (t.length > TITLE_MAX) { setError(`Title must be ${TITLE_MAX} characters or fewer.`); return }
    if (!b) { setError('Enter the note text.'); return }
    if (b.length > BODY_MAX) { setError(`Note text must be ${BODY_MAX} characters or fewer.`); return }
    onSave?.({ title: t, body: b })
  }, [title, body, onSave])

  if (!open) return null

  const inp = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 13, fontFamily: F, border: '1.5px solid #e5e7eb', borderRadius: 8, color: '#191919', outline: 'none' }

  return (
    <div onClick={onCancel} role="dialog" aria-modal="true" aria-label={mode === 'edit' ? 'Edit note' : 'Insert note'}
      style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(440px, 100%)', background: '#fff', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.18)', fontFamily: F, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #eee' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{mode === 'edit' ? 'Edit note' : 'Insert note'}</div>
          <button onClick={onCancel} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 6, minWidth: 40, minHeight: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Note title</label>
          <input autoFocus value={title} maxLength={TITLE_MAX} onChange={e => { setTitle(e.target.value); setError('') }}
            placeholder="e.g. Reminder" style={{ ...inp, height: 38 }} />
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', margin: '14px 0 6px' }}>Note text</label>
          <textarea value={body} maxLength={BODY_MAX} rows={5} onChange={e => { setBody(e.target.value); setError('') }}
            placeholder="A short reminder or highlighted detail. Line breaks are kept." style={{ ...inp, resize: 'vertical', lineHeight: 1.5, minHeight: 96 }} />
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>Plain text only. Line breaks are preserved in the email.</div>
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
