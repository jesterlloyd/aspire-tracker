// src/components/connect/blocks/EventModal.jsx
//
// RICH-COMPOSE-2B — shared modal form for inserting/editing an Event Details card. Owned by
// RichTextEditor; reused for insert + edit. Plain-text fields; Date/Time required. Client-side
// validation is for UX only; the server (renderContentBlocks) re-validates, escapes, and caps on
// render. The parent gives a remount `key` per open so useState initializes fresh.

import { useState, useCallback } from 'react'
import { X } from 'lucide-react'

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'
const MAX = { title: 80, dateTime: 120, location: 120, format: 80, respondBy: 120 }
const INP = { width: '100%', boxSizing: 'border-box', height: 38, padding: '0 11px', fontSize: 13, fontFamily: F, border: '1.5px solid #e5e7eb', borderRadius: 8, color: '#191919', outline: 'none' }
const LAB = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', margin: '12px 0 6px' }

// Module-level field (hoisted out of render so it is not recreated each render).
function EvField({ label, value, onChange, max, placeholder, autoFocus }) {
  return (
    <>
      <label style={LAB}>{label}</label>
      <input autoFocus={autoFocus} value={value} maxLength={max} onChange={onChange} placeholder={placeholder} style={INP} />
    </>
  )
}

export default function EventModal({ open, mode = 'insert', initial = {}, onSave, onCancel }) {
  const [title, setTitle] = useState(initial.title || '')
  const [dateTime, setDateTime] = useState(initial.dateTime || '')
  const [location, setLocation] = useState(initial.location || '')
  const [format, setFormat] = useState(initial.format || '')
  const [respondBy, setRespondBy] = useState(initial.respondBy || '')
  const [error, setError] = useState('')

  const submit = useCallback(() => {
    const dt = String(dateTime || '').trim()
    if (!dt) { setError('Enter a date / time.'); return }
    if (dt.length > MAX.dateTime) { setError(`Date / Time must be ${MAX.dateTime} characters or fewer.`); return }
    onSave?.({
      title: String(title || '').trim().slice(0, MAX.title),
      dateTime: dt,
      location: String(location || '').trim().slice(0, MAX.location),
      format: String(format || '').trim().slice(0, MAX.format),
      respondBy: String(respondBy || '').trim().slice(0, MAX.respondBy),
    })
  }, [title, dateTime, location, format, respondBy, onSave])

  if (!open) return null

  const ch = (set) => (e) => { set(e.target.value); setError('') }

  return (
    <div onClick={onCancel} role="dialog" aria-modal="true" aria-label={mode === 'edit' ? 'Edit event details' : 'Insert event details'}
      style={{ position: 'fixed', inset: 0, zIndex: 800, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(440px, 100%)', maxHeight: '90vh', overflowY: 'auto', background: '#fff', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.18)', fontFamily: F }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: '#fff' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{mode === 'edit' ? 'Edit event details' : 'Insert event details'}</div>
          <button onClick={onCancel} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 6, minWidth: 40, minHeight: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
        </div>
        <div style={{ padding: '4px 16px 16px' }}>
          <EvField label="Event title (optional)" value={title} onChange={ch(setTitle)} max={MAX.title} placeholder="e.g. ASPIRE Orientation" />
          <EvField label="Date / Time" value={dateTime} onChange={ch(setDateTime)} max={MAX.dateTime} placeholder="e.g. Tuesday, March 4 at 10:00 AM PT" autoFocus />
          <EvField label="Location (optional)" value={location} onChange={ch(setLocation)} max={MAX.location} placeholder="e.g. 8700 Beverly Blvd, Los Angeles" />
          <EvField label="Format (optional)" value={format} onChange={ch(setFormat)} max={MAX.format} placeholder="e.g. In person, Virtual, Microsoft Teams" />
          <EvField label="Respond by (optional)" value={respondBy} onChange={ch(setRespondBy)} max={MAX.respondBy} placeholder="e.g. March 1" />
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>Plain text only. Only filled rows appear in the email.</div>
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
