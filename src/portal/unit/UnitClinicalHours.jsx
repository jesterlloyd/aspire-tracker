// src/portal/unit/UnitClinicalHours.jsx
//
// The Clinical Hours section inside the Unit Leader student profile drawer. It REUSES the
// canonical clinical-hours calculation (deriveClinicalHours) and the canonical status-chip
// vocabulary (shiftStatusChips), and mirrors the main-app Clinical Hours presentation
// (Required / Approved / Pending / Remaining tiles + progress bar + logged-shift table).
//
// It is ROLE-SAFE BY CONSTRUCTION. Unlike the staff ClinicalHoursPanel it does NOT mount the
// support-request reads, the support-needed dot, or the ShiftDetailsModal (which exposes the
// private support narrative, the learning highlight, and the internal review reason). The
// Details column here is a read-only, non-identifying note only. The rows come from a
// server-scoped endpoint that re-checks the student against the caller's active unit scope
// and returns only quantitative + status fields.

import { deriveClinicalHours } from '../../lib/portalProgress'
import { shiftStatusChip, isPendingReview } from '../../lib/shiftStatusChips'

const NAVY = '#1D2567'

function fmtShiftDate(ymd) {
  if (!ymd) return '-'
  const d = new Date(`${ymd}T12:00:00`)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function UnitClinicalHours({ hours, shifts, loading, error, onRetry }) {
  if (loading) return <p className="ptl-muted" style={{ margin: 0, fontSize: 13 }} role="status">Loading clinical hours…</p>
  if (error) {
    return (
      <p className="ptl-muted" style={{ margin: 0, fontSize: 13 }} role="alert">
        Clinical hours could not be loaded.{' '}
        {onRetry && <button type="button" className="ptl-linklike" onClick={onRetry}>Try again</button>}
      </p>
    )
  }

  const required = hours?.required ?? null
  const approved = hours?.approved ?? 0
  const pending = hours?.pending ?? 0
  const d = deriveClinicalHours({ required, approved, pending })
  const remaining = d.reliable ? d.remaining : null
  const pct = d.reliable ? d.pct : 0
  const rows = Array.isArray(shifts) ? shifts : []

  const tiles = [
    ['Required', required ?? '-'],
    ['Approved', approved],
    ['Pending', pending],
    ['Remaining', remaining ?? '-'],
  ]

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 10 }}>
        {tiles.map(([lbl, val]) => (
          <div key={lbl} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: NAVY, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{val}</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 2 }}>{lbl}</div>
          </div>
        ))}
      </div>
      {d.reliable && (
        <div style={{ height: 10, borderRadius: 12, background: '#f3f4f6', overflow: 'hidden', marginBottom: 12 }}>
          <div style={{ height: '100%', borderRadius: 12, width: `${pct}%`, background: pct >= 80 ? '#166534' : NAVY, transition: 'width 600ms ease' }} />
        </div>
      )}

      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic', margin: 0 }}>No shifts logged yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#faf9f5' }}>
                {['Date', 'Hrs', 'Unit', 'Preceptor', 'Type', 'Status', 'Details'].map(h => (
                  <th key={h} style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 700, color: '#6b7280', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(log => {
                const chip = shiftStatusChip(log.status)
                return (
                  <tr key={log.id} style={{ borderBottom: '1px solid #eef0f2' }}>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{fmtShiftDate(log.shift_date)}</td>
                    <td style={{ padding: '6px 8px', fontWeight: 600, color: NAVY }}>{log.total_hours ?? '-'}</td>
                    <td style={{ padding: '6px 8px', color: '#6b7280', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.unit_name || '-'}</td>
                    <td style={{ padding: '6px 8px', color: '#6b7280', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.preceptor_name || '-'}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10,
                        background: log.shift_type === 'Night' ? NAVY : '#eff6ff',
                        color: log.shift_type === 'Night' ? '#fff' : '#1d4ed8' }}>{log.shift_type || 'Day'}</span>
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: chip.bg, color: chip.text, fontWeight: 600, whiteSpace: 'nowrap' }}>{chip.label}</span>
                    </td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      {/* Role-safe note only: never the private support text or internal review reason. */}
                      {isPendingReview(log.status)
                        ? <span style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>Pending review</span>
                        : <span style={{ color: '#9ca3af' }}>-</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
