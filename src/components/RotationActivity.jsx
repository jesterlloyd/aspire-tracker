// ROTATION-ACTIVITY-OVERSIGHT — Rotation > Activity is a two-section oversight board:
//   1. On Campus Now      — live presence (the EXISTING read-only OpenShiftReview, unchanged).
//   2. Active Rotation     — every student with status 'Active Rotation', incl. those not on
//      Progress              campus today, with rotation progress + follow-up indicators.
// Read-only. Owner/Admin-only (canEdit). No writes/email/cron/RPC. Progress math mirrors the
// Student Profile (approved_hours / hours_required); no-recent-log mirrors Action Center act15.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import OpenShiftReview from './OpenShiftReview'
import ClinicalHoursPanel from './ClinicalHoursPanel'
import { getStudentPreferredFullName } from '../lib/studentNameFormatters'
import { resolvePreceptor } from '../lib/preceptor'

const F = 'DM Sans, sans-serif'
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000
const NEARING_PCT = 85 // matches priorities.js "nearing completion" (>= 85% of required hours)

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ margin: '18px 2px 8px' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#191919', fontFamily: F }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, fontFamily: F }}>{subtitle}</div>}
    </div>
  )
}

function EmptyCard({ children }) {
  return (
    <div style={{
      margin: '8px 0', padding: '24px 20px', textAlign: 'center',
      background: '#fff', border: '1px solid #e8e4dc', borderRadius: 14,
      color: '#6b7280', fontSize: 13.5, fontFamily: F,
    }}>{children}</div>
  )
}

function Badge({ label, tone }) {
  const tones = {
    sage:  { bg: '#eef6ee', color: '#2F7D5C', border: '#cfe6d6' },
    amber: { bg: '#fdf6ec', color: '#92400e', border: '#f0c9b0' },
    rose:  { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
    green: { bg: '#ecfdf3', color: '#166534', border: '#bbf7d0' },
  }[tone] || { bg: '#f3f4f6', color: '#4b5563', border: '#e5e7eb' }
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap',
      background: tones.bg, color: tones.color, border: `1px solid ${tones.border}`, fontFamily: F,
    }}>{label}</span>
  )
}

