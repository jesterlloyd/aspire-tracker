// RESIDENTS-1 (Owner, 2026-09-14): Residency > Residents.
//
// The hired new grads (unit, shift, hire date, position/title, preceptor, email
// and phone) and whether each is still at Cedars-Sinai, which makes this the
// retention tracker too. Per residency cohort by default, following the Scope
// picker, with an Aggregate view across every cohort.
//
// One component, mounted by NgrpWorkspace, so the staff app and the Residency
// Portal show the same page. Rows come from api/ngrp-support.js `residents`
// (Talent Acquisition narrowed like every Residency surface). The shared rules live in
// src/lib/ngrp/ngrpResidents.js.
//
// RESIDENTS-ONE-RECORD-1 (Owner, 2026-10-05): this is the RETENTION view. A resident is
// edited in one place, the applicant binder's Hiring sheet (ResidentDetailsSection, the editor
// that used to sit here); a name here opens that sheet in Profiles & Interest, switching the
// residency cohort when an Aggregate row belongs to another one.
import Tooltip from '../ui/Tooltip'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNgrpSurface } from '../../lib/ngrp/ngrpSurface'
import { KPICell } from '../KPIBand'
import StudentAvatar from '../StudentAvatar'
import SegmentedTabs from '../ui/SegmentedTabs'
import { useNgrpResidents } from '../../lib/ngrp/useNgrpData'
import { RESIDENTS_SCOPES, retentionSummary, dayOf, residentRecordPath, residentReports, SMALL_GROUP } from '../../lib/ngrp/ngrpResidents'
import { useAuth } from '../../contexts/AuthContext'
import PastHiresDrawer from './PastHiresDrawer'
import { shiftBadge } from '../../lib/shiftStatus'
import { displayName } from '../../lib/utils'
import { F } from '../../lib/ngrp/ngrpCohortForm'
// The name button is Support > By Alumnus's (.sl-namebtn); its sheet is imported here too, so
// the tab never depends on Support having loaded first.
import './supportLog.css'

