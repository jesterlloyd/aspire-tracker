// NGRP-WORKSPACE-2: At a Glance - the cohort's OPERATING PICTURE.
//
// This was the Planning tab. NGRP-WORKSPACE-2 renamed the workspace's tabs to
// match the Internship side, and "Planning" is exactly what At a Glance means
// there: where are we, what is next, what is blocked. The content is unchanged;
// only the name and the masthead above it are new.
//
// (Original note, still true.)
//
// WHAT CHANGED AND WHY.
// Planning used to be six configuration cards - the residency answer to the
// Internship's Edit Cohort modal, except living in a workspace tab. That put
// the same act (administer this cohort) in two different places depending on
// which experience you were in. The configuration now opens from the header's
// Scope picker in both experiences (components/ngrp/CohortSettingsModal.jsx),
// which leaves this tab free to do the job its name always promised.
//
// It answers four questions, in the order they get asked:
//   1. Can this cohort send Transition Forms yet, and if not, what is missing?
//   2. Where are we in this cohort's own calendar, and what is next?
//   3. Is the pipeline producing applicants, and do they fit the seats we have?
//   4. What is this cohort configured to be? (read-only, one click to change)
//
// READ-ONLY BY DESIGN, with exactly one way out to editing. Every number here
// is derived from data another surface already owns - readiness and units from
// the planning payload, the funnel from the SAME derived rows the Applicants
// roster renders - so Planning can never disagree with the tab it summarizes.
import { useMemo } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import GreetingMasthead from '../masthead/GreetingMasthead'
import { Plus, CheckCircle2, AlertTriangle, Settings2 } from 'lucide-react'
import { useNgrpPlanning, useNgrpApplicants } from '../../lib/ngrp/useNgrpData'
import { deriveApplicantRows, effectiveEligibility } from '../../lib/ngrp/ngrpStates'
import { toLocalDateStr } from '../../lib/designTokens'
import { F, btn, rulesOf } from '../../lib/ngrp/ngrpCohortForm'
import { compareCohortsChrono } from '../../lib/cohortSeason'
import { DEFAULT_APPLICATION_CHECKLIST } from '../../../lib/server/ngrpEligibility.js'
import {
  cycleTimeline, milestoneWhen, capacitySummary, pipelineStages, seatPressure, ruleSummaryLines,
} from '../../lib/ngrp/ngrpPlanningView'

