// NGRP-WORKSPACE-1 (correction): the NGRP workspace shell.
//
// The PRIMARY cycle selector now lives in the header (NgrpCyclePicker, in the
// slot the ASPIRE cohort picker occupies in the ASPIRE workspace) - this
// shell no longer renders a second selector. What remains here is compact
// cycle METADATA (status, application dates, interview window, residency
// start) plus the sub-tab routing and the workspace's distinct query states:
// loading, unprovisioned, unauthorized, error, and no-cycles are all
// different situations and render as different things - none of them is ever
// shown as "No cycles yet".
import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { NGRP_TABS } from '../../lib/ngrp/ngrpTabs'
import ApplicantsTab from './ApplicantsTab'
import './ngrp.css'

const PLANNED_TABS = {
  support: {
    title: 'Support',
    body: 'Optional NGRP preparation - Town Halls, Interview Bootcamps, workshops, and mentorship touchpoints - with attendance tracked per cycle. Participation is always optional and never affects eligibility.',
  },
  planning: {
    title: 'Planning',
    body: 'Cycle setup: name and status, application dates, interview window, licensing deadline, residency start date, source ASPIRE cohorts, participating units, qualification requirements, conditional-requirement deadlines, the application checklist, retention benchmarks, and cycle events.',
  },
  interviews: {
    title: 'Interviews',
    body: 'The internal assignment board for application-confirmed candidates: three ranked preferences beside the single HR-assigned unit, interviewer and schedule, the requirements checklist, and interview state. HR selects the assigned unit and interview; this board records it.',
  },
  residency: {
    title: 'Residency',
    body: 'Offer through retention: acceptance, hire, final unit, residency start, clinical orientation, permanent assignment, weekly mentorship check-ins, and the 3-, 6-, and 12-month checkpoints.',
  },
  evaluation: {
    title: 'Evaluation',
    body: 'Cycle-scoped outcomes with explicit denominators: Bootcamp pre/post assessment, resident evaluation completion, retention at 3, 6, and 12 months against cycle and organization benchmarks, and the conversion funnel from completed ASPIRE alumnus to retained RN. Support-participation comparisons stay observational.',
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

export default function NgrpWorkspace({ cyclesStatus, cyclesCount, cycle, canManage, toast }) {
  const location = useLocation()
  const navigate = useNavigate()

  const subTab = useMemo(() => {
    const seg = location.pathname.split('/')[2] || ''
    return NGRP_TABS.some(t => t.id === seg) ? seg : null
  }, [location.pathname])

  // /ngrp (or an unknown sub-path) → Applicants, mirroring /rotation's redirect.
  useEffect(() => {
    if (!subTab) navigate('/ngrp/applicants', { replace: true })
  }, [subTab, navigate])

  // ── Workspace-level query states (each one distinct, none conflated) ───────
  if (cyclesStatus === 'loading') {
    return (
      <div className="ngrp-main">
        <div className="state-box"><div className="spinner" /><p>Loading NGRP cycles…</p></div>
      </div>
    )
  }
  if (cyclesStatus === 'unauthorized') {
    // The App-level guard redirects; this renders only for the brief interim
    // and never shows any roster data.
    return (
      <div className="ngrp-main">
        <StateCard heading="NGRP access required" body="Your account does not have access to the NGRP workspace." />
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
          heading="NGRP cycles could not be loaded"
          body="The server or database did not answer. This is not an empty cycle list - refresh to try again, and check the connection if it persists."
        />
      </div>
    )
  }
  if (cyclesCount === 0) {
    return (
      <div className="ngrp-main">
        <StateCard
          heading="No residency cycles configured"
          body="NGRP is provisioned but no cycle exists yet. Cycles (and their source ASPIRE cohorts) are created in NGRP → Planning; until then there is nothing to scope the Applicants roster to."
        />
      </div>
    )
  }

  return (
    <div className="ngrp-workspace">
      <div className="ngrp-main">
        {/* Compact cycle metadata - the selector itself is the header pill. */}
        {cycle && (
          <div className="ngrp-cycle-strip" data-testid="ngrp-cycle-meta">
            <span className="ngrp-cycle-eyebrow">NGRP Residency Cycle</span>
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

        {(!subTab || subTab === 'applicants') && (
          <ApplicantsTab cycle={cycle} canManage={canManage} toast={toast} />
        )}

        {subTab && subTab !== 'applicants' && (
          <div className="snap" style={{ margin: '14px 0', padding: '22px 24px' }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: 'var(--raven, #191919)' }}>
              {PLANNED_TABS[subTab]?.title}
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary, #6b7280)', maxWidth: 640, lineHeight: 1.6 }}>
              {PLANNED_TABS[subTab]?.body}
            </p>
            <p style={{ margin: '10px 0 0', fontSize: 12, color: '#9CA3AF' }}>
              This tab ships after Applicants; its data model is part of the NGRP foundation plan
              (docs/product/NGRP-WORKSPACE-1.md).
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
