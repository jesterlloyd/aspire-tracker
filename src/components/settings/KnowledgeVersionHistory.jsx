// KT-3a-2b: read-only Version History for a Knowledge Center entry. Lists the
// immutable versions (newest first) via the existing list_entry_versions action and
// shows a full read-only snapshot of a selected version via get_entry_version. Both
// Owner and Admin can read versions (this is rendered only from the gated KC drawer;
// the backend authorizes every call regardless). No restore, no diff, and no
// revision workflow here — those are deferred to KT-3a-2c.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { CATEGORY_LABELS, fmtDate } from './knowledgeCategories'

async function postAdmin(payload) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  return fetch('/api/knowledge-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  })
}

// The endpoint exposes the editor only as a user_profiles id (no name). Show a short,
// stable form with the full id available on hover.
function shortId(id) {
  return typeof id === 'string' && id.length > 8 ? id.slice(0, 8) : (id || '—')
}

const sectionLabel = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-secondary, #9ca3af)', marginBottom: 8 }
const metaStyle = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-secondary, #9ca3af)', marginBottom: 4 }
const quietBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--color-accent-primary, #1D2567)', fontFamily: 'DM Sans, sans-serif', fontSize: 12.5, fontWeight: 600,
}

export default function KnowledgeVersionHistory({ entryId, open, reloadToken }) {
  const [versions, setVersions] = useState(null) // null = not loaded yet
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selNum, setSelNum] = useState(null)      // selected version number (snapshot view)
  const [selected, setSelected] = useState(null)  // full snapshot row
  const [selLoading, setSelLoading] = useState(false)
  const [selError, setSelError] = useState(null)

  const load = useCallback(async () => {
    if (!entryId) return
    setLoading(true); setError(null); setSelNum(null); setSelected(null); setSelError(null)
    try {
      const res = await postAdmin({ action: 'list_entry_versions', entry_id: entryId })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(res.status === 403 ? 'You don’t have permission to view version history.' : 'We couldn’t load version history. Please try again.')
        setVersions([])
        return
      }
      setVersions(Array.isArray(json?.versions) ? json.versions : [])
    } catch {
      setError('We couldn’t load version history. Please try again.')
      setVersions([])
    } finally {
      setLoading(false)
    }
  }, [entryId])

  // (Re)load whenever the drawer opens, the entry changes, or a lifecycle action
  // bumps reloadToken (so v1 appears immediately after activation).
  useEffect(() => {
    if (!open || !entryId) return
    load()
  }, [open, entryId, reloadToken, load])

  async function openVersion(n) {
    setSelNum(n); setSelLoading(true); setSelError(null); setSelected(null)
    try {
      const res = await postAdmin({ action: 'get_entry_version', entry_id: entryId, version_number: n })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.version) {
        setSelError(res.status === 404 ? 'That version could not be found.' : 'We couldn’t load that version. Please try again.')
        return
      }
      setSelected(json.version)
    } catch {
      setSelError('We couldn’t load that version. Please try again.')
    } finally {
      setSelLoading(false)
    }
  }

  function backToList() {
    setSelNum(null); setSelected(null); setSelError(null)
  }

  const wrap = { marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--color-border-subtle, #f3f4f6)' }

  // ── Snapshot (read-only) view of a single version ────────────────────────────
  if (selNum != null) {
    return (
      <div style={wrap}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
          <div style={sectionLabel}>Version {selNum}</div>
          <button type="button" style={quietBtn} onClick={backToList}>← Back to history</button>
        </div>
        {selLoading ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #6b7280)' }}>Loading version…</div>
        ) : selError ? (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 12.5 }}>{selError}</div>
        ) : selected ? (
          <div style={{ fontSize: 13, color: 'var(--color-text-primary, #374151)' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{selected.title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14, fontSize: 12.5, color: 'var(--color-text-secondary, #6b7280)' }}>
              <span>{CATEGORY_LABELS[selected.category] || selected.category}</span>
              <span style={{ color: 'var(--color-text-secondary, #9ca3af)' }}>·</span>
              <span>{fmtDate(selected.created_at)}</span>
              <span style={{ color: 'var(--color-text-secondary, #9ca3af)' }}>·</span>
              <span title={selected.editor_id}>Editor {shortId(selected.editor_id)}</span>
            </div>

            <div style={metaStyle}>Body</div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, marginBottom: 16 }}>{selected.body || <span style={{ color: 'var(--color-text-secondary, #9ca3af)' }}>(empty)</span>}</div>

            {selected.source_attribution ? (
              <div style={{ marginBottom: 14 }}>
                <div style={metaStyle}>Source of truth</div>
                <div>{selected.source_attribution}</div>
              </div>
            ) : null}

            {selected.change_note ? (
              <div style={{ marginBottom: 14 }}>
                <div style={metaStyle}>Change note</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{selected.change_note}</div>
              </div>
            ) : null}

            <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary, #6b7280)' }}>Precedence {selected.precedence_rank}</div>
          </div>
        ) : null}
      </div>
    )
  }

  // ── Version list ─────────────────────────────────────────────────────────────
  return (
    <div style={wrap}>
      <div style={sectionLabel}>Version History</div>
      {loading || versions == null ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #6b7280)' }}>Loading versions…</div>
      ) : error ? (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 12.5 }}>{error}</div>
      ) : versions.length === 0 ? (
        <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--color-bg-elevated, #eef2fb)', color: 'var(--color-text-secondary, #6b7280)', fontSize: 12.5 }}>
          No versions yet. Versions are created when an entry is activated.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {versions.map(v => (
            <button
              key={v.version_number}
              type="button"
              onClick={() => openVersion(v.version_number)}
              style={{
                textAlign: 'left', cursor: 'pointer', width: '100%',
                border: '1px solid var(--color-border-subtle, #f3f4f6)', borderRadius: 9,
                background: 'var(--color-bg-surface, #ffffff)', padding: '9px 12px',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary, #191919)' }}>Version {v.version_number}</span>
                <span style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)', whiteSpace: 'nowrap' }}>{fmtDate(v.created_at)}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)', marginTop: 2 }} title={v.editor_id}>Editor {shortId(v.editor_id)}</div>
              {v.change_note ? (
                <div style={{ fontSize: 12.5, color: 'var(--color-text-primary, #374151)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{v.change_note}</div>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
