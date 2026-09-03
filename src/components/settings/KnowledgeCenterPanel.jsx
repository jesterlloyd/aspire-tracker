// KT-3a-2a: Settings → Knowledge Center - Owner/Admin INPUT enabled.
// Builds on the KT-3a-1 read-only shell + UI-1 primitives (SurfaceCard, Toolbar,
// Button, DataTable, StateBadge). This phase makes the panel usable for authoring:
// the New Entry button opens a create drawer, clicking a row opens a detail
// drawer (read-only view), and draft entries can be edited - all via
// KnowledgeEntryDrawer, which talks only to the existing api/knowledge-admin.js
// actions (list_entries, get_entry, create_entry_draft, update_entry_draft). No
// lifecycle/version-history controls here; non-draft entries remain read-only.
//
// Owner/Admin only (registry-hidden otherwise + defensive guard here; the backend
// is the real authority). All search/filtering is client-side. Only draft, active,
// deprecated, and archived are valid lifecycle states.
//
// SETTINGS-UNIFIED-DESIGN-1: the passive MetricCard summary row and the redundant
// FilterChip state-chips row are unified into a single row of clickable
// FilterKPICard cards (the same interactive filter primitive used on Student
// Profiles / Interview Room / Accounts & Access) - one state-filtering surface
// instead of two that did the same job.
//
// KNOWLEDGE-VAULT-1 evolves this panel into the vault index: a "Needs review"
// card and column (expiry and review dates are REPORTED here, never enforced in
// retrieval), tag filtering, alias/tag-aware search, a Markdown badge, and
// Obsidian-compatible Markdown import/export. Every existing route, action,
// permission and governance rule is unchanged; the plan of record is
// docs/product/KEITH_SKILLS_KNOWLEDGE_VAULT_PLAN.md Section 2.3.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { FileText, Search, Plus, Download, Upload, Sparkles } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import EmptyState from '../EmptyState'
import StateBadge from './StateBadge'
import SettingsPageHeader from './SettingsPageHeader'
import KnowledgeEntryDrawer from './KnowledgeEntryDrawer'
import KnowledgeGraphView from './KnowledgeGraphView'
import KnowledgeEnrichmentPanel from './KnowledgeEnrichmentPanel'
import SegmentedTabs from '../ui/SegmentedTabs'
import { KNOWLEDGE_STATES, CATEGORY_LABELS, CATEGORY_KEYS, fmtDate } from './knowledgeCategories'
import SurfaceCard from '../ui/SurfaceCard'
import Toolbar from '../ui/Toolbar'
import Button from '../ui/Button'
import DataTable from '../ui/DataTable'
import { FilterKPICard } from '../KPIBand'

const STATES = KNOWLEDGE_STATES
// SETTINGS-UNIFIED-DESIGN-1: accent per state, plus the "All" card first.
const STATE_CARD_ACCENTS = { draft: 'dawn', active: 'sage', deprecated: 'lavender', archived: 'marina' }
// KNOWLEDGE-VAULT-1 appends "Needs review": entries past their review_date or
// past expires_at. This is a REVIEW SIGNAL, not a retrieval filter - an expired
// entry still answers in Keith exactly as it did before. Surfacing it is what
// makes a later decision to start excluding expired entries evidence-based.
const STATE_CARDS = [
  { key: 'all', accent: 'nightfall' },
  ...STATES.map(s => ({ key: s, accent: STATE_CARD_ACCENTS[s] })),
  { key: 'review', accent: 'dawn' },
]
const CARD_LABELS = { review: 'Needs review' }
const CARD_SUBS = { review: 'Past review or expiry' }
const cardLabel = (key) => CARD_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1)

// Authenticated POST helper for the knowledge-admin endpoint (the backend authorizes
// every action server-side regardless of client gating).
async function postAdmin(payload) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch('/api/knowledge-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  })
  return res
}

