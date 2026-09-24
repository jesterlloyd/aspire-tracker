// src/components/connect/blocks/ButtonModal.jsx
//
// RICH-COMPOSE-2A-2 - shared modal form for inserting/editing a Linked Button. Owned by
// RichTextEditor and reused for both insert and edit. Client-side validation is for UX only; the
// server (renderContentBlocks + buttonUrl) is the authority and re-validates/escapes on render.
//
// OUTREACH-FORM-BUTTON-1 (2026-09-24): a button links to a web address OR a Catalog form. A form
// button stores the form, not a link: every form link is personal, so the send path gives each
// recipient their own (lib/server/forms/outreachButtons.js), and the server checks the form is
// published before anyone is emailed.

import { useState, useCallback, useEffect } from 'react'
import { X } from 'lucide-react'
import { validateButtonUrl } from '../../../lib/connect/buttonUrl'
import { supabase } from '../../../lib/supabase'
import { REMINDER_RULES } from '../../../lib/forms/formModel'

const F = 'Plus Jakarta Sans, sans-serif'
const NAVY = '#1D2567'
const LABEL_MAX = 60

// The parent (RichTextEditor) gives this component a remount `key` per open, so useState initializes
// fresh from initialLabel/initialUrl each time - no open-sync effect needed.
// The Catalog's forms (kind 'form'; the form id is in storage_path 'form:<id>'), read once.
function useCatalogForms(active) {
  const [forms, setForms] = useState(null)
  useEffect(() => {
    if (!active || forms) return
    supabase.from('catalog_resources').select('title, storage_path, is_active').eq('kind', 'form').order('title')
      .then(({ data, error }) => setForms(error ? [] : (data || []).filter(r => r.is_active !== false && /^form:/.test(r.storage_path || ''))
        .map(r => ({ id: r.storage_path.slice(5), title: r.title }))))
      .catch(() => setForms([]))
  }, [active, forms])
  return forms
}

export default function ButtonModal({ open, mode = 'insert', initial = {}, onSave, onCancel }) {
  const [label, setLabel] = useState(initial.label || '')
  const [kind, setKind] = useState(initial.form ? 'form' : 'url')
  const [url, setUrl] = useState(initial.url || '')
  const [form, setForm] = useState(initial.form || '')
  const [due, setDue] = useState(initial.due || '')
  const [reminders, setReminders] = useState(initial.reminders || '')
  const [error, setError] = useState('')
  const forms = useCatalogForms(open && kind === 'form')

  const submit = useCallback(() => {
    const lbl = String(label || '').trim()
    if (!lbl) { setError('Enter a button label.'); return }
    if (lbl.length > LABEL_MAX) { setError(`Label must be ${LABEL_MAX} characters or fewer.`); return }
    if (kind === 'form') {
      if (!form) { setError('Choose the form this button opens.'); return }
      const title = (forms || []).find(f => f.id === form)?.title || initial.formTitle || ''
      onSave?.({ label: lbl, form, formTitle: title, due, reminders })
      return
    }
    const v = validateButtonUrl(url)
    if (!v.ok) { setError('Enter a valid https or email link (http and unsafe links are not allowed).'); return }
    onSave?.({ label: lbl, url: v.url })
  }, [label, kind, url, form, forms, due, reminders, initial.formTitle, onSave])

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
          <div role="radiogroup" aria-label="The button opens" style={{ display: 'flex', gap: 6, margin: '14px 0 0' }}>
            {[['url', 'A web address'], ['form', 'A Catalog form']].map(([k, t]) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setError('') }}
                style={{ flex: 1, height: 34, fontSize: 12.5, fontWeight: 600, fontFamily: F, borderRadius: 'var(--aspire-radius-control)', cursor: 'pointer',
                  border: kind === k ? `1.5px solid ${NAVY}` : '1.5px solid #e5e7eb', background: kind === k ? '#eef0fa' : '#fff', color: kind === k ? NAVY : '#4b5563' }}>{t}</button>
            ))}
          </div>
          {kind === 'url' ? (<>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', margin: '14px 0 6px' }}>Button URL</label>
            <input value={url} onChange={e => { setUrl(e.target.value); setError('') }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
              placeholder="https://aspireintelligence.app/... or name@example.edu" style={field} />
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }}>Only https and email links are allowed. A link without a protocol becomes https.</div>
          </>) : (<>
            <label htmlFor="bm-form" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', margin: '14px 0 6px' }}>Form</label>
            <select id="bm-form" value={form} onChange={e => { setForm(e.target.value); setError('') }} style={field}>
              <option value="">{forms ? (forms.length ? 'Choose a form…' : 'The Catalog has no forms') : 'Loading the Catalog…'}</option>
              {(forms || []).map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
              {form && !(forms || []).some(f => f.id === form) && <option value={form}>{initial.formTitle || 'This form'}{forms ? ' (no longer in the Catalog)' : ''}</option>}
            </select>
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label htmlFor="bm-due" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Due (optional)</label>
                <input id="bm-due" type="date" value={due} onChange={e => setDue(e.target.value)} style={field} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label htmlFor="bm-rem" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Reminders</label>
                <select id="bm-rem" value={reminders} onChange={e => setReminders(e.target.value)} style={field}>
                  <option value="">The form's setting</option>
                  {REMINDER_RULES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8, lineHeight: 1.5 }}>Each person gets their own link to the form, and their answers are filed to their record. Someone who already has an open link gets the same one. The form must be published.</div>
          </>)}
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
