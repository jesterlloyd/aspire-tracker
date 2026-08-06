// KEITH-SKILLS-1: Settings → Keith → Skills - the governed inventory of Keith's
// skills. Modeled directly on KnowledgeCenterPanel (same UI-1 primitives:
// SettingsPageHeader, FilterKPICard row, Toolbar, DataTable, StateBadge, detail
// drawer) so the two Administration surfaces read as one system.
//
// Owner/Admin only (the registry hides this section otherwise, plus the defensive
// guard below; api/keith-skills-admin is the real authority). All search/filtering
// is client-side. Only draft, active, deprecated, and archived are valid lifecycle
// states. This phase is list + detail + lifecycle + the runtime kill switch: there
// is no authoring, no import/export, no version diff, and no test runner.
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Search, Sparkles } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import EmptyState from '../EmptyState'
import StateBadge from './StateBadge'
import StatusBadge from '../ui/StatusBadge'
import SettingsPageHeader from './SettingsPageHeader'
import KeithSkillDrawer from './KeithSkillDrawer'
import {
  KEITH_SKILL_STATES, ENABLED_STYLES, CLASSIFICATION_STYLES, failureCount, formatList,
} from './keithSkillFields'
import SurfaceCard from '../ui/SurfaceCard'
import Toolbar from '../ui/Toolbar'
import DataTable from '../ui/DataTable'
import { FilterKPICard } from '../KPIBand'

// Accent per state, plus the "All" card first - the same mapping the Knowledge
// Center uses so the two filter rows are visually interchangeable.
const STATE_CARD_ACCENTS = { draft: 'dawn', active: 'sage', deprecated: 'lavender', archived: 'marina' }
const STATE_CARDS = [
  { key: 'all', accent: 'nightfall' },
  ...KEITH_SKILL_STATES.map(s => ({ key: s, accent: STATE_CARD_ACCENTS[s] })),
]
const cardLabel = (key) => key.charAt(0).toUpperCase() + key.slice(1)

const secondary = 'var(--color-text-secondary, #6b7280)'

// Authenticated POST helper for the keith-skills-admin endpoint (the backend
// authorizes every action server-side regardless of client gating).
async function postAdmin(payload) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const res = await fetch('/api/keith-skills-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  })
  return res
}

