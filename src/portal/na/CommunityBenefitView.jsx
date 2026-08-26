// NURSING-ACADEMICS-1: the Community Benefit section.
//
// Everything here is server-computed by the compute module behind
// /api/portal/academics-community-benefit; this view only renders. The
// aggregate CSV is generated server-side too (privacy contract): this view
// downloads the finished file, it never assembles an export from
// identifiable rows.
//
// HONEST STATES. A fiscal year with no entered rate shows "Rate not set"
// instead of a guessed dollar figure. Records that cannot be assigned to a
// fiscal year (missing/sentinel rotation end date, drifted rotation link)
// appear in the "Needs reporting data" panel and are excluded from totals
// until corrected, never silently dropped. Students whose previously worked
// hours were later rejected or voided appear in "Records for review" so
// hours never just vanish.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Download } from 'lucide-react'
import MetricCard from '../../components/ui/MetricCard'
import { LoadingState, EmptyState, ErrorState } from '../unit/UnitLeaderChrome'
import { useRegisterPortalRefresh } from '../PortalRefresh'
import { useReportPortalFailure, ACCESS_FAILURE } from '../portalAccessSignal'
import { downloadCSV } from '../../lib/utils'
import { fetchCommunityBenefit, fetchBenefitExportCsv } from './nursingAcademicsApi'
import { schoolColor } from './naSchoolColors'
import { academicsProgramGroup, academicsProgramLabel, academicsSchoolLabel } from './naDisplayLabels'

const money0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const money2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = new Intl.NumberFormat('en-US')

