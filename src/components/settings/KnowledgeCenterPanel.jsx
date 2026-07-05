// KT-3a-2a: Settings → Knowledge Center - Owner/Admin INPUT enabled.
// Builds on the KT-3a-1 read-only shell + UI-1 primitives (SurfaceCard, MetricCard,
// FilterChip, Toolbar, Button, DataTable, StateBadge). This phase makes the panel
// usable for authoring: the New Entry button opens a create drawer, clicking a row
// opens a detail drawer (read-only view), and draft entries can be edited - all via
// KnowledgeEntryDrawer, which talks only to the existing api/knowledge-admin.js
// actions (list_entries, get_entry, create_entry_draft, update_entry_draft). No
// lifecycle/version-history controls here; non-draft entries remain read-only.
//
// Owner/Admin only (registry-hidden otherwise + defensive guard here; the backend
// is the real authority). All search/filtering is client-side. Only draft, active,
// deprecated, and archived are valid lifecycle states.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { FileText, Search, Plus } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import EmptyState from '../EmptyState'
import StateBadge from './StateBadge'
import SettingsPageHeader from './SettingsPageHeader'
import KnowledgeEntryDrawer from './KnowledgeEntryDrawer'
import { KNOWLEDGE_STATES, CATEGORY_LABELS, CATEGORY_KEYS, fmtDate } from './knowledgeCategories'
import SurfaceCard from '../ui/SurfaceCard'
import MetricCard from '../ui/MetricCard'
import FilterChip from '../ui/FilterChip'
import Toolbar from '../ui/Toolbar'
import Button from '../ui/Button'
import DataTable from '../ui/DataTable'

const STATES = KNOWLEDGE_STATES
const STATE_CHIPS = [{ key: 'all', label: 'All' }, ...STATES.map(s => ({ key: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))]

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
  { key: 'title',    label: 'Title',    cellStyle: { fontWeight: 600 }, render: e => e.title || 'Untitled' },
  { key: 'category', label: 'Category', cellStyle: { color: 'var(--color-text-secondary, #6b7280)' }, render: e => CATEGORY_LABELS[e.category] || e.category },
  { key: 'state',    label: 'State',    render: e => <StateBadge state={e.state} /> },
  { key: 'version',  label: 'Version',  align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums' }, render: e => e.current_version },
  { key: 'updated',  label: 'Updated',  align: 'right', cellStyle: { color: 'var(--color-text-secondary, #6b7280)', whiteSpace: 'nowrap' }, render: e => fmtDate(e.updated_at) },
]

export default function KnowledgeCenterPanel() {
  const { isAdmin, isOwner } = useAuth() // owner/admin; registry hides this section otherwise
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')

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
    const c = { draft: 0, active: 0, deprecated: 0, archived: 0 }
    for (const e of entries) if (c[e.state] !== undefined) c[e.state]++
    return c
  }, [entries])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter(e =>
      (stateFilter === 'all' || e.state === stateFilter) &&
      (categoryFilter === 'all' || e.category === categoryFilter) &&
      (!q || (e.title || '').toLowerCase().includes(q))
    )
  }, [entries, search, stateFilter, categoryFilter])

  if (!allowed) {
    return (
      <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #6b7280)', fontFamily: 'DM Sans, sans-serif' }}>
        You don’t have access to the Knowledge Center.
      </div>
    )
  }

  return (
    <section aria-labelledby="settings-knowledge-heading" style={{ fontFamily: 'DM Sans, sans-serif' }}>
      <div id="settings-knowledge-heading">
        <SettingsPageHeader
          title="Knowledge Center"
          subtitle="Governed Keith knowledge entries and revisions"
          accessNote="Owner and Admin access"
        />
      </div>

      {/* Summary cards - passive metrics (MetricCard summary register) */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        {STATES.map(s => (
          <MetricCard
            key={s}
            badge={<StateBadge state={s} />}
            value={loading ? '-' : counts[s]}
            sub={`${s.charAt(0).toUpperCase() + s.slice(1)} entries`}
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
                fontFamily: 'DM Sans, sans-serif', fontSize: 13, outline: 'none',
              }}
            />
          </>
        )}
        filters={(
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
            style={{
              padding: '8px 10px', borderRadius: 9,
              border: '1px solid var(--color-border-default, #e5e7eb)',
              background: 'var(--color-bg-surface, #ffffff)', color: 'var(--color-text-primary, #191919)',
              fontFamily: 'DM Sans, sans-serif', fontSize: 13, cursor: 'pointer',
            }}
          >
            <option value="all">All categories</option>
            {CATEGORY_KEYS.map(k => <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>)}
          </select>
        )}
        primaryAction={(
          <Button
            variant="primary"
            icon={<Plus size={14} strokeWidth={2.2} />}
            onClick={openCreate}
          >
            New Entry
          </Button>
        )}
      />

      {/* State filter chips */}
      <div role="group" aria-label="Filter by state" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {STATE_CHIPS.map(c => (
          <FilterChip key={c.key} label={c.label} active={stateFilter === c.key} onClick={() => setStateFilter(c.key)} />
        ))}
      </div>

      {/* Content states: loading → error → empty → table (with no-match empty) */}
      {loading ? (
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
            <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--color-text-secondary, #6b7280)', fontSize: 13, fontFamily: 'DM Sans, sans-serif' }}>
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
        onClose={closeDrawer}
        onSaved={handleSaved}
        onRequestEdit={() => setDrawerMode('edit')}
      />
    </section>
  )
}