// Entries table columns (DataTable) - identical cells to the KT-3a-1 table.
const ENTRY_COLUMNS = [
  {
    key: 'title',
    label: 'Title',
    render: e => (
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {e.title || 'Untitled'}
          {/* Markdown is marked by a small text badge, not by an icon alone,
              so the format is legible without relying on iconography. */}
          {e.body_format === 'markdown' && (
            <span title="Markdown" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3, padding: '1px 5px', borderRadius: 4, background: 'var(--color-bg-elevated, #eef2fb)', color: 'var(--color-accent-primary, #1D2567)' }}>MD</span>
          )}
        </div>
        {(e.tags?.length > 0) && (
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #9ca3af)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
            {e.tags.map(t => `#${t}`).join(' ')}
          </div>
        )}
      </div>
    ),
  },
  { key: 'category', label: 'Category', cellStyle: { color: 'var(--color-text-secondary, #6b7280)' }, render: e => CATEGORY_LABELS[e.category] || e.category },
  { key: 'state',    label: 'State',    render: e => <StateBadge state={e.state} /> },
  {
    key: 'review',
    label: 'Review',
    render: e => (
      e.expired
        ? <span style={{ fontSize: 11.5, fontWeight: 600, color: '#b45309' }} title={`Expired ${fmtDate(e.expires_at)}`}>Expired</span>
        : e.due_for_review
          ? <span style={{ fontSize: 11.5, fontWeight: 600, color: '#b45309' }} title={`Review due ${fmtDate(e.review_date)}`}>Due</span>
          : <span style={{ color: 'var(--color-text-secondary, #d1d5db)' }}>–</span>
    ),
  },
  { key: 'version',  label: 'Version',  align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums' }, render: e => e.current_version },
  { key: 'updated',  label: 'Updated',  align: 'right', cellStyle: { color: 'var(--color-text-secondary, #6b7280)', whiteSpace: 'nowrap' }, render: e => fmtDate(e.updated_at) },
]

const selectStyle = {
  padding: '8px 10px', borderRadius: 9,
  border: '1px solid var(--color-border-default, #e5e7eb)',
  background: 'var(--color-bg-surface, #ffffff)', color: 'var(--color-text-primary, #191919)',
  fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, cursor: 'pointer',
}

