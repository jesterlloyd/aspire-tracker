// NGRP-WORKSPACE-1 (correction 2): the Residency experience's COHORT picker.
//
// In the Residency experience this occupies the header's cohort slot, right
// beside the Experience picker, in the exact CohortPicker pill + dropdown
// treatment. To users these are simply "cohorts" (eyebrow COHORT, value the
// cohort's name); internally each row is an ngrp_cycles record and the API
// keeps cycle_id - the cohort framing is presentation language only, never a
// schema rename.
//
// Truthful states, never disguised: a database failure or missing
// provisioning shows "Cohorts unavailable" (with the full explanation on the
// NGRP page itself), an empty configured list shows "No cohorts configured",
// and neither is ever presented as a valid selection.
import { useState, useRef, useEffect } from 'react'
import Tooltip from '../ui/Tooltip'
import { CYCLE_CLOSED_STATUSES } from '../../lib/ngrp/ngrpStates'

// Approved status vocabulary (plan §10.1), colored like the ASPIRE cohort
// statuses: blue = planned/in progress, green = open/active, gray = done.
const STATUS_COLORS = {
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

const fmtDate = d => {
  if (!d) return null
  const [y, m, day] = String(d).split('T')[0].split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function HeaderChevron() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
}

export default function ResidencyCohortPicker({ status, cycles, activeCycle, onSelectCycle }) {
  const [open, setOpen] = useState(false)
  const areaRef = useRef(null)
  const triggerRef = useRef(null)

  useEffect(() => {
    const handler = e => { if (areaRef.current && !areaRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Keyboard completion: closing the dropdown (Escape, or a selection made by
  // Enter/Space/click) hands focus back to the trigger pill.
  const closeAndRefocus = () => { setOpen(false); triggerRef.current?.focus() }

  // The value line never fabricates a cohort and never presents a failure as
  // an empty list: unavailable ≠ unconfigured ≠ loading.
  const unavailable = status === 'unprovisioned' || status === 'error' || status === 'stale'
  const label = status === 'loading' ? 'Loading cohorts…'
    : unavailable ? 'Cohorts unavailable'
    : cycles.length === 0 ? 'No cohorts configured'
    : (activeCycle?.name || 'Select cohort')
  const isLive = Boolean(activeCycle) && OPEN_STATUSES.has(activeCycle.status)

  return (
    <div
      ref={areaRef}
      className="chart-cohort-area"
      onKeyDown={e => { if (e.key === 'Escape' && open) { e.stopPropagation(); closeAndRefocus() } }}
    >
      <Tooltip label="Switch cohort" placement="bottom">
        <button
          ref={triggerRef}
          data-tour="residency-cohort-switcher"
          aria-label="Switch residency cohort"
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
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 2 }}>Cohort</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, opacity: (unavailable || (status === 'ready' && cycles.length === 0)) ? 0.7 : 1 }}>{label}</span>
          <span style={{ opacity: 0.5, lineHeight: 0, marginLeft: 2 }}><HeaderChevron /></span>
        </button>
      </Tooltip>

      {open && (
        <div className="chart-cohort-dropdown" role="listbox" aria-label="Residency cohorts">
          <div style={{ padding: '10px 14px 6px', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--sand)' }}>
            Select Cohort
          </div>
          {status !== 'ready' || cycles.length === 0 ? (
            <div style={{ padding: '16px', fontSize: 12.5, color: '#6b7280' }}>
              {status === 'loading' && 'Loading cohorts…'}
              {unavailable && 'Cohorts could not be loaded right now. The Residency workspace shows what is wrong and how to resolve it.'}
              {status === 'ready' && cycles.length === 0 && 'No residency cohorts are configured yet. Cohorts are created in Planning.'}
            </div>
          ) : cycles.map(c => {
            // `cycles` arrives ordered (active → planned/open chronologically
            // → completed/archived) from orderCyclesForSelector.
            const isSel = c.id === activeCycle?.id
            const sc = STATUS_COLORS[c.status] || { bg: '#f3f4f6', color: '#6b7280' }
            const done = CYCLE_CLOSED_STATUSES.includes(c.status)
            const dates = [
              c.application_open_date && `Apps ${fmtDate(c.application_open_date)}${c.application_deadline ? `–${fmtDate(c.application_deadline)}` : ''}`,
              c.residency_start_date && `Starts ${fmtDate(c.residency_start_date)}`,
            ].filter(Boolean).join(' · ')
            return (
              // Native button: Enter/Space activation for free, no synthetic
              // key handling. Styling matches the previous rows exactly.
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={isSel}
                onClick={() => { onSelectCycle(c.id); closeAndRefocus() }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', border: 'none',
                  fontFamily: 'DM Sans, sans-serif',
                  padding: '14px 16px', cursor: 'pointer', opacity: done ? 0.75 : 1,
                  background: isSel ? '#e8edf8' : 'transparent',
                  borderLeft: isSel ? '3px solid #1d2567' : '3px solid transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--sand)' }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>{c.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 }}>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>{dates || ' '}</span>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 8 }}>
                    {c.status && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: sc.bg, color: sc.color }}>{c.status}</span>}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
