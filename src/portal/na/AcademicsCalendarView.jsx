// NURSING-ACADEMICS-1: the At A Glance section.
//
// A TIMELINE presentation (one school rotation per row) inside the shared
// CanonicalCalendarLayout shell, with the canonical month navigation. Each
// row is a school-colored multi-day range bar positioned against the visible
// month; ranges that continue beyond the month carry continue markers, and
// the exact start/end dates are always printed in text next to the bar, so
// the bar is never the only carrier of the information.
//
// DATES ARE CANONICAL. Every window comes from cohort_school_rotations via
// the server endpoint; the 1900-01-01 sentinel and missing dates arrive as
// has_dates=false and render in the "Needs dates" data-quality panel: they
// are never plotted, never silently omitted.
//
// COLOR CONSISTENCY. schoolColor() hashes the canonical school identity, so
// a school keeps one color across renders, filters, the legend, and the
// Community Benefit charts.

import { useState, useEffect, useMemo, useCallback } from 'react'
import MetricCard from '../../components/ui/MetricCard'
import {
  CanonicalCalendarLayout,
  CanonicalCalendarSidebar,
  CanonicalCalendarNav,
  CanonicalCalendarMonthTitle,
} from '../../components/shared/CanonicalCalendarFoundation'
import { LoadingState, EmptyState, ErrorState } from '../unit/UnitLeaderChrome'
import { useRegisterPortalRefresh } from '../PortalRefresh'
import { useReportPortalFailure, ACCESS_FAILURE } from '../portalAccessSignal'
import { orderCohortsByTimeline } from '../../lib/derivations/cohortOrder'
import { fetchAcademicsCalendar, fetchCommunityBenefit } from './nursingAcademicsApi'
import { schoolColor } from './naSchoolColors'
import { academicsProgramLabel, academicsSchoolLabel } from './naDisplayLabels'

const money0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const num = new Intl.NumberFormat('en-US')

