import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Search, FileText, FileType2, ExternalLink, Star, Pin, Folder, Clock, Download, Plus, X,
  MoreHorizontal, Pencil, Link2, FolderInput, Archive, RotateCcw, Check, ChevronUp, ChevronDown,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { FilterKPICard } from '../KPIBand'
import WorkspaceBackLink from '../ui/WorkspaceBackLink'

// CATALOG-1 - ASPIRE Catalog browse UI. View: Owner/Admin/Interviewer (read).
// Manage (add/edit/move/remove): Owner/Admin only. ASPIRE-CHART corrected the
// stale 'Owner/Admin only' copy - the code has admitted Interviewers as
// readers since the header nav gate (HeaderActions canViewCatalog); RLS and
// the server endpoints remain the real authority on every read and write.
//
// Reads catalog_resources via the user session; the table's Owner/Admin SELECT RLS is the
// gate (a non-Owner/Admin simply sees no rows). Internal files open through the server-side
// /api/catalog-resource-open endpoint (short-lived signed URL, never persisted); external
// links navigate out. No writes, no uploads, no edit/delete - Manage affordances are inert
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
// Upload form uses the stored categories only (no "All").
const UPLOAD_CATEGORIES = CATEGORIES.filter(c => c.key !== 'all')
// Client-side pre-check allowlist (server re-validates authoritatively).
const ALLOWED_EXTS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg']
const MAX_FILE_BYTES = 10 * 1024 * 1024

const DAY_MS = 24 * 60 * 60 * 1000

