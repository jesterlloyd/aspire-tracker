// NGRP-WORKSPACE-2: At a Glance - the cohort's OPERATING PICTURE.
//
// RESIDENCY-GLANCE-1 (Owner, 2026-09-11): it now reads like the Internship At
// a Glance. One unified KPI card (Residency Snapshot), then the two tables that
// answer "which units are hiring, how many, and who is applying": Hiring Units
// (grouped by division, like Placement Capacity) and Applicants (grouped by
// school, like Placement Requests). The Cohort Timeline and the Pipeline stay.
// Seats is gone (the Hiring Units table says everything it said), and so is
// Scope and Rules: the cohort's configuration lives in the cohort settings the
// Scope picker opens, which is where it is edited anyway.
//
// READ-ONLY AND INFORMATIONAL BY DESIGN. No row opens anything; to work with
// an alumnus, go to Profiles & Interest. Every number derives from data another
// surface already owns - units from the planning payload, everything else from
// the SAME derived rows the Profiles roster renders (src/lib/ngrp/ngrpGlanceView.js)
// - so this page can never disagree with the tabs it summarizes.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ngrpPath } from '../../lib/ngrp/ngrpTabs'
import { useNgrpSurface } from '../../lib/ngrp/ngrpSurface'
import { useAuth } from '../../contexts/AuthContext'
import GreetingMasthead from '../masthead/GreetingMasthead'
import { useStaffMastheadEvents } from '../masthead/useStaffMastheadEvents'
import { KPICell } from '../KPIBand'
import StudentAvatar from '../StudentAvatar'
import { Plus, CheckCircle2, AlertTriangle, Settings2 } from 'lucide-react'
import { useNgrpPlanning, useNgrpApplicants } from '../../lib/ngrp/useNgrpData'
import { deriveApplicantRows, effectiveEligibility, rosterStatus, ROSTER_STATUSES } from '../../lib/ngrp/ngrpStates'
import { toLocalDateStr } from '../../lib/designTokens'
import { F, btn } from '../../lib/ngrp/ngrpCohortForm'
import { compareCohortsChrono } from '../../lib/cohortSeason'
import { displayName } from '../../lib/utils'
import { cycleTimeline, milestoneWhen, pipelineStages } from '../../lib/ngrp/ngrpPlanningView'
import { residencySnapshot, hiringUnitGroups, applicantsBySchool, statusCounts } from '../../lib/ngrp/ngrpGlanceView'