const fmtDate = (s) => {
  if (!s) return 'Pending'
  const [y, m, d] = String(s).split('-').map(Number)
  if (!y || !m || !d) return 'Pending'
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Horizontal bar list: label column + proportional bars. Pure presentation;
// widths are percentages of the group maximum, and every value is printed in
// text so the bar is never the only carrier.
function BarChart({ title, rows, ariaLabel }) {
  const max = Math.max(...rows.flatMap(r => r.bars.map(b => b.value)), 1)
  return (
    <section className="ptl-card ptl-na-chart" aria-label={ariaLabel}>
      <h2>{title}</h2>
      <div className="ptl-na-chart-rows">
        {rows.map(r => (
          <div key={r.label} className="ptl-na-chart-row">
            <span className="ptl-na-chart-label">
              <span className="ptl-na-legend-dot" style={{ background: schoolColor(r.label).fill }} aria-hidden="true" />
              {r.displayLabel || r.label}
            </span>
            <div className="ptl-na-chart-bars">
              {r.bars.map(b => (
                <div key={b.key} className="ptl-na-chart-barline">
                  <span
                    className={`ptl-na-chart-bar ptl-na-chart-bar-${b.key}`}
                    style={{ width: `${Math.max((b.value / max) * 100, b.value > 0 ? 1.5 : 0)}%`, background: b.color }}
                    aria-hidden="true"
                  />
                  <span className="ptl-na-chart-value">{b.text}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

const PROGRAM_FILTERS = Object.freeze(['All Programs', 'ABSN', 'BSN', 'ELMN', 'MECN'])
// NA-CONTACTS-POLISH-3: the program quick filters are clickable KPI cards, so
// they carry the canonical FilterKPICard accents (src/components/KPIBand.jsx
// ACCENT_PALETTE): tinted rest, solid active fill.
const PROGRAM_ACCENTS = Object.freeze({
  'All Programs': { tint: '#EDEEF4', solid: '#1D2567' },
  ABSN: { tint: '#EEF7F0', solid: '#2F7D5C' },
  BSN: { tint: '#EDF0F7', solid: '#4A5D8F' },
  ELMN: { tint: '#F0EDF5', solid: '#6B4F8F' },
  MECN: { tint: '#FBF5E8', solid: '#8B5E1A' },
})

export default function CommunityBenefitView({
  active = true,
  fiscalYear: controlledFiscalYear,
  onFiscalYearChange,
  onReportLoaded,
  reportFetcher = fetchCommunityBenefit,
  exportFetcher = fetchBenefitExportCsv,
  refreshKey = 0,
  showToolbar = true,
  showSettingsLink = true,
  reportPortalFailures = true,
  embedded = false,
}) {
  const [fy, setFy] = useState(null) // null = server default (current FY)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)
  const [programFilter, setProgramFilter] = useState('All Programs')
  const [search, setSearch] = useState('')
  const [schoolFilter, setSchoolFilter] = useState('')
  const [cohortFilter, setCohortFilter] = useState('')
  const [sortBy, setSortBy] = useState('student-az')

  // Loading starts true and every trigger (reload, FY change) flips it in its
  // HANDLER, so the effect body performs no synchronous setState.
  const reload = useCallback(() => { setLoading(true); setError(null); setReloadKey(k => k + 1) }, [])
  const requestedFy = Number.isInteger(controlledFiscalYear) ? controlledFiscalYear : fy
  const changeFy = useCallback((next) => {
    setLoading(true)
    setError(null)
    if (Number.isInteger(controlledFiscalYear)) onFiscalYearChange?.(next)
    else setFy(next)
  }, [controlledFiscalYear, onFiscalYearChange])
  const reportFailure = useReportPortalFailure()
  useRegisterPortalRefresh(reload, active)

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    reportFetcher(requestedFy).then(res => {
      if (cancelled) return
      if (!res.ok) {
        const kind = reportPortalFailures
          ? reportFailure({ status: res.status, error: res.error })
          : null
        if (kind === ACCESS_FAILURE.ACCESS_ENDED) { setLoading(false); return }
        setError(kind === ACCESS_FAILURE.SIGNED_OUT
          ? 'Your session expired. Please sign in again.'
          : 'We could not load the community benefit report right now. Please try again shortly.')
        setLoading(false); return
      }
      setReport(res.data)
      onReportLoaded?.(res.data)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [active, requestedFy, reloadKey, refreshKey, reportFailure, reportFetcher, reportPortalFailures, onReportLoaded])

  const fiscalYears = useMemo(() => report?.available_fiscal_years || [], [report])

  const onExport = async () => {
    if (!report || exporting) return
    setExporting(true); setExportError(null)
    const res = await exportFetcher(report.fiscal_year)
    if (res.ok && res.csv) {
      downloadCSV(res.csv, `aspire-community-benefit-fy${report.fiscal_year}.csv`)
    } else {
      setExportError('The export could not be generated right now. Please try again shortly.')
    }
    setExporting(false)
  }

  if (loading && !report) return <LoadingState label="Loading the community benefit report" />
  if (error) return <ErrorState detail={error} onRetry={reload} />
  if (!report) return <EmptyState title="No report available" detail="Try again shortly." />

  const rnRate = report.rates?.rn_preceptor?.hourly_rate ?? null
  const mgmtRate = report.rates?.management?.hourly_rate ?? null
  const t = report.totals
  const benefitText = (v) => (v == null ? 'Rate not set' : money0.format(v))

  const benefitChartRows = (rnRate != null || mgmtRate != null)
    ? report.by_school
      .map(s => {
        const standard = s.standard_benefit || 0
        const capstone = s.capstone_benefit || 0
        return {
          label: s.school,
          displayLabel: academicsSchoolLabel(s.school),
          total: standard + capstone,
          bars: [{
            key: 'benefit', value: standard + capstone, color: schoolColor(s.school).fill,
            text: `${money0.format(standard + capstone)}${capstone > 0 ? ` (incl. ${money0.format(capstone)} non-clinical)` : ''}`,
          }],
        }
      })
      .filter(r => r.total > 0)
    : []

  const detailRows = report.detail_rows || []
  const schools = [...new Set(detailRows.map(r => r.school).filter(Boolean))]
    .sort((a, b) => academicsSchoolLabel(a).localeCompare(academicsSchoolLabel(b)))
  const cohorts = [...new Set(detailRows.map(r => r.cohort).filter(Boolean))]
    .sort((a, b) => {
      const aStart = detailRows.find(r => r.cohort === a)?.rotation_start || ''
      const bStart = detailRows.find(r => r.cohort === b)?.rotation_start || ''
      return aStart.localeCompare(bStart) || a.localeCompare(b)
    })
  const programCounts = Object.fromEntries(PROGRAM_FILTERS.map(key => [key, 0]))
  programCounts['All Programs'] = detailRows.length
  for (const row of detailRows) {
    const group = academicsProgramGroup(row.program)
    if (group in programCounts) programCounts[group] += 1
  }
  const query = search.trim().toLowerCase()
  const filteredRows = detailRows
    .filter(r => programFilter === 'All Programs' || academicsProgramGroup(r.program) === programFilter)
    .filter(r => !schoolFilter || r.school === schoolFilter)
    .filter(r => !cohortFilter || r.cohort === cohortFilter)
    .filter(r => !query || r.student_name.toLowerCase().includes(query))
    .sort((a, b) => {
      if (sortBy === 'student-za') return b.student_name.localeCompare(a.student_name)
      if (sortBy === 'cohort') {
        const cohortOrder = cohorts.indexOf(a.cohort) - cohorts.indexOf(b.cohort)
        return cohortOrder || a.student_name.localeCompare(b.student_name)
      }
      return a.student_name.localeCompare(b.student_name)
    })

  return (
    <div className="ptl-na-benefit">
      {showToolbar && (
        <>
          <div className="ptl-na-filters ptl-na-benefit-toolbar" role="group" aria-label="Report controls">
            <label className="ptl-na-filter" htmlFor="na-benefit-fy">
              <span>Fiscal year</span>
              <select
                id="na-benefit-fy"
                value={report.fiscal_year}
                onChange={e => changeFy(Number(e.target.value))}
              >
                {(fiscalYears.includes(report.fiscal_year) ? fiscalYears : [report.fiscal_year, ...fiscalYears])
                  .map(y => <option key={y} value={y}>FY {y} (Jul {y - 1} to Jun {y})</option>)}
              </select>
            </label>
            {/* NA-BENEFIT-POLISH-1: the approved Settings button, carried over -
                Download icon + "Download CSV", nightfall filled. */}
            <button type="button" className="ptl-na-export" onClick={onExport} disabled={exporting}>
              <Download size={16} aria-hidden="true" />
              {exporting ? 'Preparing CSV…' : 'Download CSV'}
            </button>
            {showSettingsLink && report.can_manage_reporting_inputs && (
              <a className="ptl-btn-outline ptl-na-settings-link" href="/settings/community-benefit">
                Manage reporting inputs
              </a>
            )}
          </div>
          <p className="ptl-na-export-note">
            The CSV is aggregate-only for fiscal reporting: one row per school, program,
            course type, and benefit category. It contains no names, contact details, or
            record identifiers.
          </p>
          {exportError && <p role="alert" className="ptl-na-error-note">{exportError}</p>}
        </>
      )}

      <div className="ptl-na-kpis">
        <MetricCard label="Students served" value={num.format(t.students_served || 0)} sub="Students with completed hours" />
        <MetricCard label="Required clinical hours" value={num.format(t.required_hours)} sub="Sum of student requirements" />
        <MetricCard label="Completed clinical hours" value={num.format(t.approved_hours)} sub="Completed shifts counted for reporting" />
        <MetricCard label="Additional non-clinical hours" value={num.format(t.capstone_hours)} sub="Owner-entered project or leadership hours" />
        <MetricCard
          label="Estimated nursing benefit"
          value={benefitText(t.total_benefit)}
          sub={t.total_benefit != null
            ? `${benefitText(t.standard_benefit)} clinical${t.capstone_benefit ? ` + ${benefitText(t.capstone_benefit)} non-clinical` : ''}`
            : 'Awaiting hourly rates'}
        />
      </div>

      {t.students === 0 && report.needs_data.length === 0 ? (
        <EmptyState
          title={`No ASPIRE activity in ${report.fiscal_year_label}`}
          detail="Choose another fiscal year to see rotations assigned to it."
        />
      ) : (
        <>
          {benefitChartRows.length > 0 && (
            <BarChart
              title="Benefit contribution by school"
              ariaLabel="Estimated nursing benefit contribution by school"
              rows={benefitChartRows}
            />
          )}

          <section className="ptl-card ptl-na-table-card" aria-labelledby="na-detail-heading">
            <div className="ptl-na-table-heading">
              <div>
                <h2 id="na-detail-heading">Student detail ({report.fiscal_year_label})</h2>
                <p className="ptl-na-table-note">
                  Protected view for authorized Nursing Education and Leadership users.
                  The downloadable CSV never includes this level of detail.
                </p>
              </div>
              <span className="ptl-na-result-count">{filteredRows.length} of {detailRows.length} students</span>
            </div>

            <div className="ptl-na-program-kpis" role="group" aria-label="Filter student detail by program">
              {PROGRAM_FILTERS.map(key => {
                const selected = programFilter === key
                const accent = PROGRAM_ACCENTS[key] || PROGRAM_ACCENTS['All Programs']
                return (
                  <button
                    key={key}
                    type="button"
                    className={`ptl-na-program-card${selected ? ' ptl-na-program-card-active' : ''}`}
                    style={{ '--ptl-na-program-tint': accent.tint, '--ptl-na-program-solid': accent.solid }}
                    aria-pressed={selected}
                    onClick={() => setProgramFilter(key)}
                  >
                    <strong>{num.format(programCounts[key] || 0)}</strong>
                    <span>{key}</span>
                  </button>
                )
              })}
            </div>

            <div className="ptl-na-table-controls" role="group" aria-label="Student detail controls">
              <label className="ptl-na-search" htmlFor="na-detail-search">
                <span className="ptl-visually-hidden">Search students</span>
                <input
                  id="na-detail-search"
                  type="search"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search student"
                />
              </label>
              <label className="ptl-na-control" htmlFor="na-detail-school">
                <span className="ptl-visually-hidden">Filter by school</span>
                <select id="na-detail-school" value={schoolFilter} onChange={e => setSchoolFilter(e.target.value)}>
                  <option value="">All Schools</option>
                  {schools.map(s => <option key={s} value={s}>{academicsSchoolLabel(s)}</option>)}
                </select>
              </label>
              <label className="ptl-na-control" htmlFor="na-detail-cohort">
                <span className="ptl-visually-hidden">Filter by cohort</span>
                <select id="na-detail-cohort" value={cohortFilter} onChange={e => setCohortFilter(e.target.value)}>
                  <option value="">All Cohorts</option>
                  {cohorts.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="ptl-na-control" htmlFor="na-detail-sort">
                <span className="ptl-visually-hidden">Sort students</span>
                <select id="na-detail-sort" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                  <option value="student-az">Student A–Z</option>
                  <option value="student-za">Student Z–A</option>
                  <option value="cohort">Cohort timeline</option>
                </select>
              </label>
            </div>

            <div className="ptl-na-table-scroll">
              <table className="ptl-na-table">
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    <th scope="col">School</th>
                    <th scope="col">Program</th>
                    <th scope="col">Course type</th>
                    <th scope="col">Cohort</th>
                    <th scope="col">ASPIRE status</th>
                    <th scope="col">Rotation</th>
                    <th scope="col" className="ptl-na-num">Required</th>
                    <th scope="col" className="ptl-na-num">Completed</th>
                    <th scope="col">Primary preceptor</th>
                    <th scope="col">Category</th>
                    <th scope="col" className="ptl-na-num">Est. benefit</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r, i) => (
                    <tr key={`${r.student_name}-${i}`}>
                      <td>{r.student_name}</td>
                      <td>
                        <span className="ptl-na-legend-dot" style={{ background: schoolColor(r.school).fill }} aria-hidden="true" />
                        {academicsSchoolLabel(r.school)}
                      </td>
                      <td>{academicsProgramLabel(r.program)}</td>
                      <td>{r.course_type}</td>
                      <td>{r.cohort || '-'}</td>
                      <td>{r.status}</td>
                      <td>{fmtDate(r.rotation_start)} to {fmtDate(r.rotation_end)}</td>
                      <td className="ptl-na-num">{num.format(r.required_hours)}</td>
                      <td className="ptl-na-num">
                        {num.format(r.approved_hours)}
                        {r.projection_matches === false && (
                          <span className="ptl-na-flag" title="The stored hours projection differs from the authoritative shift-log total; the shift-log total is shown."> *</span>
                        )}
                      </td>
                      <td>
                        {r.preceptor_name || 'Not assigned'}
                        {r.preceptor_source === 'legacy' && <span className="ptl-na-muted"> (legacy record)</span>}
                      </td>
                      <td>{r.benefit_category}</td>
                      <td className="ptl-na-num">{r.estimated_benefit == null ? 'Rate not set' : money2.format(r.estimated_benefit)}</td>
                    </tr>
                  ))}
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={12} className="ptl-na-table-empty">No students match these filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {report.needs_data.length > 0 && (
        <section className="ptl-card ptl-na-quality" aria-labelledby="na-needs-data-heading">
          <h2 id="na-needs-data-heading">Needs reporting data</h2>
          <p>
            These ASPIRE placements cannot be assigned to a fiscal year yet, so they
            are excluded from the totals above until their rotation dates are
            corrected. They are listed here rather than silently dropped.
          </p>
          <ul>
            {report.needs_data.map((r, i) => (
              <li key={`${r.student_name}-${i}`}>
                <strong>{r.student_name}</strong> · {r.school || 'No school'}{r.cohort ? ` · ${r.cohort}` : ''}
                {' '}· {r.reason === 'missing_rotation_end_date'
                  ? 'rotation end date pending review'
                  : r.reason === 'rotation_link_mismatch'
                    ? 'rotation link does not match the current cohort/school'
                    : 'no linked school rotation'}
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.review_records.length > 0 && (
        <section className="ptl-card ptl-na-quality" aria-labelledby="na-review-heading">
          <h2 id="na-review-heading">Records for review</h2>
          <p>
            These students have previously recorded hours that were later rejected or
            voided. Completed totals above already exclude them; they are surfaced
            here so worked hours never disappear without review.
          </p>
          <ul>
            {report.review_records.map((r, i) => (
              <li key={`${r.student_name}-${i}`}>
                <strong>{r.student_name}</strong> · {r.school || 'No school'}
                {r.rejected_hours > 0 ? ` · ${num.format(r.rejected_hours)} h rejected` : ''}
                {r.voided_hours > 0 ? ` · ${num.format(r.voided_hours)} h voided` : ''}
                {r.pending_hours > 0 ? ` · ${num.format(r.pending_hours)} h pending review` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* NA-BENEFIT-POLISH-1: the missing-rate advisory moved from the top of
          the report to the bottom, after the data-quality sections, so it
          informs without leading the page. */}
      {(rnRate == null || mgmtRate == null) && (
        <div className="ptl-na-rate-note" role="status">
          {rnRate == null && mgmtRate == null
            ? embedded
              ? `Hourly rates for ${report.fiscal_year_label} have not been entered. Use Set hourly rate above to calculate benefit estimates.`
              : `Hourly rates for ${report.fiscal_year_label} have not been entered yet, so benefit estimates are not shown. Rates are managed in ASPIRE Intelligence Settings.`
            : rnRate == null
              ? `The RN hourly rate for ${report.fiscal_year_label} has not been entered yet, so clinical benefit estimates are not shown.`
              : `The Leadership hourly rate for ${report.fiscal_year_label} has not been entered yet, so non-clinical benefit estimates are not shown.`}
        </div>
      )}
    </div>
  )
}
