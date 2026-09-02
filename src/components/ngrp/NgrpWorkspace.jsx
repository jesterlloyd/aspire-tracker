// NGRP-WORKSPACE-2: the Residency workspace shell.
//
// Five tabs (A / S / PI / R / E), two of which carry sub-tabs. The PRIMARY
// cohort selector lives in the header's Scope picker; this shell renders compact
// cohort metadata, the sub-tab strip where a tab has one, and the workspace's
// distinct query states: loading, unprovisioned, unauthorized, error and
// no-cohorts are different situations and render as different things.
//
// ROUTING IS RESOLVED IN ONE PLACE. resolveNgrpPath turns any /ngrp/* path,
// including the retired ids people have bookmarked, into a live tab plus sub-tab
// and the canonical path to replace it with. This shell only redirects when it
// says to, so a legacy URL lands somewhere real instead of on an error.
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { resolveNgrpPath, ngrpSubTabs, ngrpPath } from '../../lib/ngrp/ngrpTabs'
import SegmentedTabs from '../ui/SegmentedTabs'
import AtAGlanceTab from './AtAGlanceTab'
import ProfilesTab from './ProfilesTab'
import ActivityCalendar from './ActivityCalendar'
import './ngrp.css'

// Tabs and sub-tabs whose surfaces are not built yet say what they will hold and
// what they are waiting on. None of them is ever shown as an empty success.
const PLANNED = {
  'support/before': {
    title: 'Support before residency',
    body: 'Optional NGRP preparation for alumni who have not started yet - Town Halls, Interview Bootcamps, resume reviews and workshops - with attendance tracked per cohort. Participation is always optional and never affects eligibility.',
  },
  'support/after': {
    title: 'Support after residency',
    body: 'Mentorship for residents who have started: mentor pairing, weekly check-ins, and the touchpoints that run alongside the 3, 6 and 12 month checkpoints.',
  },
  'residency/board': {
    title: 'Placement board',
    body: 'Units hiring on the left, applicants on the right, matched the way the ASPIRE placement board works: ranked preferences beside the assigned unit, seats against confirmed applicants, and the interview and hire outcome recorded on the row. This is where who was interviewed and who was hired will live.',
  },
  evaluation: {
    title: 'Evaluation',
    body: 'Cohort-scoped outcomes with explicit denominators: Interview Bootcamp pre and post assessment, resident evaluation completion, retention at 3, 6 and 12 months against cohort and organization benchmarks, and the Casey-Fink survey. Support participation comparisons stay observational.',
  },
}

const fmtDate = d => {
  if (!d) return null
  const [y, m, day] = String(d).split('T')[0].split('-').map(Number)
  if (!y || !m || !day) return d
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function StateCard({ heading, body, tone = 'info' }) {
  const tones = {
    info:  { bg: '#F3F4F6', border: '#D1D5DB', color: '#4B5563' },
    error: { bg: '#FEE2E2', border: '#FCA5A5', color: '#991B1B' },
  }
  const t = tones[tone] || tones.info
  return (
    <div className="snap" style={{ margin: '14px 0', padding: '22px 24px', background: t.bg, border: `1px solid ${t.border}` }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700, color: t.color }}>{heading}</h2>
      <p style={{ margin: 0, fontSize: 13, color: t.color, maxWidth: 640, lineHeight: 1.6 }}>{body}</p>
    </div>
  )
}

function PlannedCard({ id }) {
  const spec = PLANNED[id]
  if (!spec) return null
  return (
    <div className="snap" style={{ margin: '14px 0', padding: '22px 24px' }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: 'var(--raven, #191919)' }}>{spec.title}</h2>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #6b7280)', maxWidth: 640, lineHeight: 1.6 }}>{spec.body}</p>
      <p style={{ margin: '10px 0 0', fontSize: 12, color: '#9CA3AF' }}>
        This surface ships after the workspace restructure; its data model is part of the NGRP
        foundation plan (docs/product/NGRP-WORKSPACE-1.md).
      </p>
    </div>
  )
}