const fmtDay = d => {
  if (!d) return null
  const [y, m, day] = String(d).split('T')[0].split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function Panel({ title, action, children, sub }) {
  return (
    <section className="snap" style={{ margin: '0 0 14px', padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#1D2567', fontFamily: F }}>{title}</h2>
        {sub && <span style={{ fontSize: 11.5, color: '#8B8F99', fontFamily: F }}>{sub}</span>}
        {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
      </div>
      {children}
    </section>
  )
}

function ExpandToggle({ onExpand, onCollapse }) {
  return (
    <div className="ov-expand-toggle">
      <button type="button" onClick={onExpand}>Expand All</button>
      <span style={{ color: 'var(--border)' }}>·</span>
      <button type="button" onClick={onCollapse}>Collapse All</button>
    </div>
  )
}

function useOpenSet() {
  const [open, setOpen] = useState(() => new Set())
  const toggle = k => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k); else next.add(k)
    return next
  })
  return { open, toggle, setOpen }
}

// ── 1 · The unified KPI card ─────────────────────────────────────────────────
function ResidencySnapshot({ snap, band, cycleName }) {
  const positionsSub = snap.activeUnits === 0
    ? 'No hiring units yet'
    : snap.exact ? plural(snap.activeUnits, 'hiring unit') : `${snap.pricedUnits} of ${snap.activeUnits} units set`
  return (
    <section className="snap" aria-label="Residency snapshot" style={{ margin: '14px 0' }}>
      <div className="snap-head">
        <span className="ov-panel-title">Residency Snapshot</span>
        <span className="snap-sub">
          {cycleName} · {plural(snap.applicants, 'applicant')} · {plural(snap.schools, 'school')} · {plural(snap.activeUnits, 'hiring unit')}
        </span>
      </div>
      <div className="glance-kpis snap-kpis">
        <KPICell value={snap.positions} label="Positions" sub={positionsSub} />
        <KPICell value={snap.applicants} label="Applicants" sub="Transition Form submitted" />
        {/* RESIDENCY-ROSTER-1: "Confirmed" is gone, because nobody confirms
            anything any more. "Filled" is now "Paired", which is what the
            placement board actually records: the unit that will interview
            them. Hires have their own number in the band below. */}
        <KPICell value={snap.inPool} label="In the Pool" sub="Ready to be paired" />
        <KPICell value={snap.paired} label="Paired" sub="A unit will interview them" accent="sage" />
        <KPICell
          value={snap.open == null ? 'Not set' : snap.open}
          label="Open"
          sub={snap.open == null ? 'Every unit needs a position count' : 'Positions not yet paired'}
        />
      </div>
      {/* The Status band (Owner): one number per state, in the arc's own order,
          the same states the Alumni Roster's Status column shows. */}
      <div className="ngrp-statusband" aria-label="Applicants by status">
        {band.map(s => (
          <div key={s.key} className={`ngrp-statusband-item${s.count === 0 ? ' ngrp-statusband-zero' : ''}`}>
            <span className="ngrp-statusband-n">{s.count}</span>
            <span className="ngrp-statusband-l">{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── 2 · Hiring Units (like Placement Capacity) ───────────────────────────────
function HiringUnitsPanel({ groups, loading }) {
  const { open, toggle, setOpen } = useOpenSet()
  const units = groups.flatMap(g => g.units)
  const positionsKnown = units.length > 0 && units.every(u => u.positions != null)
  const positions = units.reduce((s, u) => s + (u.positions || 0), 0)
  const assigned = units.reduce((s, u) => s + u.assigned, 0)
  return (
    <section className="snap ngrp-glance-panel" aria-label="Hiring units">
      <div className="aggregate-panel-hdr">
        <div>
          <div className="ov-panel-title">Hiring Units</div>
          <div className="ov-panel-sub">
            {plural(units.length, 'unit')} · {positionsKnown ? plural(positions, 'position') : 'positions not all set'} · {assigned} filled
          </div>
        </div>
        {groups.length > 0 && (
          <ExpandToggle onExpand={() => setOpen(new Set(groups.map(g => g.division)))} onCollapse={() => setOpen(new Set())} />
        )}
      </div>
      {groups.length === 0 ? (
        <p className="ngrp-glance-empty">
          {loading ? 'Loading…' : 'No hiring units are active for this residency cohort yet. Add them in the cohort settings.'}
        </p>
      ) : (
        <div className="ngrp-glance-scroll">
          <table className="ngrp-glance-table">
            <thead>
              <tr>
                <th className="aspire-th">Unit</th>
                <th className="aspire-th aspire-th-right">Positions</th>
                <th className="aspire-th aspire-th-right">1st Choice</th>
                <th className="aspire-th aspire-th-right">Top 3</th>
                <th className="aspire-th aspire-th-right">Assigned</th>
                <th className="aspire-th aspire-th-right">Hired</th>
                <th className="aspire-th aspire-th-right">Open</th>
              </tr>
            </thead>
            {groups.map((g) => {
              const isOpen = open.has(g.division)
              const total = f => g.units.reduce((s, u) => s + (u[f] || 0), 0)
              return (
                <tbody key={g.division}>
                  <tr className="ngrp-glance-div">
                    <td>
                      <button type="button" className="ngrp-glance-divbtn" aria-expanded={isOpen} onClick={() => toggle(g.division)}>
                        <span className="ov-chevron">{isOpen ? '▾' : '▸'}</span>
                        <span className="ngrp-glance-divname">{g.division}</span>
                        <span className="ov-group-badge">{plural(g.units.length, 'unit')}</span>
                      </button>
                    </td>
                    <td className="num">{g.positions ?? ''}</td>
                    <td className="num">{total('first')}</td>
                    <td className="num">{total('top3')}</td>
                    <td className="num">{g.assigned}</td>
                    <td className="num">{total('hired')}</td>
                    <td className="num">{g.positions == null ? '' : Math.max(g.positions - g.assigned, 0)}</td>
                  </tr>
                  {isOpen && g.units.map(u => (
                    <tr key={u.unit_name} className="ngrp-glance-unit">
                      <td>{u.unit_name}</td>
                      <td className="num">{u.positions ?? <span className="ngrp-glance-muted">Not set</span>}</td>
                      <td className="num">{u.first}</td>
                      <td className="num">{u.top3}</td>
                      <td className="num">{u.assigned}</td>
                      <td className="num">{u.hired}</td>
                      <td className="num">{u.open ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              )
            })}
          </table>
        </div>
      )}
    </section>
  )
}

// ── 3 · Applicants (like Placement Requests) ─────────────────────────────────
// RESIDENCY-ROSTER-1: the SAME Status the roster shows, so the two surfaces
// cannot describe one person two ways.
function ApplicantStatus({ row }) {
  const status = rosterStatus(row)
  if (status === 'awaiting_decision' && row.assigned_unit) {
    return <span className="ngrp-glance-pill ngrp-glance-pill-conf">{row.assigned_unit} interviews them</span>
  }
  const tone = status === 'hired' ? ' ngrp-glance-pill-ok' : status === 'in_pool' ? ' ngrp-glance-pill-conf' : ''
  return <span className={`ngrp-glance-pill${tone}`}>{ROSTER_STATUSES[status].label}</span>
}

function ApplicantsPanel({ schools, loading }) {
  const { open, toggle, setOpen } = useOpenSet()
  const total = schools.reduce((s, g) => s + g.rows.length, 0)
  const paired = schools.reduce((s, g) => s + g.paired, 0)
  return (
    <section className="snap ngrp-glance-panel" aria-label="Applicants">
      <div className="aggregate-panel-hdr">
        <div>
          <div className="ov-panel-title">Applicants</div>
          <div className="ov-panel-sub">
            {plural(schools.length, 'school')} · {plural(total, 'applicant')} · {paired} paired
          </div>
        </div>
        {schools.length > 0 && (
          <ExpandToggle onExpand={() => setOpen(new Set(schools.map(g => g.school)))} onCollapse={() => setOpen(new Set())} />
        )}
      </div>
      {schools.length === 0 ? (
        <p className="ngrp-glance-empty">
          {loading ? 'Loading…' : 'No applicants yet. Alumni appear here once they submit the Transition Form.'}
        </p>
      ) : (
        <div className="ov-groups">
          {schools.map((g) => {
            const isOpen = open.has(g.school)
            return (
              <div key={g.school} className="ov-group">
                <button type="button" className="ov-group-row ngrp-glance-grouprow" aria-expanded={isOpen} onClick={() => toggle(g.school)}>
                  <span className="ov-chevron">{isOpen ? '▾' : '▸'}</span>
                  <span className="ov-group-name">{g.school}</span>
                  {g.inPool > 0 && <span className="ngrp-glance-pill ngrp-glance-pill-ok">{g.inPool} in the pool</span>}
                  <span className="ov-group-badge">{plural(g.rows.length, 'applicant')}</span>
                </button>
                {isOpen && (
                  <div className="ov-group-items">
                    {g.rows.map(r => (
                      <div key={r.id} className="ov-unit-row">
                        <div className="ngrp-glance-person">
                          <StudentAvatar student={r.student} size={28} />
                          <div className="ov-unit-info">
                            <span className="ov-unit-name">
                              {displayName(r.student)}
                              {r.student?.aspire_cohort && <span className="ngrp-glance-cohort">{r.student.aspire_cohort}</span>}
                            </span>
                            <span className="ngrp-glance-muted">1st choice: {r.unit_preference_1 || 'none ranked'}</span>
                          </div>
                        </div>
                        <div className="ov-unit-badges"><ApplicantStatus row={r} /></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default function AtAGlanceTab({ cycle, cyclesCount, canManage, onEditCohort, onAddCohort }) {
  const { userProfile } = useAuth()
  const navigate = useNavigate()
  const { base, eventAudience, staffApp } = useNgrpSurface()
  // Hooks stay above the early returns below.
  const mastheadItems = useStaffMastheadEvents({ audience: eventAudience })
  const planning = useNgrpPlanning(cycle?.id || null)
  const data = planning.data
  const applicants = useNgrpApplicants(cycle?.id)

  const rows = useMemo(
    () => deriveApplicantRows(applicants.payload?.students, applicants.payload?.candidates),
    [applicants.payload],
  )

  const todayStr = toLocalDateStr()
  const serverCycle = data?.cycle || null
  const timeline = useMemo(() => cycleTimeline(serverCycle, todayStr), [serverCycle, todayStr])
  // RESIDENCY-PORTAL-2: the Residency Portal's roster is submitted-forms only, so its
  // server supplies the cohort-wide counts; the staff app derives them from its rows.
  const stages = useMemo(
    () => applicants.payload?.pipeline || pipelineStages(rows, { effectiveEligibility }),
    [applicants.payload, rows],
  )
  const snap = useMemo(() => residencySnapshot({ units: data?.units || [], rows, stages }), [data, rows, stages])
  const band = useMemo(() => statusCounts(rows), [rows])
  const unitGroups = useMemo(() => hiringUnitGroups(data?.units || [], rows), [data, rows])
  const schools = useMemo(() => applicantsBySchool(rows), [rows])

  // ── Access + loading states ────────────────────────────────────────────────
  if (!canManage) {
    return (
      <div className="snap" style={{ margin: '14px 0', padding: '22px 24px' }}>
        <p style={{ margin: 0, fontSize: 13, color: '#6b7280', fontFamily: F }}>
          At a Glance requires NGRP management access.
        </p>
      </div>
    )
  }
  if (planning.status === 'loading') {
    return <div className="state-box"><div className="spinner" /><p>Loading At a Glance…</p></div>
  }
  if (planning.status === 'unprovisioned') {
    return (
      <div className="snap" style={{ margin: '14px 0', padding: '22px 24px', background: '#F3F4F6' }}>
        <p style={{ margin: 0, fontSize: 13, color: '#4B5563', fontFamily: F }}>
          NGRP persistence is not provisioned yet - apply the pending migration, then reload.
        </p>
      </div>
    )
  }
  if (planning.status === 'error' || planning.status === 'stale') {
    return (
      <div className="ngrp-banner ngrp-banner-error" role="alert" style={{ marginTop: 14 }}>
        <b>At a Glance could not load.</b> This is a server or connection problem.{' '}
        <button type="button" className="ngrp-linkbtn" onClick={() => planning.refetch()}>Try again</button>
      </div>
    )
  }

  // ── First-time setup (no residency cohorts at all) ─────────────────────────
  if (!cycle || cyclesCount === 0) {
    return (
      <div className="snap" style={{ margin: '14px 0', padding: '26px 28px' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, color: '#1D2567', fontFamily: F }}>
          Set up your first residency cohort
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 13.5, color: '#4A5560', maxWidth: 620, lineHeight: 1.6, fontFamily: F }}>
          A residency cohort (for example “January 2027”) scopes everything in the Residency
          experience: which completed ASPIRE alumni appear in Applicants, the Transition Form
          window, participating units, and eligibility rules. Add it here - no SQL involved -
          then choose the ASPIRE cohorts participating and configure the rest at your own pace.
        </p>
        <button type="button" style={{ ...btn(true), height: 38, fontSize: 13.5 }} onClick={onAddCohort}>
          <Plus size={15} strokeWidth={2.2} aria-hidden="true" /> Add residency cohort
        </button>
      </div>
    )
  }

  if (!serverCycle) return <div className="state-box"><div className="spinner" /><p>Loading cohort…</p></div>

  const readiness = data?.readiness || { ok: false, reasons: [] }
  // COHORT-ORDER-1: the summary reads in program order too, so it cannot
  // disagree with the picker that set it.
  const sources = [...(data?.sourceCohorts || [])].sort(compareCohortsChrono)
  const rosterLoading = applicants.status === 'loading'

  const dateLabel = new Date(`${todayStr}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  // EVENT-AUDIENCE-2 (Owner, 2026-09-04): the cycle-milestone chip is gone. The
  // masthead shows the SAME flagged calendar events every staff masthead shows,
  // by the one rule in src/lib/mastheadEvents.js; the cycle's own dates live in
  // the timeline card below, where they always were.

  const editButton = (
    <button type="button" style={btn()} onClick={onEditCohort}>
      <Settings2 size={13} strokeWidth={2.2} aria-hidden="true" /> Edit cohort
    </button>
  )

  return (
    <div style={{ margin: '14px 0 28px' }}>
      {/* NGRP-WORKSPACE-2: the same shared masthead the Internship At a Glance
          and every portal home use, so the two experiences open the same way.
          Its context line names the residency cohort rather than an ASPIRE one,
          because that is what everything below it is scoped to. */}
      <GreetingMasthead
        fullName={userProfile?.full_name}
        dateLabel={dateLabel}
        contextLabel={serverCycle.name}
        items={mastheadItems}
        calendar={{ label: 'Open Calendar', onClick: () => navigate(ngrpPath('residency', 'activity', base)) }}
        flush
      />

      {/* Readiness gates Transition Form SENDS, which only the ASPIRE team
          does, so the Residency Portal does not show it. */}
      {staffApp && (
        <div className={`ngrp-banner ${readiness.ok ? 'ngrp-banner-info' : 'ngrp-banner-warn'}`}
          style={{ margin: '14px 0 0', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          {readiness.ok
            ? <><CheckCircle2 size={15} strokeWidth={2.2} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                <span><b>Ready for Transition Form sends.</b> Deadline, participating ASPIRE cohorts, and participating units are all configured.</span></>
            : <><AlertTriangle size={15} strokeWidth={2.2} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                <span><b>Not ready for form sends yet:</b>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{readiness.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </span></>}
          {!readiness.ok && (
            <button type="button" onClick={onEditCohort}
              style={{ ...btn(), marginLeft: 'auto', flexShrink: 0, borderColor: 'rgba(146,64,14,0.25)', color: '#92400E' }}>
              Fix in cohort settings
            </button>
          )}
        </div>
      )}

      <ResidencySnapshot snap={snap} band={band} cycleName={serverCycle.name} />

      <div className="ngrp-plan-2col">
        <HiringUnitsPanel groups={unitGroups} loading={planning.status === 'loading'} />
        <ApplicantsPanel schools={schools} loading={rosterLoading} />
      </div>

      <div className="ngrp-plan-2col">
        <Panel title="Cohort Timeline" sub={serverCycle.status} action={editButton}>
          <ol className="ngrp-timeline">
            {timeline.map(item => {
              const range = item.end && item.end !== item.start
                ? `${fmtDay(item.start)} – ${fmtDay(item.end)}`
                : fmtDay(item.start)
              return (
                <li key={item.key} className={`ngrp-tl-step ngrp-tl-${item.state}${item.isNext ? ' ngrp-tl-next' : ''}`}>
                  <span className="ngrp-tl-dot" aria-hidden="true" />
                  <span className="ngrp-tl-label">{item.label}</span>
                  <span className="ngrp-tl-date">{range || 'Not set'}</span>
                  <span className="ngrp-tl-when">{milestoneWhen(item) || (item.state === 'unset' ? '—' : '')}</span>
                </li>
              )
            })}
          </ol>
        </Panel>

        <Panel title="Pipeline" sub={rosterLoading ? 'Loading…' : plural(sources.length, 'participating cohort')}>
          {sources.length === 0 && (
            <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#92400E', fontFamily: F }}>
              No ASPIRE cohorts are participating yet, so no alumni are in scope.
            </p>
          )}
          <div className="ngrp-funnel">
            {stages.map(s => (
              <div key={s.key} className="ngrp-funnel-row">
                <span className="ngrp-funnel-label">{s.label}<span className="ngrp-funnel-hint">{s.hint}</span></span>
                <span className="ngrp-funnel-count">{s.count}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
