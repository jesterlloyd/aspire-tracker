// ROTATION-ACTIVITY-OVERSIGHT — Rotation > Activity is a two-section oversight board:
//   1. On Campus Now      — live presence (the EXISTING read-only OpenShiftReview, unchanged).
//   2. Active Rotation     — every student with status 'Active Rotation', incl. those not on
//      Progress              campus today, with rotation progress + follow-up indicators.
// Read-only. Owner/Admin-only (canEdit). No writes/email/cron/RPC. Progress math mirrors the
// Student Profile (approved_hours / hours_required); no-recent-log mirrors Action Center act15.
import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import OpenShiftReview from './OpenShiftReview'
import ClinicalHoursPanel from './ClinicalHoursPanel'
import { getStudentPreferredFullName } from '../lib/studentNameFormatters'
import { resolvePreceptor } from '../lib/preceptor'
import { canonicalRotationWindow } from '../lib/rotationWindow'

// Compact canonical rotation range for a card: "Mon D – Mon D" from the linked
// cohort_school_rotations row, else legacy students.term_dates, else '' (omit).
const fmtRangeDate = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function resolveRotationRange(student, rotationRow) {
  const win = canonicalRotationWindow(rotationRow)
  if (win) return `${fmtRangeDate(win.start)} – ${fmtRangeDate(win.end)}`
  return (student.term_dates || '').trim()
}

const F = 'DM Sans, sans-serif'
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000
const NEARING_PCT = 85 // matches priorities.js "nearing completion" (>= 85% of required hours)

const SORT_OPTIONS = [
  { key: 'attention',  label: 'Needs attention' },
  { key: 'hours_desc', label: 'Closest to completion' },
  { key: 'hours_asc',  label: 'Least hours completed' },
  { key: 'name',       label: 'Name A–Z' },
  { key: 'school',     label: 'School A–Z' },
]

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ margin: '18px 2px 8px' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#191919', fontFamily: F }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, fontFamily: F }}>{subtitle}</div>}
    </div>
  )
}