export default function NgrpWorkspace({ cyclesStatus, cyclesCount, cycle, canManage, toast, onEditCohort, onAddCohort }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { tab, subTab, redirect } = resolveNgrpPath(location.pathname)

  // The one redirect. Everything from a bare /ngrp to a retired /ngrp/applicants
  // bookmark resolves through resolveNgrpPath and lands on a canonical path.
  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true })
  }, [redirect, navigate])

  // ── Workspace-level query states (each one distinct, none conflated) ───────
  if (cyclesStatus === 'loading') {
    return (
      <div className="ngrp-main">
        <div className="state-box"><div className="spinner" /><p>Loading residency cohorts…</p></div>
      </div>
    )
  }
  if (cyclesStatus === 'unauthorized') {
    return (
      <div className="ngrp-main">
        <StateCard heading="NGRP access required" body="Your account does not have access to the Residency workspace." />
      </div>
    )
  }
  if (cyclesStatus === 'unprovisioned') {
    return (
      <div className="ngrp-main">
        <StateCard
          heading="NGRP persistence is not provisioned yet"
          body="The NGRP foundation migration (supabase/migrations/20260903000000_ngrp_foundation.sql) has not been applied. Apply it through the Owner SQL gate, then reload - no roster is shown until the workspace can answer correctly."
        />
      </div>
    )
  }
  if (cyclesStatus === 'error' || cyclesStatus === 'stale') {
    return (
      <div className="ngrp-main">
        <StateCard
          tone="error"
          heading="Residency cohorts could not be loaded"
          body="The server or database did not answer. This is not an empty cohort list - refresh to try again, and check the connection if it persists."
        />
      </div>
    )
  }
  // No configured cohorts never blocks At a Glance, which is where the first
  // cohort is set up; every other tab explains the requirement honestly.
  if (cyclesCount === 0 && tab !== 'overview') {
    return (
      <div className="ngrp-main">
        <StateCard
          heading="No residency cohorts configured"
          body="NGRP is provisioned but no residency cohort exists yet. Add one from the Scope picker in the header, or from At a Glance (no SQL involved) - until then there is nothing to scope this tab to."
        />
      </div>
    )
  }

  const subs = ngrpSubTabs(tab)

  return (
    <div className="ngrp-workspace">
      <div className="ngrp-main">
        {/* Compact cohort metadata - the selector itself is the header's Scope pill. */}
        {cycle && (
          <div className="ngrp-cycle-strip" data-testid="ngrp-cycle-meta">
            <span className="ngrp-cycle-eyebrow">Residency Cohort</span>
            <span className="ngrp-cycle-name">{cycle.name}</span>
            {cycle.status && <span className="ngrp-cycle-meta">{cycle.status}</span>}
            {cycle.application_open_date && (
              <span className="ngrp-cycle-meta">Applications {fmtDate(cycle.application_open_date)}{cycle.application_deadline ? ` – ${fmtDate(cycle.application_deadline)}` : ''}</span>
            )}
            {cycle.interview_window_start && (
              <span className="ngrp-cycle-meta">Interviews {fmtDate(cycle.interview_window_start)}{cycle.interview_window_end ? ` – ${fmtDate(cycle.interview_window_end)}` : ''}</span>
            )}
            {cycle.residency_start_date && (
              <span className="ngrp-cycle-meta">Residency starts {fmtDate(cycle.residency_start_date)}</span>
            )}
          </div>
        )}

        {/* Sub-tabs, for the two tabs that have them. The strip is the shared
            SegmentedTabs, so it keeps its own arrow-key handling. */}
        {subs.length > 0 && (
          <div className="ngrp-subnav">
            <SegmentedTabs
              label={`${tab} sections`}
              items={subs.map(s => ({ key: s.id, label: s.label }))}
              value={subTab}
              onChange={key => navigate(ngrpPath(tab, key))}
            />
          </div>
        )}

        {tab === 'overview' && (
          <AtAGlanceTab
            cycle={cycle}
            cyclesCount={cyclesCount}
            canManage={canManage}
            onEditCohort={onEditCohort}
            onAddCohort={onAddCohort}
          />
        )}

        {tab === 'profiles' && <ProfilesTab cycle={cycle} canManage={canManage} toast={toast} />}

        {tab === 'support' && <PlannedCard id={`support/${subTab}`} />}

        {tab === 'residency' && subTab === 'board' && <PlannedCard id="residency/board" />}
        {tab === 'residency' && subTab === 'activity' && (
          <ActivityCalendar cycle={cycle} canManage={canManage} />
        )}

        {tab === 'evaluation' && <PlannedCard id="evaluation" />}
      </div>
    </div>
  )
}