const fmtDay = d => {
  if (!d) return null
  const [y, m, day] = String(d).split('T')[0].split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

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

export default function AtAGlanceTab({ cycle, cyclesCount, canManage, onEditCohort, onAddCohort }) {
  const { userProfile } = useAuth()
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
  const capacity = useMemo(() => capacitySummary(data?.units), [data])
  const stages = useMemo(() => pipelineStages(rows, { effectiveEligibility }), [rows])
  const confirmed = stages.find(s => s.key === 'confirmed')?.count || 0
  const pressure = seatPressure(capacity, confirmed)

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
  const rules = rulesOf(serverCycle)
  // COHORT-ORDER-1: the summary reads in program order too, so it cannot
  // disagree with the picker that set it.
  const sources = [...(data?.sourceCohorts || [])].sort(compareCohortsChrono)
  // The five official requirements are always in force, whatever the cycle
  // stores; only the extras vary by cohort.
  const extras = (Array.isArray(serverCycle.application_checklist) ? serverCycle.application_checklist : [])
    .filter(i => !DEFAULT_APPLICATION_CHECKLIST.some(o => o.key === i.key))

  const dateLabel = new Date(`${todayStr}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  // The masthead's milestone is the same "next" the timeline marks, so the card
  // and the list below it can never name different things.
  const nextMilestone = timeline.find(i => i.isNext) || timeline.find(i => i.state === 'today') || null
  const mastheadMilestone = nextMilestone
    ? { label: 'Next milestone', name: nextMilestone.label, when: milestoneWhen(nextMilestone) }
    : null

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
        milestone={mastheadMilestone}
      />

      {/* 1 · Readiness - the one question that gates everything downstream. */}
      <div className={`ngrp-banner ${readiness.ok ? 'ngrp-banner-info' : 'ngrp-banner-warn'}`}
        style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
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

      {/* 2 · The cohort's own calendar. */}
      <Panel title="Cohort timeline" sub={serverCycle.status} action={editButton}>
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

      {/* 3 · Demand and seats, side by side - the actual planning judgment. */}
      <div className="ngrp-plan-2col">
        <Panel title="Pipeline" sub={applicants.status === 'loading' ? 'Loading…' : `${sources.length} source cohort${sources.length === 1 ? '' : 's'}`}>
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

        <Panel title="Seats" sub={`${capacity.activeCount} active unit${capacity.activeCount === 1 ? '' : 's'}`}>
          {capacity.activeCount === 0 ? (
            <p style={{ margin: 0, fontSize: 12.5, color: '#92400E', fontFamily: F, lineHeight: 1.6 }}>
              No participating units are active. The Transition Form has no ranked preferences to offer
              until at least one unit is added and marked active.
            </p>
          ) : (
            <>
              {/* A seat total is shown only when it means something. With no
                  capacity entered at all there is no number to print, and a
                  big em-dash would read as "zero seats" rather than "unknown". */}
              {capacity.seats > 0 && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 30, fontWeight: 700, color: '#1D2567', fontFamily: F, fontVariantNumeric: 'tabular-nums' }}>
                    {capacity.seats}
                  </span>
                  <span style={{ fontSize: 12.5, color: '#6B7785', fontFamily: F }}>
                    seat{capacity.seats === 1 ? '' : 's'} across{' '}
                    {capacity.exact
                      ? `${capacity.activeCount} unit${capacity.activeCount === 1 ? '' : 's'}`
                      : `${capacity.activeCount - capacity.unpriced} of ${capacity.activeCount} units`}
                  </span>
                </div>
              )}
              {pressure ? (
                <>
                  <div className="ngrp-seatbar" role="img"
                    aria-label={`${pressure.confirmed} confirmed applicants against ${pressure.seats} seats`}>
                    <span className={`ngrp-seatbar-fill${pressure.over ? ' ngrp-seatbar-over' : ''}`} style={{ width: `${pressure.pct}%` }} />
                  </div>
                  <p style={{ margin: '8px 0 0', fontSize: 12.5, color: pressure.over ? '#B3282D' : '#4A5560', fontFamily: F, lineHeight: 1.6 }}>
                    {pressure.over
                      ? <><b>{pressure.confirmed} confirmed</b> against {pressure.seats} seats - {pressure.confirmed - pressure.seats} over capacity.</>
                      : <><b>{pressure.confirmed} confirmed</b>, {pressure.remaining} seat{pressure.remaining === 1 ? '' : 's'} remaining.</>}
                  </p>
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 12.5, color: '#6B7785', fontFamily: F, lineHeight: 1.6 }}>
                  {capacity.unpriced} of {capacity.activeCount} active unit{capacity.activeCount === 1 ? ' has' : 's have'} no capacity set,
                  so the seat total is incomplete and is not compared against confirmed applicants.
                </p>
              )}
              <ul className="ngrp-seatlist">
                {(data.units || []).filter(u => u.is_active).map(u => (
                  <li key={u.unit_name}>
                    <span>{u.unit_name}</span>
                    <span className="ngrp-seatlist-cap">{Number(u.capacity) > 0 ? u.capacity : '—'}</span>
                  </li>
                ))}
              </ul>
              {capacity.inactiveCount > 0 && (
                <p style={{ margin: '10px 0 0', fontSize: 11.5, color: '#8B8F99', fontFamily: F }}>
                  {capacity.inactiveCount} inactive unit{capacity.inactiveCount === 1 ? '' : 's'} not offered on the form.
                </p>
              )}
            </>
          )}
        </Panel>
      </div>

      {/* 4 · What this cohort is configured to be. Read-only on purpose. */}
      <Panel title="Scope and rules" action={editButton}>
        <dl className="ngrp-summary">
          <dt>ASPIRE cohorts participating</dt>
          <dd>{sources.length ? sources.map(c => c.name).join(', ') : <i>None mapped</i>}</dd>

          <dt>Eligibility</dt>
          <dd>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {ruleSummaryLines(rules).map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          </dd>

          <dt>Application checklist</dt>
          <dd>
            {DEFAULT_APPLICATION_CHECKLIST.length} required item{DEFAULT_APPLICATION_CHECKLIST.length === 1 ? '' : 's'}
            {extras.length ? `, plus ${extras.length} for this cohort: ${extras.map(i => i.label).filter(Boolean).join(', ')}` : ''}
          </dd>

          <dt>Retention benchmarks</dt>
          <dd>{[
            serverCycle.retention_benchmarks?.traditional_pct != null && `Traditional residency ${serverCycle.retention_benchmarks.traditional_pct}%`,
            serverCycle.retention_benchmarks?.organization_pct != null && `Organization-wide ${serverCycle.retention_benchmarks.organization_pct}%`,
          ].filter(Boolean).join(' · ') || <i>Not set</i>}</dd>

          {serverCycle.notes && (<><dt>Notes</dt><dd>{serverCycle.notes}</dd></>)}
        </dl>
      </Panel>
    </div>
  )
}
