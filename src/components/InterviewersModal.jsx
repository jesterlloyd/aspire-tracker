import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { X, Plus, Trash2, Pencil, Loader } from 'lucide-react'
import DetailDrawer from './ui/DetailDrawer'

const CACHE_KEY = 'aspire_interviewers_v1'

const loadCache = () => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

const saveCache = (data) => {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)) } catch {}
}

const initialsOf = (name) => (name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

// WS2.2 / ACCOUNTS-ACCESS-REDESIGN-1: reusable inline content (no modal chrome). Rendered by
// AccountsAccessPanel (Settings → Accounts & Access) and by the legacy InterviewersModal wrapper.
// Pass onRequestClose to show a close button (modal mode); omit it for inline (Settings).
//
// Phase-1 UI redesign: read-only directory cards + an Add/Edit DetailDrawer replace the old dark
// header and always-on inline email inputs. All data behavior is preserved — same /api/manage-
// interviewers actions (add / update_email / update_color) with the same payloads, the same
// aspire_interviewers_v1 cache key, the same rubric_support_data invalidations, and the same delete
// call. NOTE: delete still uses the existing direct-Supabase path; its authorization inconsistency
// is intentionally NOT changed here and is deferred to ACCOUNTS-ACCESS-DELETE-HARDEN-2.
export function InterviewersContent({ onRequestClose }) {
  const queryClient = useQueryClient()
  const [interviewers, setInterviewers] = useState([])
  const [loading,      setLoading]      = useState(false)

  // Add drawer
  const [showAdd,  setShowAdd]  = useState(false)
  const [newName,  setNewName]  = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [adding,   setAdding]   = useState(false)

  // Edit drawer (name is read-only in Phase 1; email + color only)
  const [editing,    setEditing]    = useState(null)   // interviewer object or null
  const [editEmail,  setEditEmail]  = useState('')
  const [editColor,  setEditColor]  = useState('#1D2567')
  const [editSaving, setEditSaving] = useState(false)

  // Delete confirmation (replaces window.confirm; still calls the same delete exactly once)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting,     setDeleting]     = useState(false)

  const fetchInterviewers = useCallback(async () => {
    // Cache-first: show instantly if available
    const cached = loadCache()
    if (cached?.length > 0) {
      setInterviewers(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }

    // Background refresh from Supabase
    try {
      const { data, error } = await supabase
        .from('interviewers')
        .select('id, name, email, color')
        .order('name', { ascending: true })
      if (!error && data) {
        setInterviewers(data)
        saveCache(data)
      }
    } catch (err) {
      console.error('Fetch interviewers:', err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchInterviewers() }, [fetchInterviewers])

  const callProxy = async (body) => {
    // WS1d-A: forward the Supabase access token so the server can verify the
    // caller and authorize interviewer-directory administration server-side.
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    const response = await fetch('/api/manage-interviewers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || data.error || 'Request failed')
    return data
  }

  const handleAdd = async () => {
    if (!newName.trim()) return
    setAdding(true)
    try {
      const result = await callProxy({ action: 'add', name: newName.trim(), email: newEmail.trim() || '' })
      const newRecord = result.data
      const updated = [...interviewers, newRecord].sort((a, b) => a.name.localeCompare(b.name))
      setInterviewers(updated)
      saveCache(updated)
      setNewName('')
      setNewEmail('')
      setShowAdd(false)
      // Invalidate rubric dropdown cache so the new interviewer appears immediately
      queryClient.invalidateQueries({ queryKey: ['rubric_support_data'] })
    } catch (err) {
      alert(`Add failed: ${err.message}`)
    } finally {
      setAdding(false)
    }
  }

  const openEdit = (interviewer) => {
    setEditing(interviewer)
    setEditEmail(interviewer.email ?? '')
    setEditColor(interviewer.color || '#1D2567')
  }

  // Save from the Edit drawer — SAME payloads as the previous inline controls:
  // update_email and update_color via /api/manage-interviewers. Name is not editable.
  const handleEditSave = async () => {
    if (!editing) return
    setEditSaving(true)
    try {
      const emailTrim = (editEmail ?? '').trim()
      if (emailTrim !== (editing.email ?? '')) {
        await callProxy({ action: 'update_email', id: editing.id, email: emailTrim })
      }
      if ((editColor || '') !== (editing.color || '')) {
        await callProxy({ action: 'update_color', id: editing.id, color: editColor })
      }
      const updated = interviewers.map(i =>
        i.id === editing.id ? { ...i, email: emailTrim, color: editColor } : i
      )
      setInterviewers(updated)
      saveCache(updated)
      setEditing(null)
    } catch (err) {
      alert(`Save failed: ${err.message}`)
    } finally {
      setEditSaving(false)
    }
  }

  // The exact previous delete behavior, minus the window.confirm wrapper (the confirmation is now the
  // dialog below). Still a direct Supabase delete + rubric_support_data invalidation, called once.
  // Authorization hardening is deferred to ACCOUNTS-ACCESS-DELETE-HARDEN-2.
  const performDelete = async (interviewer) => {
    setDeleting(true)
    try {
      const { error } = await supabase
        .from('interviewers')
        .delete()
        .eq('id', interviewer.id)
      if (error) { alert(`Could not delete: ${error.message}`); return }
      const updated = interviewers.filter(i => i.id !== interviewer.id)
      setInterviewers(updated)
      saveCache(updated)
      queryClient.invalidateQueries({ queryKey: ['rubric_support_data'] })
      setDeleteTarget(null)
    } catch (err) {
      alert(`Delete failed: ${err.message}`)
    } finally {
      setDeleting(false)
    }
  }

  const F = 'DM Sans, sans-serif'
  const fieldStyle = {
    width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: '8px',
    fontFamily: F, fontSize: '13px', outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle = { display: 'block', fontFamily: F, fontWeight: 600, fontSize: '12px', color: '#374151', marginBottom: '6px' }
  const directoryNote = (
    <div style={{ marginTop: 14, fontSize: 11.5, color: '#9ca3af', lineHeight: 1.5, fontFamily: F }}>
      Directory only. This does not create a login account.
    </div>
  )

  return (
    <div style={{ width: '100%', height: '100%', background: '#ffffff', display: 'flex', flexDirection: 'column', fontFamily: F }}>
      {/* Header — light surface bar (replaced the dark gradient block). Primary action lives here. */}
      <div style={{ padding: '18px 24px', flexShrink: 0, borderBottom: '1px solid #eef0f2', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '17px', color: '#191919' }}>Interviewer Directory</div>
          <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '3px' }}>
            People who conduct ASPIRE interviews. Separate from login accounts.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button onClick={() => { setNewName(''); setNewEmail(''); setShowAdd(true) }}
            style={{ padding: '8px 14px', background: '#1D2567', border: 'none', borderRadius: '8px', fontFamily: F, fontWeight: 600, fontSize: '13px', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <Plus size={15} /> Add Interviewer
          </button>
          {onRequestClose && (
            <button onClick={onRequestClose} aria-label="Close"
              style={{ background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#6b7280', flexShrink: 0 }}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px' }}>
        <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '14px', lineHeight: 1.5 }}>
          Interviewers appear in the availability manager and rubric dropdown. Email addresses are used
          for scheduling notifications.
        </div>

        {/* Loading */}
        {loading && interviewers.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ height: 60, borderRadius: 12, border: '1px solid #e8e4dc', background: 'linear-gradient(90deg,#f7f7f5,#fbfbfa,#f7f7f5)' }} />
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && interviewers.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', border: '1px dashed #e8e4dc', borderRadius: 14, background: '#fcfcfb' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 6 }}>No interviewers yet</div>
            <div style={{ fontSize: 12.5, color: '#9ca3af', marginBottom: 16, lineHeight: 1.5 }}>
              Add the people who conduct ASPIRE interviews. They’ll appear in scheduling and rubrics.
            </div>
            <button onClick={() => { setNewName(''); setNewEmail(''); setShowAdd(true) }}
              style={{ padding: '9px 16px', background: '#1D2567', border: 'none', borderRadius: 8, fontFamily: F, fontWeight: 600, fontSize: 13, color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={15} /> Add Interviewer
            </button>
          </div>
        )}

        {/* Directory cards — read-only (edit/delete via actions) */}
        {interviewers.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10, alignItems: 'start' }}>
            {interviewers.map(interviewer => (
              <div key={interviewer.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                border: '1px solid #e8e4dc', borderRadius: 12, padding: '12px 14px',
                background: '#ffffff', boxShadow: '0 1px 3px rgba(25,25,25,0.06)',
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  background: interviewer.color || '#1D2567',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 11, color: '#fff',
                }}>
                  {initialsOf(interviewer.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#1D2567', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{interviewer.name}</div>
                  <div style={{ fontSize: 12.5, color: interviewer.email ? '#6b7280' : '#c0c4cc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {interviewer.email || 'No email on file'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => openEdit(interviewer)} title="Edit interviewer" aria-label={`Edit ${interviewer.name}`}
                    style={{ padding: '6px 12px', border: '1px solid #d7ddf5', borderRadius: 8, background: '#fff', fontFamily: F, fontWeight: 600, fontSize: 12, color: '#1D2567', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Pencil size={13} /> Edit
                  </button>
                  <button onClick={() => setDeleteTarget(interviewer)} title="Remove interviewer" aria-label={`Remove ${interviewer.name}`}
                    style={{ width: 32, height: 32, border: '1px solid #f3d0d4', borderRadius: 8, background: '#fff', cursor: 'pointer', color: '#dc1e34', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Interviewer drawer */}
      <DetailDrawer
        open={showAdd}
        title="Add interviewer"
        onClose={() => setShowAdd(false)}
        width={440}
        footer={(
          <>
            <button onClick={() => setShowAdd(false)}
              style={{ padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', fontFamily: F, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleAdd} disabled={adding || !newName.trim()}
              style={{ padding: '8px 20px', border: 'none', borderRadius: 8, background: !newName.trim() ? '#e5e7eb' : '#1D2567', color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: newName.trim() && !adding ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {adding ? <><Loader size={13} /> Adding…</> : <><Plus size={13} /> Add Interviewer</>}
            </button>
          </>
        )}
      >
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Full name <span style={{ color: '#dc1e34' }}>*</span></label>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Samuel Berman" style={fieldStyle} />
        </div>
        <div>
          <label style={labelStyle}>Email address <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span></label>
          <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="name@example.com" style={fieldStyle} />
        </div>
        {directoryNote}
      </DetailDrawer>

      {/* Edit Interviewer drawer — name read-only (Phase 1); email + color editable */}
      <DetailDrawer
        open={!!editing}
        title={editing ? `Edit · ${editing.name}` : 'Edit interviewer'}
        onClose={() => setEditing(null)}
        width={440}
        footer={editing ? (
          <>
            <button onClick={() => setEditing(null)}
              style={{ padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', fontFamily: F, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleEditSave} disabled={editSaving}
              style={{ padding: '8px 20px', border: 'none', borderRadius: 8, background: editSaving ? '#e5e7eb' : '#1D2567', color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: editSaving ? 'default' : 'pointer' }}>
              {editSaving ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : null}
      >
        {editing && (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Name</label>
              <div style={{ ...fieldStyle, background: '#f7f7f5', color: '#6b7280', display: 'flex', alignItems: 'center' }}>{editing.name}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Email address</label>
              <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="name@example.com" style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Calendar color</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="color" value={editColor} onChange={e => setEditColor(e.target.value)}
                  aria-label="Interviewer color"
                  style={{ width: 40, height: 34, border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer', padding: 2, background: '#fff' }} />
                <span style={{ fontSize: 12.5, color: '#6b7280', fontFamily: 'ui-monospace, Menlo, monospace' }}>{editColor}</span>
              </div>
            </div>
            {directoryNote}
          </>
        )}
      </DetailDrawer>

      {/* Delete confirmation (replaces window.confirm; calls performDelete once) */}
      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: '26px 24px', maxWidth: 380, width: '90%', boxShadow: '0 16px 48px rgba(0,0,0,0.2)', fontFamily: F }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#1D2567', marginBottom: 10 }}>Remove {deleteTarget.name}?</div>
            <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, marginBottom: 20 }}>
              This removes them from the interviewer directory. Existing scheduling and rubric records that
              reference their name are not changed.
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteTarget(null)} disabled={deleting}
                style={{ padding: '9px 18px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', fontFamily: F, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => performDelete(deleteTarget)} disabled={deleting}
                style={{ padding: '9px 18px', border: 'none', borderRadius: 8, background: '#dc2626', color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: deleting ? 'default' : 'pointer' }}>
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ACCOUNTS-ACCESS-PEOPLE-MODEL-2A: the legacy editable "Manage Interviewers" modal is RETIRED as a
// user-facing directory editor. Interviewers are now managed account-first in Settings → Accounts &
// Access (enable Can Conduct Interviews on a person's login account; color is set there too). This
// entry point (WeekCalendar's "Manage Interviewers" button) now shows guidance + a shortcut to
// Settings instead of the account-less directory editor. The editable InterviewersContent above is
// intentionally KEPT (not deleted) for reference/rollback, but is no longer reachable from the app UI.
// No table, endpoint, scheduling, or name-storage behavior is changed.
export default function InterviewersModal({ isOpen, onClose }) {
  const navigate = useNavigate()
  if (!isOpen) return null
  const F = 'DM Sans, sans-serif'
  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Manage interviewers"
      style={{ position: 'fixed', inset: 0, zIndex: 1999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: F }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: '26px 24px', maxWidth: 460, width: '90%', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: '#1D2567', marginBottom: 10 }}>Interviewers are managed in Accounts &amp; Access</div>
        <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, marginBottom: 20 }}>
          Interviewers are now login accounts with <strong>Can Conduct Interviews</strong> enabled — managed
          in <strong>Settings › Accounts &amp; Access › People / Interviewers</strong>. To add an interviewer,
          invite the person as a login account, then turn on Can Conduct Interviews (their calendar color is
          set there too). This separate interviewer list is no longer edited here.
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}
            style={{ padding: '9px 16px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb', fontFamily: F, fontSize: 13, cursor: 'pointer' }}>Close</button>
          <button type="button" onClick={() => { onClose?.(); navigate('/settings/accounts') }}
            style={{ padding: '9px 18px', border: 'none', borderRadius: 8, background: '#1D2567', color: '#fff', fontFamily: F, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Go to Accounts &amp; Access</button>
        </div>
      </div>
    </div>
  )
}
