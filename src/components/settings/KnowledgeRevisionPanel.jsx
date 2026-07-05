// KT-3a-2c: Knowledge Center revision workflow for ACTIVE entries. Frontend wiring of
// the existing knowledge-admin revision actions (no backend changes). Uses the shipped
// in-place forward-versioning model: a pending revision lives in knowledge_revisions
// (UNIQUE per entry); applying it updates the Active row in place, snapshots prior
// content into version history, increments current_version, and deletes the pending
// revision. There is NO replacement/family model and the Active entry's displayed
// content never changes while a revision is pending.
//
// Roles (backend is the authority; UI mirrors it): submit/view = Owner/Admin;
// edit/discard = Owner OR the revision's author; apply = Owner only.
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import Button from '../ui/Button'
import { CATEGORY_LABELS, CATEGORY_KEYS, CAPS, fmtDate } from './knowledgeCategories'

async function postAdmin(payload) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  return fetch('/api/knowledge-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  })
}

const sectionLabel = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-secondary, #9ca3af)', marginBottom: 8 }
const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary, #6b7280)', marginBottom: 5 }
const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 9,
  border: '1px solid var(--color-border-default, #e5e7eb)',
  background: 'var(--color-bg-surface, #ffffff)', color: 'var(--color-text-primary, #191919)',
  fontFamily: 'DM Sans, sans-serif', fontSize: 13, outline: 'none', boxSizing: 'border-box',
}
const errStyle = { fontSize: 11.5, color: '#dc2626', marginTop: 4 }
const errorBox = { padding: '8px 12px', marginBottom: 12, borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 12.5 }
const metaLabel = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-secondary, #9ca3af)', marginBottom: 4 }

function Field({ label, hint, error, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}{hint && <span style={{ fontWeight: 500, color: 'var(--color-text-secondary, #9ca3af)' }}> · {hint}</span>}</label>
      {children}
      {error && <div style={errStyle}>{error}</div>}
    </div>
  )
}

const REV_EMPTY = { title: '', category: '', body: '', source_attribution: '', precedence_rank: '', change_note: '' }

