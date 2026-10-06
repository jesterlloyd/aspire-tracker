// src/components/settings/ResidencyActivityPanel.jsx
//
// RESIDENCY-TA-1 (Owner, 2026-10-05): "a log of who did what". Talent Acquisition now logs
// support, flags, uploads and scores in Residency beside the ASPIRE team; this page lists every
// such action, newest first, for the Owner and Admins only. Rows come from /api/ngrp-manage
// `activity_log`; every word comes from src/lib/ngrp/residencyActivityModel.js.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Search } from 'lucide-react'
import SettingsPageHeader from './SettingsPageHeader'
import SurfaceCard from '../ui/SurfaceCard'
import DataSheet, { Pill, Missing } from '../shared/DataSheet'
import { postNgrpManage } from '../../lib/ngrp/useNgrpData'
import { downloadCSV } from '../../lib/utils'
import { ACTION_GROUPS, matchesGroup, actorOf, detailOf, eventLabel, activityCsv } from '../../lib/ngrp/residencyActivityModel'

const fmtWhen = ts => {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
const control = {
  height: 32, padding: '0 10px', border: '1px solid var(--border-input, rgba(29,37,103,0.10))',
  borderRadius: 'var(--aspire-radius-control)', fontSize: 12.5, background: 'var(--bg-input, #fff)',
  color: 'var(--text-heading)', fontFamily: 'inherit',
}

export default function ResidencyActivityPanel() {
  const [person, setPerson] = useState('all')
  const [group, setGroup] = useState('all')
  const [query, setQuery] = useState('')
  // The newest 200, then older pages on request ("Load earlier activity").
  const first = useQuery({
    queryKey: ['residency_activity'],
    queryFn: async () => {
      const r = await postNgrpManage('activity_log', { limit: 200 })
      if (r.provisioned === false) return { unprovisioned: true, rows: [] }
      if (!r.ok) throw new Error(r.error || 'request_failed')
      return r
    },
    staleTime: 30_000,
  })
  const [older, setOlder] = useState({ rows: [], nextBefore: undefined, more: undefined, busy: false })
  const rows = useMemo(() => [...(first.data?.rows || []), ...older.rows], [first.data, older.rows])
  const nextBefore = older.nextBefore !== undefined ? older.nextBefore : first.data?.nextBefore
  const more = older.more !== undefined ? older.more : first.data?.more === true
  const status = first.isPending ? 'loading' : first.isError ? 'error' : first.data?.unprovisioned ? 'unprovisioned' : older.busy ? 'more' : 'ok'
  const loadOlder = async () => {
    setOlder(o => ({ ...o, busy: true }))
    const r = await postNgrpManage('activity_log', { limit: 200, before: nextBefore })
    setOlder(o => (r.ok
      ? { rows: [...o.rows, ...(r.rows || [])], nextBefore: r.nextBefore || null, more: r.more === true, busy: false }
      : { ...o, busy: false }))
  }

  const people = useMemo(() => {
    const m = new Map()
    for (const r of rows) { const a = actorOf(r); m.set(`${a.name}|${a.team}`, a) }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
  }, [rows])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (!matchesGroup(r, group)) return false
      if (person !== 'all') { const a = actorOf(r); if (`${a.name}|${a.team}` !== person) return false }
      if (q && !String(r.student_name || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, group, person, query])

  const columns = [
    { key: 'when', label: 'When', min: 150, grow: 1, priority: 1, sortValue: r => r.created_at, render: r => fmtWhen(r.created_at) },
    { key: 'who', label: 'Who', min: 170, grow: 1.4, priority: 1, sortValue: r => actorOf(r).name,
      render: (r) => { const a = actorOf(r); return <span><b>{a.name}</b> <Pill tone={a.team === 'Talent Acquisition' ? 'info' : 'off'}>{a.team}</Pill></span> } },
    { key: 'action', label: 'Action', min: 170, grow: 1.4, priority: 1, sortValue: r => eventLabel(r.event_type), render: r => eventLabel(r.event_type) },
    { key: 'alumnus', label: 'Alumnus', min: 150, grow: 1.4, priority: 2, sortValue: r => r.student_name || '', render: r => r.student_name || <Missing /> },
    { key: 'detail', label: 'Detail', min: 130, grow: 1.1, priority: 3, sortValue: r => detailOf(r), render: r => detailOf(r) || <Missing /> },
    { key: 'cohort', label: 'Residency Cohort', min: 120, grow: 0.9, priority: 4, sortValue: r => r.cycle_name || '', render: r => r.cycle_name || <Missing /> },
  ]

  return (
    <>
      <SettingsPageHeader
        title="Residency Activity"
        subtitle="Who did what in Residency, across the ASPIRE team and Talent Acquisition."
        actions={(
          <button type="button" onClick={() => downloadCSV(activityCsv(shown), 'residency-activity.csv')} disabled={!shown.length}
            style={{ ...control, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--color-accent-primary, #1D2567)', color: '#fff', border: 0, fontWeight: 700, cursor: shown.length ? 'pointer' : 'default', opacity: shown.length ? 1 : 0.6 }}>
            <Download size={14} aria-hidden="true" /> Export CSV
          </button>
        )}
      />
      <SurfaceCard>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '4px 0 12px' }}>
          <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <Search size={13} aria-hidden="true" style={{ position: 'absolute', left: 9, color: 'var(--text-caption)' }} />
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search alumni" aria-label="Search by alumnus" style={{ ...control, paddingLeft: 28, minWidth: 200 }} />
          </label>
          <select value={person} onChange={e => setPerson(e.target.value)} aria-label="Filter by person" style={control}>
            <option value="all">Everyone</option>
            {people.map(([k, a]) => <option key={k} value={k}>{a.name} ({a.team})</option>)}
          </select>
          <select value={group} onChange={e => setGroup(e.target.value)} aria-label="Filter by action" style={control}>
            {ACTION_GROUPS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
          </select>
          <span style={{ fontSize: 12, color: 'var(--text-caption)' }} aria-live="polite">{shown.length} of {rows.length} loaded</span>
        </div>
        {status === 'loading' && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-caption)' }}>Loading activity…</p>}
        {status === 'error' && <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--aspire-bad)' }}>The activity could not load. <button type="button" className="ngrp-linkbtn" onClick={() => first.refetch()}>Try again</button></p>}
        {status === 'unprovisioned' && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-caption)' }}>Residency is not set up on this database yet.</p>}
        {(status === 'ok' || status === 'more') && (
          <>
            <DataSheet level="plain" columns={columns} rows={shown} rowKey={r => r.id} defaultSort={{ key: 'when', dir: 'desc' }}
              aria-label="Residency activity" emptyMessage={rows.length ? 'Nothing matches these filters.' : 'No activity recorded yet.'} />
            {more && (
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12 }}>
                <button type="button" style={{ ...control, cursor: 'pointer', fontWeight: 600 }} disabled={status === 'more'} onClick={loadOlder}>
                  {status === 'more' ? 'Loading…' : 'Load earlier activity'}
                </button>
              </div>
            )}
          </>
        )}
      </SurfaceCard>
    </>
  )
}