// Enabled is shown as a plain read-only pill, never a toggle: flipping the runtime
// kill switch is an Owner action that requires confirmation, and that lives in the
// drawer where the consequence can be stated.
const SKILL_COLUMNS = [
  {
    key: 'skill',
    label: 'Skill',
    render: s => (
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{s.display_name || s.slug || 'Untitled skill'}</div>
        <div style={{ fontSize: 11.5, color: secondary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' }}>
          {s.slug}
        </div>
      </div>
    ),
  },
  { key: 'status', label: 'Status', render: s => <StateBadge state={s.status} /> },
  { key: 'enabled', label: 'Enabled', render: s => <StatusBadge value={s.enabled ? 'yes' : 'no'} colorMap={ENABLED_STYLES} /> },
  { key: 'roles', label: 'Roles', cellStyle: { color: secondary }, render: s => formatList(s.allowed_roles) },
  { key: 'classification', label: 'Classification', render: s => (s.data_classification ? <StatusBadge value={s.data_classification} colorMap={CLASSIFICATION_STYLES} dot={false} /> : '-') },
  { key: 'version', label: 'Version', align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums' }, render: s => s.version ?? '-' },
  { key: 'invocations', label: 'Invocations (30d)', align: 'right', cellStyle: { fontVariantNumeric: 'tabular-nums' }, render: s => Number(s.stats?.total) || 0 },
  {
    key: 'failures',
    label: 'Failures (30d)',
    align: 'right',
    cellStyle: { fontVariantNumeric: 'tabular-nums' },
    render: s => {
      const n = failureCount(s.stats)
      return <span style={n > 0 ? { color: '#dc2626', fontWeight: 600 } : undefined}>{n}</span>
    },
  },
]

export default function KeithSkillsPanel() {
  const { isAdmin, isOwner } = useAuth() // owner/admin; registry hides this section otherwise
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('all')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedSkill, setSelectedSkill] = useState(null) // full record (get_skill, includes instruction_body)
  const [rowBusy, setRowBusy] = useState(false) // guards double-fetch while a row opens

  // Defensive: client visibility is not authorization; the registry already hides
  // this section from non-admins and the endpoint authorizes server-side regardless.
  const allowed = isAdmin

  // Reusable list fetch so the drawer can refresh counts + rows after a change.
  const loadSkills = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await postAdmin({ action: 'list_skills' })
      if (!res.ok) throw new Error(`status_${res.status}`)
      const json = await res.json()
      setSkills(Array.isArray(json.skills) ? json.skills : [])
    } catch {
      setError('We couldn’t load Keith skills. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch-on-mount for Owner/Admin, mirroring the Knowledge Center list load. The
  // disable matches the repo's established fetch-on-activation precedent (see
  // portal/MyProfile.jsx): the effect body only kicks off a request.
  useEffect(() => {
    if (!allowed) return
    loadSkills() // eslint-disable-line react-hooks/set-state-in-effect
  }, [allowed, loadSkills])

  // Fetch a single skill (with instruction_body) and open the drawer.
  const openSkill = useCallback(async (skillId) => {
    if (rowBusy) return
    setRowBusy(true)
    try {
      const res = await postAdmin({ action: 'get_skill', skill_id: skillId })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.skill) return
      setSelectedSkill(json.skill)
      setDrawerOpen(true)
    } catch {
      /* row click is best-effort; failure leaves the list untouched */
    } finally {
      setRowBusy(false)
    }
  }, [rowBusy])

  function closeDrawer() {
    setDrawerOpen(false)
  }

  // After a lifecycle / enable change: refresh the list, then re-fetch the skill into
  // the open drawer so the Owner sees the persisted result in place.
  const handleChanged = useCallback(async (skillId) => {
    await loadSkills()
    if (skillId) {
      try {
        const res = await postAdmin({ action: 'get_skill', skill_id: skillId })
        const json = await res.json().catch(() => null)
        if (res.ok && json?.skill) {
          setSelectedSkill(json.skill)
          return
        }
      } catch { /* fall through to closing the drawer */ }
    }
    setDrawerOpen(false)
  }, [loadSkills])

  const counts = useMemo(() => {
    const c = { draft: 0, active: 0, deprecated: 0, archived: 0 }
    for (const s of skills) if (c[s.status] !== undefined) c[s.status]++
    return c
  }, [skills])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return skills.filter(s =>
      (stateFilter === 'all' || s.status === stateFilter) &&
      (!q || (s.display_name || '').toLowerCase().includes(q) || (s.slug || '').toLowerCase().includes(q))
    )
  }, [skills, search, stateFilter])

  if (!allowed) {
    return (
      <div style={{ fontSize: 13, color: secondary, fontFamily: 'DM Sans, sans-serif' }}>
        You don’t have access to Keith skills.
      </div>
    )
  }

  return (
    <section aria-labelledby="settings-keith-heading" style={{ fontFamily: 'DM Sans, sans-serif' }}>
      <div id="settings-keith-heading">
        <SettingsPageHeader
          title="Keith"
          subtitle="Governed Keith skills, their lifecycle, and what is running"
          accessNote="Owner and Admin access"
        />
      </div>

      {/* One state-filtering surface - clickable FilterKPICard cards, matching the
          Knowledge Center. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        {STATE_CARDS.map(c => (
          <FilterKPICard
            key={c.key}
            value={loading ? '-' : (c.key === 'all' ? skills.length : counts[c.key])}
            label={cardLabel(c.key)}
            sub={`${cardLabel(c.key)} skills`}
            accent={c.accent}
            active={stateFilter === c.key}
            onClick={() => setStateFilter(f => (f === c.key ? 'all' : c.key))}
          />
        ))}
      </div>

      {/* Toolbar: search only - there is no create/import affordance in this phase. */}
      <Toolbar
        search={(
          <>
            <Search size={15} strokeWidth={2} color="var(--color-text-secondary, #9ca3af)"
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or slug"
              aria-label="Search Keith skills by name or slug"
              style={{
                width: '100%', padding: '8px 10px 8px 30px', borderRadius: 9,
                border: '1px solid var(--color-border-default, #e5e7eb)',
                background: 'var(--color-bg-surface, #ffffff)', color: 'var(--color-text-primary, #191919)',
                fontFamily: 'DM Sans, sans-serif', fontSize: 13, outline: 'none',
              }}
            />
          </>
        )}
      />

      {/* Content states: loading → error → empty → table (with no-match empty) */}
      {loading ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: secondary, fontSize: 13 }}>
          Loading Keith skills…
        </div>
      ) : error ? (
        <SurfaceCard padding="16px 18px" style={{ color: secondary, fontSize: 13 }}>
          {error}
        </SurfaceCard>
      ) : skills.length === 0 ? (
        <SurfaceCard>
          <EmptyState
            icon={<Sparkles />}
            heading="No Keith skills yet"
            subtext="Governed Keith skills will live here, each with the roles it serves, the data it reaches, and whether it is currently running."
          />
        </SurfaceCard>
      ) : (
        <DataTable
          columns={SKILL_COLUMNS}
          rows={filtered}
          getRowKey={s => s.id}
          onRowClick={s => openSkill(s.id)}
          rowSelected={s => drawerOpen && selectedSkill?.id === s.id}
          empty={(
            <div style={{ padding: '24px 18px', textAlign: 'center', color: secondary, fontSize: 13, fontFamily: 'DM Sans, sans-serif' }}>
              No skills match your search and filters.
            </div>
          )}
        />
      )}

      <KeithSkillDrawer
        open={drawerOpen}
        skill={selectedSkill}
        isOwner={isOwner}
        onClose={closeDrawer}
        onChanged={handleChanged}
      />
    </section>
  )
}
