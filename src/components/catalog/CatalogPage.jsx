import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Search, FileText, FileType2, ExternalLink, Star, Pin, Folder, Clock, Download } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

// CATALOG-1 — Read-only ASPIRE Catalog browse UI (Owner/Admin only).
//
// Reads catalog_resources via the user session; the table's Owner/Admin SELECT RLS is the
// gate (a non-Owner/Admin simply sees no rows). Internal files open through the server-side
// /api/catalog-resource-open endpoint (short-lived signed URL, never persisted); external
// links navigate out. No writes, no uploads, no edit/delete — Manage affordances are inert
// placeholders only.

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

// Stored categories (7) + the UI-only "All" filter. Labels are display-only.
const CATEGORIES = [
  { key: 'all',                 label: 'All' },
  { key: 'orientation',         label: 'Orientation' },
  { key: 'forms',               label: 'Forms' },
  { key: 'clinical_resources',  label: 'Clinical Resources' },
  { key: 'unit_guides',         label: 'Unit Guides' },
  { key: 'student_support',     label: 'Student Support' },
  { key: 'preceptor_resources', label: 'Preceptor Resources' },
  { key: 'policies',            label: 'Policies' },
]
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.key, c.label]))

const DAY_MS = 24 * 60 * 60 * 1000

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fileIcon(label) {
  const l = (label || '').toUpperCase()
  if (l === 'LINK') return <ExternalLink size={16} strokeWidth={1.9} />
  if (l === 'DOC')  return <FileType2 size={16} strokeWidth={1.9} />
  return <FileText size={16} strokeWidth={1.9} /> // PDF / default
}

