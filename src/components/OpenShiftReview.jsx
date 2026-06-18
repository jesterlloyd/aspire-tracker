// CLOCKOUT-DETECT-1 — Read-only "Open Shift Review" detector (Owner/Admin only).
//
// Lists the FULL population of currently open shifts (lifecycle_state = 'in_progress') for the
// active cohort and classifies each as: not overdue / clock-out may be overdue + emailable /
// clock-out may be overdue + no email on file. This previews the decision a future
// CLOCKOUT-NUDGE-1 cron would make — including the would-skip (no-email) cases — while staying
// strictly READ-ONLY: no email, no draft, no Resend, no cron, no DB write, no notification_log,
// no RPC. Thresholds + shift-type sourcing are reused ENTIRELY from shiftStatus.js (single
// source of truth, identical to SHIFT-VIS-1) — no duplicated or divergent logic here.
//
// Email availability is a read-only classification only: personal_email then school_email
// (precedence matches SR-2b-2). Nothing is ever sent or drafted.
import { useState, useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { shiftTypeOf, shiftBadge, openShiftMs, formatDuration, isClockoutMaybeOverdue } from '../lib/shiftStatus'

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'

function fmtCheckedIn(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return sameDay ? time : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`
}

export default function OpenShiftReview({ openLogs = [], students = [], onSelectStudent }) {
  const [open, setOpen] = useState(false)

  const rows = useMemo(() => {
    const list = openLogs.map(log => {
      const stu = students.find(s => s.id === log.student_id) || null
      const shiftType = shiftTypeOf(log)
      const overdue = isClockoutMaybeOverdue(log)
      // Read-only email classification: personal first, then school.
      const email = stu ? (stu.personal_email || stu.school_email || '') : ''
      const klass = !overdue ? 'ok' : (email ? 'overdue_email' : 'overdue_no_email')
      return { log, stu, shiftType, overdue, email, klass, ms: openShiftMs(log) ?? 0 }
    })
    // Longest-open first — the most likely forgotten clock-outs surface at the top.
    return list.sort((a, b) => b.ms - a.ms)
  }, [openLogs, students])

  const counts = useMemo(() => ({
    total:    rows.length,
    overdue:  rows.filter(r => r.overdue).length,
    emailable: rows.filter(r => r.klass === 'overdue_email').length,
    noEmail:  rows.filter(r => r.klass === 'overdue_no_email').length,
  }), [rows])

  if (rows.length === 0) return null

  const th = { padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b7280', whiteSpace: 'nowrap' }
  const td = { padding: '9px 12px', fontSize: 12.5, color: '#374151', verticalAlign: 'top' }

  return (
    <div style={{ margin: '8px 0 24px', fontFamily: F }}>
      <div style={{
        background: '#fff', border: '1px solid #e8e4dc', borderRadius: 14,
        boxShadow: '0 1px 3px rgba(25,25,25,0.06)', overflow: 'hidden',
      }}>
        {/* Header / toggle */}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px',
            background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: F,
          }}
        >
          <ChevronRight size={16} strokeWidth={2.2} style={{ color: '#6b7280', flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#191919' }}>Open Shift Review</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Chip fg="#4A5560" bg="#F4F3F1" n={counts.total} label="open" />
            <Chip fg="#92400e" bg="#FBF5E8" n={counts.overdue} label="may be overdue" />
            <Chip fg="#166534" bg="#EDF7F0" n={counts.emailable} label="emailable" />
            <Chip fg="#991b1b" bg="#FEECEC" n={counts.noEmail} label="no email" />
          </span>
        </button>

        {open && (
          <div style={{ borderTop: '1px solid #f1efe9' }}>
            <div style={{ padding: '8px 16px 0', fontSize: 11.5, color: '#9ca3af' }}>
              Read-only review of currently open shifts. “May be overdue” is a hedged estimate from
              conservative thresholds — not a confirmed missed clock-out. No notifications are sent.
            </div>
            <div style={{ overflowX: 'auto', padding: '8px 6px 12px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: F }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #eee7da' }}>
                    {['Student', 'School · Program', 'Shift', 'Checked in', 'Open', 'Status', 'Email'].map(h => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ log, stu, shiftType, overdue, email, klass, ms }) => {
                    const name = stu ? `${stu.first_name || ''} ${stu.last_name || ''}`.trim() || '—' : 'Unknown student'
                    const schoolProg = stu ? [stu.school, stu.program_type].filter(Boolean).join(' · ') : ''
                    return (
                      <tr key={log.id} style={{ borderBottom: '1px solid #f5f3ee' }}>
                        <td style={{ ...td, fontWeight: 600, color: '#191919' }}>
                          {onSelectStudent && stu ? (
                            <button type="button" onClick={() => onSelectStudent(stu.id)}
                              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: NAVY, fontWeight: 600, fontFamily: F, fontSize: 12.5 }}>
                              {name}
                            </button>
                          ) : name}
                        </td>
                        <td style={{ ...td, color: '#6b7280' }}>{schoolProg || '—'}</td>
                        <td style={td}>{shiftBadge(shiftType).label}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtCheckedIn(log.checked_in_at)}</td>
                        <td style={{ ...td, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatDuration(ms)}</td>
                        <td style={td}>
                          {overdue
                            ? <span style={{ fontWeight: 700, color: '#92400e' }}>Clock-out may be overdue</span>
                            : <span style={{ color: '#6b7280' }}>Within window</span>}
                        </td>
                        <td style={td}>
                          {klass === 'overdue_no_email'
                            ? <span style={{ fontWeight: 700, color: '#991b1b' }}>No email on file</span>
                            : email
                              ? <span style={{ color: '#374151' }}>{email}</span>
                              : <span style={{ color: '#9ca3af' }}>—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Chip({ fg, bg, n, label }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: fg, background: bg, borderRadius: 8, padding: '3px 9px', whiteSpace: 'nowrap' }}>
      <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{n}</span> {label}
    </span>
  )
}
