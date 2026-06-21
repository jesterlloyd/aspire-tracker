import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { deriveCohortRange, canonicalRotationWindow } from '../lib/rotationWindow'
import Tooltip from './ui/Tooltip';

const STATUS_CLASS = {
  Planning:  'cs-planning',
  Active:    'cs-active',
  Completed: 'cs-completed',
  Archived:  'cs-archived',
}

// STUDENT-PROFILE-CANON-1D: format a YYYY-MM-DD canonical date to a Pacific long form (e.g.
// "May 4, 2026"). The canonical dates are date-only; anchor at noon UTC to avoid tz day-shift.
const fmtCohortDate = (d) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date(d + 'T12:00:00Z'))

export default function CohortBar({ cohorts, activeCohortId, onSelect, onNew, onManage }) {
  const active = cohorts.find(c => c.id === activeCohortId)

  // STUDENT-PROFILE-CANON-1D: the cohort date span is DERIVED at read time from the canonical,
  // coordinator-owned cohort_school_rotations rows (earliest non-sentinel start → latest
  // non-sentinel end), not from the free-text cohorts.start_date/end_date. Sentinel 1900-01-01
  // rows are excluded; if no valid row exists we show "Rotation dates pending" (never a sentinel).
  const { data: rotationRows = [], isLoading: rangeLoading } = useQuery({
    queryKey: ['cohort_rotation_range', activeCohortId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cohort_school_rotations')
        .select('rotation_start_date, rotation_end_date')
        .eq('cohort_id', activeCohortId)
      if (error) throw error
      return data || []
    },
    enabled: !!activeCohortId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const derivedRange = deriveCohortRange(rotationRows)
  const pendingSchoolCount = rotationRows.filter(r => !canonicalRotationWindow(r)).length

  return (
    <div className="cohort-bar">
      <div className="cohort-bar-inner">
        <div className="cohort-select-group">
          <span className="cohort-bar-label">Cohort</span>
          <select
            className="cohort-select"
            value={activeCohortId || ''}
            onChange={e => onSelect(e.target.value)}
          >
            {cohorts.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {active && (
            <span className={`cohort-status-badge ${STATUS_CLASS[active.status] || 'cs-archived'}`}>
              {active.status}
            </span>
          )}
          {active?.accepting_submissions && (
            <Tooltip label="Accepting form submissions" placement="bottom">
              <span className="cohort-open-badge">
                ● Accepting submissions
              </span>
            </Tooltip>
          )}
          {active && !rangeLoading && (
            derivedRange ? (
              <span className="cohort-dates">
                {fmtCohortDate(derivedRange.start)} to {fmtCohortDate(derivedRange.end)}
                {pendingSchoolCount > 0 && (
                  <span style={{ marginLeft: 6, opacity: 0.7, fontStyle: 'italic' }}>· some school windows pending</span>
                )}
              </span>
            ) : (
              <span className="cohort-dates" style={{ fontStyle: 'italic', opacity: 0.85 }}>Rotation dates pending</span>
            )
          )}
          {active?.match_quality_summary?.total_matched > 0 && (
            <span className="cohort-match-quality">
              {active.match_quality_summary.top_choice_percentage}% top choice placements
            </span>
          )}
        </div>
        <div className="cohort-bar-actions">
          {active && (
            <button className="btn-cohort-outline" onClick={onManage}>⚙ Edit Cohort</button>
          )}
          <button className="btn-cohort-primary" onClick={onNew}>+ New Cohort</button>
        </div>
      </div>
    </div>
  )
}
