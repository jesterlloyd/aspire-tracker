// KT-3a-1: Settings → Knowledge Center (READ-ONLY shell).
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

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        {STATES.map(s => (
          <SummaryCard key={s} state={s} count={counts[s]} loading={loading} />
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
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
        </div>

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

        {/* New Entry — INERT in KT-3a-1 (create workflow arrives in the next update). */}
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Creating entries arrives in the next update"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto',
            padding: '8px 14px', borderRadius: 9, border: 'none',
            background: 'var(--color-bg-elevated, #eef2fb)', color: 'var(--color-text-secondary, #6b7280)',
            fontFamily: 'DM Sans, sans-serif', fontSize: 13, fontWeight: 600,
            cursor: 'not-allowed', opacity: 0.6,
          }}
        >
          <Plus size={14} strokeWidth={2.2} />
          New Entry
          <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.85 }}>· soon</span>
        </button>
      </div>

      {/* State filter chips */}
      <div role="group" aria-label="Filter by state" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {STATE_CHIPS.map(c => {
          const active = stateFilter === c.key
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={active}
              onClick={() => setStateFilter(c.key)}
              style={{
                padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${active ? 'var(--color-accent-primary, #1D2567)' : 'var(--color-border-default, #e5e7eb)'}`,
                background: active ? 'var(--color-accent-primary, #1D2567)' : 'var(--color-bg-surface, #ffffff)',
                color: active ? '#ffffff' : 'var(--color-text-secondary, #6b7280)',
                fontFamily: 'DM Sans, sans-serif', fontSize: 12.5, fontWeight: active ? 600 : 500,
                transition: 'background 0.15s, color 0.15s, border-color 0.15s',
              }}
            >
              {c.label}
            </button>
          )
        })}
      </div>

      {/* Content states: loading → error → empty → list */}
      {loading ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--color-text-secondary, #6b7280)', fontSize: 13 }}>
          Loading knowledge entries…
        </div>
      ) : error ? (
        <div style={{
          padding: '16px 18px', borderRadius: 12,
          background: 'var(--color-bg-surface, #ffffff)', boxShadow: '0 1px 3px rgba(16,24,40,0.06)',
          color: 'var(--color-text-secondary, #6b7280)', fontSize: 13,
        }}>
          {error}
        </div>
      ) : entries.length === 0 ? (
        <div style={{ borderRadius: 12, background: 'var(--color-bg-surface, #ffffff)', boxShadow: '0 1px 3px rgba(16,24,40,0.06)' }}>
          <EmptyState
            icon={<FileText />}
            heading="No knowledge entries yet"
            subtext="Governed Keith knowledge will live here — program rules, eligibility, rotations, terminology, and FAQs that Keith can cite. Authoring tools arrive in the next update."
          />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          padding: '24px 18px', borderRadius: 12, textAlign: 'center',
          background: 'var(--color-bg-surface, #ffffff)', boxShadow: '0 1px 3px rgba(16,24,40,0.06)',
          color: 'var(--color-text-secondary, #6b7280)', fontSize: 13,
        }}>
          No entries match your search and filters.
        </div>
      ) : (
        <EntriesTable entries={filtered} />
      )}
    </section>
  )
}

// ── Summary card ──────────────────────────────────────────────────────────────
function SummaryCard({ state, count, loading }) {
  const label = state.charAt(0).toUpperCase() + state.slice(1)
  return (
    <div style={{
      flex: '1 1 140px', minWidth: 120,
      padding: '14px 16px', borderRadius: 12,
      background: 'var(--color-bg-surface, #ffffff)', boxShadow: '0 1px 3px rgba(16,24,40,0.06)',
    }}>
      <div style={{ marginBottom: 8 }}><StateBadge state={state} /></div>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text-primary, #191919)', lineHeight: 1 }}>
        {loading ? '—' : count}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary, #6b7280)', marginTop: 3 }}>{label} entries</div>
    </div>
  )
}

// ── Entries table ─────────────────────────────────────────────────────────────
function EntriesTable({ entries }) {
  const cell = { padding: '10px 14px', fontSize: 13, color: 'var(--color-text-primary, #374151)', verticalAlign: 'middle' }
  const th = { padding: '9px 14px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-secondary, #6b7280)', textAlign: 'left', whiteSpace: 'nowrap' }
  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', background: 'var(--color-bg-surface, #ffffff)', boxShadow: '0 1px 3px rgba(16,24,40,0.06)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'DM Sans, sans-serif' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border-subtle, #f3f4f6)' }}>
            <th style={th}>Title</th>
            <th style={th}>Category</th>
            <th style={th}>State</th>
            <th style={{ ...th, textAlign: 'right' }}>Version</th>
            <th style={{ ...th, textAlign: 'right' }}>Updated</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id} style={{ borderTop: '1px solid var(--color-border-subtle, #f3f4f6)' }}>
              <td style={{ ...cell, fontWeight: 600 }}>{e.title || 'Untitled'}</td>
              <td style={{ ...cell, color: 'var(--color-text-secondary, #6b7280)' }}>{CATEGORY_LABELS[e.category] || e.category}</td>
              <td style={cell}><StateBadge state={e.state} /></td>
              <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{e.current_version}</td>
              <td style={{ ...cell, textAlign: 'right', color: 'var(--color-text-secondary, #6b7280)', whiteSpace: 'nowrap' }}>{fmtDate(e.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
