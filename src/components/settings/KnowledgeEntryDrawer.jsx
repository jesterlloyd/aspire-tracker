// KT-3a-2a: Knowledge Center entry drawer — view / create / edit modes inside the
// shared DetailDrawer. Owner/Admin only (rendered solely from the gated KC panel;
// the backend authorizes every call regardless). Talks ONLY to the existing
// api/knowledge-admin.js actions create_entry_draft and update_entry_draft. No
// lifecycle (activate/deprecate/archive) and no version history here.
//
// Field mapping is faithful to the KT-1 schema — title, category, body,
// source_attribution, precedence_rank, effective_date, expires_at. There are no
// dedicated "summary / tags / applies-to / timing / Keith guidance" columns, so
// that structured sub-content is authored inside Body (no invented schema). New
// entries are always created in 'draft' state (server-forced); only draft entries
// are editable in this phase — non-draft entries are read-only with a note.
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import DetailDrawer from '../ui/DetailDrawer'
import Button from '../ui/Button'
import StateBadge from './StateBadge'
import { CATEGORY_LABELS, CATEGORY_KEYS, CAPS, isValidDateStr, fmtDate } from './knowledgeCategories'

const EMPTY = { title: '', category: '', body: '', source_attribution: '', precedence_rank: '', effective_date: '', expires_at: '' }

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary, #6b7280)', marginBottom: 5 }
const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 9,
  border: '1px solid var(--color-border-default, #e5e7eb)',
  background: 'var(--color-bg-surface, #ffffff)', color: 'var(--color-text-primary, #191919)',
  fontFamily: 'DM Sans, sans-serif', fontSize: 13, outline: 'none', boxSizing: 'border-box',
}
const errStyle = { fontSize: 11.5, color: '#dc2626', marginTop: 4 }

function Field({ label, hint, error, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={labelStyle}>{label}{hint && <span style={{ fontWeight: 500, color: 'var(--color-text-secondary, #9ca3af)' }}> · {hint}</span>}</label>
      {children}
      {error && <div style={errStyle}>{error}</div>}
    </div>
  )
}