export default function KnowledgeRevisionPanel({ entry, onApplied }) {
  const { isOwner, userProfile } = useAuth()
  const myId = userProfile?.id || null

  const [revision, setRevision] = useState(null)   // pending revision row, or null
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState(null)
  const [mode, setMode] = useState('idle')          // 'idle' | 'editor' | 'confirmDiscard' | 'confirmApply'
  const [editorKind, setEditorKind] = useState('create') // 'create' | 'edit'
  const [form, setForm] = useState(REV_EMPTY)
  const [fieldErr, setFieldErr] = useState({})
  const [busy, setBusy] = useState(false)
  const [actionErr, setActionErr] = useState(null)
  const [conflict, setConflict] = useState(false)   // 409/404 → offer refresh instead of retry

  const entryId = entry?.id
  const isActive = entry?.state === 'active'

  // Self-gate (defense-in-depth): the Knowledge Center panel/drawer is already
  // Owner/Admin-only, but the revision panel independently restricts ALL revision UI
  // and reads to Owner/Admin. Non-governance users get no controls and trigger no
  // get_entry_revision call. The backend remains the authority (403 on any attempt).
  const normalizedRole = String(userProfile?.role || '').toLowerCase()
  const canGovernKnowledge = isOwner || normalizedRole === 'admin'

  // Fetch the pending revision (if any) for this active entry.
  const loadRevision = useCallback(async () => {
    if (!entryId || !isActive || !canGovernKnowledge) return
    setLoading(true); setLoadErr(null)
    try {
      const res = await postAdmin({ action: 'get_entry_revision', entry_id: entryId })
      if (res.status === 404) { setRevision(null); return }
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.revision) { setLoadErr('We couldn’t load the pending revision. Please try again.'); setRevision(null); return }
      setRevision(json.revision)
    } catch {
      setLoadErr('We couldn’t load the pending revision. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [entryId, isActive, canGovernKnowledge])

  useEffect(() => {
    setMode('idle'); setActionErr(null); setConflict(false); setFieldErr({})
    loadRevision()
  }, [entryId, isActive, loadRevision])

  // Active entries only, Owner/Admin only - otherwise render nothing.
  if (!isActive || !entryId || !canGovernKnowledge) return null

  const canEditDiscard = isOwner || (revision && revision.author_id === myId)

  function openCreate() {
    setEditorKind('create')
    setForm({
      title: entry.title || '',
      category: entry.category || '',
      body: entry.body || '',
      source_attribution: entry.source_attribution || '',
      precedence_rank: entry.precedence_rank != null ? String(entry.precedence_rank) : '100',
      change_note: '',
    })
    setFieldErr({}); setActionErr(null); setConflict(false); setMode('editor')
  }
  function openEdit() {
    if (!revision) return
    setEditorKind('edit')
    setForm({
      title: revision.title || '',
      category: revision.category || '',
      body: revision.body || '',
      source_attribution: revision.source_attribution || '',
      precedence_rank: revision.precedence_rank != null ? String(revision.precedence_rank) : '100',
      change_note: revision.change_note || '',
    })
    setFieldErr({}); setActionErr(null); setConflict(false); setMode('editor')
  }
  function cancelEditor() { setMode('idle'); setFieldErr({}); setActionErr(null); setConflict(false) }
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function validate() {
    const fe = {}
    if (!form.title.trim()) fe.title = 'Title is required.'
    else if (form.title.length > CAPS.title) fe.title = `Max ${CAPS.title} characters.`
    if (!CATEGORY_KEYS.includes(form.category)) fe.category = 'Choose a category.'
    if (!form.body.trim()) fe.body = 'Body content is required.'
    else if (form.body.length > CAPS.body) fe.body = `Max ${CAPS.body.toLocaleString()} characters.`
    if (form.source_attribution.length > CAPS.source) fe.source_attribution = `Max ${CAPS.source} characters.`
    const n = Number(form.precedence_rank)
    if (form.precedence_rank === '' || !Number.isInteger(n) || n < 0) fe.precedence_rank = 'Whole number ≥ 0.'
    if (!form.change_note.trim()) fe.change_note = 'A change note is required (it documents this revision in version history).'
    else if (form.change_note.length > CAPS.source) fe.change_note = `Max ${CAPS.source} characters.`
    setFieldErr(fe)
    return Object.keys(fe).length === 0
  }

  function mapError(status, json, fallback) {
    if (status === 409) { setConflict(true); return 'A pending revision already exists for this entry. Refresh to view it.' }
    if (status === 404) { setConflict(true); return 'That pending revision no longer exists. Refresh to update this panel.' }
    if (status === 403) return json?.message && !/error|sql|rpc/i.test(json.message) ? json.message : 'You don’t have permission to do that.'
    return fallback
  }

  async function submitEditor() {
    if (busy) return
    if (!validate()) return
    setBusy(true); setActionErr(null); setConflict(false)
    try {
      // Full snapshot (backend validates 'snapshot' - all content fields required).
      const payload = {
        action: editorKind === 'create' ? 'submit_entry_revision' : 'update_entry_revision',
        entry_id: entryId,
        title: form.title.trim(),
        category: form.category,
        body: form.body,
        source_attribution: form.source_attribution,
        precedence_rank: Number(form.precedence_rank),
        change_note: form.change_note,
      }
      const res = await postAdmin(payload)
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setActionErr(mapError(res.status, json, 'We couldn’t save the revision. Please try again.'))
        return
      }
      setMode('idle')
      await loadRevision()
    } catch {
      setActionErr('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function runDiscard() {
    if (busy) return
    setBusy(true); setActionErr(null); setConflict(false)
    try {
      const res = await postAdmin({ action: 'discard_entry_revision', entry_id: entryId })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setActionErr(mapError(res.status, json, 'We couldn’t discard the revision. Please try again.'))
        return
      }
      setMode('idle')
      await loadRevision()
    } catch {
      setActionErr('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function runApply() {
    if (busy) return
    setBusy(true); setActionErr(null); setConflict(false)
    try {
      const res = await postAdmin({ action: 'apply_entry_revision', entry_id: entryId })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setActionErr(mapError(res.status, json, 'We couldn’t apply the revision. Please try again.'))
        return
      }
      // Active content + current_version changed, prior content moved to version history.
      setMode('idle'); setRevision(null)
      onApplied?.()           // parent re-fetches the entry + list + version history
    } catch {
      setActionErr('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function refreshFromConflict() { setConflict(false); setActionErr(null); setMode('idle'); loadRevision() }

  const wrap = { marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--color-border-subtle, #f3f4f6)' }

  // ── Editor (create / edit revision) ──────────────────────────────────────────
  if (mode === 'editor') {
    return (
      <div style={wrap}>
        <div style={sectionLabel}>{editorKind === 'create' ? 'Create revision' : 'Edit revision'}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)', marginBottom: 12 }}>
          Proposed changes are saved as a Draft revision. The Active entry stays unchanged until an Owner applies it.
        </div>
        {actionErr && (
          <div style={errorBox}>
            {actionErr}
            {conflict && <div style={{ marginTop: 8 }}><Button variant="secondary" onClick={refreshFromConflict}>Refresh</Button></div>}
          </div>
        )}
        <Field label="Title" error={fieldErr.title}>
          <input style={inputStyle} value={form.title} maxLength={CAPS.title + 1} onChange={e => set('title', e.target.value)} />
        </Field>
        <Field label="Category" error={fieldErr.category}>
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.category} onChange={e => set('category', e.target.value)}>
            <option value="">Select a category…</option>
            {CATEGORY_KEYS.map(k => <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>)}
          </select>
        </Field>
        <Field label="Body / content" error={fieldErr.body}>
          <textarea style={{ ...inputStyle, minHeight: 200, resize: 'vertical', lineHeight: 1.5 }} value={form.body} onChange={e => set('body', e.target.value)} placeholder="Full entry content…" />
        </Field>
        <Field label="Source of truth" hint="optional" error={fieldErr.source_attribution}>
          <input style={inputStyle} value={form.source_attribution} onChange={e => set('source_attribution', e.target.value)} placeholder="e.g. ASPIRE policy, NGRP guidelines" />
        </Field>
        <Field label="Precedence" hint="lower = higher priority" error={fieldErr.precedence_rank}>
          <input style={inputStyle} value={form.precedence_rank} inputMode="numeric" onChange={e => set('precedence_rank', e.target.value)} placeholder="100" />
        </Field>
        <Field label="Change note" hint="required, shown in version history" error={fieldErr.change_note}>
          <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical', lineHeight: 1.5 }} value={form.change_note} maxLength={CAPS.source} onChange={e => set('change_note', e.target.value)} placeholder="What changed and why?" />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="quiet" onClick={cancelEditor} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submitEditor} disabled={busy}>{busy ? 'Saving…' : (editorKind === 'create' ? 'Submit revision' : 'Save revision')}</Button>
        </div>
      </div>
    )
  }

  // ── Idle: loading / no-pending (Create) / pending (View + actions) ───────────
  return (
    <div style={wrap}>
      <div style={sectionLabel}>Revision</div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #6b7280)' }}>Loading revision…</div>
      ) : loadErr ? (
        <div style={errorBox}>{loadErr}<div style={{ marginTop: 8 }}><Button variant="secondary" onClick={loadRevision}>Retry</Button></div></div>
      ) : !revision ? (
        <>
          <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #6b7280)', marginBottom: 10 }}>
            Active entry content is changed through a revision. The current content stays live until an Owner applies the revision.
          </div>
          <Button variant="primary" onClick={openCreate}>Create revision</Button>
        </>
      ) : (
        <>
          <div style={{ border: '1px solid #c7d2fe', borderRadius: 10, padding: '14px 16px', background: 'var(--color-bg-elevated, #eef2fb)' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-accent-primary, #1D2567)', marginBottom: 4 }}>
              Draft revision of {entry.title}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)', marginBottom: 12 }}>
              {revision.author_id === myId ? 'Submitted by you' : 'Submitted by another Owner/Admin'}
              {revision.submitted_at ? ` · ${fmtDate(revision.submitted_at)}` : ''}
              {revision.updated_at && revision.updated_at !== revision.submitted_at ? ` · updated ${fmtDate(revision.updated_at)}` : ''}
            </div>

            <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)', marginBottom: 8 }}>
              This is the proposed content. The Active entry above is unchanged until applied.
            </div>

            <div style={metaLabel}>Proposed title</div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{revision.title}</div>
            <div style={metaLabel}>Proposed body</div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, fontSize: 13, marginBottom: 8, maxHeight: 220, overflowY: 'auto' }}>
              {revision.body || <span style={{ color: 'var(--color-text-secondary, #9ca3af)' }}>(empty)</span>}
            </div>
            {revision.source_attribution ? (<><div style={metaLabel}>Source of truth</div><div style={{ fontSize: 13, marginBottom: 8 }}>{revision.source_attribution}</div></>) : null}
            {revision.change_note ? (<><div style={metaLabel}>Change note</div><div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{revision.change_note}</div></>) : null}
          </div>

          {actionErr && (
            <div style={{ ...errorBox, marginTop: 12, marginBottom: 0 }}>
              {actionErr}
              {conflict && <div style={{ marginTop: 8 }}><Button variant="secondary" onClick={refreshFromConflict}>Refresh</Button></div>}
            </div>
          )}

          {mode === 'confirmDiscard' ? (
            <div style={{ marginTop: 12, border: '1px solid var(--color-border-default, #e5e7eb)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 13, color: 'var(--color-text-primary, #374151)', marginBottom: 12 }}>
                Discard this draft revision? The Active entry will remain unchanged.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button variant="quiet" onClick={() => setMode('idle')} disabled={busy}>Cancel</Button>
                <Button variant="quiet" onClick={runDiscard} disabled={busy}>{busy ? 'Working…' : 'Discard revision'}</Button>
              </div>
            </div>
          ) : mode === 'confirmApply' ? (
            <div style={{ marginTop: 12, border: '1px solid var(--color-border-default, #e5e7eb)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 13, color: 'var(--color-text-primary, #374151)', marginBottom: 12 }}>
                Apply this revision? The Active entry will advance to a new version. The previous content will remain available in version history.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button variant="quiet" onClick={() => setMode('idle')} disabled={busy}>Cancel</Button>
                <Button variant="primary" onClick={runApply} disabled={busy}>{busy ? 'Applying…' : 'Apply revision'}</Button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {canEditDiscard && <Button variant="secondary" onClick={openEdit} disabled={busy}>Edit revision</Button>}
              {canEditDiscard && <Button variant="quiet" onClick={() => { setActionErr(null); setMode('confirmDiscard') }} disabled={busy}>Discard revision</Button>}
              {isOwner && <Button variant="primary" onClick={() => { setActionErr(null); setMode('confirmApply') }} disabled={busy}>Apply revision</Button>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
