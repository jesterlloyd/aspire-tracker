// KT-3a-1: Settings → Knowledge Center (READ-ONLY shell).
// UI-1: now composed from the shared ui/ primitives (SurfaceCard, MetricCard,
// FilterChip, Toolbar, Button, DataTable, StatusBadge via StateBadge) — the
// primitives were extracted from this panel's shipped pixels, so rendering is
// visually identical. Behavior unchanged from KT-3a-1.
//
// Owner/Admin only (registry-hidden otherwise + defensive guard here; the backend
// is the real authority). Reads governed knowledge entries via the existing
// api/knowledge-admin.js `list_entries` action ONLY. No create/edit/lifecycle/
// revision/version actions in this phase — the New Entry button is intentionally
// inert (arrives in KT-3a-2). All search/filtering is client-side. Only draft,
// active, deprecated, and archived are valid lifecycle states.
import { useState, useEffect, useMemo } from 'react'
import { FileText, Search, Plus } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import EmptyState from '../EmptyState'
import StateBadge from './StateBadge'
import SettingsPageHeader from './SettingsPageHeader'
import SurfaceCard from '../ui/SurfaceCard'
import MetricCard from '../ui/MetricCard'
import FilterChip from '../ui/FilterChip'
import Toolbar from '../ui/Toolbar'
import Button from '../ui/Button'
import DataTable from '../ui/DataTable'

const STATES = ['draft', 'active', 'deprecated', 'archived']
const STATE_CHIPS = [{ key: 'all', label: 'All' }, ...STATES.map(s => ({ key: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))]

// Eight KT-1 knowledge categories (display labels for the snake_case enum values).
const CATEGORY_LABELS = {
  program_overview: 'Program Overview',
  eligibility_placement: 'Eligibility & Placement',
  interview_selection: 'Interview & Selection',
  rotations_matching: 'Rotations & Matching',
  student_requirements: 'Student Requirements',
  communication_guidance: 'Communication Guidance',
  terminology_navigation: 'Terminology & Navigation',
  faq: 'FAQ',
}
const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS)

function fmtDate(value) {
  if (!value) return '—'
  const t = Date.parse(value)
  if (Number.isNaN(t)) return '—'
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Entries table columns (DataTable) — identical cells to the KT-3a-1 table.
const ENTRY_COLUMNS = [
  { key: 'title',    label: 'Title',    cellStyle: { fontWeight: 600 }, render: e => e.title || 'Untitled' },
  { key: 'category', label: 'Category', cellStyle: { color: 'var(--color-text-secondary, #6b7280)' }, render: e => CATEGORY_LABELS[e.category] || e.category },
  { key: 'state',    label: 'State',    render: e => <StateBadge state={e.state} /> },
  { key: 'version',  label: 'Version',  align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums' }, render: e => e.current_version },
  { key: 'updated',  label: 'Updated',  align: 'right', cellStyle: { color: 'var(--color-text-secondary, #6b7280)', whiteSpace: 'nowrap' }, render: e => fmtDate(e.updated_at) },
]

export default function KnowledgeCenterPanel() {
  const { isAdmin } = useAuth() // owner/admin; registry hides this section otherwise
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')

  // Defensive: client visibility is not authorization; the registry already hides
  // this section from non-admins and the endpoint authorizes server-side regardless.
  const allowed = isAdmin

  useEffect(() => {
    if (!allowed) return
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        const res = await fetch('/api/knowledge-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ action: 'list_entries' }),
        })
        if (!res.ok) throw new Error(`status_${res.status}`)
        const json = await res.json()
        if (!cancelled) setEntries(Array.isArray(json.entries) ? json.entries : [])
      } catch {
        if (!cancelled) setError('We couldn’t load knowledge entries. Please try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [allowed])

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

      {/* Summary cards — passive metrics (MetricCard summary register) */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        {STATES.map(s => (
          <MetricCard
            key={s}
            badge={<StateBadge state={s} />}
            value={loading ? '—' : counts[s]}
            sub={`${s.charAt(0).toUpperCase() + s.slice(1)} entries`}
          />
        ))}
      </div>

      {/* Toolbar: search + category filter + (inert) New Entry */}
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
          /* New Entry — INERT in UI-1 (create workflow arrives in KT-3a-2a). */
          <Button
            variant="secondary"
            disabled
            icon={<Plus size={14} strokeWidth={2.2} />}
            title="Creating entries arrives in the next update"
          >
            New Entry
            <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.85 }}>· soon</span>
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
            subtext="Governed Keith knowledge will live here — program rules, eligibility, rotations, terminology, and FAQs that Keith can cite. Authoring tools arrive in the next update."
          />
        </SurfaceCard>
      ) : (
        <DataTable
          columns={ENTRY_COLUMNS}
          rows={filtered}
          getRowKey={e => e.id}
          empty={(
            <div style={{ padding: '24px 18px', textAlign: 'center', color: 'var(--color-text-secondary, #6b7280)', fontSize: 13, fontFamily: 'DM Sans, sans-serif' }}>
              No entries match your search and filters.
            </div>
          )}
        />
      )}
    </section>
  )
}
