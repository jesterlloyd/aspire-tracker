// ClinicalHoursPanel — shared, read-only clinical-hours summary + shift-log table extracted
// verbatim from StudentSidePanel so Student Profiles and Rotation > Activity render the SAME
// totals, table, and Shift Details modal (no duplicated math, no second modal).
//
// Totals (Required / Approved / Pending / Remaining) come from the student record fields
// (hours_required / approved_hours / pending_hours) — the canonical source the profile uses.
// The caller supplies `shiftLogs` (cached per student via React Query, queryKey
// ['student_shift_logs', student.id]) so each surface controls its own fetch + side effects.
import { useState } from 'react'
import { Info } from 'lucide-react'
import ShiftDetailsModal from './ShiftDetailsModal'

export default function ClinicalHoursPanel({ student, shiftLogs = [] }) {
  const [selectedShift, setSelectedShift] = useState(null)
  const data = student || {}

  const req = parseFloat(data.hours_required || 0)
  const apv = parseFloat(data.approved_hours || 0)
  const pnd = parseFloat(data.pending_hours || 0)
  const rem = Math.max(0, req - apv)
  const pct = req > 0 ? Math.min(100, (apv / req) * 100) : 0

  return (
    <>
      {/* Summary numbers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 10 }}>
        {[['Required', req], ['Approved', apv], ['Pending', pnd], ['Remaining', rem]].map(([lbl, val]) => (
          <div key={lbl} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--nightfall)', lineHeight: 1 }}>{val}</div>
            <div style={{ fontSize: 11, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 2 }}>{lbl}</div>
          </div>
        ))}
      </div>
      <div style={{ height: 10, borderRadius: 12, background: '#f3f4f6', overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ height: '100%', borderRadius: 12, width: `${pct}%`,
          background: pct >= 100 ? '#166534' : pct >= 80 ? '#166534' : 'var(--nightfall)',
          transition: 'width 600ms ease' }}>
          {pct >= 100 && <span style={{ fontSize: 9, color: '#fff', paddingLeft: 4 }}>✓</span>}
        </div>
      </div>

      {/* Shift log table */}
      {shiftLogs.length === 0 ? (
        <p style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic', margin: 0 }}>No shifts logged yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--sand)' }}>
                {['Date', 'Hrs', 'Unit', 'Preceptor', 'Type', 'Status', 'Details', ''].map(h => (
                  <th key={h} style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 700, color: '#6b7280', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shiftLogs.map(log => (
                <tr key={log.id} style={{ borderBottom: '1px solid var(--border-lt)' }}>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                    {log.shift_date ? new Date(log.shift_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                  </td>
                  <td style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--nightfall)' }}>{log.total_hours}</td>
                  <td style={{ padding: '6px 8px', color: '#6b7280', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.unit_name || '—'}</td>
                  <td style={{ padding: '6px 8px', color: '#6b7280', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.preceptor_name || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10,
                      background: log.shift_type === 'Night' ? '#1d2567' : '#eff6ff',
                      color: log.shift_type === 'Night' ? '#fff' : '#1d4ed8' }}>{log.shift_type || 'Day'}</span>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {(() => {
                      const STATUS_STYLES = {
                        'Auto-Accepted':  { bg: '#D1FAE5', text: '#065F46', label: 'Auto-Accepted' },
                        'Pending Review': { bg: '#FEF3C7', text: '#78350F', label: 'Pending Review' },
                        'Approved':       { bg: '#DBEAFE', text: '#1E40AF', label: 'Approved' },
                        'Rejected':       { bg: '#FEE2E2', text: '#7F1D1D', label: 'Rejected' },
                        'Edited':         { bg: '#E0E7FF', text: '#3730A3', label: 'Edited' },
                        // legacy values (pre-migration rows)
                        'approved':       { bg: '#D1FAE5', text: '#065F46', label: 'Approved' },
                        'needs_review':   { bg: '#FEF3C7', text: '#78350F', label: 'Pending Review' },
                        'rejected':       { bg: '#FEE2E2', text: '#7F1D1D', label: 'Rejected' },
                      }
                      const s = STATUS_STYLES[log.status] || { bg: '#F3F4F6', text: '#6B7280', label: log.status || '—' }
                      return (
                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, background: s.bg, color: s.text, fontWeight: 600, fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap' }}>
                          {s.label}
                        </span>
                      )
                    })()}
                  </td>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                    {/* SUPPORT-NEEDED-VISIBILITY-1: amber dot flags a shift whose support-needed note
                        is non-empty, so the specific entry is easy to find; the full text stays in the
                        Details modal (ShiftDetailsModal "Support requested" callout). */}
                    {(log.support_needed || '').trim() && (
                      <span
                        aria-label="Support needed"
                        title="This shift has a support-needed note — open Details"
                        style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: '#d97706', marginRight: 6, verticalAlign: 'middle' }}
                      />
                    )}
                    <button
                      onClick={() => setSelectedShift(log)}
                      aria-label="View shift details"
                      title="View shift details"
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 2, verticalAlign: 'middle' }}
                    >
                      <Info size={16} />
                    </button>
                  </td>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                    {/* WS1e-A4: per-shift approve/adjust/reject controls disabled — approved
                        and pending hours are calculated from submitted shift logs and cannot
                        be edited directly. Read-only status only. */}
                    {['Pending Review', 'needs_review'].includes(log.status) && (
                      <span style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}
                        title="Approved and pending hours are calculated from submitted shift logs and cannot be edited directly.">
                        Pending review
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Read-only Shift Details modal (shared component) */}
      <ShiftDetailsModal shift={selectedShift} onClose={() => setSelectedShift(null)} />
    </>
  )
}
