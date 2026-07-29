// ASPIRE-EVENTS-CALENDAR-2B: create / edit / read-only detail for a custom ASPIRE event. All writes
// go through the gated /api/aspire-events endpoint (client cannot write aspire_events directly - RLS
// blocks it). Owner/admin get create+edit+archive; everyone else gets a read-only detail view.
// Cohort scoping is DEFERRED in Phase 2 (no cohort picker here) - reported deferred.
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { ASPIRE_EVENT_TYPES, RECURRENCE_OPTIONS, ANNUAL_ALLDAY_TYPES, eventColor, eventTypeLabel, formatEventWhen } from '../lib/aspireEvents'

const COLOR_SWATCHES = ['#1D2567', '#0E7490', '#7C3AED', '#C2410C', '#B91C1C', '#2F7D5C']

// Surface the safest server-provided message: an explicit human `message`, else a human `error` string
// that came with a machine `code` (our safe classified responses), else the generic fallback. Never
// shows a bare error slug (e.g. 'not_found') and never leaks raw database internals.
const safeServerError = (json, fallback) => json?.message || (json?.code ? json.error : null) || fallback

// timestamptz ISO → local 'YYYY-MM-DD' / 'HH:MM' for date/time inputs.
function toDateInput(ts) {
  if (!ts) return ''
  const d = new Date(ts); if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function toTimeInput(ts) {
  if (!ts) return ''
  const d = new Date(ts); if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function combineISO(dateStr, timeStr) {
  if (!dateStr) return null
  const d = new Date(`${dateStr}T${timeStr || '00:00'}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function AspireEventModal({ event, canManage, defaultDate, recurrenceEnabled = false, onClose, onSaved }) {
  const isEdit = !!event
  const readOnly = !canManage

  const [form, setForm] = useState(() => ({
    title:           event?.title || '',
    event_type:      event?.event_type || 'custom',
    all_day:         event?.all_day ?? false,
    start_date:      event ? toDateInput(event.start_at) : (defaultDate || todayStr()),
    start_time:      event ? (toTimeInput(event.start_at) || '09:00') : '09:00',
    end_date:        event?.end_at ? toDateInput(event.end_at) : '',
    end_time:        event?.end_at ? toTimeInput(event.end_at) : '',
    location:        event?.location || '',
    url:             event?.url || '',
    school:          event?.school || '',
    // Audience is preserved server-side (default 'internal') but its control is hidden: only 'internal'
    // is operative today (nothing consumes the others; no authorized portal read path). See discovery.
    audience:        event?.audience || 'internal',
    description:     event?.description || '',
    is_milestone:    event?.is_milestone ?? false,
    show_on_welcome: event?.show_on_welcome ?? false,
    color:           event?.color || '',
    // Recurrence (gated on recurrenceEnabled from the server capability; fail-closed to 'none').
    recurrence:      event?.recurrence || 'none',
    recurrence_end:  event?.recurrence_end || '',
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmArchive, setConfirmArchive] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Selecting a Birthday (or any annual-all-day type) applies its defaults: all-day on, and — when
  // recurrence is enabled — Annually. The user can still change any default before saving.
  const setEventType = (val) => setForm(f => {
    const next = { ...f, event_type: val }
    if (ANNUAL_ALLDAY_TYPES.has(val)) {
      next.all_day = true
      if (recurrenceEnabled) next.recurrence = 'annually'
    }
    return next
  })

  const post = async (payload) => {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    const res = await fetch('/api/aspire-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
    })
    const json = await res.json().catch(() => ({}))
    return { ok: res.ok, json }
  }

  const handleSave = async () => {
    setError('')
    if (!form.title.trim()) { setError('Please enter a title.'); return }
    if (!form.start_date)   { setError('Please choose a start date.'); return }

    const start_at = combineISO(form.start_date, form.all_day ? '00:00' : form.start_time)
    let end_at = null
    if (form.all_day) {
      end_at = form.end_date ? combineISO(form.end_date, '00:00') : null
    } else if (form.end_time) {
      end_at = combineISO(form.end_date || form.start_date, form.end_time)
    }
    if (end_at && start_at && new Date(end_at).getTime() < new Date(start_at).getTime()) {
      setError('End cannot be before start.'); return
    }
    if (recurrenceEnabled && form.recurrence !== 'none' && form.recurrence_end && form.recurrence_end < form.start_date) {
      setError('Recurrence end cannot be before the start date.'); return
    }

    const payload = {
      action: isEdit ? 'update' : 'create',
      ...(isEdit ? { id: event.id } : {}),
      title: form.title.trim(),
      event_type: form.event_type,
      all_day: form.all_day,
      start_at,
      end_at,
      location: form.location.trim() || null,
      url: form.url.trim() || null,
      school: form.school.trim() || null,
      audience: form.audience,
      description: form.description.trim() || null,
      is_milestone: form.is_milestone,
      show_on_welcome: form.show_on_welcome,
      color: form.color || null,
      // Only send recurrence when the server reports it enabled; a one-time event omits it entirely.
      ...(recurrenceEnabled ? {
        recurrence: form.recurrence,
        recurrence_end: form.recurrence !== 'none' && form.recurrence_end ? form.recurrence_end : null,
      } : {}),
    }

    setSaving(true)
    const { ok, json } = await post(payload)
    setSaving(false)
    if (!ok) { setError(safeServerError(json, 'Could not save the event. Please try again.')); return }
    onSaved?.(isEdit ? 'updated' : 'created')
  }

  const handleArchive = async () => {
    setError(''); setSaving(true)
    const { ok, json } = await post({ action: 'archive', id: event.id })
    setSaving(false)
    if (!ok) { setError(safeServerError(json, 'Could not archive the event.')); return }
    onSaved?.('archived')
  }

  // ── Read-only detail view (non-owner/admin) ─────────────────────────────────
  if (readOnly) {
    const row = (label, value) => value ? (
      <div className="form-field" style={{ gap: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af' }}>{label}</span>
        <span style={{ fontSize: 13, color: '#374151' }}>{value}</span>
      </div>
    ) : null
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: eventColor(event), flexShrink: 0 }} />
              {event.title}
            </h2>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {row('Type', eventTypeLabel(event.event_type))}
            {row('When', `${toDateInput(event.start_at)} · ${formatEventWhen(event)}`)}
            {row('Location', event.location)}
            {row('Link', event.url)}
            {row('School', event.school)}
            {row('Details', event.description)}
            {event.is_milestone ? <span style={{ fontSize: 12, color: '#7C3AED', fontWeight: 600 }}>★ Milestone</span> : null}
          </div>
          <div className="modal-footer">
            <button className="btn btn-primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Create / edit form (owner/admin) ────────────────────────────────────────
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? 'Edit ASPIRE Event' : 'Add ASPIRE Event'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div className="error-msg">{error}</div>}

          <div className="form-field">
            <label className="form-label">Title *</label>
            <input className="form-input" value={form.title} maxLength={200}
              onChange={e => set('title', e.target.value)} placeholder="e.g. NGRP Applications Open" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-field">
              <label className="form-label">Event type</label>
              <select className="form-select" value={form.event_type} onChange={e => setEventType(e.target.value)}>
                {ASPIRE_EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {/* Repeats replaces the (hidden) Audience control. Shown only when the server reports
                recurrence is enabled (the Owner migration is applied); fail-closed otherwise. */}
            {recurrenceEnabled && (
              <div className="form-field">
                <label className="form-label">Repeats</label>
                <select className="form-select" value={form.recurrence} onChange={e => set('recurrence', e.target.value)}>
                  {RECURRENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.all_day} onChange={e => set('all_day', e.target.checked)}
              style={{ accentColor: '#1D2567', width: 15, height: 15 }} />
            All-day event
          </label>

          {/* Recurrence end — only when repeating. "Never" (blank) or "On date". */}
          {recurrenceEnabled && form.recurrence !== 'none' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-field">
                <label className="form-label">Ends</label>
                <select className="form-select"
                  value={form.recurrence_end ? 'on' : 'never'}
                  onChange={e => set('recurrence_end', e.target.value === 'never' ? '' : (form.recurrence_end || form.start_date))}>
                  <option value="never">Never</option>
                  <option value="on">On date</option>
                </select>
              </div>
              {form.recurrence_end && (
                <div className="form-field">
                  <label className="form-label">End date</label>
                  <input className="form-input" type="date" value={form.recurrence_end}
                    min={form.start_date || undefined} onChange={e => set('recurrence_end', e.target.value)} />
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: form.all_day ? '1fr 1fr' : '1fr 1fr', gap: 12 }}>
            <div className="form-field">
              <label className="form-label">Start date *</label>
              <input className="form-input" type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </div>
            {!form.all_day && (
              <div className="form-field">
                <label className="form-label">Start time</label>
                <input className="form-input" type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} />
              </div>
            )}
            <div className="form-field">
              <label className="form-label">End date <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
              <input className="form-input" type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
            </div>
            {!form.all_day && (
              <div className="form-field">
                <label className="form-label">End time <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
                <input className="form-input" type="time" value={form.end_time} onChange={e => set('end_time', e.target.value)} />
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-field">
              <label className="form-label">Location <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
              <input className="form-input" value={form.location} onChange={e => set('location', e.target.value)} placeholder="Room / campus" />
            </div>
            <div className="form-field">
              <label className="form-label">School <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
              <input className="form-input" value={form.school} onChange={e => set('school', e.target.value)} placeholder="Affiliated school" />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Link <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional, http(s))</span></label>
            <input className="form-input" value={form.url} onChange={e => set('url', e.target.value)} placeholder="https://…" />
          </div>

          <div className="form-field">
            <label className="form-label">Description <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
            <textarea className="form-input" rows={3} value={form.description} onChange={e => set('description', e.target.value)} style={{ resize: 'vertical' }} />
          </div>

          <div className="form-field">
            <label className="form-label">Color <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional, defaults to the event type)</span></label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => set('color', '')}
                style={{ height: 26, padding: '0 10px', borderRadius: 6, border: form.color === '' ? '2px solid #1D2567' : '1px solid #e5e7eb', background: '#fff', fontSize: 12, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
                Default
              </button>
              {COLOR_SWATCHES.map(c => (
                <button key={c} type="button" title={c} onClick={() => set('color', c)} aria-label={`Color ${c}`}
                  style={{ width: 26, height: 26, borderRadius: '50%', background: c, cursor: 'pointer', border: '2px solid #fff', boxShadow: form.color === c ? `0 0 0 2px ${c}` : '0 0 0 1px #e5e7eb' }} />
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_milestone} onChange={e => set('is_milestone', e.target.checked)}
                style={{ accentColor: '#1D2567', width: 15, height: 15 }} />
              Mark as milestone
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.show_on_welcome} onChange={e => set('show_on_welcome', e.target.checked)}
                style={{ accentColor: '#1D2567', width: 15, height: 15 }} />
              Show on Aggregate welcome
            </label>
          </div>
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <div>
            {isEdit && !confirmArchive && (
              <button className="btn btn-outline-modal" onClick={() => setConfirmArchive(true)} disabled={saving}
                style={{ color: '#b45309', borderColor: '#fcd34d' }}>Archive</button>
            )}
            {isEdit && confirmArchive && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: '#6b7280' }}>Archive this event?</span>
                <button className="btn btn-outline-modal" onClick={() => setConfirmArchive(false)} disabled={saving}>No</button>
                <button className="btn btn-primary" onClick={handleArchive} disabled={saving}
                  style={{ background: '#b45309' }}>{saving ? 'Archiving…' : 'Yes, archive'}</button>
              </div>
            )}
          </div>
          {!confirmArchive && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-outline-modal" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create event'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