function SortControl({ value, onChange }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b7280', fontFamily: F, whiteSpace: 'nowrap' }}>
      Sort by
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          fontFamily: F, fontSize: 13, padding: '6px 9px', borderRadius: 8,
          border: '1px solid #e0ddd3', background: '#fff', color: '#191919', cursor: 'pointer',
        }}>
        {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </label>
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

function ProgressRowCard({ card, expanded, onToggle, onOpen, innerRef, highlighted }) {
  const { s, req, apv, pct, lastLog, daysSince, noRecentLog, missingPreceptor, onCampus,
          precName, unitName, complete, nearComplete, shift, school, range, supportNeeded } = card
  const name = getStudentPreferredFullName(s)
  const barColor = pct >= 80 ? '#166534' : '#1D2567'
  const lastLogText = lastLog
    ? `Last log ${new Date(lastLog).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` +
      (daysSince != null ? ` · ${daysSince === 0 ? 'today' : `${daysSince}d ago`}` : '')
    : 'No shifts logged yet'

  const metaLine = [school, unitName, shift].filter(Boolean).join(' · ') || '—'

  return (
    <div ref={innerRef} style={{
      padding: '13px 16px', marginBottom: 8,
      background: highlighted ? '#f7f9ff' : '#fff',
      border: `1px solid ${highlighted ? '#1D2567' : '#e8e4dc'}`,
      boxShadow: highlighted ? '0 0 0 2px rgba(29,37,103,0.25)' : 'none',
      borderRadius: 12, fontFamily: F,
      // Clear the sticky top nav + Rotation tab header if scrollIntoView nudges the window.
      scrollMarginTop: 88,
      transition: 'box-shadow 0.4s ease, border-color 0.4s ease, background 0.4s ease',
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
          {/* SUPPORT-NEEDED-VISIBILITY-1: clickable badge when this student has ≥1 shift log with a
              non-empty support-needed note. Clicking opens View Hours (details) so the ASPIRE team can
              read the request without hunting through every shift. Support amber matches the
              "Support requested" callout in the shift-details modal. */}
          {supportNeeded > 0 && (
            <button
              type="button"
              onClick={() => { if (!expanded) onToggle() }}
              title="View the support request in View Hours"
              aria-label={`Support needed${supportNeeded > 1 ? ` (${supportNeeded} entries)` : ''}. Open View Hours.`}
              style={{
                fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap',
                background: '#FBF5E8', color: '#8B5E1A', border: '1px solid #f0c9b0', fontFamily: F,
                cursor: 'pointer',
              }}
            >
              {supportNeeded > 1 ? `Support needed · ${supportNeeded}` : 'Support needed'}
            </button>
          )}
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

export default function RotationActivity({ students = [], units = [], cohortId, onNavigateToStudent, focusStudentId, onFocusConsumed }) {
  const { canEdit } = useAuth()
  const [expandedId, setExpandedId] = useState(null)
  const [sortMode, setSortMode] = useState('attention')
  const [highlightId, setHighlightId] = useState(null)
  const cardRefs = useRef({})   // { [studentId]: card element } — for scroll-into-view
  const focusTimers = useRef([]) // pending scroll/highlight cancelers — cleared on new focus / unmount

  // Expand + scroll + highlight the matching Active Rotation Progress card. Shared by the
  // Aggregate handoff (focusStudentId prop) AND the in-page On Campus Now row click. No-op if
  // the student is not in active rotation. The scroll is deferred past the route/subtab
  // (display:none→block) AND the expanded-card layout pass — a short timeout + double rAF — so
  // it lands on the card's final position. Pending handles are tracked in a ref so a NEW focus
  // cancels the previous, and the unmount effect clears any pending.
  const focusOnStudent = useCallback((id) => {
    if (!id) return
    const inActive = students.some(s => s.id === id && s.status === 'Active Rotation')
    if (!inActive) return // safe no-op fallback
    focusTimers.current.forEach(fn => fn()); focusTimers.current = []
    setExpandedId(id)
    const t = setTimeout(() => {
      const r1 = requestAnimationFrame(() => {
        const r2 = requestAnimationFrame(() => {
          cardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          setHighlightId(id)
          const h = setTimeout(() => setHighlightId(prev => (prev === id ? null : prev)), 1800)
          focusTimers.current.push(() => clearTimeout(h))
        })
        focusTimers.current.push(() => cancelAnimationFrame(r2))
      })
      focusTimers.current.push(() => cancelAnimationFrame(r1))
    }, 80)
    focusTimers.current.push(() => clearTimeout(t))
  }, [students])

  // Aggregate > On Campus Now handoff: consume the one-time target.
  useEffect(() => {
    if (!focusStudentId) return
    focusOnStudent(focusStudentId) // eslint-disable-line react-hooks/set-state-in-effect
    onFocusConsumed?.()
  }, [focusStudentId, focusOnStudent, onFocusConsumed])

  // Clear any pending scroll/highlight timers if the component unmounts mid-sequence.
  useEffect(() => () => { focusTimers.current.forEach(fn => fn()); focusTimers.current = [] }, [])

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
      // SUPPORT-NEEDED-VISIBILITY-1: also read support_needed (same table/rows, no schema/RLS change)
      // so a per-student "Support needed" badge can render on the card without opening View Hours.
      const { data, error } = await supabase
        .from('student_shift_logs')
        .select('student_id, submitted_at, support_needed')
        .eq('cohort_id', cohortId)
      if (error) throw error
      const now = Date.now()
      const latest = {}
      const supportCount = {}
      for (const l of (data || [])) {
        // A support entry exists when the textbox is non-empty after trimming (null/blank = none).
        if ((l.support_needed || '').trim()) supportCount[l.student_id] = (supportCount[l.student_id] || 0) + 1
        if (!l.submitted_at) continue
        const t = new Date(l.submitted_at).getTime()
        if (!latest[l.student_id] || t > latest[l.student_id].t) latest[l.student_id] = { t, iso: l.submitted_at }
      }
      const summary = {}
      const ids = new Set([...Object.keys(latest), ...Object.keys(supportCount)])
      for (const sid of ids) {
        const v = latest[sid]
        summary[sid] = {
          lastLog: v ? v.iso : null,
          daysSince: v ? Math.floor((now - v.t) / (24 * 3600 * 1000)) : null,
          noRecentLog: v ? (now - v.t) > SEVEN_DAYS_MS : true,
          supportNeeded: supportCount[sid] || 0,
        }
      }
      return summary
    },
    enabled: !!cohortId && canEdit,
    refetchInterval: 60 * 1000,
  })

  // Canonical rotation date windows (coordinator-owned cohort_school_rotations) for the cohort,
  // mapped by row id. Students link via students.cohort_school_rotation_id. Read-only SELECT on
  // the same table other surfaces already query client-side. Rotation dates change rarely.
  const { data: rotationById = {} } = useQuery({
    queryKey: ['rotation_ranges', cohortId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cohort_school_rotations')
        .select('id, rotation_start_date, rotation_end_date')
        .eq('cohort_id', cohortId)
      if (error) throw error
      return Object.fromEntries((data || []).map(r => [r.id, r]))
    },
    enabled: !!cohortId && canEdit,
    staleTime: 5 * 60_000,
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
        range: resolveRotationRange(s, rotationById[s.cohort_school_rotation_id]),
        complete: pct >= 100,
        nearComplete: pct >= NEARING_PCT && pct < 100,
        supportNeeded: log?.supportNeeded || 0,
      }
    })

  // Sort only the Active Rotation Progress list (never On Campus Now). Expansion is keyed by
  // student id, so re-sorting preserves the expanded card. "Needs attention" is the default.
  const byName = (a, b) => getStudentPreferredFullName(a.s).localeCompare(getStudentPreferredFullName(b.s))
  const comparators = {
    // missing preceptor / no recent log → lowest progress → name (on-campus is a badge only)
    attention: (a, b) => {
      const ar = (a.missingPreceptor || a.noRecentLog) ? 0 : 1
      const br = (b.missingPreceptor || b.noRecentLog) ? 0 : 1
      if (ar !== br) return ar - br
      if (a.pct !== b.pct) return a.pct - b.pct
      return byName(a, b)
    },
    // ROTATION-PROGRESS-SORT-1: rank by percentage of required hours completed (matches the
    // displayed progress bar / % label), not raw approved hours — so students closest to finishing
    // rank highest even with different required-hour totals. pct already guards req<=0 → 0 and caps
    // at 100. Tie-breakers: completion % desc → approved hours desc → preferred name asc.
    hours_desc: (a, b) => (b.pct - a.pct) || (b.apv - a.apv) || byName(a, b),
    hours_asc:  (a, b) => (a.apv - b.apv) || byName(a, b),
    name:       byName,
    school:     (a, b) => (a.school || '').localeCompare(b.school || '') || byName(a, b),
  }
  const sortedCards = [...cards].sort(comparators[sortMode] || comparators.attention)

  return (
    <div style={{ padding: '4px 20px 24px', fontFamily: F }}>
      {/* ── Section 1: On Campus Now (existing review, unchanged) ── */}
      <SectionHeader title="On Campus Now" subtitle="Students checked in or active on campus right now." />
      {openLogs.length === 0 ? (
        <EmptyCard>No open shifts right now.</EmptyCard>
      ) : (
        <OpenShiftReview openLogs={openLogs} students={students} units={units} defaultOpen onSelectStudent={focusOnStudent} />
      )}

      {/* ── Section 2: Active Rotation Progress (new) ── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <SectionHeader
          title="Active Rotation Progress"
          subtitle="All students currently in active rotation, including those not on campus today."
        />
        {cards.length > 0 && (
          <div style={{ margin: '0 2px 8px' }}>
            <SortControl value={sortMode} onChange={setSortMode} />
          </div>
        )}
      </div>
      {sortedCards.length === 0 ? (
        <EmptyCard>No students are in active rotation right now.</EmptyCard>
      ) : (
        sortedCards.map(card => (
          <ProgressRowCard
            key={card.s.id}
            card={card}
            innerRef={el => { if (el) cardRefs.current[card.s.id] = el; else delete cardRefs.current[card.s.id] }}
            highlighted={highlightId === card.s.id}
            expanded={expandedId === card.s.id}
            onToggle={() => setExpandedId(prev => (prev === card.s.id ? null : card.s.id))}
            onOpen={onNavigateToStudent}
          />
        ))
      )}
    </div>
  )
}
