// ROTATION-PRECEPTORS-STUDENT-COVERAGE - read-only "Student Coverage" view (sibling of the
// Preceptor Directory inside Rotation > Preceptors). Answers the inverse question: which
// placement-committed students (Active Rotation / Placed) do NOT have preceptor coverage yet.
//
// PRIMARY preceptor source = students.preceptor_id, with the canonical free-text fallback
// students.matched_preceptor (kept in sync with the FK; see lib/preceptor.js). "No primary
// preceptor" mirrors Action Center act17 / Rotation Activity: !preceptor_id &&
// !matched_preceptor.trim(). This phase tracks PRIMARY coverage only - secondary/coverage
// assignments (student_preceptor_assignments) exist but are intentionally not surfaced here.
// No writes, no assignment path. Open Profile is the only (existing, safe) navigation.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { getStudentPreferredFullName } from '../lib/studentNameFormatters'
import { resolvePreceptor } from '../lib/preceptor'
import { canonicalRotationWindow } from '../lib/rotationWindow'

const F = 'DM Sans, sans-serif'
const COVERAGE_STATUSES = ['Active Rotation', 'Placed'] // statuses committed to rotation

const fmtRangeDate = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function resolveRange(student, rotationRow) {
  const win = canonicalRotationWindow(rotationRow)
  if (win) return `${fmtRangeDate(win.start)} – ${fmtRangeDate(win.end)}`
  return (student.term_dates || '').trim()
}

function Badge({ label, tone }) {
  const tones = {
    rose: { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca' },
    sage: { bg: '#eef6ee', color: '#2F7D5C', border: '#cfe6d6' },
  }[tone] || { bg: '#f3f4f6', color: '#4b5563', border: '#e5e7eb' }
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap',
      background: tones.bg, color: tones.color, border: `1px solid ${tones.border}`, fontFamily: F,
    }}>{label}</span>
  )
}

function CoverageRow({ row, onOpen }) {
  const { s, name, school, status, unitName, shift, range, precName, missing } = row
  const metaLine = [school, status, unitName, shift].filter(Boolean).join(' · ') || '-'
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14,
      padding: '12px 16px', marginBottom: 8,
      background: missing ? '#fffafa' : '#fff',
      border: `1px solid ${missing ? '#f3c9c9' : '#e8e4dc'}`,
      borderRadius: 12, fontFamily: F,
    }}>
      <div style={{ flex: '1 1 240px', minWidth: 200 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#1D2567' }}>{name}</span>
          {missing ? <Badge label="No primary preceptor" tone="rose" /> : <Badge label="Primary assigned" tone="sage" />}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>{metaLine}</div>
        <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 2 }}>
          Preceptor: {missing ? '-' : (precName || '-')}{range ? ` · ${range}` : ''}
        </div>
      </div>
      <div style={{ flex: '0 0 auto' }}>
        {onOpen && (
          <button
            onClick={() => onOpen(s.id)}
            style={{
              fontSize: 12, fontWeight: 600, color: '#1D2567', background: 'rgba(29,37,103,0.07)',
              border: '1px solid rgba(29,37,103,0.15)', borderRadius: 8, padding: '7px 12px',
              cursor: 'pointer', fontFamily: F, whiteSpace: 'nowrap',
            }}>
            Open Profile
          </button>
        )}
      </div>
    </div>
  )
}

export default function StudentCoverage({ students = [], units = [], cohortId, onNavigateToStudent }) {
  // Canonical rotation windows - shares the React Query cache key with Rotation > Activity.
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
    enabled: !!cohortId,
    staleTime: 5 * 60_000,
  })

  const rows = students
    .filter(s => COVERAGE_STATUSES.includes(s.status))
    .map(s => {
      const prec = resolvePreceptor(s)
      const unit = units.find(u => u.id === s.matched_unit_id)
      const missing = !s.preceptor_id && !(s.matched_preceptor || '').trim()
      return {
        s,
        name: getStudentPreferredFullName(s),
        school: s.school || '',
        status: s.status,
        unitName: unit?.unit_name || '',
        shift: s.shift_assigned || '',
        range: resolveRange(s, rotationById[s.cohort_school_rotation_id]),
        precName: prec.name,
        missing,
      }
    })
    // Coverage-risk first: Active Rotation + no preceptor → Placed + no preceptor → assigned → name.
    .sort((a, b) => {
      const rank = (r) => r.missing ? (r.status === 'Active Rotation' ? 0 : 1) : 3
      const ra = rank(a), rb = rank(b)
      if (ra !== rb) return ra - rb
      return a.name.localeCompare(b.name)
    })

  return (
    <div style={{ padding: '4px 20px 24px', fontFamily: F, overflowY: 'auto' }}>
      <div style={{ margin: '4px 2px 10px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#191919' }}>Student Coverage</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
          Primary preceptor coverage for students who are placed or actively rotating, students without a primary preceptor first.
        </div>
      </div>
      {rows.length === 0 ? (
        <div style={{
          margin: '8px 0', padding: '24px 20px', textAlign: 'center',
          background: '#fff', border: '1px solid #e8e4dc', borderRadius: 14,
          color: '#6b7280', fontSize: 13.5,
        }}>
          No Active Rotation or Placed students in this cohort yet.
        </div>
      ) : (
        rows.map(row => <CoverageRow key={row.s.id} row={row} onOpen={onNavigateToStudent} />)
      )}
    </div>
  )
}
