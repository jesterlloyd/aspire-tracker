// NGRP-WORKSPACE-1 (correction): the header's NGRP residency-cycle picker.
//
// When the NGRP workspace is active, this replaces the ASPIRE cohort picker
// in the header's Zone 2 - the SINGLE primary NGRP-cycle selector. It mirrors
// CohortPicker's pill + dropdown treatment exactly, but its language is
// precise: this selects an NGRP RESIDENCY CYCLE, never an ASPIRE cohort. The
// two selections are separate state (the cohort pref is untouched while in
// NGRP; the cycle pref is stored per authenticated user in App.jsx).
import { useState, useRef, useEffect } from 'react'
import Tooltip from '../ui/Tooltip'

// Approved cycle vocabulary (plan §10.1). Colors reuse the cohort-status
// families: blue = information/in progress, green = open/active, gray = done.
const CYCLE_STATUS_COLORS = {
  'Planning':           { bg: '#dbeafe', color: '#1d4ed8' },
  'Accepting Interest': { bg: '#dbeafe', color: '#1d4ed8' },
  'Application Open':   { bg: '#dcfce7', color: '#166534' },
  'Application Closed': { bg: '#fef3c7', color: '#92400e' },
  'Interviews':         { bg: '#ede9fe', color: '#5b21b6' },
  'Offers':             { bg: '#ede9fe', color: '#5b21b6' },
  'Residency Active':   { bg: '#dcfce7', color: '#166534' },
  'Completed':          { bg: '#f3f4f6', color: '#6b7280' },
  'Archived':           { bg: '#f3f4f6', color: '#9ca3af' },
}

const OPEN_STATUSES = new Set(['Accepting Interest', 'Application Open', 'Interviews', 'Offers', 'Residency Active'])

function HeaderChevron() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
}

export default function NgrpCyclePicker({ status, cycles, activeCycle, onSelectCycle }) {
  const [open, setOpen] = useState(false)
  const areaRef = useRef(null)

  useEffect(() => {
    const handler = e => { if (areaRef.current && !areaRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const label = status === 'loading' ? 'Loading cycles…'
    : status === 'unprovisioned' ? 'Awaiting provisioning'
    : status === 'error' || status === 'stale' ? 'Cycles unavailable'
    : cycles.length === 0 ? 'No cycles configured'
    : (activeCycle?.name || 'Select cycle')
  const isLive = Boolean(activeCycle) && OPEN_STATUSES.has(activeCycle.status)

  return (
    <div ref={areaRef} className="chart-cohort-area">
      <Tooltip label="Switch NGRP residency cycle" placement="bottom">
        <button
          data-tour="ngrp-cycle-switcher"
          aria-label="Switch NGRP residency cycle"
          aria-expanded={open}
          onClick={() => setOpen(p => !p)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 999, padding: '7px 13px',
            color: '#fff', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: isLive ? '#5DD39E' : '#9ca3af', boxShadow: isLive ? '0 0 0 3px rgba(93,211,158,0.2)' : 'none' }} />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 2 }}>NGRP Residency Cycle</span>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
          <span style={{ opacity: 0.5, lineHeight: 0, marginLeft: 2 }}><HeaderChevron /></span>
        </button>
      </Tooltip>

      {open && (
        <div className="chart-cohort-dropdown" role="listbox" aria-label="NGRP residency cycles">
          <div style={{ padding: '10px 14px 6px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--sand)' }}>
            Select NGRP Residency Cycle
          </div>
          {status !== 'ready' || cycles.length === 0 ? (
            <div style={{ padding: '16px', fontSize: 12.5, color: '#6b7280' }}>
              {status === 'loading' && 'Loading cycles…'}
              {status === 'unprovisioned' && 'NGRP persistence has not been provisioned yet. Apply the NGRP foundation migration, then reload.'}
              {(status === 'error' || status === 'stale') && 'The cycle list could not be loaded. Refresh to try again.'}
              {status === 'ready' && cycles.length === 0 && 'No residency cycles are configured yet. Cycles are created in NGRP → Planning.'}
            </div>
          ) : cycles.map(c => {
            const isSel = c.id === activeCycle?.id
            const sc = CYCLE_STATUS_COLORS[c.status] || { bg: '#f3f4f6', color: '#6b7280' }
            return (
              <div
                key={c.id}
                role="option"
                aria-selected={isSel}
                tabIndex={0}
                onClick={() => { onSelectCycle(c.id); setOpen(false) }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectCycle(c.id); setOpen(false) } }}
                style={{ padding: '14px 16px', cursor: 'pointer', background: isSel ? '#e8edf8' : 'transparent', borderLeft: isSel ? '3px solid #1d2567' : '3px solid transparent', transition: 'background 0.1s' }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--sand)' }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>{c.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 }}>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>
                    {(c.source_cohorts || []).length > 0
                      ? `${c.source_cohorts.length} source cohort${c.source_cohorts.length === 1 ? '' : 's'}`
                      : 'No source cohorts mapped'}
                  </span>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 8 }}>
                    {c.status && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: sc.bg, color: sc.color }}>{c.status}</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