const fmtDate = (v) => {
  const d = dayOf(v)
  if (!d) return ''
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
const pill = (bg, color) => ({
  display: 'inline-block', padding: '2px 9px', borderRadius: 'var(--aspire-radius-pill, 999px)', fontSize: 11, fontWeight: 600,
  background: bg, color, whiteSpace: 'nowrap', fontFamily: F,
})
const SOURCE_NOTE = {
  reflection: 'from their first reflection',
  form: 'from their Transition Form',
}

function Muted({ children }) {
  return <span className="ngrp-glance-muted">{children}</span>
}

function Affiliation({ resident }) {
  if (resident.affiliated) {
    return <span data-testid="resident-affiliated" style={pill('#DCEBDD', '#2D4A2B')}>At Cedars-Sinai</span>
  }
  return (
    <Tooltip label={resident.separation_reason || ''} disabled={!resident.separation_reason} applyAriaLabel={false}>
    <span data-testid="resident-separated">
      <span style={pill('#ECECEC', '#4B5563')}>Separated</span>
      <Muted> {fmtDate(resident.separated_at)}</Muted>
    </span>
    </Tooltip>
  )
}

function Sourced({ value, source }) {
  if (!value) return <Muted>Not recorded</Muted>
  return (
    <>
      {value}
      {source && SOURCE_NOTE[source] && <div className="ngrp-glance-muted" style={{ fontSize: 11 }}>{SOURCE_NOTE[source]}</div>}
    </>
  )
}

// HIRE-HISTORY-1 (Owner, 2026-11-04): how many interns from a school, or an ASPIRE cohort, became
// residents, and how many stayed. Percentages with their counts beside them, so 2% of 50 and 50%
// of 2 read differently; a group under SMALL_GROUP interns is shown, marked small, never hidden.
function ReportTable({ title, sub, rows, firstCol, testId }) {
  return (
    <section className="snap ngrp-glance-panel" aria-label={title}>
      <div className="aggregate-panel-hdr ngrp-residents-hdr">
        <div>
          <div className="ov-panel-title">{title}</div>
          <div className="ov-panel-sub">{sub}</div>
        </div>
      </div>
      {rows.length === 0
        ? <p className="ngrp-glance-empty">No Completed interns to count yet.</p>
        : (
          <div className="ngrp-glance-scroll">
            <table className="ngrp-glance-table" data-testid={testId}>
              <thead>
                <tr>
                  <th className="aspire-th">{firstCol}</th>
                  <th className="aspire-th aspire-th-right">Completed Interns</th>
                  <th className="aspire-th aspire-th-right">Applied</th>
                  <th className="aspire-th aspire-th-right">Hired</th>
                  <th className="aspire-th aspire-th-right">Hired Rate</th>
                  <th className="aspire-th aspire-th-right">Still Here</th>
                  <th className="aspire-th aspire-th-right">Retention</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key}>
                    <td>{r.key}{r.small && <Muted> · small group (under {SMALL_GROUP})</Muted>}</td>
                    <td style={{ textAlign: 'right' }}>{r.interns}</td>
                    <td style={{ textAlign: 'right' }}>{r.applied}</td>
                    <td style={{ textAlign: 'right' }}>{r.hired}</td>
                    <td style={{ textAlign: 'right' }}>{r.hiredPct === null ? <Muted>—</Muted> : <><strong>{r.hiredPct}%</strong> <Muted>{r.hired} of {r.interns}</Muted></>}</td>
                    <td style={{ textAlign: 'right' }}>{r.retained}</td>
                    <td style={{ textAlign: 'right' }}>{r.retainedPct === null ? <Muted>—</Muted> : <><strong>{r.retainedPct}%</strong> <Muted>{r.retained} of {r.hired}</Muted></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  )
}

export default function ResidentsTab({ cycle, toast }) {
  const [scope, setScope] = useState(RESIDENTS_SCOPES.COHORT)
  const { base, staffApp } = useNgrpSurface()
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const aggregate = scope === RESIDENTS_SCOPES.AGGREGATE
  const data = useNgrpResidents(cycle?.id, { scope })
  const summary = useMemo(() => retentionSummary(data.residents), [data.residents])
  const scopeLabel = aggregate ? 'All residency cohorts' : (cycle?.name || 'This cohort')
  // HIRE-HISTORY-1: the reports read the aggregate population (every Completed intern) and
  // every hire; Record past hires is the Owner's and Admins', in the staff app.
  const aggregateData = useNgrpResidents(cycle?.id, { scope: RESIDENTS_SCOPES.AGGREGATE })
  const reports = useMemo(() => (aggregateData.population
    ? residentReports({ population: aggregateData.population, residents: aggregateData.residents })
    : null), [aggregateData.population, aggregateData.residents])
  const canRecordPast = staffApp && ['owner', 'admin'].includes(userProfile?.role)
  const [pastOpen, setPastOpen] = useState(false)

  const body = (() => {
    if (data.status === 'loading') return <p className="ngrp-glance-empty">Loading residents…</p>
    if (data.status === 'unauthorized') return <p className="ngrp-glance-empty">Your account cannot see residents.</p>
    if (data.status === 'unprovisioned') return <p className="ngrp-glance-empty">Residents appear once the NGRP support migration is applied.</p>
    if (data.status === 'error') return <p className="ngrp-glance-empty">Residents could not be loaded. Refresh to try again.</p>
    if (data.residents.length === 0) {
      return (
        <p className="ngrp-glance-empty">
          {aggregate
            ? 'No residents yet. New grads appear here once their hire is recorded on the Interview Board.'
            : `No residents in ${cycle?.name || 'this cohort'} yet. New grads appear here once their hire is recorded on the Interview Board.`}
        </p>
      )
    }
    return (
      <div className="ngrp-glance-scroll">
        <table className="ngrp-glance-table" data-testid="residents-table">
          <thead>
            <tr>
              <th className="aspire-th">Resident</th>
              {aggregate && <th className="aspire-th">Cohort</th>}
              <th className="aspire-th">Unit</th>
              <th className="aspire-th">Shift</th>
              <th className="aspire-th">Hire Date</th>
              <th className="aspire-th">Position/Title</th>
              <th className="aspire-th">Preceptor</th>
              <th className="aspire-th">Email/Phone</th>
              <th className="aspire-th">Affiliation</th>
            </tr>
          </thead>
          <tbody>
            {data.residents.map(r => (
              <tr key={r.candidate_id}>
                <td>
                  <div className="ngrp-glance-person">
                    <StudentAvatar student={r.student} size={28} />
                    <div className="ov-unit-info">
                      {/* Support > By Alumnus's name button, reused. */}
                      <button type="button" className="ngrp-linkbtn sl-namebtn"
                        onClick={() => navigate(residentRecordPath(base, r.candidate_id))}>{displayName(r.student)}</button>
                    </div>
                  </div>
                </td>
                {aggregate && <td>{r.cohort_name}</td>}
                <td>{r.unit || <Muted>Not recorded</Muted>}</td>
                <td>{r.shift ? shiftBadge(r.shift).label : <Muted>Not recorded</Muted>}</td>
                <td>
                  {fmtDate(r.hired_at)}
                  {r.residency_start_date && <div className="ngrp-glance-muted" style={{ fontSize: 11 }}>Starts {fmtDate(r.residency_start_date)}</div>}
                </td>
                <td>{r.position_title || <Muted>Not recorded</Muted>}</td>
                <td><Sourced value={r.preceptor.value} source={r.preceptor.source} /></td>
                <td>
                  {r.cs_email || r.personal_email || <Muted>No email</Muted>}
                  <div className="ngrp-glance-muted" style={{ fontSize: 11 }}>
                    {r.phone.value || 'No phone'}
                    {r.phone.value && r.phone.source === 'form' ? ` (${SOURCE_NOTE.form})` : ''}
                  </div>
                </td>
                <td><Affiliation resident={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  })()

  return (
    <>
      <section className="snap" aria-label="Residents snapshot" style={{ margin: '14px 0' }}>
        <div className="snap-head">
          <span className="ov-panel-title">Residents</span>
          <span className="snap-sub">{scopeLabel} · hired new grads and who is still at Cedars-Sinai</span>
        </div>
        <div className="glance-kpis snap-kpis ngrp-residents-kpis" data-testid="residents-kpis">
          <KPICell value={summary.hired} label="Residents Hired" sub={aggregate ? 'Across all cohorts' : 'This cohort'} />
          <KPICell value={summary.affiliated} label="At Cedars-Sinai" sub="No separation recorded" accent="sage" />
          <KPICell value={summary.separated} label="Separated" sub="Left Cedars-Sinai" accent={summary.separated ? 'warning' : undefined} />
          <KPICell
            value={summary.rate === null ? '0%' : `${summary.rate}%`}
            label="Retention"
            sub={summary.rate === null ? 'No residents yet' : `${summary.affiliated} of ${summary.hired} still here`}
          />
        </div>
      </section>

      <section className="snap ngrp-glance-panel" aria-label="Hired new grads">
        <div className="aggregate-panel-hdr ngrp-residents-hdr" data-testid="residents-hdr">
          <div>
            <div className="ov-panel-title">Hired New Grads</div>
            <div className="ov-panel-sub">
              {aggregate ? 'Every residency cohort' : `Residents hired in ${cycle?.name || 'this cohort'}`}
              {' · '}a name opens their record
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {canRecordPast && (
              <button type="button" className="ngrp-linkbtn" onClick={() => setPastOpen(true)} data-testid="record-past-hires">Record past hires</button>
            )}
            <SegmentedTabs
              label="Residents scope"
              items={[
                { key: RESIDENTS_SCOPES.COHORT, label: cycle?.name || 'This Cohort' },
                { key: RESIDENTS_SCOPES.AGGREGATE, label: 'Aggregate' },
              ]}
              value={scope}
              onChange={setScope}
            />
          </div>
        </div>
        {body}
      </section>

      {reports && (
        <>
          <ReportTable
            title="Interns Who Became Residents, by School"
            sub={`Every Completed intern across all residency cohorts · ${reports.totals.hired} of ${reports.totals.interns} hired`}
            rows={reports.bySchool} firstCol="School" testId="report-by-school" />
          <ReportTable
            title="Interns Who Became Residents, by ASPIRE Cohort"
            sub="Applied counts a submitted Transition Form in any residency cohort"
            rows={reports.byCohort} firstCol="ASPIRE Cohort" testId="report-by-cohort" />
        </>
      )}

      {pastOpen && (
        <PastHiresDrawer toast={toast} onClose={() => setPastOpen(false)}
          onRecorded={() => { data.refetch(); aggregateData.refetch() }} />
      )}
    </>
  )
}
