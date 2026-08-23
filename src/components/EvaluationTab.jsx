import React, { useState, useEffect, useCallback } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { CS_COLORS } from '../lib/brand'
import { useLastSynced } from '../hooks/useLastSynced'
import { useAuth } from '../contexts/AuthContext'
import EvaluationResponseDetail from './EvaluationResponseDetail'
import PreceptorFeedbackPanel from './evaluation/PreceptorFeedbackPanel'
import PreceptorResponseDetail from './evaluation/PreceptorResponseDetail'
import StudentEvalResponseDetail from './evaluation/StudentEvalResponseDetail'
import SurveyAutomationDashboard from './evaluation/SurveyAutomationDashboard'
import CaseyFinkComparisonPanel from './evaluation/CaseyFinkComparisonPanel'
import RestrictedAccessOverlay from './RestrictedAccessOverlay'
import { instrumentCompactLabel, instrumentSortIndex, timepointSortIndex, statusSortIndex, completedByLabel, INSTRUMENT_ORDER } from '../lib/evaluationLabels'
import { buildCaseyFinkComparison } from '../lib/evaluation/caseyFinkComparison'

// Composite Section I mean (CPS/LA/PR) for a row, or null when not all three are present.
function sectionIMean(assignment) {
  const r = extractResponse(assignment)
  const cps = r?.score_s1_clinical_problem_solving
  const la  = r?.score_s1_learning_activities
  const pr  = r?.score_s1_practice_readiness
  if (cps == null || la == null || pr == null) return null
  return (Number(cps) + Number(la) + Number(pr)) / 3
}

const F = 'DM Sans, sans-serif'

// ── Timepoint display labels ──────────────────────────────────────────────────
const TIMEPOINT_LABELS = {
  baseline:                'Baseline',
  early_rotation_baseline: 'Baseline',
  mid_rotation:            'Mid-Rotation Check-In',
  midpoint:                'Mid-Rotation Check-In',
  post_rotation:           'Post-Rotation',
}

// ── Status badge config - colors from brand.js CS_COLORS ─────────────────────
const STATUS_CONFIG = {
  completed:    { bg: CS_COLORS.sage,    text: '#166534', border: '#c6d9a8', label: 'Completed'    },
  opened:       { bg: CS_COLORS.marina,  text: '#1D2567', border: '#9dd6f2', label: 'Opened'       },
  sent:         { bg: '#f3f4f6',         text: '#374151', border: '#d1d5db', label: 'Sent'         },
  expired:      { bg: CS_COLORS.dawn,    text: '#583733', border: '#f0c9b0', label: 'Expired'      },
  revoked:      { bg: '#e5e7eb',         text: '#6b7280', border: '#d1d5db', label: 'Revoked'      },
  reminder_due: { bg: '#fef3c7',         text: '#92400e', border: '#fde68a', label: 'Reminder Due' },
  non_responder:{ bg: '#fee2e2',         text: '#991b1b', border: '#fca5a5', label: 'No Response'  },
  draft:        { bg: '#f9fafb',         text: '#9ca3af', border: '#e5e7eb', label: 'Draft'        },
}

// ── KPI card definitions ──────────────────────────────────────────────────────
// restBg: pastel tint (Phase 4 ACCENT_PALETTE tints from designTokens.js / KPIBand.jsx)
// restNum: per-category dark color for resting-state number
// activeBg: solid category color - mirrors per-accent p.solid in FilterKPICard (KPIBand.jsx)
//   nightfall #1D2567 = colors.ink2, marina #275E63, sage #2F7D5C, dawn solid #8B5E1A (deepened),
//   hickory #583733 = CS_COLORS.hickory (revoked), #4A5560 for neutral sent
const KPI_CARD_DEFS = [
  { key: 'total',     label: 'TOTAL ASSIGNED', sub: 'All assignments',    restBg: '#EDEEF4', restNum: '#1D2567', activeBg: '#1D2567', tooltip: 'All evaluation assignments for this cohort' },
  { key: 'sent',      label: 'SENT',           sub: 'Awaiting response',  restBg: '#F4F3F1', restNum: '#4A5560', activeBg: '#4A5560', tooltip: 'Invitation sent, awaiting student response' },
  { key: 'opened',    label: 'OPENED',         sub: 'In progress',        restBg: '#EDF5F4', restNum: '#275E63', activeBg: '#275E63', tooltip: 'Student opened the invitation' },
  { key: 'completed', label: 'COMPLETED',      sub: 'Response submitted', restBg: '#EEF7F0', restNum: '#2F7D5C', activeBg: '#2F7D5C', tooltip: 'Student submitted responses' },
  { key: 'expired',   label: 'EXPIRED',        sub: 'Window closed',      restBg: '#FBF5E8', restNum: '#8B5E1A', activeBg: '#8B5E1A', tooltip: 'Invitation expired without submission' },
  { key: 'revoked',   label: 'REVOKED',        sub: 'Recalled by owner',  restBg: '#F3F4F6', restNum: '#4A5560', activeBg: '#583733', tooltip: 'Invitation revoked by owner' },
]