const parseYmd = (s) => {
  if (!s) return null
  const [y, m, d] = String(s).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

const fmtDate = (s) => {
  const d = parseYmd(s)
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
}

const monthStartOf = (d) => new Date(d.getFullYear(), d.getMonth(), 1)

export default function AcademicsCalendarView({ active = true }) {
  const [payload, setPayload] = useState(null)
  const [benefit, setBenefit] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [monthCursor, setMonthCursor] = useState(() => monthStartOf(new Date()))
  const [fyFilter, setFyFilter] = useState('')
  const [cohortFilter, setCohortFilter] = useState('')
  const [schoolFilter, setSchoolFilter] = useState('')
  const [programFilter, setProgramFilter] = useState('')

  // Loading starts true and reload flips it in the HANDLER (not the effect),
  // so the effect body performs no synchronous setState.
  const reload = useCallback(() => { setLoading(true); setError(null); setReloadKey(k => k + 1) }, [])
  const reportFailure = useReportPortalFailure()
  useRegisterPortalRefresh(reload, active)

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    Promise.all([fetchAcademicsCalendar(), fetchCommunityBenefit()]).then(([res, benefitRes]) => {
      if (cancelled) return
      const failed = !res.ok ? res : (!benefitRes.ok ? benefitRes : null)
      if (failed) {
        const kind = reportFailure({ status: failed.status, error: failed.error })
        if (kind === ACCESS_FAILURE.ACCESS_ENDED) { setLoading(false); return }
        setError(kind === ACCESS_FAILURE.SIGNED_OUT
          ? 'Your session expired. Please sign in again.'
          : 'We could not load At A Glance right now. Please try again shortly.')
        setLoading(false); return
      }
      setPayload(res.data)
      setBenefit(benefitRes.data)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [active, reloadKey, reportFailure])

  const rotations = useMemo(() => payload?.rotations || [], [payload])
  const cohorts = useMemo(
    () => orderCohortsByTimeline(payload?.cohorts || []),
    [payload],
  )

  const fiscalYears = useMemo(() =>
    [...new Set(rotations.map(r => r.fiscal_year).filter(fy => fy != null))].sort((a, b) => b - a),
  [rotations])
  const schools = useMemo(() =>
    [...new Set(rotations.map(r => r.school))].sort((a, b) => a.localeCompare(b)),
  [rotations])
  const programs = useMemo(() =>
    [...new Set(rotations.flatMap(r => r.programs))].sort((a, b) => a.localeCompare(b)),
  [rotations])

  // FY/cohort/school/program filters. The FY filter cannot apply to a rotation
  // without dates, so dateless rotations are governed by the other filters
  // only and always surface in the Needs dates panel.
  const matchesShared = useCallback((r) =>
    (!cohortFilter || r.cohort_id === cohortFilter) &&
    (!schoolFilter || r.school === schoolFilter) &&
    (!programFilter || r.programs.includes(programFilter)),
  [cohortFilter, schoolFilter, programFilter])

  const dated = useMemo(() =>
    rotations
      .filter(r => r.has_dates && matchesShared(r) && (!fyFilter || String(r.fiscal_year) === fyFilter))
      .sort((a, b) => a.rotation_start.localeCompare(b.rotation_start) || a.school.localeCompare(b.school)),
  [rotations, matchesShared, fyFilter])

  const needsDates = useMemo(() =>
    rotations.filter(r => !r.has_dates && matchesShared(r)),
  [rotations, matchesShared])

  if (loading) return <LoadingState label="Loading At A Glance" />
  if (error) return <ErrorState detail={error} onRetry={reload} />

  const benefitTotals = benefit?.totals || {}
  const estimatedBenefit = benefitTotals.total_benefit == null
    ? 'Rate not set'
    : money0.format(benefitTotals.total_benefit)

  const monthStart = monthCursor
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0)
  const daysInMonth = monthEnd.getDate()
  const monthLabel = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const inMonth = dated.filter(r => {
    const start = parseYmd(r.rotation_start)
    const end = parseYmd(r.rotation_end)
    return start && end && start <= monthEnd && end >= monthStart
  })

  const today = new Date()
  const todayInMonth = today >= monthStart && today <= monthEnd
  const dayPct = (day) => ((day - 1) / daysInMonth) * 100
  const spanFor = (r) => {
    const start = parseYmd(r.rotation_start)
    const end = parseYmd(r.rotation_end)
    const clampedStart = start < monthStart ? 1 : start.getDate()
    const clampedEnd = end > monthEnd ? daysInMonth : end.getDate()
    return {
      left: dayPct(clampedStart),
      width: Math.max(((clampedEnd - clampedStart + 1) / daysInMonth) * 100, 1.5),
      continuesBefore: start < monthStart,
      continuesAfter: end > monthEnd,
    }
  }

  const legendSchools = [...new Set(inMonth.map(r => r.school))].sort((a, b) => a.localeCompare(b))
  const filterSelects = [
    { id: 'na-cal-fy', label: 'Fiscal year', value: fyFilter, onChange: setFyFilter,
      options: fiscalYears.map(fy => ({ value: String(fy), label: `FY ${fy}` })) },
    { id: 'na-cal-cohort', label: 'Cohort', value: cohortFilter, onChange: setCohortFilter,
      options: cohorts.map(c => ({ value: c.id, label: c.name })) },
    { id: 'na-cal-school', label: 'School', value: schoolFilter, onChange: setSchoolFilter,
      options: schools.map(s => ({ value: s, label: academicsSchoolLabel(s) })) },
    { id: 'na-cal-program', label: 'Program', value: programFilter, onChange: setProgramFilter,
      options: programs.map(p => ({ value: p, label: academicsProgramLabel(p) })) },
  ]

  return (
    <div className="ptl-na-calendar">
      <section aria-labelledby="na-fy-summary-heading">
        <div className="ptl-na-section-heading">
          <div>
            <h2 id="na-fy-summary-heading">Fiscal-year impact</h2>
            <p>{benefit?.fiscal_year_label} · July {benefit?.fiscal_year - 1} through June {benefit?.fiscal_year}</p>
          </div>
        </div>
        <div className="ptl-na-overview-kpis">
          <MetricCard
            label="Students served"
            value={num.format(benefitTotals.students_served || 0)}
            sub="Students with completed hours"
          />
          <MetricCard
            label="Completed hours"
            value={num.format(benefitTotals.approved_hours || 0)}
            sub="Clinical hours recorded to date"
          />
          <MetricCard
            label="Estimated benefit"
            value={estimatedBenefit}
            sub="Clinical + additional non-clinical hours"
          />
        </div>
      </section>

      <div className="ptl-na-filters" role="group" aria-label="Calendar filters">
        {filterSelects.map(f => (
          <label key={f.id} className="ptl-na-filter" htmlFor={f.id}>
            <span>{f.label}</span>
            <select id={f.id} value={f.value} onChange={e => f.onChange(e.target.value)}>
              <option value="">All</option>
              {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        ))}
      </div>

      <CanonicalCalendarLayout
        title="Rotation Calendar"
        description="School rotation windows from every ASPIRE cohort, one rotation per row."
        sidebar={(
          <CanonicalCalendarSidebar>
            <div className="ptl-na-legend">
              <h3>Schools this month</h3>
              {legendSchools.length === 0 && <p className="ptl-na-legend-empty">No rotations in view.</p>}
              <ul>
                {legendSchools.map(s => (
                  <li key={s}>
                    <span className="ptl-na-legend-dot" style={{ background: schoolColor(s).fill }} aria-hidden="true" />
                    {academicsSchoolLabel(s)}
                  </li>
                ))}
              </ul>
            </div>
          </CanonicalCalendarSidebar>
        )}
        toolbar={(
          <>
            <CanonicalCalendarNav
              onPrev={() => setMonthCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
              onNext={() => setMonthCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
              onToday={() => setMonthCursor(monthStartOf(new Date()))}
              prevAriaLabel="Previous month"
              nextAriaLabel="Next month"
            />
            <CanonicalCalendarMonthTitle ariaLive="polite">{monthLabel}</CanonicalCalendarMonthTitle>
          </>
        )}
      >
        <div className="ptl-na-timeline">
          <div className="ptl-na-axis" aria-hidden="true">
            {[1, 8, 15, 22, daysInMonth].map(day => (
              <span key={day} className="ptl-na-axis-tick" style={{ left: `${dayPct(day)}%` }}>{day}</span>
            ))}
          </div>

          {inMonth.length === 0 ? (
            <EmptyState
              title={`No rotations in ${monthLabel}`}
              detail="Use the month arrows or clear a filter to see rotation windows."
            />
          ) : inMonth.map(r => {
            const span = spanFor(r)
            const color = schoolColor(r.school)
            const rangeText = `${fmtDate(r.rotation_start)} to ${fmtDate(r.rotation_end)}`
            return (
              <div key={r.id} className="ptl-na-row">
                <div className="ptl-na-row-label">
                  <span className="ptl-na-legend-dot" style={{ background: color.fill }} aria-hidden="true" />
                  <span className="ptl-na-row-school">{academicsSchoolLabel(r.school)}</span>
                  <span className="ptl-na-row-meta">
                    {r.cohort_name}{r.student_count > 0 ? ` · ${r.student_count} student${r.student_count === 1 ? '' : 's'}` : ''}
                    {r.programs.length > 0 ? ` · ${r.programs.map(academicsProgramLabel).join(', ')}` : ''}
                  </span>
                  <span className="ptl-na-row-dates">{rangeText}</span>
                </div>
                <div className="ptl-na-track">
                  {todayInMonth && (
                    <span className="ptl-na-today" style={{ left: `${dayPct(today.getDate()) + (100 / daysInMonth) / 2}%` }} aria-hidden="true" />
                  )}
                  <span
                    className={`ptl-na-bar${span.continuesBefore ? ' ptl-na-bar-before' : ''}${span.continuesAfter ? ' ptl-na-bar-after' : ''}`}
                    style={{ left: `${span.left}%`, width: `${span.width}%`, background: color.fill }}
                    role="img"
                    aria-label={`${r.school}, ${r.cohort_name}: ${rangeText}`}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </CanonicalCalendarLayout>

      {needsDates.length > 0 && (
        <section className="ptl-card ptl-na-quality" aria-labelledby="na-needs-dates-heading">
          <h2 id="na-needs-dates-heading">Needs dates</h2>
          <p>
            These school rotations have no confirmed start and end dates yet (pending
            coordinator or admin review), so they cannot be placed on the calendar.
            They are listed here rather than hidden.
          </p>
          <ul>
            {needsDates.map(r => (
              <li key={r.id}>
                <span className="ptl-na-legend-dot" style={{ background: schoolColor(r.school).fill }} aria-hidden="true" />
                <strong>{academicsSchoolLabel(r.school)}</strong> · {r.cohort_name}
                {r.student_count > 0 ? ` · ${r.student_count} student${r.student_count === 1 ? '' : 's'}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