export default function CatalogPage() {
  const { isOwner, isAdmin } = useAuth()
  const canView = isOwner || isAdmin

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  // CATALOG-2A: KPI filter ('all' | 'recent' | 'featured') and grouped-by-category view.
  const [kpi, setKpi] = useState('all')
  const [grouped, setGrouped] = useState(false)
  // busy = { id, mode } so the right action button on the right row shows progress.
  const [busy, setBusy] = useState(null)
  const [openError, setOpenError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data, error: qErr } = await supabase
        .from('catalog_resources')
        .select(`
          id, slug, title, description, category, resource_type, external_url,
          file_type_label, tags, collection_keys, sort_order, is_featured, is_pinned, updated_at
        `)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('updated_at', { ascending: false })
      if (qErr) throw qErr
      setRows(data || [])
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (canView) load(); else setLoading(false) }, [canView, load])

  // Metric cards — computed from the loaded data (never hardcoded).
  const metrics = useMemo(() => {
    const now = Date.now()
    const categories = new Set(rows.map(r => r.category).filter(Boolean))
    const recent = rows.filter(r => r.updated_at && (now - new Date(r.updated_at).getTime()) <= 30 * DAY_MS)
    const featured = rows.filter(r => r.is_featured)
    return {
      resources: rows.length,
      categories: categories.size,
      recent: recent.length,
      featured: featured.length,
    }
  }, [rows])

  // Search + category + KPI filter, all client-side over the loaded rows (no new query).
  // KPI filters (recent / featured) AND-combine with the category chip and search.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const now = Date.now()
    return rows.filter(r => {
      if (category !== 'all' && r.category !== category) return false
      if (kpi === 'featured' && !r.is_featured) return false
      if (kpi === 'recent' && !(r.updated_at && (now - new Date(r.updated_at).getTime()) <= 30 * DAY_MS)) return false
      if (!q) return true
      const hay = [
        r.title, r.description,
        ...(Array.isArray(r.tags) ? r.tags : []),
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [rows, query, category, kpi])

  // Right-rail derivations.
  const featuredCollections = useMemo(() => {
    const counts = new Map()
    for (const r of rows) {
      for (const k of (Array.isArray(r.collection_keys) ? r.collection_keys : [])) {
        counts.set(k, (counts.get(k) || 0) + 1)
      }
    }
    return [...counts.entries()].map(([key, count]) => ({ key, count }))
  }, [rows])

  const recentUpdates = useMemo(
    () => [...rows].sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0)).slice(0, 5),
    [rows]
  )
  const pinned = useMemo(() => rows.filter(r => r.is_pinned), [rows])

  // Open/Download an internal_file via the server signed-URL endpoint; external_link → navigate.
  // mode is 'open' (inline view) or 'download' (attachment disposition). The client still sends
  // ONLY the slug — the server resolves storage_path and mints a short-lived signed URL that is
  // used immediately and never persisted.
  const accessResource = useCallback(async (r, mode = 'open') => {
    setOpenError(null)
    if (r.resource_type === 'external_link') {
      if (r.external_url) window.open(r.external_url, '_blank', 'noopener,noreferrer')
      return
    }
    // For 'open', pre-open a blank tab synchronously (popup-safe). 'download' uses a transient
    // anchor instead, so no extra tab is opened.
    const pending = mode === 'open' ? window.open('', '_blank') : null
    if (pending) pending.opener = null
    setBusy({ id: r.id, mode })
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        if (pending) pending.close()
        setOpenError('Your session expired. Please sign in again.')
        return
      }
      const res = await fetch('/api/catalog-resource-open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ slug: r.slug, mode }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.signedUrl) {
        if (mode === 'download') {
          // Transient anchor — the server's attachment disposition drives the download.
          const a = document.createElement('a')
          a.href = body.signedUrl
          a.rel = 'noopener'
          a.download = ''
          document.body.appendChild(a)
          a.click()
          a.remove()
        } else if (pending) {
          pending.location = body.signedUrl
        } else {
          window.open(body.signedUrl, '_blank', 'noopener,noreferrer')
        }
      } else {
        if (pending) pending.close()
        const verb = mode === 'download' ? 'download' : 'open'
        setOpenError(body.error ? `Could not ${verb} “${r.title}”: ${body.error}` : `Could not ${verb} “${r.title}”.`)
      }
    } catch {
      if (pending) pending.close()
      setOpenError(`Network error. Please try again.`)
    } finally {
      setBusy(null)
    }
  }, [])

  if (!canView) {
    return (
      <div style={{ padding: '40px 24px', color: '#9ca3af', fontSize: 14, fontFamily: F }}>
        ASPIRE Catalog is available to Owner/Admin only.
      </div>
    )
  }

  return (
    <div style={{ padding: '4px 24px 40px', maxWidth: 1280, margin: '0 auto', fontFamily: F }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#191919', margin: '0 0 4px' }}>ASPIRE Catalog</h1>
        <p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>
          Curated resources, guides, forms, and documents for the ASPIRE Program.
        </p>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 14, maxWidth: 520 }}>
        <Search size={16} strokeWidth={1.9} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by title, description, or tag…"
          aria-label="Search catalog resources"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '10px 12px 10px 36px',
            fontSize: 14, fontFamily: F, color: '#191919',
            border: '1px solid #e2e0d9', borderRadius: 10, background: '#fff', outline: 'none',
          }}
        />
      </div>

      {/* Category chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {CATEGORIES.map(c => {
          const on = category === c.key
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              onClick={() => setCategory(c.key)}
              style={{
                fontSize: 12.5, fontWeight: 600, fontFamily: F, cursor: 'pointer',
                padding: '6px 13px', borderRadius: 999,
                border: `1px solid ${on ? NAVY : '#e2e0d9'}`,
                background: on ? NAVY : '#fff', color: on ? '#fff' : '#4A5560',
                transition: 'all 0.12s',
              }}
            >
              {c.label}
            </button>
          )
        })}
      </div>

      {/* Metric cards — interactive KPI filters (computed counts; client-side filtering). */}
      <div className="stat-cards-row" style={{ marginBottom: 24 }}>
        <KpiCard
          variant="card-nightfall" value={metrics.resources} label="Resources"
          sub="Show all" active={kpi === 'all' && category === 'all' && !grouped && query === ''}
          onClick={() => { setKpi('all'); setCategory('all'); setGrouped(false); setQuery('') }}
        />
        <KpiCard
          variant="card-marina" value={metrics.categories} label="Categories"
          sub={grouped ? 'Grouped' : 'Group view'} active={grouped}
          onClick={() => setGrouped(g => !g)}
        />
        <KpiCard
          variant="card-green" value={metrics.recent} label="Recently Updated"
          sub="Last 30 days" active={kpi === 'recent'}
          onClick={() => setKpi(k => (k === 'recent' ? 'all' : 'recent'))}
        />
        <KpiCard
          variant="card-amber" value={metrics.featured} label="Featured"
          sub="Highlighted" active={kpi === 'featured'}
          onClick={() => setKpi(k => (k === 'featured' ? 'all' : 'featured'))}
        />
      </div>

      {openError && (
        <div style={{
          fontSize: 13, borderRadius: 8, padding: '10px 14px', marginBottom: 16,
          background: '#FEECEC', color: '#991b1b', border: '1px solid #f3c6c6',
        }}>
          {openError}
        </div>
      )}

      {/* Two-column: resource list + right rail */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 22, alignItems: 'start' }}>
        {/* Main: resource list */}
        <div>
          {loading ? (
            <div style={{ padding: '32px 0', color: '#9ca3af', fontSize: 14 }}>Loading catalog…</div>
          ) : error ? (
            <div style={{ padding: '14px 0', color: '#dc2626', fontSize: 14 }}>
              Error loading catalog: {error.message}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '32px 0', color: '#9ca3af', fontSize: 14 }}>
              {rows.length === 0 ? 'No resources yet.' : 'No resources match your filters.'}
            </div>
          ) : grouped ? (
            // Grouped-by-category view (Categories KPI). Category chip + search + KPI still apply
            // via `filtered`; we just section the same filtered rows by category.
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
              {CATEGORIES.filter(c => c.key !== 'all').map(c => {
                const list = filtered.filter(r => r.category === c.key)
                if (list.length === 0) return null
                return (
                  <div key={c.key}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 10 }}>
                      {c.label} <span style={{ color: '#9ca3af', fontWeight: 500 }}>({list.length})</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {list.map(r => (
                        <ResourceRow key={r.id} r={r} busy={busy} onAccess={accessResource} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filtered.map(r => (
                <ResourceRow key={r.id} r={r} busy={busy} onAccess={accessResource} />
              ))}
            </div>
          )}
        </div>

        {/* Right rail — view-only; Manage is an inert placeholder */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <RailCard icon={<Folder size={14} strokeWidth={2} />} title="Featured Collections">
            {featuredCollections.length === 0 ? (
              <RailEmpty>No collections yet.</RailEmpty>
            ) : featuredCollections.map(c => (
              <div key={c.key} style={railRow}>
                <span style={{ color: '#374151', textTransform: 'capitalize' }}>{c.key.replace(/[-_]/g, ' ')}</span>
                <span style={{ color: '#9ca3af', fontWeight: 600 }}>{c.count}</span>
              </div>
            ))}
          </RailCard>

          <RailCard icon={<Clock size={14} strokeWidth={2} />} title="Recent Updates">
            {recentUpdates.length === 0 ? (
              <RailEmpty>Nothing recent.</RailEmpty>
            ) : recentUpdates.map(r => (
              <div key={r.id} style={{ ...railRow, alignItems: 'baseline' }}>
                <span style={{ color: '#374151', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                <span style={{ color: '#9ca3af', flexShrink: 0 }}>{fmtDate(r.updated_at)}</span>
              </div>
            ))}
          </RailCard>

          <RailCard icon={<Pin size={14} strokeWidth={2} />} title="Pinned Resources">
            {pinned.length === 0 ? (
              <RailEmpty>No pinned resources.</RailEmpty>
            ) : pinned.map(r => (
              <div key={r.id} style={railRow}>
                <span style={{ color: '#374151', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
              </div>
            ))}
          </RailCard>
        </aside>
      </div>
    </div>
  )
}

const railRow = {
  display: 'flex', justifyContent: 'space-between', gap: 10,
  fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid #f1efe9',
}

function RailCard({ icon, title, children }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e4dc', borderRadius: 14, boxShadow: '0 1px 3px rgba(25,25,25,0.06)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #f1efe9' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: '#191919' }}>
          <span style={{ color: NAVY }}>{icon}</span>{title}
        </span>
        {/* Inert placeholder — management is not part of CATALOG-1 */}
        <span style={{ fontSize: 11, fontWeight: 600, color: '#c0c4ca', userSelect: 'none' }}>Manage</span>
      </div>
      <div style={{ padding: '6px 16px 12px' }}>{children}</div>
    </div>
  )
}

function RailEmpty({ children }) {
  return <div style={{ fontSize: 12.5, color: '#9ca3af', padding: '6px 0' }}>{children}</div>
}

// Interactive KPI / filter card. Reuses the shared .summary-card + color variant classes;
// active state is shown with an outline ring + aria-pressed + a small "Active" tag (not
// color alone). Rendered as a button for native keyboard support.
function KpiCard({ variant, value, label, sub, active, onClick }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`summary-card ${variant}`}
      style={{
        appearance: 'none', font: 'inherit', textAlign: 'left', cursor: 'pointer',
        outline: active ? `2.5px solid ${NAVY}` : 'none', outlineOffset: 2,
      }}
    >
      <div className="summary-card-value">{value}</div>
      <div className="summary-card-label">{label}</div>
      <div className="summary-card-sub">{active ? '● Active' : sub}</div>
    </button>
  )
}

// One resource row. Open (inline) is primary; Download (attachment) is offered for
// internal_file only. External links show a single "Open external" action. Both internal
// actions route through onAccess(r, mode) → the slug-only signed-URL endpoint.
function ResourceRow({ r, busy, onAccess }) {
  const external = r.resource_type === 'external_link'
  const openBusy = busy?.id === r.id && busy?.mode === 'open'
  const dlBusy = busy?.id === r.id && busy?.mode === 'download'
  const anyBusy = busy?.id === r.id

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 14, padding: '16px 18px',
      background: '#fff', border: '1px solid #e8e4dc', borderRadius: 14,
      boxShadow: '0 1px 3px rgba(25,25,25,0.06)',
    }}>
      {/* Icon */}
      <div style={{
        flexShrink: 0, width: 38, height: 38, borderRadius: 10,
        background: '#EEF1FB', color: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {fileIcon(r.file_type_label)}
      </div>

      {/* Body */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: '#191919' }}>{r.title}</span>
          {r.is_featured && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700, color: '#92400e', background: '#FBF5E8', border: '1px solid #f0e0bd', borderRadius: 999, padding: '1px 7px' }}>
              <Star size={10} strokeWidth={2.2} /> Featured
            </span>
          )}
          {r.is_pinned && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700, color: NAVY, background: '#EEF1FB', border: '1px solid #d7ddf5', borderRadius: 999, padding: '1px 7px' }}>
              <Pin size={10} strokeWidth={2.2} /> Pinned
            </span>
          )}
        </div>
        {r.description && (
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4, lineHeight: 1.5 }}>{r.description}</div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#4A5560', background: '#F4F3F1', borderRadius: 8, padding: '2px 9px' }}>
            {CATEGORY_LABEL[r.category] || r.category}
          </span>
          <span style={{ fontSize: 11.5, color: '#9ca3af' }}>Updated {fmtDate(r.updated_at)}</span>
          {external && (
            <span style={{ fontSize: 11, fontWeight: 600, color: '#92400e' }}>External link</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => onAccess(r, 'open')}
          disabled={anyBusy}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', background: NAVY, color: '#fff', border: 'none',
            borderRadius: 8, fontSize: 12.5, fontWeight: 600, fontFamily: F,
            cursor: anyBusy ? 'default' : 'pointer', opacity: anyBusy ? 0.6 : 1, whiteSpace: 'nowrap',
          }}
        >
          {external ? <>Open external <ExternalLink size={13} strokeWidth={2} /></> : (openBusy ? 'Opening…' : 'Open')}
        </button>
        {!external && (
          <button
            type="button"
            onClick={() => onAccess(r, 'download')}
            disabled={anyBusy}
            aria-label={`Download ${r.title}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 12px', background: '#fff', color: NAVY, border: `1px solid ${NAVY}`,
              borderRadius: 8, fontSize: 12.5, fontWeight: 600, fontFamily: F,
              cursor: anyBusy ? 'default' : 'pointer', opacity: anyBusy ? 0.6 : 1, whiteSpace: 'nowrap',
            }}
          >
            <Download size={13} strokeWidth={2} /> {dlBusy ? 'Preparing…' : 'Download'}
          </button>
        )}
      </div>
    </div>
  )
}
