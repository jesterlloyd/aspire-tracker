// src/components/Header/scope/ResidencyCohortList.jsx
//
// SCOPE-PICKER-1: the residency cohort rows, lifted VERBATIM out of
// ResidencyCohortPicker when the Experience and Cohort pills merged into one Scope
// picker. Rows, status colors, the dates line and the closed-cycle dimming are
// unchanged; only the pill and dropdown chrome around them went away.
//
// TRUTHFUL STATES, NEVER DISGUISED (carried over from the original): a database
// failure or missing provisioning shows "Cohorts unavailable" with the full
// explanation on the NGRP page itself, an empty configured list shows "No cohorts
// configured", and neither is ever presented as a valid selection. The pill says the
// same thing, because both read src/lib/scopePickerLabels.js.
//
// To users these are simply "cohorts"; internally each row is an ngrp_cycles record
// and the API keeps cycle_id. The cohort framing is presentation language only, never
// a schema rename.
//
// DELIBERATELY UNCHANGED: grouping, ordering, and which statuses surface. The
// residency workspace shipped a day before this picker was reworked, so that judgment
// is left open for real use rather than being quietly revised here.
//
// NGRP-PLANNING-2: the footer. Residency cohort administration used to live in a
// workspace tab while Internship cohort administration lived right here, so the same
// act was learned twice. Both lists now end in the same two buttons. Edit Cohort opens
// the residency settings modal (the six configuration cards that were the Planning
// tab); Add Cohort opens the create dialog. Both are gated on ngrp_manage, the way the
// ASPIRE footer is gated on canEdit - a viewer sees the list and no footer at all.
import { CYCLE_CLOSED_STATUSES } from '../../../lib/ngrp/ngrpStates'
import { residencyUnavailable } from '../../../lib/scopePickerLabels'

// Approved status vocabulary (plan §10.1), colored like the ASPIRE cohort statuses:
// blue = planned/in progress, green = open/active, gray = done.
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

const fmtDate = d => {
  if (!d) return null
  const [y, m, day] = String(d).split('T')[0].split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ResidencyCohortList({
  status, cycles = [], activeCycle, onSelectCycle, onDone,
  canManage = false, onManageCycle, onNewCycle,
}) {
  // The footer is the ONLY way to add a cohort when none exist, so it renders in
  // the empty state too - just without Edit, which has nothing to edit.
  const footer = canManage && (onManageCycle || onNewCycle) ? (
    <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderTop: '1px solid #f3f4f6', background: 'var(--sand)' }}>
      {activeCycle && onManageCycle && (
        <button type="button" onClick={() => { onManageCycle(); onDone?.() }}
          style={{ flex: 1, padding: '7px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 12, cursor: 'pointer', color: '#374151' }}>
          ✏ Edit Cohort
        </button>
      )}
      {onNewCycle && (
        <button type="button" onClick={() => { onNewCycle(); onDone?.() }}
          style={{ flex: 1, padding: '7px', background: '#1D2567', border: 'none', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#fff' }}>
          + Add Cohort
        </button>
      )}
    </div>
  ) : null

  if (status !== 'ready' || cycles.length === 0) {
    return (
      <>
        <div style={{ padding: '16px', fontSize: 12.5, color: '#6b7280', fontFamily: 'DM Sans, sans-serif' }} role="status">
          {status === 'loading' && 'Loading cohorts…'}
          {residencyUnavailable(status) && 'Cohorts could not be loaded right now. The Residency workspace shows what is wrong and how to resolve it.'}
          {status === 'ready' && cycles.length === 0 && 'No residency cohorts are configured yet.'}
        </div>
        {status === 'ready' && cycles.length === 0 && footer}
      </>
    )
  }
  return (
    <>
      <div className="chart-scope-rows" role="listbox" aria-label="Residency cohorts">
      {cycles.map(c => {
        // `cycles` arrives ordered (active -> planned/open chronologically ->
        // completed/archived) from orderCyclesForSelector.
        const isSel = c.id === activeCycle?.id
        const sc = STATUS_COLORS[c.status] || { bg: '#f3f4f6', color: '#6b7280' }
        const done = CYCLE_CLOSED_STATUSES.includes(c.status)
        const dates = [
          c.application_open_date && `Apps ${fmtDate(c.application_open_date)}${c.application_deadline ? `–${fmtDate(c.application_deadline)}` : ''}`,
          c.residency_start_date && `Starts ${fmtDate(c.residency_start_date)}`,
        ].filter(Boolean).join(' · ')
        return (
          <button
            key={c.id}
            type="button"
            role="option"
            aria-selected={isSel}
            onClick={() => { onSelectCycle(c.id); onDone?.() }}
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
      {footer}
    </>
  )
}