export default function KnowledgeEntryDrawer({ open, mode, entry, onClose, onSaved, onRequestEdit }) {
  const editing = mode === 'create' || mode === 'edit'
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [fieldErr, setFieldErr] = useState({})

  // (Re)initialize the form whenever the drawer opens in create/edit or the entry changes.
  useEffect(() => {
    if (!open) return
    if (mode === 'create') setForm(EMPTY)
    else if (mode === 'edit' && entry) {
      setForm({
        title: entry.title || '',
        category: entry.category || '',
        body: entry.body || '',
        source_attribution: entry.source_attribution || '',
        precedence_rank: entry.precedence_rank != null ? String(entry.precedence_rank) : '',
        effective_date: entry.effective_date || '',
        expires_at: entry.expires_at || '',
      })
    }
    setError(null); setFieldErr({})
  }, [open, mode, entry?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function validate() {
    const fe = {}
    if (!form.title.trim()) fe.title = 'Title is required.'
    else if (form.title.length > CAPS.title) fe.title = `Max ${CAPS.title} characters.`
    if (!CATEGORY_KEYS.includes(form.category)) fe.category = 'Choose a category.'
    if (!form.body.trim()) fe.body = 'Body content is required.'
    else if (form.body.length > CAPS.body) fe.body = `Max ${CAPS.body.toLocaleString()} characters.`
    if (form.source_attribution.length > CAPS.source) fe.source_attribution = `Max ${CAPS.source} characters.`
    if (form.precedence_rank !== '') {
      const n = Number(form.precedence_rank)
      if (!Number.isInteger(n) || n < 0) fe.precedence_rank = 'Whole number ≥ 0.'
    }
    if (form.effective_date && !isValidDateStr(form.effective_date)) fe.effective_date = 'Use YYYY-MM-DD.'
    if (form.expires_at && !isValidDateStr(form.expires_at)) fe.expires_at = 'Use YYYY-MM-DD.'
    if (form.effective_date && form.expires_at && form.expires_at < form.effective_date) fe.expires_at = 'Must be on or after the effective date.'
    // Dates cannot be cleared via update_entry_draft: the backend's validateDates
    // rejects both null and '' (only a valid YYYY-MM-DD or an omitted field is
    // accepted, and an omitted field preserves the current value). So in edit mode,
    // block a blank-out of a date that previously had a value rather than silently
    // preserving the old date. (source_attribution and precedence_rank can be
    // cleared/reset — see handleSave.)
    if (mode === 'edit') {
      if (!form.effective_date && entry?.effective_date) fe.effective_date = 'Clearing a date isn’t supported in this phase — enter a valid date or keep the current one.'
      if (!form.expires_at && entry?.expires_at) fe.expires_at = 'Clearing a date isn’t supported in this phase — enter a valid date or keep the current one.'
    }
    setFieldErr(fe)
    return Object.keys(fe).length === 0
  }

  async function handleSave() {
    if (saving) return
    if (!validate()) return
    setSaving(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const isCreate = mode === 'create'
      const payload = isCreate
        ? { action: 'create_entry_draft', title: form.title.trim(), category: form.category, body: form.body }
        : { action: 'update_entry_draft', entry_id: entry.id, title: form.title.trim(), category: form.category, body: form.body }

      // Optional-field semantics differ by mode because the backend treats an OMITTED
      // field as "use default" (create) / "preserve current value" (update), and only
      // some fields accept a clearing value:
      //   • source_attribution → '' clears it (isCappedString accepts empty strings).
      //   • precedence_rank     → null/'' are rejected; the create-default is 100, so a
      //                           cleared rank in edit mode resets to that default.
      //   • effective_date / expires_at → validateDates rejects both null and '', so
      //                           dates are NOT clearable here; send only when set and
      //                           omit when blank (preserve). A blank-out of a
      //                           previously-set date is blocked in validate() so we
      //                           never silently preserve.
      if (isCreate) {
        if (form.source_attribution !== '') payload.source_attribution = form.source_attribution
        if (form.precedence_rank !== '') payload.precedence_rank = Number(form.precedence_rank)
        if (form.effective_date !== '') payload.effective_date = form.effective_date
        if (form.expires_at !== '') payload.expires_at = form.expires_at
      } else {
        // Always send source_attribution so blanking it clears to ''.
        payload.source_attribution = form.source_attribution
        // Blank precedence resets to the backend's create-default (100); it cannot be nulled.
        payload.precedence_rank = form.precedence_rank !== '' ? Number(form.precedence_rank) : 100
        // Dates: send when set, omit when blank (clearing is blocked in validate()).
        if (form.effective_date !== '') payload.effective_date = form.effective_date
        if (form.expires_at !== '') payload.expires_at = form.expires_at
      }

      const res = await fetch('/api/knowledge-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        let msg = 'Save failed. Please try again.'
        if (json?.error === 'conflict') msg = 'This entry is no longer a draft and can’t be edited here.'
        else if (json?.message) msg = json.message
        else if (res.status === 403) msg = 'You don’t have permission to save this entry.'
        setError(msg)
        return
      }
      // The backend returns { success, entry_id } for both create and update. Fall
      // back to an entry-object id, then the in-hand entry id, without assuming a
      // shape the backend doesn't actually return.
      const savedId = json.entry_id ?? json.entry?.id ?? entry?.id
      onSaved?.(savedId)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Footer per mode ──────────────────────────────────────────────────────────
  let footer
  if (editing) {
    footer = (
      <>
        <Button variant="quiet" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Draft'}</Button>
      </>
    )
  } else { // view
    footer = (
      <>
        <Button variant="quiet" onClick={onClose}>Close</Button>
        {entry?.state === 'draft' && <Button variant="primary" onClick={onRequestEdit}>Edit Draft</Button>}
      </>
    )
  }

  const title = mode === 'create' ? 'New Knowledge Entry' : mode === 'edit' ? 'Edit Draft' : (entry?.title || 'Knowledge Entry')

  return (
    <DetailDrawer open={open} title={title} onClose={onClose} footer={footer}>
      {editing ? (
        <>
          {error && (
            <div style={{ padding: '8px 12px', marginBottom: 14, borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 12.5 }}>{error}</div>
          )}
          <Field label="Title" error={fieldErr.title}>
            <input style={inputStyle} value={form.title} maxLength={CAPS.title + 1} onChange={e => set('title', e.target.value)} placeholder="Entry title" />
          </Field>
          <Field label="Category" error={fieldErr.category}>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.category} onChange={e => set('category', e.target.value)}>
              <option value="">Select a category…</option>
              {CATEGORY_KEYS.map(k => <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>)}
            </select>
          </Field>
          <Field
            label="Body / content"
            hint="paste the full entry; use your own section headings for summary, tags, applies-to, timing, and Keith guidance"
            error={fieldErr.body}
          >
            <textarea
              style={{ ...inputStyle, minHeight: 220, resize: 'vertical', lineHeight: 1.5 }}
              value={form.body}
              onChange={e => set('body', e.target.value)}
              placeholder="Full entry content…"
            />
          </Field>
          <Field label="Source of truth" hint="optional" error={fieldErr.source_attribution}>
            <input style={inputStyle} value={form.source_attribution} onChange={e => set('source_attribution', e.target.value)} placeholder="e.g. ASPIRE policy, NGRP guidelines" />
          </Field>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 120px' }}>
              <Field label="Precedence" hint={mode === 'edit' ? 'lower = higher priority; blank resets to 100' : 'optional, lower = higher priority'} error={fieldErr.precedence_rank}>
                <input style={inputStyle} value={form.precedence_rank} inputMode="numeric" onChange={e => set('precedence_rank', e.target.value)} placeholder="100" />
              </Field>
            </div>
            <div style={{ flex: '1 1 130px' }}>
              <Field label="Effective date" hint="optional" error={fieldErr.effective_date}>
                <input style={inputStyle} value={form.effective_date} onChange={e => set('effective_date', e.target.value)} placeholder="YYYY-MM-DD" />
              </Field>
            </div>
            <div style={{ flex: '1 1 130px' }}>
              <Field label="Expires" hint="optional" error={fieldErr.expires_at}>
                <input style={inputStyle} value={form.expires_at} onChange={e => set('expires_at', e.target.value)} placeholder="YYYY-MM-DD" />
              </Field>
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--color-text-secondary, #9ca3af)', marginTop: 4 }}>
            Saved as a <strong>Draft</strong>. Activation, revisions, and version history arrive in a later update.
          </p>
        </>
      ) : (
        // ── View (read-only) ──────────────────────────────────────────────────
        <div style={{ fontSize: 13, color: 'var(--color-text-primary, #374151)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <StateBadge state={entry?.state} />
            <span style={{ color: 'var(--color-text-secondary, #6b7280)' }}>{CATEGORY_LABELS[entry?.category] || entry?.category}</span>
            <span style={{ color: 'var(--color-text-secondary, #9ca3af)' }}>·</span>
            <span style={{ color: 'var(--color-text-secondary, #6b7280)' }}>v{entry?.current_version}</span>
            <span style={{ color: 'var(--color-text-secondary, #9ca3af)' }}>·</span>
            <span style={{ color: 'var(--color-text-secondary, #6b7280)' }}>Updated {fmtDate(entry?.updated_at)}</span>
          </div>

          {entry?.state !== 'draft' && (
            <div style={{ padding: '8px 12px', marginBottom: 14, borderRadius: 8, background: 'var(--color-bg-elevated, #eef2fb)', color: 'var(--color-text-secondary, #6b7280)', fontSize: 12.5 }}>
              Only draft entries can be edited in this phase.
            </div>
          )}

          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-secondary, #9ca3af)', marginBottom: 6 }}>Body</div>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, marginBottom: 18 }}>{entry?.body || <span style={{ color: 'var(--color-text-secondary, #9ca3af)' }}>(empty)</span>}</div>

          {entry?.source_attribution ? (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-secondary, #9ca3af)', marginBottom: 4 }}>Source of truth</div>
              <div>{entry.source_attribution}</div>
            </div>
          ) : null}

          {(entry?.effective_date || entry?.expires_at) && (
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--color-text-secondary, #6b7280)' }}>
              {entry?.effective_date && <span>Effective {fmtDate(entry.effective_date)}</span>}
              {entry?.expires_at && <span>Expires {fmtDate(entry.expires_at)}</span>}
            </div>
          )}
        </div>
      )}
    </DetailDrawer>
  )
}