// Expanded clinical-hours detail for one student. Fetches the SAME per-student shift-log
// query as the Student Profile (shared React Query cache key) and renders the shared
// ClinicalHoursPanel — same totals, table, and Shift Details modal.
function ActiveRotationHours({ student }) {
  const { data: shiftLogs = [], isLoading } = useQuery({
    queryKey: ['student_shift_logs', student.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('student_shift_logs')
        .select('*').eq('student_id', student.id)
        .order('shift_date', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!student.id,
  })
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #eee' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10, fontFamily: F }}>
        Clinical Hours
      </div>
      {isLoading
        ? <div style={{ fontSize: 12.5, color: '#9ca3af', fontFamily: F }}>Loading hours…</div>
        : <ClinicalHoursPanel student={student} shiftLogs={shiftLogs} />}
    </div>
  )
}

function ProgressRowCard({ card, expanded, onToggle, onOpen }) {
  const { s, req, apv, pct, lastLog, daysSince, noRecentLog, missingPreceptor, onCampus,
          precName, unitName, complete, nearComplete, shift, school, range } = card
  const name = getStudentPreferredFullName(s)
  const barColor = pct >= 80 ? '#166534' : '#1D2567'
  const lastLogText = lastLog
    ? `Last log ${new Date(lastLog).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` +
      (daysSince != null ? ` · ${daysSince === 0 ? 'today' : `${daysSince}d ago`}` : '')
    : 'No shifts logged yet'

  const metaLine = [school, unitName, shift].filter(Boolean).join(' · ') || '—'

  return (
    <div style={{
      padding: '13px 16px', marginBottom: 8, background: '#fff',
      border: '1px solid #e8e4dc', borderRadius: 12, fontFamily: F,
    }}>
     <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
      {/* Identity + meta */}
      <div style={{ flex: '1 1 240px', minWidth: 200 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#1D2567' }}>{name}</span>
          {onCampus && <Badge label="On campus now" tone="sage" />}
          {missingPreceptor && <Badge label="No preceptor" tone="rose" />}
          {noRecentLog && <Badge label="No recent log" tone="amber" />}
          {complete ? <Badge label="Complete" tone="green" />
            : nearComplete ? <Badge label="Near complete" tone="amber" /> : null}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>{metaLine}</div>
        <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 2 }}>
          Preceptor: {precName || '—'}{range ? ` · ${range}` : ''}
        </div>
      </div>

      {/* Progress */}
      <div style={{ flex: '1 1 200px', minWidth: 180, maxWidth: 280 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#374151', marginBottom: 4 }}>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{apv} / {req || '—'} hrs</span>
          <span style={{ fontWeight: 700, color: barColor }}>{Math.round(pct)}%</span>
        </div>
        <div style={{ height: 8, borderRadius: 12, background: '#f3f4f6', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, borderRadius: 12, background: barColor, transition: 'width 400ms ease' }} />
        </div>
        <div style={{ fontSize: 11, color: noRecentLog ? '#92400e' : '#9ca3af', marginTop: 4 }}>{lastLogText}</div>
      </div>

      {/* Actions: View Hours (primary, inline expand) + secondary Profile link */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          style={{
            fontSize: 12, fontWeight: 600, color: '#1D2567', background: 'rgba(29,37,103,0.07)',
            border: '1px solid rgba(29,37,103,0.15)', borderRadius: 8, padding: '7px 12px',
            cursor: 'pointer', fontFamily: F, whiteSpace: 'nowrap',
          }}>
          {expanded ? 'Hide Hours ▴' : 'View Hours ▾'}
        </button>
        {onOpen && (
          <button
            onClick={() => onOpen(s.id)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: F, fontSize: 11, fontWeight: 600, color: '#9ca3af' }}>
            Profile →
          </button>
        )}
      </div>
     </div>

      {/* Expanded clinical-hours detail (shared ClinicalHoursPanel) */}
      {expanded && <ActiveRotationHours student={s} />}
    </div>
  )
}

export default function RotationActivity({ students = [], units = [], cohortId, onNavigateToStudent }) {
  const { canEdit } = useAuth()
  const [expandedId, setExpandedId] = useState(null)

  // Full open-shift population (in_progress) for the cohort — read-only SELECT, unchanged.
  const { data: openLogs = [] } = useQuery({
    queryKey: ['rotation_open_shifts', cohortId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_shift_logs')
        .select('id, student_id, checked_in_at, lifecycle_state, planned_shift_type, planned_unit_name, planned_preceptor_name, unit_name, preceptor_name')
        .eq('cohort_id', cohortId)
        .eq('lifecycle_state', 'in_progress')
        .order('checked_in_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!cohortId && canEdit,
    refetchInterval: 60 * 1000,
  })

  // Per-student last-log summary for the Active Rotation Progress section. Computed in the
  // async query (not during render) so the board stays free of impure render-time Date calls.
  // "No recent log" = no submitted shift in the last 7 days (mirrors Action Center act15).
  const { data: logSummary = {} } = useQuery({
    queryKey: ['rotation_log_summary', cohortId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_shift_logs')
        .select('student_id, submitted_at')
        .eq('cohort_id', cohortId)
      if (error) throw error
      const now = Date.now()
      const latest = {}
      for (const l of (data || [])) {
        if (!l.submitted_at) continue
        const t = new Date(l.submitted_at).getTime()
        if (!latest[l.student_id] || t > latest[l.student_id].t) latest[l.student_id] = { t, iso: l.submitted_at }
      }
      const summary = {}
      for (const [sid, v] of Object.entries(latest)) {
        summary[sid] = {
          lastLog: v.iso,
          daysSince: Math.floor((now - v.t) / (24 * 3600 * 1000)),
          noRecentLog: (now - v.t) > SEVEN_DAYS_MS,
        }
      }
      return summary
    },
    enabled: !!cohortId && canEdit,
    refetchInterval: 60 * 1000,
  })

  if (!canEdit) return null // Owner/Admin-only, carried over from CLOCKOUT-DETECT-1.

  const onCampusIds = new Set(openLogs.map(l => l.student_id))

  const cards = students
    .filter(s => s.status === 'Active Rotation')
    .map(s => {
      const req = parseFloat(s.hours_required || 0)
      const apv = parseFloat(s.approved_hours || 0)
      const pct = req > 0 ? Math.min(100, (apv / req) * 100) : 0
      const log = logSummary[s.id] || null
      const prec = resolvePreceptor(s)
      const unit = units.find(u => u.id === s.matched_unit_id)
      return {
        s, req, apv, pct,
        lastLog: log?.lastLog || null,
        daysSince: log?.daysSince ?? null,
        noRecentLog: !log || log.noRecentLog,
        missingPreceptor: !s.preceptor_id && !(s.matched_preceptor || '').trim(),
        onCampus: onCampusIds.has(s.id),
        precName: prec.name,
        unitName: unit?.unit_name || '',
        shift: s.shift_assigned || '',
        school: s.school || '',
        range: (s.term_dates || '').trim(),
        complete: pct >= 100,
        nearComplete: pct >= NEARING_PCT && pct < 100,
      }
    })
    // Risk-first: missing preceptor / no recent log → lowest progress → name. (On-campus is a
    // badge, never an exclusion or de-prioritization.)
    .sort((a, b) => {
      const ar = (a.missingPreceptor || a.noRecentLog) ? 0 : 1
      const br = (b.missingPreceptor || b.noRecentLog) ? 0 : 1
      if (ar !== br) return ar - br
      if (a.pct !== b.pct) return a.pct - b.pct
      return getStudentPreferredFullName(a.s).localeCompare(getStudentPreferredFullName(b.s))
    })

  return (
    <div style={{ padding: '4px 20px 24px', fontFamily: F }}>
      {/* ── Section 1: On Campus Now (existing review, unchanged) ── */}
      <SectionHeader title="On Campus Now" subtitle="Students checked in or active on campus right now." />
      {openLogs.length === 0 ? (
        <EmptyCard>No open shifts right now.</EmptyCard>
      ) : (
        <OpenShiftReview openLogs={openLogs} students={students} units={units} defaultOpen />
      )}

      {/* ── Section 2: Active Rotation Progress (new) ── */}
      <SectionHeader
        title="Active Rotation Progress"
        subtitle="All students currently in active rotation, including those not on campus today."
      />
      {cards.length === 0 ? (
        <EmptyCard>No students are in active rotation right now.</EmptyCard>
      ) : (
        cards.map(card => (
          <ProgressRowCard
            key={card.s.id}
            card={card}
            expanded={expandedId === card.s.id}
            onToggle={() => setExpandedId(prev => (prev === card.s.id ? null : card.s.id))}
            onOpen={onNavigateToStudent}
          />
        ))
      )}
    </div>
  )
}
