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
import MetricCard from '../../components/ui/MetricCard'
import { LoadingState, EmptyState, ErrorState } from '../unit/UnitLeaderChrome'
import { useRegisterPortalRefresh } from '../PortalRefresh'
import { useReportPortalFailure, ACCESS_FAILURE } from '../portalAccessSignal'
import { downloadCSV } from '../../lib/utils'
import { fetchCommunityBenefit, fetchBenefitExportCsv } from './nursingAcademicsApi'
import { schoolColor } from './naSchoolColors'

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
              {r.label}
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

export default function CommunityBenefitView() {
  const [fy, setFy] = useState(null) // null = server default (current FY)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)

  // Loading starts true and every trigger (reload, FY change) flips it in its
  // HANDLER, so the effect body performs no synchronous setState.
  const reload = useCallback(() => { setLoading(true); setError(null); setReloadKey(k => k + 1) }, [])
  const changeFy = useCallback((next) => { setLoading(true); setError(null); setFy(next) }, [])
  const reportFailure = useReportPortalFailure()
  useRegisterPortalRefresh(reload)

  useEffect(() => {
    let cancelled = false
    fetchCommunityBenefit(fy).then(res => {
      if (cancelled) return
      if (!res.ok) {
        const kind = reportFailure({ status: res.status, error: res.error })
        if (kind === ACCESS_FAILURE.ACCESS_ENDED) { setLoading(false); return }
        setError(kind === ACCESS_FAILURE.SIGNED_OUT
          ? 'Your session expired. Please sign in again.'
          : 'We could not load the community benefit report right now. Please try again shortly.')
        setLoading(false); return
      }
      setReport(res.data)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [fy, reloadKey, reportFailure])

  const fiscalYears = useMemo(() => report?.available_fiscal_years || [], [report])

  const onExport = async () => {
    if (!report || exporting) return
    setExporting(true); setExportError(null)
    const res = await fetchBenefitExportCsv(report.fiscal_year)
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

  const hoursChartRows = report.by_school
    .filter(s => s.students > 0)
    .map(s => ({
      label: s.school,
      bars: [
        { key: 'required', value: s.required_hours, color: schoolColor(s.school).soft, text: `${num.format(s.required_hours)} required` },
        { key: 'approved', value: s.approved_hours, color: schoolColor(s.school).fill, text: `${num.format(s.approved_hours)} approved` },
      ],
    }))

  const benefitChartRows = (rnRate != null || mgmtRate != null)
    ? report.by_school
      .map(s => {
        const standard = s.standard_benefit || 0
        const capstone = s.capstone_benefit || 0
        return {
          label: s.school,
          total: standard + capstone,
          bars: [{
            key: 'benefit', value: standard + capstone, color: schoolColor(s.school).fill,
            text: `${money0.format(standard + capstone)}${capstone > 0 ? ` (incl. ${money0.format(capstone)} capstone)` : ''}`,
          }],
        }
      })
      .filter(r => r.total > 0)
    : []

  return (
    <div className="ptl-na-benefit">
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
        <button type="button" className="ptl-btn-outline ptl-na-export" onClick={onExport} disabled={exporting}>
          {exporting ? 'Preparing CSV…' : 'Download aggregate CSV'}
        </button>
      </div>
      <p className="ptl-na-export-note">
        The CSV is aggregate-only for fiscal reporting: one row per school, program,
        course type, and benefit category. It contains no names, contact details, or
        record identifiers.
      </p>
      {exportError && <p role="alert" className="ptl-na-error-note">{exportError}</p>}

      {(rnRate == null || mgmtRate == null) && (
        <div className="ptl-na-rate-note" role="status">
          {rnRate == null && mgmtRate == null
            ? `Hourly rates for ${report.fiscal_year_label} have not been entered yet, so benefit estimates are not shown. The ASPIRE team enters rates in ASPIRE Intelligence Settings.`
            : rnRate == null
              ? `The RN Preceptor hourly rate for ${report.fiscal_year_label} has not been entered yet, so standard benefit estimates are not shown.`
              : `The Management hourly rate for ${report.fiscal_year_label} has not been entered yet, so capstone benefit estimates are not shown.`}
        </div>
      )}

      <div className="ptl-na-kpis">
        <MetricCard label="ASPIRE students" value={num.format(t.students)} sub={report.fiscal_year_label} />
        <MetricCard label="Required clinical hours" value={num.format(t.required_hours)} sub="Sum of student requirements" />
        <MetricCard label="Approved actual hours" value={num.format(t.approved_hours)} sub="Auto-Accepted + Approved shifts" />
        <MetricCard label="UCLA capstone hours" value={num.format(t.capstone_hours)} sub="Owner-entered project hours" />
        <MetricCard
          label="Estimated nursing benefit"
          value={benefitText(t.total_benefit)}
          sub={t.total_benefit != null
            ? `${benefitText(t.standard_benefit)} clinical${t.capstone_benefit ? ` + ${benefitText(t.capstone_benefit)} capstone` : ''}`
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
          {hoursChartRows.length > 0 && (
            <BarChart
              title="Required versus approved hours by school"
              ariaLabel="Required versus approved clinical hours by school"
              rows={hoursChartRows}
            />
          )}
          {benefitChartRows.length > 0 && (
            <BarChart
              title="Benefit contribution by school"
              ariaLabel="Estimated nursing benefit contribution by school"
              rows={benefitChartRows}
            />
          )}

          <section className="ptl-card ptl-na-table-card" aria-labelledby="na-detail-heading">
            <h2 id="na-detail-heading">Student detail ({report.fiscal_year_label})</h2>
            <p className="ptl-na-table-note">
              Protected view for authorized Nursing Academics users. The downloadable
              CSV never includes this level of detail.
            </p>
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
                    <th scope="col" className="ptl-na-num">Approved</th>
                    <th scope="col">Primary preceptor</th>
                    <th scope="col">Category</th>
                    <th scope="col" className="ptl-na-num">Est. benefit</th>
                  </tr>
                </thead>
                <tbody>
                  {report.detail_rows.map((r, i) => (
                    <tr key={`${r.student_name}-${i}`}>
                      <td>{r.student_name}</td>
                      <td>
                        <span className="ptl-na-legend-dot" style={{ background: schoolColor(r.school).fill }} aria-hidden="true" />
                        {r.school}
                      </td>
                      <td>{r.program || '-'}</td>
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
            voided. Approved totals above already exclude them; they are surfaced
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
    </div>
  )
}
