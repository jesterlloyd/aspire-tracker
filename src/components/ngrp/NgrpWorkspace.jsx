// NGRP-WORKSPACE-1: the NGRP workspace shell. Owns the residency-cycle
// selector (the workspace's PRIMARY selector - an NGRP cycle is not an ASPIRE
// cohort; the cohort remains a filter inside Applicants) and routes the six
// sub-tabs by URL (/ngrp/<tab>), matching the app's URL-derived tab pattern.
//
// Cycle persistence lands with migration 20260903000000 (Owner-gated, not yet
// applied). Until then the hooks report provisioned:false, the roster still
// derives fully from completed ASPIRE students, and everything that would
// write is visibly gated.
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { NGRP_TABS } from '../../lib/ngrp/ngrpTabs'
import ApplicantsTab from './ApplicantsTab'
import { useNgrpCycles, useNgrpCandidates } from '../../lib/ngrp/useNgrpData'
import './ngrp.css'

const CYCLE_KEY = 'aspire:ngrpCycleId'

const PLANNED_TABS = {
  support: {
    title: 'Support',
    body: 'Optional NGRP preparation - Town Halls, Interview Bootcamps, workshops, and mentorship touchpoints - with attendance tracked per cycle. Participation is always optional and never affects eligibility.',
  },
  planning: {
    title: 'Planning',
    body: 'Cycle setup: name and status, application dates, interview window, licensing deadline, residency start date, participating units, qualification requirements, conditional-requirement deadlines, the application checklist, retention benchmarks, and cycle events.',
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

export default function NgrpWorkspace({ students, cohorts, canEdit, toast }) {
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

  const { provisioned, cycles, loading: cyclesLoading } = useNgrpCycles()

  // The stored id is a preference, not state to synchronize: the effective
  // cycle is DERIVED (stored id if it still exists → the active cycle → the
  // newest), and only an explicit selection writes anything back.
  const [cycleId, setCycleId] = useState(() => {
    try { return localStorage.getItem(CYCLE_KEY) || '' } catch { return '' }
  })
  const cycle = cycles.find(c => c.id === cycleId)
    || cycles.find(c => c.is_active)
    || cycles[0]
    || null
  const selectCycle = id => {
    setCycleId(id)
    try { localStorage.setItem(CYCLE_KEY, id) } catch { /* storage unavailable */ }
  }

  const { candidates } = useNgrpCandidates(cycle?.id, { enabled: provisioned })

  // NgrpNav itself renders in App.jsx's sticky .top-section, beside where
  // UnifiedNav renders for the ASPIRE workspace; this shell owns everything
  // below the nav.
  return (
    <div className="ngrp-workspace">
      <div className="ngrp-main">
        {/* Cycle strip: the workspace-level context. Distinct from (and shown
            alongside) the ASPIRE cohort, which stays in the header picker. */}
        <div className="ngrp-cycle-strip">
          <span className="ngrp-cycle-eyebrow">NGRP Residency Cycle</span>
          {cycles.length > 0 ? (
            <label className="ngrp-cycle-pick">
              <span className="sr-only">Select NGRP residency cycle</span>
              <select value={cycle?.id || ''} onChange={e => selectCycle(e.target.value)}>
                {cycles.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.status ? ` · ${c.status}` : ''}</option>
                ))}
              </select>
              <ChevronDown size={12} strokeWidth={2.4} aria-hidden="true" />
            </label>
          ) : (
            <span className="ngrp-cycle-none">
              {cyclesLoading ? 'Loading cycles…' : 'No cycles yet'}
            </span>
          )}
          {cycle?.residency_start_date && (
            <span className="ngrp-cycle-meta">Residency starts {cycle.residency_start_date}</span>
          )}
          {cycle?.application_deadline && (
            <span className="ngrp-cycle-meta">Applications close {cycle.application_deadline}</span>
          )}
          {!provisioned && (
            <span className="ngrp-provision-chip" title="Apply supabase/migrations/20260903000000_ngrp_foundation.sql (Owner SQL gate), then reload.">
              Awaiting NGRP provisioning - roster is live, persisted actions are disabled
            </span>
          )}
        </div>

        {(!subTab || subTab === 'applicants') && (
          <ApplicantsTab
            students={students}
            cohorts={cohorts}
            cycle={cycle}
            candidates={candidates}
            provisioned={provisioned}
            canEdit={canEdit}
            toast={toast}
          />
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