export default function KnowledgeCenterPanel() {
  const { isAdmin, isOwner } = useAuth() // owner/admin; registry hides this section otherwise
  const fileRef = useRef(null)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState('all')
  // KNOWLEDGE-GRAPH-1: List | Graph projection of the SAME governed data.
  // List remains the default and the complete accessible surface; the graph is
  // fetched lazily the first time it is opened and refreshed after any save.
  const [view, setView] = useState('list')
  // KNOWLEDGE-ENRICH-1: the enrichment workspace is opt-in per visit, never
  // auto-opened - it is a deliberate Owner workflow, not ambient UI.
  const [enrichOpen, setEnrichOpen] = useState(false)
  const [graph, setGraph] = useState(null)      // { nodes, edges } | null
  const [graphError, setGraphError] = useState(null)
  const [graphStale, setGraphStale] = useState(true)
  // Import/export status line. Export is a client-side download of what the
  // server serialized; nothing leaves the browser.
  const [portMsg, setPortMsg] = useState(null)
  const [porting, setPorting] = useState(false)

  // Detail drawer: mode 'create' | 'view' | 'edit'. selectedEntry holds the full
  // row (from get_entry, includes body) for view/edit; null in create mode.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState('view')
  const [selectedEntry, setSelectedEntry] = useState(null)
  const [rowBusy, setRowBusy] = useState(false) // guards double-fetch while a row opens

  // Defensive: client visibility is not authorization; the registry already hides
  // this section from non-admins and the endpoint authorizes server-side regardless.
  const allowed = isAdmin

  // Reusable list fetch so the drawer can refresh counts + rows after a save.
  const loadEntries = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await postAdmin({ action: 'list_entries' })
      if (!res.ok) throw new Error(`status_${res.status}`)
      const json = await res.json()
      setEntries(Array.isArray(json.entries) ? json.entries : [])
      setGraphStale(true)
    } catch {
      setError('We couldn’t load knowledge entries. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!allowed) return
    loadEntries()
  }, [allowed, loadEntries])

  // Fetch a single entry (with body) and open the drawer in view mode.
  const openEntry = useCallback(async (entryId) => {
    if (rowBusy) return
    setRowBusy(true)
    try {
      const res = await postAdmin({ action: 'get_entry', entry_id: entryId })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.entry) return
      setSelectedEntry(json.entry)
      setDrawerMode('view')
      setDrawerOpen(true)
    } catch {
      /* row click is best-effort; failure leaves the list untouched */
    } finally {
      setRowBusy(false)
    }
  }, [rowBusy])

  function openCreate() {
    setSelectedEntry(null)
    setDrawerMode('create')
    setDrawerOpen(true)
  }

  function closeDrawer() {
    setDrawerOpen(false)
  }

  // After a successful create/edit: refresh the list, then re-fetch the saved entry
  // into view mode so the author sees the persisted result.
  const handleSaved = useCallback(async (entryId) => {
    await loadEntries()
    if (entryId) {
      try {
        const res = await postAdmin({ action: 'get_entry', entry_id: entryId })
        const json = await res.json().catch(() => null)
        if (res.ok && json?.entry) {
          setSelectedEntry(json.entry)
          setDrawerMode('view')
          return
        }
      } catch { /* fall through to closing the drawer */ }
    }
    setDrawerOpen(false)
  }, [loadEntries])

  const counts = useMemo(() => {
    const c = { draft: 0, active: 0, deprecated: 0, archived: 0, review: 0 }
    for (const e of entries) {
      if (c[e.state] !== undefined) c[e.state]++
      if (e.expired || e.due_for_review) c.review++
    }
    return c
  }, [entries])

  // Every tag in use, for the filter. Alphabetical so the list is scannable.
  const allTags = useMemo(() => {
    const s = new Set()
    for (const e of entries) for (const t of e.tags || []) s.add(t)
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [entries])
  // Editing or archiving the final entry with a selected tag can remove that
  // option while the panel stays mounted. Do not let the missing value keep
  // constraining subsequent KPI card clicks.
  const activeTagFilter = tagFilter === 'all' || allTags.includes(tagFilter) ? tagFilter : 'all'

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter(e => {
      // "Needs review" is a cross-cutting filter, not a state, so it sits
      // beside the state filter rather than inside its vocabulary.
      const stateOk = stateFilter === 'all'
        || (stateFilter === 'review' ? (e.expired || e.due_for_review) : e.state === stateFilter)
      if (!stateOk) return false
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false
      if (activeTagFilter !== 'all' && !(e.tags || []).includes(activeTagFilter)) return false
      if (!q) return true
      // KNOWLEDGE-VAULT-1: search now covers aliases and tags too. Searching
      // for a name the author declared should find the page - that is the whole
      // point of recording aliases.
      return (e.title || '').toLowerCase().includes(q)
        || (e.aliases || []).some(a => a.toLowerCase().includes(q))
        || (e.tags || []).some(t => t.toLowerCase().includes(q))
    })
  }, [entries, search, stateFilter, categoryFilter, activeTagFilter])

  // Fetch the graph lazily: only when the Graph view is open and the data is
  // stale. Metadata only - the graph payload never includes a body.
  useEffect(() => {
    if (view !== 'graph' || !graphStale || !allowed) return
    let cancelled = false
    ;(async () => {
      setGraphError(null)
      try {
        const res = await postAdmin({ action: 'knowledge_graph' })
        const json = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !Array.isArray(json?.nodes)) throw new Error('bad_response')
        setGraph({ nodes: json.nodes, edges: json.edges || [] })
        setGraphStale(false)
      } catch {
        if (!cancelled) setGraphError('load_failed')
      }
    })()
    return () => { cancelled = true }
  }, [view, graphStale, allowed])

  // ── Obsidian-compatible portability ────────────────────────────────────────
  // Export builds the vault in the browser from what the server serialized. A
  // single entry downloads as one .md; several download as one .md per file so
  // the result drops straight into a vault folder with no unzip step and no
  // archive dependency.
  const exportVault = useCallback(async () => {
    setPorting(true); setPortMsg(null)
    try {
      const res = await postAdmin({ action: 'export_vault' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(json?.files)) {
        setPortMsg({ tone: 'error', text: 'We couldn’t download the vault. Please try again.' })
        return
      }
      for (const f of json.files) {
        const url = URL.createObjectURL(new Blob([f.content], { type: 'text/markdown;charset=utf-8' }))
        const a = document.createElement('a')
        a.href = url; a.download = f.filename
        document.body.appendChild(a); a.click(); a.remove()
        URL.revokeObjectURL(url)
      }
      setPortMsg({
        tone: 'info',
        text: `Downloaded ${json.count} entr${json.count === 1 ? 'y' : 'ies'} as Markdown with YAML frontmatter.${json.truncated ? ' The download hit its size limit and is partial.' : ''}`,
      })
    } catch {
      setPortMsg({ tone: 'error', text: 'We couldn’t download the vault. Please try again.' })
    } finally {
      setPorting(false)
    }
  }, [])

  // Import lands every file as a DRAFT, whatever its frontmatter claims about
  // state. Nothing imported can reach Keith until an Owner activates it.
  const importFiles = useCallback(async (event) => {
    const files = [...(event.target.files || [])]
    event.target.value = '' // let the same file be re-picked after a fix
    if (!files.length) return
    setPorting(true); setPortMsg(null)
    let ok = 0
    const failures = []
    for (const file of files) {
      try {
        const source = await file.text()
        const res = await postAdmin({ action: 'import_entry_file', source })
        const json = await res.json().catch(() => null)
        if (res.ok && json?.success) ok++
        else failures.push(`${file.name}: ${json?.message || 'could not be imported'}`)
      } catch {
        failures.push(`${file.name}: could not be read`)
      }
    }
    await loadEntries()
    setPorting(false)
    setPortMsg(
      failures.length
        ? { tone: 'error', text: `Uploaded ${ok} as draft${ok === 1 ? '' : 's'}. ${failures.length} failed — ${failures.join('; ')}` }
        : { tone: 'info', text: `Uploaded ${ok} entr${ok === 1 ? 'y' : 'ies'} as draft${ok === 1 ? '' : 's'}. Review and activate each one to make it governed guidance.` },
    )
  }, [loadEntries])

  if (!allowed) {
    return (
      <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #6b7280)', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
        You don’t have access to the Knowledge Center.
      </div>
    )
  }

  return (
    <section aria-labelledby="settings-knowledge-heading" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
      <div id="settings-knowledge-heading">
        <SettingsPageHeader
          title="Knowledge Center"
          subtitle="Governed Keith knowledge entries and revisions"
          accessNote="Owner and Admin access"
          actions={(
            <SegmentedTabs
              label="Knowledge Center view"
              items={[{ key: 'list', label: 'List' }, { key: 'graph', label: 'Graph' }]}
              value={view}
              onChange={setView}
            />
          )}
        />
      </div>

      {/* SETTINGS-UNIFIED-DESIGN-1: one state-filtering surface - clickable
          FilterKPICard cards replace both the old passive MetricCard summary
          row and the redundant FilterChip state-chips row. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        {STATE_CARDS.map(c => (
          <FilterKPICard
            key={c.key}
            value={loading ? '-' : (c.key === 'all' ? entries.length : counts[c.key])}
            label={cardLabel(c.key)}
            sub={CARD_SUBS[c.key] || `${cardLabel(c.key)} entries`}
            accent={c.accent}
            active={stateFilter === c.key}
            onClick={() => setStateFilter(f => (f === c.key ? 'all' : c.key))}
          />
        ))}
      </div>

      {/* Toolbar: search + category filter + New Entry */}
      <Toolbar
        search={(
          <>
            <Search size={15} strokeWidth={2} color="var(--color-text-secondary, #9ca3af)"
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by title"
              aria-label="Search knowledge entries by title"
              style={{
                width: '100%', padding: '8px 10px 8px 30px', borderRadius: 9,
                border: '1px solid var(--color-border-default, #e5e7eb)',
                background: 'var(--color-bg-surface, #ffffff)', color: 'var(--color-text-primary, #191919)',
                fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 13, outline: 'none',
              }}
            />
          </>
        )}
        filters={(
          <>
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
              style={selectStyle}
            >
              <option value="all">All categories</option>
              {CATEGORY_KEYS.map(k => <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>)}
            </select>
            {/* Only offered once tags exist - an empty tag filter is noise. */}
            {allTags.length > 0 && (
              <select
                value={activeTagFilter}
                onChange={e => setTagFilter(e.target.value)}
                aria-label="Filter by tag"
                style={selectStyle}
              >
                <option value="all">All tags</option>
                {allTags.map(t => <option key={t} value={t}>#{t}</option>)}
              </select>
            )}
          </>
        )}
        primaryAction={(
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Obsidian-compatible portability. Download writes a .md file per
                entry with YAML frontmatter; upload round-trips one back as a
                DRAFT, never as live content. The labels say Download/Upload
                because that is what the browser actually does here; the
                underlying export_vault / import_entry_file actions are
                unchanged. */}
            <Button variant="quiet" icon={<Sparkles size={14} strokeWidth={2.2} />} onClick={() => setEnrichOpen(v => !v)} aria-expanded={enrichOpen}>
              Enrich
            </Button>
            <Button variant="quiet" icon={<Download size={14} strokeWidth={2.2} />} onClick={exportVault} disabled={porting}>
              Download
            </Button>
            <Button variant="quiet" icon={<Upload size={14} strokeWidth={2.2} />} onClick={() => fileRef.current?.click()} disabled={porting}>
              Upload
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,text/markdown,text/plain"
              multiple
              onChange={importFiles}
              style={{ display: 'none' }}
              aria-hidden="true"
              tabIndex={-1}
            />
            <Button
              variant="primary"
              icon={<Plus size={14} strokeWidth={2.2} />}
              onClick={openCreate}
            >
              New Entry
            </Button>
          </div>
        )}
      />

      {portMsg && (
        <SurfaceCard padding="10px 14px" style={{
          marginBottom: 12, fontSize: 12.5,
          color: portMsg.tone === 'error' ? '#b91c1c' : 'var(--color-text-primary, #374151)',
          background: portMsg.tone === 'error' ? '#fef2f2' : 'var(--color-bg-elevated, #eef2fb)',
        }}>
          {portMsg.text}
        </SurfaceCard>
      )}

      {enrichOpen && (
        <KnowledgeEnrichmentPanel
          isOwner={isOwner}
          catalog={entries}
          onDataChanged={loadEntries}
        />
      )}

      {/* KNOWLEDGE-GRAPH-1: same data, two projections. The KPI cards, search
          and filters above stay live in BOTH - in the graph they dim
          non-matching nodes rather than removing them, so the layout holds. */}
      {view === 'graph' ? (
        <KnowledgeGraphView
          nodes={graph?.nodes}
          edges={graph?.edges}
          loading={graphStale && !graphError}
          error={graphError}
          onRetry={() => { setGraphError(null); setGraphStale(true) }}
          onOpenEntry={node => openEntry(node.id)}
          stateFilter={stateFilter}
          categoryFilter={categoryFilter}
          tagFilter={activeTagFilter}
          search={search}
          // The selection survives closing the drawer ON PURPOSE: the drawer's
          // backdrop blocks the graph controls while open, so Local focus is a
          // close-the-drawer-then-focus flow. Opening another node re-anchors it.
          selectedEntryId={selectedEntry?.id || null}
        />
      ) : loading ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--color-text-secondary, #6b7280)', fontSize: 13 }}>
          Loading knowledge entries…
        </div>
      ) : error ? (
        <SurfaceCard padding="16px 18px" style={{ color: 'var(--color-text-secondary, #6b7280)', fontSize: 13 }}>
          {error}
        </SurfaceCard>
      ) : entries.length === 0 ? (
        <SurfaceCard>
          <EmptyState
            icon={<FileText />}
            heading="No knowledge entries yet"
            subtext="Governed Keith knowledge will live here, program rules, eligibility, rotations, terminology, and FAQs that Keith can cite. Use New Entry to add your first draft."
          />
        </SurfaceCard>
      ) : (
        <DataTable
          columns={ENTRY_COLUMNS}
          rows={filtered}
          getRowKey={e => e.id}
          onRowClick={e => openEntry(e.id)}
          rowSelected={e => drawerOpen && selectedEntry?.id === e.id}
          empty={(
            <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--color-text-secondary, #6b7280)', fontSize: 13, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
              No entries match your search and filters.
            </div>
          )}
        />
      )}

      <KnowledgeEntryDrawer
        open={drawerOpen}
        mode={drawerMode}
        entry={selectedEntry}
        isOwner={isOwner}
        // The already-loaded list doubles as the wikilink catalog, so the
        // editor preview resolves links without a request per keystroke.
        catalog={entries}
        onOpenEntry={target => target?.id && openEntry(target.id)}
        onClose={closeDrawer}
        onSaved={handleSaved}
        onRequestEdit={() => setDrawerMode('edit')}
      />
    </section>
  )
}
