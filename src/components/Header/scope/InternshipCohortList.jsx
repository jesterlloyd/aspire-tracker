// src/components/Header/scope/InternshipCohortList.jsx
//
// SCOPE-PICKER-1: the ASPIRE cohort rows, lifted VERBATIM out of CohortPicker when the
// Experience and Cohort pills merged into one Scope picker. Rows, status pills, the
// Accepting badge, the derived date range and its bounded query, and the Edit/New
// footer are unchanged; only the pill and dropdown chrome around them went away.
//
// STAFF-SCHOOL-RESPONSE-VISIBILITY-1 (carried over): each row prefers the CANONICAL
// school-response span (earliest valid rotation_start_date to latest valid
// rotation_end_date across that cohort's cohort_school_rotations rows, sentinel/invalid
// rows excluded) over the manually entered cohorts.start_date/end_date, which remain the
// fallback. Display-only: nothing is written back to the cohorts table. One bounded
// query (cohort_id + the two dates) covers every listed cohort.
import { useQuery } from '@tanstack/react-query'
import { Sun, Leaf, Snowflake, Flower2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { groupRotationRowsByCohort, resolveCohortPickerRange } from '../../../lib/schoolResponseDisplay'
import { seasonOf } from '../../../lib/cohortSeason'

const COHORT_STATUS_COLORS = {
  Planning:  { bg: '#dbeafe', color: '#1d4ed8' },
  Active:    { bg: '#dcfce7', color: '#166534' },
  Completed: { bg: '#f3f4f6', color: '#6b7280' },
  Archived:  { bg: '#f3f4f6', color: '#9ca3af' },
}

function fmtCohortDate(d) {
  if (!d) return ''
  const s = typeof d === 'string' ? d : ''
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, day] = s.split('T')[0].split('-').map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  const p = new Date(s)
  return isNaN(p.getTime()) ? s.replace(/,?\s*\d{4}/, '').trim() : p.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
// SCOPE-PICKER-2: a season mark for the cohort name.
//
// MONOCHROME, DELIBERATELY. The row already carries a status pill (blue planned /
// green active / gray done) and the Accepting badge, and those two carry real state. A
// colored season icon would compete with them for attention while saying nothing the
// cohort's own name does not already say. It is reinforcement for scanning, so it gets
// the weight of punctuation, not of a signal.
//
// The slot is FIXED WIDTH and renders empty for a name that states no single season,
// so a list mixing "Fall 2026" with a differently-named cohort keeps one left edge
// instead of ragging.
const SEASON_ICONS = { summer: Sun, fall: Leaf, winter: Snowflake, spring: Flower2 }

function SeasonMark({ name }) {
  const season = seasonOf(name)
  const Icon = season ? SEASON_ICONS[season] : null
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex', width: 15, flexShrink: 0, justifyContent: 'center', color: '#9ca3af' }}>
      {Icon ? <Icon size={13} strokeWidth={2} /> : null}
    </span>
  )
}

function fmtCohortRange(a, b) {
  if (!a && !b) return ''
  if (!b) return fmtCohortDate(a)
  return `${fmtCohortDate(a)} – ${fmtCohortDate(b)}`
}

export default function InternshipCohortList({
  cohorts = [], sortedCohorts = [], activeCohort, activeCohortId,
  onSelectCohort, canEdit, onManageCohort, onNewCohort, onDone,
}) {
  // Bounded date-only rows for every listed cohort (no coordinator or student data in the header).
  const cohortIds = cohorts.map(c => c.id).filter(Boolean)
  const { data: rotationDateRows = [] } = useQuery({
    queryKey: ['cohort_picker_rotation_ranges', [...cohortIds].sort().join('|')],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cohort_school_rotations')
        .select('cohort_id, rotation_start_date, rotation_end_date')
        .in('cohort_id', cohortIds)
      if (error) throw error
      return data || []
    },
    enabled: cohortIds.length > 0,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const rotationRowsByCohort = groupRotationRowsByCohort(rotationDateRows)

  return (
    <>
      <div className="chart-scope-rows" role="listbox" aria-label="ASPIRE cohorts">
        {sortedCohorts.map(c => {
          const isSel = c.id === activeCohortId
          const sc = COHORT_STATUS_COLORS[c.status] || { bg: '#f3f4f6', color: '#6b7280' }
          return (
            // Native button: Enter/Space activation for free, matching the residency
            // list. The old ASPIRE rows were plain divs and were keyboard-unreachable.
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={isSel}
              onClick={() => { onSelectCohort(c.id); onDone?.() }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', border: 'none',
                fontFamily: 'DM Sans, sans-serif',
                padding: '14px 16px', cursor: 'pointer',
                background: isSel ? '#e8edf8' : 'transparent',
                borderLeft: isSel ? '3px solid #1d2567' : '3px solid transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--sand)' }}
              onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 15, fontWeight: 600, color: '#374151' }}>
                {/* aria-hidden: the season is spoken as part of the cohort's own name,
                    so announcing it twice would be noise. */}
                <SeasonMark name={c.name} />
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 }}>
                <span style={{ fontSize: 12, color: '#6b7280' }}>{(() => {
                  // Derived school-response span first; manual cohort dates as fallback;
                  // otherwise the existing blank behavior.
                  const range = resolveCohortPickerRange(c, rotationRowsByCohort[c.id])
                  return (range ? fmtCohortRange(range.start, range.end) : '') || ' '
                })()}</span>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 8 }}>
                  {c.status && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: sc.bg, color: sc.color }}>{c.status}</span>}
                  {c.accepting_submissions && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: '#dbeafe', color: '#1e40af', border: '1px solid #bfdbfe' }}>Accepting</span>}
                </div>
              </div>
            </button>
          )
        })}
      </div>
      {/* NGRP-PLANNING-2: both experiences now administer cohorts from this footer,
          in the same words. "New" became "Add" so the two lists read identically -
          the residency side was never going to say "New Cycle". */}
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderTop: '1px solid #f3f4f6', background: 'var(--sand)' }}>
          {activeCohort && (
            <button type="button" onClick={() => { onManageCohort(); onDone?.() }}
              style={{ flex: 1, padding: '7px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 12, cursor: 'pointer', color: '#374151' }}>
              ✏ Edit Cohort
            </button>
          )}
          <button type="button" onClick={() => { onNewCohort(); onDone?.() }}
            style={{ flex: 1, padding: '7px', background: '#1D2567', border: 'none', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#fff' }}>
            + Add Cohort
          </button>
        </div>
      )}
    </>
  )
}