// Shadow tokens matching KPIBand.jsx / designTokens.js shadows export
const SH = {
  s1: '0 1px 0 rgba(29,37,103,0.04), 0 1px 2px rgba(29,37,103,0.04)',
  s2: '0 1px 0 rgba(29,37,103,0.04), 0 4px 12px rgba(29,37,103,0.05)',
  s3: '0 1px 0 rgba(29,37,103,0.04), 0 8px 24px rgba(29,37,103,0.08)',
}
const HALO = '0 0 0 4px rgba(29,37,103,0.06)'

// ── Helpers ───────────────────────────────────────────────────────────────────

// Render-time effective status projection - does NOT mutate stored data.
// Applied consistently: badge rendering, KPI counts, and table filter.
function effectiveStatus(assignment) {
  if (
    (assignment.status === 'sent' || assignment.status === 'opened') &&
    assignment.expires_at &&
    new Date(assignment.expires_at) < new Date()
  ) {
    return 'expired'
  }
  return assignment.status
}

function fmtDate(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// Safely extracts the response from either array or object embed shape
function extractResponse(assignment) {
  const r = assignment.evaluation_responses
  if (!r) return null
  if (Array.isArray(r)) return r[0] || null
  return r
}

// ── Sub-components ────────────────────────────────────────────────────────────

// Interactive KPI filter card - visual pattern mirrors FilterKPICard from KPIBand.jsx.
// Each card uses its own solid category color (activeBg) as the active fill, matching
// the per-accent p.solid treatment in Student Profiles.
function EvalKPICard({ value, label, sub, restBg, restNum, activeBg, isActive, onClick, tooltipLabel }) {
  const card = (
    <button
      onClick={onClick}
      aria-label={tooltipLabel || label}
      style={{
        background:   isActive ? activeBg : restBg,
        border:       `1px solid ${isActive ? activeBg : 'rgba(29,37,103,0.06)'}`,
        borderRadius: 14,
        padding:      '14px 18px',
        textAlign:    'left',
        cursor:       'pointer',
        fontFamily:   F,
        boxShadow:    isActive ? SH.s2 : SH.s1,
        transition:   'transform 0.18s cubic-bezier(0.2, 0.7, 0.2, 1), box-shadow 0.18s ease, background 0.18s ease, border-color 0.15s ease',
        willChange:   'transform, box-shadow',
        display:      'flex', flexDirection: 'column', gap: 4,
        width:        '100%',
        minWidth:     0,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = `${SH.s3}, ${HALO}`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform   = 'translateY(0)'
        e.currentTarget.style.boxShadow   = isActive ? SH.s2 : SH.s1
      }}
      onMouseDown={e => { e.currentTarget.style.transform = 'translateY(0)' }}
      onMouseUp={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
    >
      <div style={{
        fontSize: 32, fontWeight: 700, lineHeight: 1,
        letterSpacing: '-0.025em',
        color:              isActive ? '#fff' : restNum,
        fontVariantNumeric: 'tabular-nums', fontFamily: F,
      }}>
        {value ?? 0}
      </div>
      <div style={{
        fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.14em',
        color:      isActive ? 'rgba(255,255,255,0.88)' : '#475467',
        fontWeight: 600, marginTop: 8, fontFamily: F,
      }}>
        {label}
      </div>
      {sub && (
        <div style={{
          fontSize: 11.5,
          color:    isActive ? 'rgba(255,255,255,0.72)' : '#98A2B3',
          marginTop: 2, fontFamily: F,
        }}>
          {sub}
        </div>
      )}
    </button>
  )
  return card
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 11, fontWeight: 700,
      padding: '3px 9px', borderRadius: 10,
      background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}`,
      whiteSpace: 'nowrap', fontFamily: F, letterSpacing: 0.1,
    }}>
      {cfg.label}
    </span>
  )
}

function Th({ label, sortable, onClick, active, dir }) {
  return (
    <th
      onClick={sortable ? onClick : undefined}
      style={{
        padding: '10px 14px',
        textAlign: 'left',
        fontSize: 11,
        fontWeight: 700,
        color: sortable && active ? '#1D2567' : '#6b7280',
        letterSpacing: 0.5,
        cursor: sortable ? 'pointer' : 'default',
        userSelect: 'none',
        fontFamily: F,
        whiteSpace: 'nowrap',
      }}
    >
      {label}{sortable && active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )
}

function Td({ children, style }) {
  return (
    <td style={{ padding: '10px 14px', verticalAlign: 'middle', ...style }}>
      {children}
    </td>
  )
}

function ExpandedRow({ assignment: a, response }) {
  const LabelVal = ({ label, value }) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 5 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', minWidth: 190, flexShrink: 0, fontFamily: F }}>{label}</span>
      <span style={{ fontSize: 12, color: '#374151', fontFamily: F }}>{value}</span>
    </div>
  )
  const SectionLabel = ({ children }) => (
    <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', marginBottom: 8, marginTop: 4, letterSpacing: 0.7, fontFamily: F }}>
      {children}
    </div>
  )
  const cps = response?.score_s1_clinical_problem_solving
  const la  = response?.score_s1_learning_activities
  const pr  = response?.score_s1_practice_readiness
  const instrumentName = a.evaluation_instruments?.display_name

  return (
    <div>
      {instrumentName && (
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 12, fontFamily: F }}>
          {instrumentName}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 32px' }}>
        <div>
          <SectionLabel>LIFECYCLE</SectionLabel>
          <LabelVal label="Invited at"              value={fmtDateTime(a.invited_at)} />
          <LabelVal label="Sent at"                 value={fmtDateTime(a.sent_at)} />
          <LabelVal label="Opened at"               value={fmtDateTime(a.opened_at)} />
          <LabelVal label="Submitted at"            value={fmtDateTime(response?.submitted_at)} />
          <LabelVal label="Expires at"              value={fmtDateTime(a.expires_at)} />
          {a.revoked_at && <LabelVal label="Revoked at" value={fmtDateTime(a.revoked_at)} />}
          <LabelVal label="Hours at invitation"     value={a.approved_hours_at_invitation != null ? String(a.approved_hours_at_invitation) : '-'} />
          <LabelVal label="Hours at completion"     value={a.approved_hours_at_completion != null ? String(a.approved_hours_at_completion) : '-'} />
        </div>
        <div>
          <SectionLabel>SECTION I SCORES</SectionLabel>
          <LabelVal label="Clinical Problem-Solving" value={cps != null ? Number(cps).toFixed(2) : '-'} />
          <LabelVal label="Learning Activities"      value={la  != null ? Number(la).toFixed(2)  : '-'} />
          <LabelVal label="Practice Readiness"       value={pr  != null ? Number(pr).toFixed(2)  : '-'} />
          {a.notes && (
            <>
              <SectionLabel>NOTES</SectionLabel>
              <p style={{ fontSize: 12, color: '#374151', margin: 0, lineHeight: 1.6, fontFamily: F }}>{a.notes}</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EvaluationTab({ cohortId }) {
  const { markSynced, display: syncDisplay } = useLastSynced()
  const { isOwner, isAdmin, isInterviewer } = useAuth()
  // EVALUATION-INTERVIEWER-ACCESS-UX: interviewers may open the tab but must NOT see evaluation
  // data (survey responses, readiness scores, preceptor/student feedback, comments). Roles are
  // mutually exclusive, so isInterviewer is true only for interviewers (never owner/admin).
  const evaluationRestricted = isInterviewer && !isOwner && !isAdmin

  const [activeSubTab,    setActiveSubTab]    = useState('cohort')
  const [assignments,     setAssignments]     = useState([])

  // EVAL-NAV-1: 'program' and 'preceptor' are no longer reachable from the visible subnav.
  // If state ever lands on one of those hidden keys, fall back to Responses ('cohort').
  useEffect(() => {
    if (activeSubTab === 'program' || activeSubTab === 'preceptor') {
      setActiveSubTab('cohort')
    }
  }, [activeSubTab])

  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState(null)
  const [expandedIds,     setExpandedIds]     = useState(new Set())

  // Sort state - default: most recent sent_at first
  const [sortKey, setSortKey] = useState('sent_at')
  const [sortDir, setSortDir] = useState('desc')

  // Single-select KPI filter: null = Total (all), string = that effective status
  const [activeKpiFilter,  setActiveKpiFilter]  = useState(null)
  const [filterInstrument, setFilterInstrument] = useState('All')
  const [filterTimepoint,  setFilterTimepoint]  = useState('All')

  // Response detail modal state
  const [detailAssignment,  setDetailAssignment]  = useState(null)
  // Instrument content cache: { [slug]: { content: {...} } | { error: true } | undefined }
  const [contentCache,      setContentCache]      = useState({})

  const fetchAssignments = useCallback(async () => {
    if (!cohortId) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('evaluation_assignments')
        .select(`
          id, timepoint, status,
          invited_at, sent_at, opened_at, expires_at, revoked_at,
          approved_hours_at_invitation, approved_hours_at_completion, notes,
          respondent_type, respondent_name,
          students!inner ( id, first_name, last_name ),
          evaluation_instruments!inner ( slug, display_name ),
          evaluation_responses (
            submitted_at,
            responses,
            score_s1_clinical_problem_solving,
            score_s1_learning_activities,
            score_s1_practice_readiness
          )
        `)
        .eq('cohort_id', cohortId)
        .order('sent_at', { ascending: false })
      if (err) throw err
      setAssignments(data || [])
      markSynced()
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [cohortId])

  // RESTRICTED-ACCESS-OVERLAY-UNIFORMITY-FIX: interviewers DO load the dashboard so the real (not
  // fake) Evaluation page renders, blurred, behind the restricted overlay - matching Rotation. The
  // overlay blocks all interaction, so individual response details/modals/exports stay inaccessible.
  useEffect(() => { fetchAssignments() }, [fetchAssignments])

  // ── Derived values ────────────────────────────────────────────────────────

  // Distinct instrument and timepoint values for dropdowns
  const instruments = ['All', ...new Set(
    assignments.map(a => a.evaluation_instruments?.display_name).filter(Boolean)
  )]
  // display_name → slug, so the dropdown can show compact labels while the filter still keys on display_name.
  const slugByDisplayName = {}
  assignments.forEach(a => {
    const ei = a.evaluation_instruments
    if (ei?.display_name && ei?.slug && !slugByDisplayName[ei.display_name]) slugByDisplayName[ei.display_name] = ei.slug
  })
  const timepoints = ['All', ...new Set(
    assignments.map(a => a.timepoint).filter(Boolean)
  )]

  // Instrument + timepoint filter only (no status filter) - basis for KPI card counts.
  // Per A.4: card counts are independent of the status filter so the full distribution
  // is always visible regardless of which card is active.
  const instrumentTimeFiltered = assignments.filter(a => {
    if (filterInstrument !== 'All' && a.evaluation_instruments?.display_name !== filterInstrument) return false
    if (filterTimepoint  !== 'All' && a.timepoint !== filterTimepoint) return false
    return true
  })

  // KPI card counts - use effectiveStatus, based on instrumentTimeFiltered
  const kpiCounts = {
    total:     instrumentTimeFiltered.length,
    sent:      instrumentTimeFiltered.filter(a => effectiveStatus(a) === 'sent').length,
    opened:    instrumentTimeFiltered.filter(a => effectiveStatus(a) === 'opened').length,
    completed: instrumentTimeFiltered.filter(a => effectiveStatus(a) === 'completed').length,
    expired:   instrumentTimeFiltered.filter(a => effectiveStatus(a) === 'expired').length,
    revoked:   instrumentTimeFiltered.filter(a => effectiveStatus(a) === 'revoked').length,
  }

  // Full filtered set - adds active KPI status filter on top of instrument/timepoint.
  // Used for the response table.
  const filtered = instrumentTimeFiltered.filter(a => {
    if (activeKpiFilter !== null && effectiveStatus(a) !== activeKpiFilter) return false
    return true
  })

  // Client-side sort - all columns sortable (rows already loaded; safe for cohort scale).
  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    // Canonical-index columns (numeric order)
    if (sortKey === 'instrument') return dir * (instrumentSortIndex(a.evaluation_instruments?.slug) - instrumentSortIndex(b.evaluation_instruments?.slug))
    if (sortKey === 'timepoint')  return dir * (timepointSortIndex(a.timepoint) - timepointSortIndex(b.timepoint))
    if (sortKey === 'status')     return dir * (statusSortIndex(effectiveStatus(a)) - statusSortIndex(effectiveStatus(b)))
    // Numeric Section I composite - nulls always last regardless of direction
    if (sortKey === 'section_i') {
      const ma = sectionIMean(a), mb = sectionIMean(b)
      if (ma == null && mb == null) return 0
      if (ma == null) return 1
      if (mb == null) return -1
      return dir * (ma - mb)
    }
    // String columns
    let va, vb
    if (sortKey === 'student') {
      va = `${a.students?.last_name || ''} ${a.students?.first_name || ''}`.toLowerCase()
      vb = `${b.students?.last_name || ''} ${b.students?.first_name || ''}`.toLowerCase()
    } else if (sortKey === 'completed_by') {
      va = completedByLabel(a.respondent_type, a.respondent_name).toLowerCase()
      vb = completedByLabel(b.respondent_type, b.respondent_name).toLowerCase()
    } else if (sortKey === 'submitted_at') {
      va = extractResponse(a)?.submitted_at || ''
      vb = extractResponse(b)?.submitted_at || ''
    } else {
      va = a[sortKey] || ''
      vb = b[sortKey] || ''
    }
    if (va === vb) return 0
    return dir * (va > vb ? 1 : -1)
  })

  // ASPIRE-CHART: CSV export of the CURRENT responses view (same filters and
  // sort the reader sees). Client-side, from already-loaded authorized rows -
  // the same safety pattern as the students CSV export. No new data access.
  const exportResponsesCSV = () => {
    const headers = ['Student', 'Completed By', 'Instrument', 'Timepoint', 'Status', 'Submitted',
      'S1 Clinical Problem Solving', 'S1 Learning Activities', 'S1 Practice Readiness']
    const rows = sorted.map(a => {
      const r = extractResponse(a)
      return [
        `${a.students?.last_name || ''}, ${a.students?.first_name || ''}`.replace(/^, /, ''),
        completedByLabel(a.respondent_type, a.respondent_name),
        a.evaluation_instruments?.display_name || '',
        TIMEPOINT_LABELS[a.timepoint] || a.timepoint || '',
        effectiveStatus(a),
        r?.submitted_at || '',
        r?.score_s1_clinical_problem_solving ?? '',
        r?.score_s1_learning_activities ?? '',
        r?.score_s1_practice_readiness ?? '',
      ]
    })
    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const dateSlug = new Date().toISOString().slice(0, 10)
    link.href = url
    link.download = `aspire_evaluations_${dateSlug}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Instrument cards: per-instrument completed/assigned within the current timepoint filter (NOT
  // instrument-filtered, so every instrument is always visible). Only the canonical instruments that
  // actually appear in this cohort are shown - Program Experience is never shown.
  const timepointScoped = assignments.filter(a => filterTimepoint === 'All' || a.timepoint === filterTimepoint)
  const instrumentCards = INSTRUMENT_ORDER.map(slug => {
    const rows = timepointScoped.filter(a => a.evaluation_instruments?.slug === slug)
    if (rows.length === 0) return null
    const displayName = rows[0].evaluation_instruments?.display_name
    const completed = rows.filter(a => effectiveStatus(a) === 'completed').length
    return { slug, displayName, label: instrumentCompactLabel(slug, displayName), assigned: rows.length, completed }
  }).filter(Boolean)

  // The comparison intentionally ignores the table's timepoint and status filters: it
  // must see both completed baseline and post-rotation Casey-Fink responses to form
  // honest student-level pairs. The cohort is already enforced by the database query.
  const caseyFinkComparison = buildCaseyFinkComparison(assignments)
  const selectedInstrumentSlug = filterInstrument === 'All' ? null : slugByDisplayName[filterInstrument]
  const showCaseyFinkComparison = selectedInstrumentSlug == null || selectedInstrumentSlug === 'casey_fink_readiness_2024'

  // ── Event handlers ────────────────────────────────────────────────────────

  function handleKpiClick(key) {
    if (key === 'total') {
      setActiveKpiFilter(null)
      return
    }
    // Toggle: clicking the active card deselects it (returns to Total)
    setActiveKpiFilter(prev => prev === key ? null : key)
  }

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  function toggleRow(id) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Response detail handlers ──────────────────────────────────────────────

  // Fetches instrument content from /api/evaluation-instrument-content.
  // Fires only on first open for a given slug; subsequent opens reuse the cache.
  // Uses the authenticated Supabase session's access token.
  const fetchInstrumentContent = useCallback(async (slug) => {
    if (!slug || contentCache[slug] !== undefined) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setContentCache(prev => ({ ...prev, [slug]: { error: true } }))
        return
      }
      const res = await fetch(
        `/api/evaluation-instrument-content?slug=${encodeURIComponent(slug)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      )
      if (!res.ok) {
        setContentCache(prev => ({ ...prev, [slug]: { error: true } }))
        return
      }
      const data = await res.json()
      setContentCache(prev => ({ ...prev, [slug]: data }))
    } catch {
      setContentCache(prev => ({ ...prev, [slug]: { error: true } }))
    }
  }, [contentCache])

  function handleViewResponse(assignment) {
    setDetailAssignment(assignment)
    const slug = assignment.evaluation_instruments?.slug
    if (slug) fetchInstrumentContent(slug)
  }

  function handleCloseDetail() {
    setDetailAssignment(null)
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  // Sub-tab button style - mirrors RotationTab.jsx btnStyle pattern
  const btnStyle = (key) => ({
    height: 32, padding: '0 13px', display: 'flex', alignItems: 'center',
    border: 'none', cursor: 'pointer', fontSize: 12,
    fontFamily: F, fontWeight: 500,
    background: activeSubTab === key ? 'var(--color-accent-primary,#1D2567)' : 'var(--bg-input,#fff)',
    color: activeSubTab === key ? '#fff' : 'var(--text-secondary,#4A5560)',
    transition: 'all 0.12s',
  })

  const sel = {
    fontSize: 12, padding: '5px 10px', borderRadius: 6,
    border: '1px solid #d1d5db', background: '#fff',
    color: '#374151', fontFamily: F, cursor: 'pointer',
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: F, display: 'flex', flexDirection: 'column', position: 'relative' }}>

      {/* EVALUATION-INTERVIEWER-ACCESS-UX + RESTRICTED-ACCESS-OVERLAY-UNIFORMITY-FIX: for interviewers,
          overlay the REAL Evaluation dashboard (blurred, non-interactive), identical pattern to the
          Rotation tab (MatchingTab). The overlay covers the tab and captures all pointer events, so
          response detail modals, exports, tokens, and row clicks stay inaccessible. */}
      {evaluationRestricted && (
        <RestrictedAccessOverlay
          title="Evaluation results are restricted"
          body="Evaluation summary, survey responses, and feedback are reviewed by ASPIRE leads and administrative staff. To protect student feedback and response details, this dashboard is available to program leads only."
          contact="If you need access to evaluation information, please contact the ASPIRE lead."
        />
      )}

      {/* Sub-tab picker - mirrors RotationTab.jsx structure and styling */}
      <div style={{ padding: '0 20px 12px', flexShrink: 0 }}>
        <div style={{
          display: 'flex',
          borderRadius: 7,
          border: '1px solid var(--border-input,rgba(29,37,103,0.10))',
          overflow: 'hidden',
          width: 'fit-content',
        }}>
          {/* EVAL-NAV-1: visible subnav simplified to Responses + Review & Release.
              Internal keys ('cohort','automation') are unchanged. The 'program' and
              'preceptor' tabs are hidden (components retained, see blocks below). */}
          <button onClick={() => setActiveSubTab('cohort')}  style={btnStyle('cohort')}>Responses</button>
          {(isOwner || isAdmin) && (
            <button onClick={() => setActiveSubTab('automation')} style={btnStyle('automation')}>Review &amp; Release</button>
          )}
        </div>
      </div>

      {/* ── Program View placeholder ────────────────────────────────────── */}
      {activeSubTab === 'program' && (
        <div style={{ padding: '24px 20px', display: 'flex', justifyContent: 'center' }}>
          <div style={{
            background: '#fff',
            borderRadius: 12,
            border: '1px solid rgba(29,37,103,0.08)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            padding: '48px 56px',
            textAlign: 'center',
            maxWidth: 480,
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#191919', marginBottom: 10, fontFamily: F }}>
              Program View
            </div>
            <div style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.6, fontFamily: F }}>
              This view will summarize evaluation trends across cohorts. Available in a future release.
            </div>
          </div>
        </div>
      )}

      {/* ── Preceptor Feedback (Owner/Admin only) ───────────────────────── */}
      {activeSubTab === 'preceptor' && (isOwner || isAdmin) && (
        <PreceptorFeedbackPanel cohortId={cohortId} />
      )}

      {/* ── Review & Release (Owner/Admin only). EVAL-RR-UNIFIED-NAV-1: the Unit Leader
             release console is no longer stacked above the dashboard as a separate
             surface - it is a section INSIDE the dashboard's navigator (Survey Workflows /
             Unit Leader Release), selected like any workflow. ── */}
      {activeSubTab === 'automation' && (isOwner || isAdmin) && (
        <SurveyAutomationDashboard cohortId={cohortId} />
      )}

      {/* ── Cohort View ─────────────────────────────────────────────────── */}
      {activeSubTab === 'cohort' && (
        // LAYOUT-SHELL-CONSISTENCY-1/1B: fill the shared app-main shell explicitly. The EvaluationTab
        // root is a flex column, so this body already stretched to the shell width at viewports up to
        // ~1540px; the removed maxWidth:1400 only left a right-side gap on WIDER monitors (app-main
        // exceeds 1400 above ~1541px, and the capped flex child left-aligned). width:100% + min-width:0
        // make full-width, shrink-safe behavior explicit and independent of the parent's align-items.
        <div style={{ width: '100%', minWidth: 0, padding: '4px 20px 24px' }}>

          {/* Header - title, subtitle, and freshness cue right-aligned (mirrors OverviewTab) */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#191919', margin: '0 0 4px', fontFamily: F }}>
                Evaluation Dashboard
              </h2>
              <p style={{ fontSize: 13, color: '#9ca3af', margin: 0, fontFamily: F }}>
                Review evaluation assignments and submitted responses by cohort.
              </p>
            </div>
            {syncDisplay && (
              <div style={{ fontSize: 11.5, color: '#98A2B3', whiteSpace: 'nowrap', fontFamily: F, flexShrink: 0, paddingBottom: 2 }}>
                {syncDisplay}
              </div>
            )}
          </div>

          {/* Loading */}
          {loading && (
            <div style={{ padding: '48px 0', textAlign: 'center', color: '#9ca3af', fontSize: 14, fontFamily: F }}>
              Loading evaluations…
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div style={{ padding: '24px 0', color: '#dc2626', fontSize: 14, lineHeight: 1.6, fontFamily: F }}>
              <strong>Error loading evaluations:</strong> {error.message}
            </div>
          )}

          {/* KPI cards + content */}
          {!loading && !error && (
            <>
              {/* Instrument cards - primary grouping. Clickable to set the instrument filter
                  (toggles off when the active one is clicked again). Shows completed/assigned +
                  a thin completion bar. Compact labels; Program Experience never shown. */}
              {instrumentCards.length > 0 && (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                  {instrumentCards.map(card => {
                    const active = filterInstrument === card.displayName
                    const pct = card.assigned > 0 ? Math.round((card.completed / card.assigned) * 100) : 0
                    return (
                      <button
                        key={card.slug}
                        type="button"
                        onClick={() => setFilterInstrument(prev => prev === card.displayName ? 'All' : card.displayName)}
                        title={card.displayName}
                        style={{
                          flex: '1 1 200px', minWidth: 200, textAlign: 'left', cursor: 'pointer',
                          padding: '12px 14px', borderRadius: 10, fontFamily: F,
                          border: `1px solid ${active ? '#1D2567' : '#e5e7eb'}`,
                          background: active ? '#EEF2FB' : '#fff',
                          boxShadow: active ? '0 1px 3px rgba(29,37,103,0.18)' : '0 1px 2px rgba(29,37,103,0.04)',
                          transition: 'background 0.12s, border-color 0.12s',
                        }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1D2567', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.label}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{card.completed}/{card.assigned} · {pct}%</span>
                        </div>
                        <div style={{ height: 4, background: 'rgba(29,37,103,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: '#2F7D5C', borderRadius: 2 }} />
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              {showCaseyFinkComparison && (
                <CaseyFinkComparisonPanel comparison={caseyFinkComparison} />
              )}

              {/* Status KPI band (secondary) - kept immediately above the response
                  controls and table because these cards filter that worklist. */}
              <div className="eval-kpis" style={{
                display: 'grid',
                gap: 10,
                marginBottom: 14,
              }}>
                {KPI_CARD_DEFS.map(card => (
                  <EvalKPICard
                    key={card.key}
                    value={kpiCounts[card.key]}
                    label={card.label}
                    sub={card.sub}
                    restBg={card.restBg}
                    restNum={card.restNum}
                    activeBg={card.activeBg}
                    isActive={activeKpiFilter === (card.key === 'total' ? null : card.key)}
                    onClick={() => handleKpiClick(card.key)}
                    tooltipLabel={card.tooltip}
                  />
                ))}

              </div>

              {/* Filter strip - instrument and timepoint dropdowns only */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
                <select value={filterInstrument} onChange={e => setFilterInstrument(e.target.value)} style={sel}>
                  {instruments.map(i => (
                    <option key={i} value={i}>{i === 'All' ? 'All instruments' : instrumentCompactLabel(slugByDisplayName[i], i)}</option>
                  ))}
                </select>

                <select value={filterTimepoint} onChange={e => setFilterTimepoint(e.target.value)} style={sel}>
                  {timepoints.map(t => (
                    <option key={t} value={t}>{t === 'All' ? 'All timepoints' : (TIMEPOINT_LABELS[t] || t)}</option>
                  ))}
                </select>

                <button onClick={exportResponsesCSV} disabled={sorted.length === 0}
                  style={{ marginLeft: 'auto', height: 32, padding: '0 12px',
                    border: '1px solid var(--border-input,rgba(29,37,103,0.10))', borderRadius: 7,
                    fontSize: 12, fontFamily: F, background: 'var(--bg-input,#fff)',
                    color: sorted.length === 0 ? '#9ca3af' : 'var(--text-body,#191919)',
                    cursor: sorted.length === 0 ? 'default' : 'pointer', flexShrink: 0 }}>
                  ↓ Export CSV ({sorted.length})
                </button>
              </div>

              {/* Empty states */}
              {assignments.length === 0 && (
                <div style={{ padding: '48px 0', textAlign: 'center', color: '#9ca3af', fontSize: 14, fontFamily: F }}>
                  No evaluations for this cohort yet.
                </div>
              )}
              {assignments.length > 0 && sorted.length === 0 && (
                <div style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: 14, fontFamily: F }}>
                  No evaluations match the current filters.
                </div>
              )}

              {/* Main table - ASPIRE-CHART: scrolls horizontally on narrow
                  screens instead of clipping its seven columns */}
              {sorted.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflowX: 'auto' }}>
                  <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontFamily: F }}>
                    <thead>
                      <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                        <Th label="Student"      sortable onClick={() => handleSort('student')}      active={sortKey === 'student'}      dir={sortDir} />
                        <Th label="Completed By" sortable onClick={() => handleSort('completed_by')} active={sortKey === 'completed_by'} dir={sortDir} />
                        <Th label="Instrument"   sortable onClick={() => handleSort('instrument')}   active={sortKey === 'instrument'}   dir={sortDir} />
                        <Th label="Timepoint"    sortable onClick={() => handleSort('timepoint')}    active={sortKey === 'timepoint'}    dir={sortDir} />
                        <Th label="Status"       sortable onClick={() => handleSort('status')}       active={sortKey === 'status'}       dir={sortDir} />
                        <Th label="Submitted"    sortable onClick={() => handleSort('submitted_at')} active={sortKey === 'submitted_at'} dir={sortDir} />
                        <Th label="Section I"    sortable onClick={() => handleSort('section_i')}    active={sortKey === 'section_i'}    dir={sortDir} />
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((a, idx) => {
                        const response   = extractResponse(a)
                        const isExpanded = expandedIds.has(a.id)
                        const es         = effectiveStatus(a)
                        const bgBase     = idx % 2 === 0 ? '#ffffff' : '#fafafa'
                        const cps = response?.score_s1_clinical_problem_solving
                        const la  = response?.score_s1_learning_activities
                        const pr  = response?.score_s1_practice_readiness
                        const scoresReady = cps != null && la != null && pr != null

                        return (
                          <React.Fragment key={a.id}>
                            <tr
                              onClick={() => toggleRow(a.id)}
                              style={{ cursor: 'pointer', background: bgBase, borderBottom: isExpanded ? 'none' : '1px solid #f3f4f6' }}
                              onMouseEnter={e => e.currentTarget.style.background = '#eef2fb'}
                              onMouseLeave={e => e.currentTarget.style.background = bgBase}
                            >
                              <Td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {isExpanded
                                    ? <ChevronDown  size={14} color="#9ca3af" style={{ flexShrink: 0 }} />
                                    : <ChevronRight size={14} color="#9ca3af" style={{ flexShrink: 0 }} />
                                  }
                                  <span style={{ fontWeight: 600, color: '#191919', fontSize: 13 }}>
                                    {a.students?.first_name} {a.students?.last_name}
                                  </span>
                                </div>
                              </Td>
                              <Td>
                                <span style={{ fontSize: 12, color: a.respondent_type === 'preceptor' ? '#1D2567' : '#6b7280' }}>
                                  {completedByLabel(a.respondent_type, a.respondent_name)}
                                </span>
                              </Td>
                              <Td>
                                <span style={{
                                  fontSize: 12, color: '#374151',
                                  maxWidth: 220, display: 'inline-block',
                                  overflow: 'hidden', textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap', verticalAlign: 'middle',
                                }} title={a.evaluation_instruments?.display_name || ''}>
                                  {instrumentCompactLabel(a.evaluation_instruments?.slug, a.evaluation_instruments?.display_name)}
                                </span>
                              </Td>
                              <Td>
                                <span style={{ fontSize: 12, color: '#374151' }}>
                                  {TIMEPOINT_LABELS[a.timepoint] || a.timepoint}
                                </span>
                              </Td>
                              <Td><StatusBadge status={es} /></Td>
                              <Td>
                                <span style={{ fontSize: 12, color: '#374151' }}>
                                  {fmtDate(response?.submitted_at)}
                                </span>
                              </Td>
                              <Td>
                                <span style={{ fontSize: 11, color: '#374151', fontVariantNumeric: 'tabular-nums' }}>
                                  {scoresReady
                                    ? `CPS ${Number(cps).toFixed(2)} · LA ${Number(la).toFixed(2)} · PR ${Number(pr).toFixed(2)}`
                                    : '-'
                                  }
                                </span>
                              </Td>
                            </tr>

                            {isExpanded && (
                              <tr style={{ background: idx % 2 === 0 ? '#f8f9fe' : '#f4f5fa' }}>
                                <td colSpan={7} style={{ padding: '16px 24px', borderBottom: '1px solid #e5e7eb' }}>
                                  <ExpandedRow assignment={a} response={response} />
                                  {es === 'completed' && response?.responses && (
                                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #e5e7eb' }}>
                                      <button
                                        onClick={e => { e.stopPropagation(); handleViewResponse(a) }}
                                        style={{
                                          padding: '6px 14px',
                                          background: '#1D2567', color: '#fff',
                                          border: 'none', borderRadius: 6,
                                          fontSize: 12, fontWeight: 600,
                                          fontFamily: F, cursor: 'pointer',
                                        }}
                                      >
                                        View response
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Response detail modal - mounted at EvaluationTab level, one at a time. Each
          survey type renders in its own isolated, Owner/Admin-only detail (section-keyed):
          preceptor_progress → PreceptorResponseDetail, student_preceptor_eval →
          StudentEvalResponseDetail; Casey-Fink/student keeps the existing detail view. */}
      {detailAssignment?.evaluation_instruments?.slug === 'preceptor_progress' ? (
        <PreceptorResponseDetail
          assignment={detailAssignment}
          instrumentContent={contentCache['preceptor_progress']}
          isOpen={!!detailAssignment}
          onClose={handleCloseDetail}
        />
      ) : detailAssignment?.evaluation_instruments?.slug === 'student_preceptor_eval' ? (
        <StudentEvalResponseDetail
          assignment={detailAssignment}
          instrumentContent={contentCache['student_preceptor_eval']}
          isOpen={!!detailAssignment}
          onClose={handleCloseDetail}
        />
      ) : (
        <EvaluationResponseDetail
          assignment={detailAssignment}
          instrumentContent={
            detailAssignment?.evaluation_instruments?.slug
              ? contentCache[detailAssignment.evaluation_instruments.slug]
              : undefined
          }
          isOpen={!!detailAssignment}
          onClose={handleCloseDetail}
        />
      )}
    </div>
  )
}