function fmtDate(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fileIcon(label) {
  const l = (label || '').toUpperCase()
  if (l === 'LINK') return <ExternalLink size={16} strokeWidth={1.9} />
  if (l === 'DOC')  return <FileType2 size={16} strokeWidth={1.9} />
  return <FileText size={16} strokeWidth={1.9} /> // PDF / default
}

export default function CatalogPage({ backPath = '/aggregate', backLabel = 'Aggregate' }) {
  const { isOwner, isAdmin, isInterviewer } = useAuth()
  const canView = isOwner || isAdmin || isInterviewer  // read access (Interviewers included)
  const canManage = isOwner || isAdmin                  // upload / edit / move / feature / pin / remove

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
  // CATALOG-2B: Owner/Admin "Add resource" upload modal state.
  const [showAdd, setShowAdd] = useState(false)
  // CATALOG-2C: sort, soft-removed visibility, metadata edit/remove, deep-link, action feedback.
  const [sortBy, setSortBy] = useState('recent')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState(null)          // resource being edited (metadata)
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [actionMsg, setActionMsg] = useState(null)      // { tone:'ok'|'err', text }
  const [highlightSlug, setHighlightSlug] = useState(null)
  // CATALOG-3: editable categories (display_name + sort_order) from catalog_categories.
  const [cats, setCats] = useState([])
  const [showCats, setShowCats] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      let q = supabase
        .from('catalog_resources')
        .select(`
          id, slug, title, description, category, resource_type, external_url,
          file_type_label, tags, collection_keys, sort_order, is_featured, is_pinned, is_active, updated_at
        `)
      // Default view = active only. "Show removed" includes soft-deactivated rows (Owner/Admin).
      if (!showInactive) q = q.eq('is_active', true)
      const { data, error: qErr } = await q
        .order('sort_order', { ascending: true })
        .order('updated_at', { ascending: false })
      if (qErr) throw qErr
      setRows(data || [])
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [showInactive])

  useEffect(() => { if (canView) load(); else setLoading(false) }, [canView, load])

  // CATALOG-3: load editable categories (read policy allows Owner/Admin/Interviewer).
  const loadCats = useCallback(async () => {
    const { data } = await supabase
      .from('catalog_categories')
      .select('slug, display_name, description, sort_order')
      .order('sort_order', { ascending: true })
    setCats(data || [])
  }, [])
  useEffect(() => { if (canView) loadCats() }, [canView, loadCats])

  // Category label/order derived from catalog_categories, with the static list as a fallback
  // until it loads. Filtering/grouping/selection keep operating on the stable SLUG (c.key).
  const storedCats = useMemo(
    () => (cats.length ? cats.map(c => ({ key: c.slug, label: c.display_name })) : UPLOAD_CATEGORIES),
    [cats]
  )
  const chipCats = useMemo(() => [{ key: 'all', label: 'All' }, ...storedCats], [storedCats])
  const catLabelMap = useMemo(() => {
    const m = { ...CATEGORY_LABEL }
    for (const c of cats) m[c.slug] = c.display_name
    return m
  }, [cats])
  const catLabel = useCallback((slug) => catLabelMap[slug] || slug, [catLabelMap])

  // Deep-link: /catalog?resource=<slug> highlights + scrolls to that resource (no file access).
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('resource')
    if (slug) setHighlightSlug(slug)
  }, [])

  // Active (non-deactivated) rows drive the metrics and right rail, regardless of "Show removed".
  const activeRows = useMemo(() => rows.filter(r => r.is_active !== false), [rows])

  // Metric cards - computed from the active data (never hardcoded).
  const metrics = useMemo(() => {
    const now = Date.now()
    const categories = new Set(activeRows.map(r => r.category).filter(Boolean))
    const recent = activeRows.filter(r => r.updated_at && (now - new Date(r.updated_at).getTime()) <= 30 * DAY_MS)
    const featured = activeRows.filter(r => r.is_featured)
    return {
      resources: activeRows.length,
      categories: categories.size,
      recent: recent.length,
      featured: featured.length,
    }
  }, [activeRows])

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

  // Right-rail derivations (active resources only).
  const featuredCollections = useMemo(() => {
    const counts = new Map()
    for (const r of activeRows) {
      for (const k of (Array.isArray(r.collection_keys) ? r.collection_keys : [])) {
        counts.set(k, (counts.get(k) || 0) + 1)
      }
    }
    return [...counts.entries()].map(([key, count]) => ({ key, count }))
  }, [activeRows])

  const recentUpdates = useMemo(
    () => [...activeRows].sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0)).slice(0, 5),
    [activeRows]
  )
  const pinned = useMemo(() => activeRows.filter(r => r.is_pinned), [activeRows])

  // Client-side sort over the filtered set (no query/schema change).
  const sorted = useMemo(() => {
    const arr = [...filtered]
    switch (sortBy) {
      case 'title':
        arr.sort((a, b) => (a.title || '').localeCompare(b.title || '')); break
      case 'category':
        arr.sort((a, b) =>
          (catLabel(a.category) || '').localeCompare(catLabel(b.category) || '')
          || (a.title || '').localeCompare(b.title || '')); break
      case 'featured':
        arr.sort((a, b) => (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0)); break
      case 'pinned':
        arr.sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0)); break
      case 'recent':
      default:
        arr.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0)); break
    }
    return arr
  }, [filtered, sortBy, catLabel])

  // After data is ready, scroll a deep-linked resource into view.
  useEffect(() => {
    if (!highlightSlug || loading) return
    const el = document.getElementById(`catalog-res-${highlightSlug}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightSlug, loading, sorted])

  // Open/Download an internal_file via the server signed-URL endpoint; external_link → navigate.
  // mode is 'open' (inline view) or 'download' (attachment disposition). The client still sends
  // ONLY the slug - the server resolves storage_path and mints a short-lived signed URL that is
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
          // Transient anchor - the server's attachment disposition drives the download.
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

  // CATALOG-2C - metadata-only update via the server-verified endpoint (strict whitelist).
  // Used by edit, move-to-category, feature/pin toggles, soft-remove, and reactivate. No
  // Storage operation is ever involved; the server updates metadata columns only.
  const runUpdate = useCallback(async (id, patch, okText) => {
    setActionMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setActionMsg({ tone: 'err', text: 'Your session expired. Please sign in again.' }); return false }
      const res = await fetch('/api/catalog-resource-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ id, ...patch }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.resource) { setActionMsg({ tone: 'ok', text: okText }); await load(); return true }
      setActionMsg({ tone: 'err', text: body.error || 'Update failed.' }); return false
    } catch {
      setActionMsg({ tone: 'err', text: 'Network error. Please try again.' }); return false
    }
  }, [load])

  const copyLink = useCallback(async (r) => {
    // Internal slug-link only - NOT a signed/file URL. Opening it still requires auth + Owner/Admin.
    const link = `${window.location.origin}/catalog?resource=${encodeURIComponent(r.slug)}`
    try {
      await navigator.clipboard.writeText(link)
      setActionMsg({ tone: 'ok', text: 'Catalog link copied.' })
    } catch {
      setActionMsg({ tone: 'err', text: `Copy failed. Link: ${link}` })
    }
  }, [])

  // Bundle of metadata actions handed to each row's "…" menu.
  const rowActions = useMemo(() => ({
    onEdit: (r) => { setActionMsg(null); setEditing(r) },
    onMove: (r, cat) => runUpdate(r.id, { category: cat }, `Moved to ${catLabel(cat)}.`),
    onCopyLink: copyLink,
    onToggleFeatured: (r) => runUpdate(r.id, { is_featured: !r.is_featured }, r.is_featured ? 'Unfeatured.' : 'Featured.'),
    onTogglePinned: (r) => runUpdate(r.id, { is_pinned: !r.is_pinned }, r.is_pinned ? 'Unpinned.' : 'Pinned.'),
    onRemove: (r) => { setActionMsg(null); setConfirmRemove(r) },
    onReactivate: (r) => runUpdate(r.id, { is_active: true }, 'Resource restored.'),
  }), [runUpdate, copyLink, catLabel])

  if (!canView) {
    return (
      <div style={{ padding: '40px 24px', color: '#9ca3af', fontSize: 14, fontFamily: F }}>
        The ASPIRE Catalog is available to Owner, Admin, and Interviewer accounts.
      </div>
    )
  }

  return (
    <div style={{ padding: '4px 20px 40px', fontFamily: F }}>
      {/* Return control - on the page background, no utility bar. */}
      <div style={{ marginBottom: 12 }}>
        <WorkspaceBackLink path={backPath} label={backLabel} />
      </div>
      {/* Header */}
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#191919', margin: '0 0 4px' }}>ASPIRE Catalog</h1>
          <p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>
            Curated resources, guides, forms, and documents for ASPIRE.
          </p>
        </div>
        {/* Owner/Admin only - the upload/category endpoints re-verify server-side. */}
        {canManage && (
          <div style={{ display: 'flex', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setShowCats(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '9px 14px', background: '#fff', color: NAVY, border: `1px solid ${NAVY}`,
                borderRadius: 9, fontSize: 13, fontWeight: 600, fontFamily: F, cursor: 'pointer',
              }}
            >
              <FolderInput size={15} strokeWidth={2} /> Manage categories
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '9px 16px', background: NAVY, color: '#fff', border: 'none',
                borderRadius: 9, fontSize: 13, fontWeight: 600, fontFamily: F, cursor: 'pointer',
              }}
            >
              <Plus size={15} strokeWidth={2.2} /> Add resource
            </button>
          </div>
        )}
      </div>

      {showAdd && (
        <AddResourceModal
          categories={storedCats}
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); load() }}
        />
      )}

      {showCats && (
        <ManageCategoriesModal
          cats={cats}
          onClose={() => setShowCats(false)}
          onSaved={() => { loadCats() }}
          setActionMsg={setActionMsg}
        />
      )}

      {editing && (
        <EditResourceModal
          resource={editing}
          categories={storedCats}
          onClose={() => setEditing(null)}
          onSaved={async (patch) => {
            const ok = await runUpdate(editing.id, patch, 'Resource updated.')
            if (ok) setEditing(null)
          }}
        />
      )}

      {confirmRemove && (
        <RemoveConfirmDialog
          resource={confirmRemove}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={async () => {
            const ok = await runUpdate(confirmRemove.id, { is_active: false }, 'Removed from catalog (reversible via “Show removed”).')
            if (ok) setConfirmRemove(null)
          }}
        />
      )}

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
        {chipCats.map(c => {
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

      {/* Metric cards - interactive KPI filters. Reuses the shared FilterKPICard so the
          hover lift / shadow / active treatment matches Student Profiles exactly. Counts are
          computed from loaded data; filtering stays client-side. */}
      <div className="stat-cards-row" style={{ marginBottom: 24 }}>
        <FilterKPICard
          accent="nightfall" value={metrics.resources} label="Resources" sub="Show all"
          active={kpi === 'all' && category === 'all' && !grouped && query === ''}
          onClick={() => { setKpi('all'); setCategory('all'); setGrouped(false); setQuery('') }}
        />
        <FilterKPICard
          accent="marina" value={metrics.categories} label="Categories"
          sub={grouped ? 'Grouped' : 'Group view'} active={grouped}
          onClick={() => setGrouped(g => !g)}
        />
        <FilterKPICard
          accent="sage" value={metrics.recent} label="Recently Updated" sub="Last 30 days"
          active={kpi === 'recent'}
          onClick={() => setKpi(k => (k === 'recent' ? 'all' : 'recent'))}
        />
        <FilterKPICard
          accent="dawn" value={metrics.featured} label="Featured" sub="Highlighted"
          active={kpi === 'featured'}
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

      {actionMsg && (
        <div style={{
          fontSize: 13, borderRadius: 8, padding: '10px 14px', marginBottom: 16,
          background: actionMsg.tone === 'ok' ? '#EDF7F0' : '#FEECEC',
          color: actionMsg.tone === 'ok' ? '#166534' : '#991b1b',
          border: `1px solid ${actionMsg.tone === 'ok' ? '#c6e7d0' : '#f3c6c6'}`,
        }}>
          {actionMsg.text}
        </div>
      )}

      {/* Toolbar: sort + show-removed (Owner/Admin). Sort is client-side over loaded rows. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#4A5560' }}>
          Sort
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            style={{
              fontSize: 12.5, fontFamily: F, color: '#191919', cursor: 'pointer',
              border: '1px solid #e2e0d9', borderRadius: 8, background: '#fff', padding: '6px 9px',
            }}
          >
            <option value="recent">Most Recent</option>
            <option value="title">Title A–Z</option>
            <option value="category">Category</option>
            <option value="featured">Featured first</option>
            <option value="pinned">Pinned first</option>
          </select>
        </label>
        {canManage && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#4A5560', cursor: 'pointer' }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Show removed
          </label>
        )}
      </div>

      {/* Two-column: resource list + right rail. LAYOUT-SHELL-CONSISTENCY-1/1B: main list takes the
          flexible width; the supporting sidebar uses a bounded responsive range on desktop and stacks
          below the list at <=1024px (see .catalog-content-grid in index.css). */}
      <div className="catalog-content-grid">
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
            // Grouped-by-category view (Categories KPI). Category chip + search + KPI + sort still
            // apply via `sorted`; we just section the same rows by category.
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
              {storedCats.map(c => {
                const list = sorted.filter(r => r.category === c.key)
                if (list.length === 0) return null
                return (
                  <div key={c.key}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 10 }}>
                      {c.label} <span style={{ color: '#9ca3af', fontWeight: 500 }}>({list.length})</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {list.map(r => (
                        <ResourceRow key={r.id} r={r} busy={busy} onAccess={accessResource} actions={rowActions} canManage={canManage} categories={storedCats} catLabel={catLabel} highlight={r.slug === highlightSlug} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {sorted.map(r => (
                <ResourceRow key={r.id} r={r} busy={busy} onAccess={accessResource} actions={rowActions} canManage={canManage} categories={storedCats} catLabel={catLabel} highlight={r.slug === highlightSlug} />
              ))}
            </div>
          )}
        </div>

        {/* Right rail - view-only; Manage is an inert placeholder */}
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
        {/* ASPIRE-CHART: the inert 'Manage' label is gone - a control that
            does nothing is a broken promise, not an affordance. */}
      </div>
      <div style={{ padding: '6px 16px 12px' }}>{children}</div>
    </div>
  )
}

function RailEmpty({ children }) {
  return <div style={{ fontSize: 12.5, color: '#9ca3af', padding: '6px 0' }}>{children}</div>
}

// CATALOG-2B - Owner/Admin "Add resource" modal. Uploads a NEW internal_file via the
// signed-upload-URL flow: (1) POST phase 'sign' to get a one-time per-path token, (2) PUT the
// bytes straight to Supabase via uploadToSignedUrl, (3) POST phase 'commit' so the server
// verifies the object and inserts the row. The client never holds a broad Storage credential
// and never writes catalog_resources directly.
function AddResourceModal({ categories = UPLOAD_CATEGORIES, onClose, onCreated }) {
  const [file, setFile] = useState(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(categories[0].key)
  const [tagsStr, setTagsStr] = useState('')
  const [isFeatured, setIsFeatured] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState(null)

  const fieldStyle = {
    width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 13.5, fontFamily: F,
    color: '#191919', border: '1px solid #e2e0d9', borderRadius: 8, background: '#fff', outline: 'none',
  }
  const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: '#4A5560', marginBottom: 5 }

  async function submit() {
    setErr(null)
    if (!file) { setErr('Choose a file to upload.'); return }
    if (!title.trim()) { setErr('Title is required.'); return }
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    if (!ALLOWED_EXTS.includes(ext)) { setErr(`Unsupported file type “.${ext}”. Allowed: ${ALLOWED_EXTS.join(', ')}.`); return }
    if (file.size > MAX_FILE_BYTES) { setErr('File exceeds the 10 MB limit.'); return }

    const meta = {
      title: title.trim(),
      description: description.trim(),
      category,
      filename: file.name,
      tags: tagsStr.split(',').map(t => t.trim()).filter(Boolean),
      is_featured: isFeatured,
      is_pinned: isPinned,
    }

    setUploading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { setErr('Your session expired. Please sign in again.'); return }
      const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }

      // 1) sign
      const signRes = await fetch('/api/catalog-resource-upload', {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ phase: 'sign', ...meta, size: file.size }),
      })
      const sign = await signRes.json().catch(() => ({}))
      if (!signRes.ok) { setErr(sign.error || 'Could not start the upload.'); return }

      // 2) upload bytes directly to Supabase Storage via the one-time token
      const up = await supabase.storage.from('aspire-catalog')
        .uploadToSignedUrl(sign.path, sign.token, file, { contentType: file.type || undefined })
      if (up.error) { setErr(`File upload failed: ${up.error.message}`); return }

      // 3) commit - server verifies the object and inserts the row
      const commitRes = await fetch('/api/catalog-resource-upload', {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ phase: 'commit', ...meta }),
      })
      const commit = await commitRes.json().catch(() => ({}))
      if (!commitRes.ok) { setErr(commit.error || 'Could not save the resource.'); return }

      onCreated()
    } catch {
      setErr('Network error. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={() => !uploading && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        style={{ maxWidth: 520, fontFamily: F }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1D2567', fontFamily: F }}>Add resource</h2>
          <button type="button" onClick={() => !uploading && onClose()} aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', padding: 4 }}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>File <span style={{ color: '#9ca3af', fontWeight: 400 }}>(PDF, DOC, PPT, XLS, or image · max 10 MB)</span></label>
            <input type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg,.jpeg"
              onChange={e => setFile(e.target.files?.[0] || null)} style={{ fontSize: 13, fontFamily: F }} />
          </div>
          <div>
            <label style={labelStyle}>Title</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Pre-licensure Student General Guidelines" style={fieldStyle} />
          </div>
          <div>
            <label style={labelStyle}>Description <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ ...fieldStyle, resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={labelStyle}>Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer' }}>
                {categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={labelStyle}>Tags <span style={{ color: '#9ca3af', fontWeight: 400 }}>(comma-separated)</span></label>
              <input type="text" value={tagsStr} onChange={e => setTagsStr(e.target.value)} placeholder="guidelines, onboarding" style={fieldStyle} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 18 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
              <input type="checkbox" checked={isFeatured} onChange={e => setIsFeatured(e.target.checked)} /> Featured
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
              <input type="checkbox" checked={isPinned} onChange={e => setIsPinned(e.target.checked)} /> Pinned
            </label>
          </div>

          {err && (
            <div style={{ fontSize: 12.5, borderRadius: 8, padding: '9px 12px', background: '#FEECEC', color: '#991b1b', border: '1px solid #f3c6c6' }}>
              {err}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn-outline-modal" onClick={() => !uploading && onClose()} disabled={uploading}>Cancel</button>
          <button
            type="button"
            onClick={submit}
            disabled={uploading}
            style={{
              padding: '9px 18px', background: NAVY, color: '#fff', border: 'none', borderRadius: 8,
              fontSize: 13, fontWeight: 600, fontFamily: F, cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1,
            }}
          >
            {uploading ? 'Uploading…' : 'Upload resource'}
          </button>
        </div>
      </div>
    </div>
  )
}

// One resource row. Open (inline) is primary; Download (attachment) is offered for
// internal_file only. External links show a single "Open external" action. Both internal
// actions route through onAccess(r, mode) → the slug-only signed-URL endpoint.
function ResourceRow({ r, busy, onAccess, actions, canManage, categories, catLabel, highlight }) {
  const external = r.resource_type === 'external_link'
  const openBusy = busy?.id === r.id && busy?.mode === 'open'
  const dlBusy = busy?.id === r.id && busy?.mode === 'download'
  const anyBusy = busy?.id === r.id
  const inactive = r.is_active === false

  return (
    <div
      id={`catalog-res-${r.slug}`}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 14, padding: '16px 18px',
        background: inactive ? '#faf9f7' : '#fff',
        border: `1px solid ${highlight ? NAVY : '#e8e4dc'}`, borderRadius: 14,
        boxShadow: highlight ? `0 0 0 2px rgba(29,37,103,0.30)` : '0 1px 3px rgba(25,25,25,0.06)',
        opacity: inactive ? 0.72 : 1,
      }}
    >
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
          {inactive && (
            <span style={{ fontSize: 10.5, fontWeight: 700, color: '#991b1b', background: '#FEECEC', border: '1px solid #f3c6c6', borderRadius: 999, padding: '1px 7px' }}>
              Removed
            </span>
          )}
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
            {catLabel ? catLabel(r.category) : (CATEGORY_LABEL[r.category] || r.category)}
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
        {actions && <RowMenu r={r} external={external} inactive={inactive} onAccess={onAccess} actions={actions} canManage={canManage} categories={categories} />}
      </div>
    </div>
  )
}

// Row "…" action menu (Owner/Admin). Metadata-only actions + Open/Download/Copy-link. NO
// rename-storage, hard-delete, or broad-share entries. Closes on outside click / Escape.
function RowMenu({ r, external, inactive, onAccess, actions, canManage, categories = UPLOAD_CATEGORIES }) {
  const [open, setOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setMoveOpen(false) } }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setMoveOpen(false) } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const close = () => { setOpen(false); setMoveOpen(false) }
  const run = (fn) => { close(); fn() }

  const itemStyle = {
    display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
    padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 12.5, fontFamily: F, color: '#374151', whiteSpace: 'nowrap',
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32,
          background: open ? '#f1efe9' : '#fff', color: '#6b7280', border: '1px solid #e2e0d9',
          borderRadius: 8, cursor: 'pointer',
        }}
      >
        <MoreHorizontal size={16} strokeWidth={2} />
      </button>

      {open && (
        <div role="menu" style={{
          position: 'absolute', top: '110%', right: 0, zIndex: 20, minWidth: 200,
          background: '#fff', border: '1px solid #e8e4dc', borderRadius: 12,
          boxShadow: '0 8px 24px rgba(25,25,25,0.14)', overflow: 'hidden', padding: '4px 0',
        }}>
          <button type="button" style={itemStyle} onClick={() => run(() => onAccess(r, 'open'))}>
            {external ? <ExternalLink size={14} /> : <FileText size={14} />} {external ? 'Open external' : 'Open'}
          </button>
          {!external && (
            <button type="button" style={itemStyle} onClick={() => run(() => onAccess(r, 'download'))}>
              <Download size={14} /> Download
            </button>
          )}
          <button type="button" style={itemStyle} onClick={() => run(() => actions.onCopyLink(r))}>
            <Link2 size={14} /> Copy link
          </button>

          {/* Management actions - Owner/Admin only. Interviewers see read actions above only. */}
          {canManage && <div style={{ height: 1, background: '#f1efe9', margin: '4px 0' }} />}

          {canManage && (inactive ? (
            <button type="button" style={{ ...itemStyle, color: '#166534', fontWeight: 600 }} onClick={() => run(() => actions.onReactivate(r))}>
              <RotateCcw size={14} /> Reactivate
            </button>
          ) : (
            <>
              <button type="button" style={itemStyle} onClick={() => run(() => actions.onEdit(r))}>
                <Pencil size={14} /> Edit details
              </button>

              {/* Move to category - metadata-only category-field change (file never moves). */}
              <button type="button" style={itemStyle} onClick={() => setMoveOpen(o => !o)} aria-expanded={moveOpen}>
                <FolderInput size={14} /> Move to category
              </button>
              {moveOpen && (
                <div style={{ padding: '2px 0 2px 0', background: '#faf9f7' }}>
                  {categories.map(c => (
                    <button key={c.key} type="button"
                      style={{ ...itemStyle, padding: '7px 12px 7px 34px', color: c.key === r.category ? NAVY : '#374151', fontWeight: c.key === r.category ? 700 : 400 }}
                      onClick={() => run(() => actions.onMove(r, c.key))}>
                      {c.key === r.category && <Check size={13} />} {c.label}
                    </button>
                  ))}
                </div>
              )}

              <button type="button" style={itemStyle} onClick={() => run(() => actions.onToggleFeatured(r))}>
                <Star size={14} /> {r.is_featured ? 'Unfeature' : 'Feature'}
              </button>
              <button type="button" style={itemStyle} onClick={() => run(() => actions.onTogglePinned(r))}>
                <Pin size={14} /> {r.is_pinned ? 'Unpin' : 'Pin'}
              </button>

              <div style={{ height: 1, background: '#f1efe9', margin: '4px 0' }} />

              <button type="button" style={{ ...itemStyle, color: '#991b1b' }} onClick={() => run(() => actions.onRemove(r))}>
                <Archive size={14} /> Remove from catalog
              </button>
            </>
          ))}
        </div>
      )}
    </div>
  )
}

// CATALOG-2C - Edit details (metadata only). Sends only title/description/category/tags/
// featured/pinned to the strict-whitelist endpoint. Slug, storage_path, and the file are never
// touched (copied links stay stable; the file stays at its original key).
function EditResourceModal({ resource, categories = UPLOAD_CATEGORIES, onClose, onSaved }) {
  const [title, setTitle] = useState(resource.title || '')
  const [description, setDescription] = useState(resource.description || '')
  const [category, setCategory] = useState(resource.category || categories[0].key)
  const [tagsStr, setTagsStr] = useState(Array.isArray(resource.tags) ? resource.tags.join(', ') : '')
  const [isFeatured, setIsFeatured] = useState(!!resource.is_featured)
  const [isPinned, setIsPinned] = useState(!!resource.is_pinned)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const fieldStyle = {
    width: '100%', boxSizing: 'border-box', padding: '9px 11px', fontSize: 13.5, fontFamily: F,
    color: '#191919', border: '1px solid #e2e0d9', borderRadius: 8, background: '#fff', outline: 'none',
  }
  const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: '#4A5560', marginBottom: 5 }

  async function save() {
    setErr(null)
    if (!title.trim()) { setErr('Title is required.'); return }
    setSaving(true)
    try {
      await onSaved({
        title: title.trim(),
        description: description.trim(),
        category,
        tags: tagsStr.split(',').map(t => t.trim()).filter(Boolean),
        is_featured: isFeatured,
        is_pinned: isPinned,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={() => !saving && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 520, fontFamily: F }} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1D2567', fontFamily: F }}>Edit details</h2>
          <button type="button" onClick={() => !saving && onClose()} aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', padding: 4 }}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Title</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} style={fieldStyle} />
          </div>
          <div>
            <label style={labelStyle}>Description <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ ...fieldStyle, resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px' }}>
              <label style={labelStyle}>Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer' }}>
                {categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <label style={labelStyle}>Tags <span style={{ color: '#9ca3af', fontWeight: 400 }}>(comma-separated)</span></label>
              <input type="text" value={tagsStr} onChange={e => setTagsStr(e.target.value)} style={fieldStyle} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 18 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
              <input type="checkbox" checked={isFeatured} onChange={e => setIsFeatured(e.target.checked)} /> Featured
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
              <input type="checkbox" checked={isPinned} onChange={e => setIsPinned(e.target.checked)} /> Pinned
            </label>
          </div>
          <div style={{ fontSize: 11.5, color: '#9ca3af' }}>
            The file and its link stay the same, only these details change.
          </div>
          {err && (
            <div style={{ fontSize: 12.5, borderRadius: 8, padding: '9px 12px', background: '#FEECEC', color: '#991b1b', border: '1px solid #f3c6c6' }}>
              {err}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn-outline-modal" onClick={() => !saving && onClose()} disabled={saving}>Cancel</button>
          <button type="button" onClick={save} disabled={saving}
            style={{ padding: '9px 18px', background: NAVY, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, fontFamily: F, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// CATALOG-2C - Soft-remove confirmation. Sets is_active=false (reversible); never deletes the
// row and never touches Storage.
function RemoveConfirmDialog({ resource, onCancel, onConfirm }) {
  const [working, setWorking] = useState(false)
  return (
    <div className="modal-overlay" onMouseDown={() => !working && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 440, fontFamily: F }} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1D2567', fontFamily: F }}>Remove from catalog?</h2>
        </div>
        <div style={{ padding: '16px 20px', fontSize: 13.5, color: '#374151', lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 10px' }}>
            <strong>{resource.title}</strong> will be hidden from the catalog. The file is <strong>not</strong> deleted
            and this is reversible, turn on <strong>Show removed</strong> to restore it.
          </p>
        </div>
        <div className="modal-footer" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn-outline-modal" onClick={() => !working && onCancel()} disabled={working}>Cancel</button>
          <button type="button" onClick={async () => { setWorking(true); try { await onConfirm() } finally { setWorking(false) } }} disabled={working}
            style={{ padding: '9px 18px', background: '#991b1b', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, fontFamily: F, cursor: working ? 'default' : 'pointer', opacity: working ? 0.6 : 1 }}>
            {working ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>
    </div>
  )
}

// CATALOG-3 - Manage Categories (Owner/Admin). Rename display_name (+ optional description) and
// reorder via up/down. Saves through the server endpoint: renames as per-category metadata
// updates, reorder as ONE coherent write of the full ordered slug list. NO Add, NO Archive, NO
// slug editing - slug is shown read-only as the stable anchor. No resource row or Storage touch.
function ManageCategoriesModal({ cats, onClose, onSaved, setActionMsg }) {
  const [draft, setDraft] = useState(() => cats.map(c => ({
    slug: c.slug, display_name: c.display_name || '', description: c.description || '',
  })))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const move = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= draft.length) return
    const next = draft.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    setDraft(next)
  }
  const setField = (i, field, val) => {
    const next = draft.slice()
    next[i] = { ...next[i], [field]: val }
    setDraft(next)
  }

  async function post(body) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Your session expired. Please sign in again.')
    const res = await fetch('/api/catalog-category-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || 'Save failed.')
    return json
  }

  async function save() {
    setErr(null)
    if (draft.some(d => !d.display_name.trim())) { setErr('Display name is required for every category.'); return }
    const origBySlug = Object.fromEntries(cats.map(c => [c.slug, c]))
    setSaving(true)
    try {
      // 1) Renames (display_name / description changes) - per-category metadata updates.
      for (const d of draft) {
        const o = origBySlug[d.slug] || {}
        const dn = d.display_name.trim()
        const desc = d.description.trim()
        if (dn !== (o.display_name || '') || desc !== (o.description || '')) {
          await post({ action: 'rename', slug: d.slug, display_name: dn, description: desc })
        }
      }
      // 2) Reorder - one coherent write of the full ordered slug list (only if order changed).
      const newOrder = draft.map(d => d.slug)
      const oldOrder = cats.map(c => c.slug)
      if (JSON.stringify(newOrder) !== JSON.stringify(oldOrder)) {
        await post({ action: 'reorder', order: newOrder })
      }
      setActionMsg?.({ tone: 'ok', text: 'Categories updated.' })
      onSaved()
      onClose()
    } catch (e) {
      setErr(e.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = {
    flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '7px 10px', fontSize: 13, fontFamily: F,
    color: '#191919', border: '1px solid #e2e0d9', borderRadius: 8, background: '#fff', outline: 'none',
  }
  const arrowBtn = (disabled) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 22,
    background: '#fff', color: disabled ? '#cbd0d6' : '#4A5560', border: '1px solid #e2e0d9',
    borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
  })

  return (
    <div className="modal-overlay" onMouseDown={() => !saving && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 580, fontFamily: F }} onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#1D2567', fontFamily: F }}>Manage categories</h2>
          <button type="button" onClick={() => !saving && onClose()} aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', display: 'flex', padding: 4 }}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 2 }}>
            Rename display names and reorder. Category IDs (slugs) are fixed, so existing resources and links keep working.
          </div>
          {draft.map((d, i) => (
            <div key={d.slug} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: '#faf9f7', border: '1px solid #eee7da', borderRadius: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} style={arrowBtn(i === 0)}>
                  <ChevronUp size={14} strokeWidth={2.2} />
                </button>
                <button type="button" aria-label="Move down" disabled={i === draft.length - 1} onClick={() => move(i, 1)} style={arrowBtn(i === draft.length - 1)}>
                  <ChevronDown size={14} strokeWidth={2.2} />
                </button>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input type="text" value={d.display_name} onChange={e => setField(i, 'display_name', e.target.value)}
                  aria-label={`Display name for ${d.slug}`} placeholder="Display name" style={inputStyle} />
                <input type="text" value={d.description} onChange={e => setField(i, 'description', e.target.value)}
                  aria-label={`Description for ${d.slug}`} placeholder="Description (optional)" style={{ ...inputStyle, fontSize: 12, color: '#6b7280' }} />
              </div>
              <span style={{ flexShrink: 0, fontSize: 10.5, color: '#9ca3af', fontFamily: 'monospace' }}>{d.slug}</span>
            </div>
          ))}

          {err && (
            <div style={{ fontSize: 12.5, borderRadius: 8, padding: '9px 12px', background: '#FEECEC', color: '#991b1b', border: '1px solid #f3c6c6' }}>
              {err}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn-outline-modal" onClick={() => !saving && onClose()} disabled={saving}>Cancel</button>
          <button type="button" onClick={save} disabled={saving}
            style={{ padding: '9px 18px', background: NAVY, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, fontFamily: F, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save categories'}
          </button>
        </div>
      </div>
    </div>
  )
}
