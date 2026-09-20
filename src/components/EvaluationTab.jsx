import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useLastSynced } from '../hooks/useLastSynced'
import { useAuth } from '../contexts/AuthContext'
import EvaluationResponseDetail from './EvaluationResponseDetail'
import PreceptorFeedbackPanel from './evaluation/PreceptorFeedbackPanel'
import PreceptorResponseDetail from './evaluation/PreceptorResponseDetail'
import StudentEvalResponseDetail from './evaluation/StudentEvalResponseDetail'
import SurveyAutomationDashboard from './evaluation/SurveyAutomationDashboard'
import RestrictedAccessOverlay from './RestrictedAccessOverlay'
import DataSheet, { Pill, Missing, DetailField } from './shared/DataSheet'
import { sortRows } from './shared/dataSheetSort'
import { InstrumentTabs, AnalysisSheet } from './evaluation/ResponsesPacket'
import BubbleSheet from './evaluation/BubbleSheet'
import { completedByLabel } from '../lib/evaluationLabels'
import {
  PACKET_SLUGS, DEFAULT_PACKET_SLUG, STATUS_GROUPS,
  buildPacket, buildInstrumentTabs, buildRosterRows, buildBubbleSheet,
  rosterSortValue, effectiveStatus, responseOf, timepointLabel,
} from '../lib/evaluation/responsesPacketModel'

// RESPONSES-PACKET-1 (2026-09-19): Evaluation > Responses is a printed results packet.
// Four instrument file tabs sit on a gridded analysis sheet (ResponsesPacket.jsx), a
// continuous-feed roster lists individual responses (the shared DataSheet, the first build
// of the table canon), and each row opens into a bubble sheet of that person's answers
// (BubbleSheet.jsx). Every number comes from src/lib/evaluation/responsesPacketModel.js.
//
// What this file still owns: the fetch (unchanged query, plus school and program), the
// Owner/Admin interviewer overlay, the Responses / Review & Release subnav, the CSV export
// (same columns and filename as before, mirroring the roster's filters and sort), the
// instrument-content cache the response viewers read, and the three response viewers.
// Nothing about how a response is collected, stored or scored changed.

const F = 'Plus Jakarta Sans, sans-serif'

// CSV timepoint labels: unchanged from before this rebuild so a downstream reader of the
// export sees the same words. The packet's own display labels live in the model.
const CSV_TIMEPOINT_LABELS = {
  baseline:                'Baseline',
  early_rotation_baseline: 'Baseline',
  mid_rotation:            'Mid-Rotation Check-In',
  midpoint:                'Mid-Rotation Check-In',
  post_rotation:           'Post-Rotation',
}

function fmtDate(iso) {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(iso) {
  if (!iso) return '–'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// ── Roster cells ──────────────────────────────────────────────────────────────

// Name, a middot, then the program: "Adam Friedenthal · Accel BSN" (table canon §3.2).
function NameCell({ row }) {
  return (
    <span className="ds-nm">
      <span title={row.name}>{row.name}</span>
      {row.program && (
        <>
          <span className="ds-dot" aria-hidden="true">·</span>
          <small>{row.program}</small>
        </>
      )}
    </span>
  )
}

function renderCell(col, row) {
  switch (col.kind) {
    case 'name':   return <NameCell row={row} />
    case 'school': return row.school ? <span className="ds-txt ds-dim" title={row.school}>{row.school}</span> : <Missing />
    case 'date':   return row.submittedAt ? <span className="ds-date">{fmtDate(row.submittedAt)}</span> : <Missing />
    case 'pill':   return <Pill tone={row.pill.tone}>{row.pill.label}</Pill>
    case 'num': {
      const v = row.scores[col.scoreKey]
      return <span className="ds-num">{v == null ? <Missing /> : v.toFixed(2)}</span>
    }
    default: return row[col.key] ?? <Missing />
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EvaluationTab({ cohortId, cohortLabel = '' }) {
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

  // Roster sort, client-side over the loaded page. Controlled here so the CSV export can
  // mirror the exact order on screen.
  const [sort, setSort] = useState({ key: 'student', dir: 'asc' })

  // The instrument is chosen by its file tab (a slug). The roster's own filters: timepoint,
  // status group, and a focus set the sheet's follow-up strip can open ("See who").
  const [filterInstrument, setFilterInstrument] = useState(DEFAULT_PACKET_SLUG)
  const [filterTimepoint,  setFilterTimepoint]  = useState('All')
  const [activeKpiFilter,  setActiveKpiFilter]  = useState(null)
  const [rosterFocus,      setRosterFocus]      = useState(null)
  const [tableView,        setTableView]        = useState(false)
  const [live,             setLive]             = useState('')
  // Until the reader picks a tab, the packet opens on the first instrument that has rows.
  const [userPickedInstrument, setUserPickedInstrument] = useState(false)
  const rosterRef = useRef(null)

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
          students!inner ( id, first_name, preferred_first_name, last_name, school, program_type ),
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

  const instrumentTabs = useMemo(() => buildInstrumentTabs(assignments), [assignments])

  // A stale slug (a deep link to an instrument this build does not know) falls back to the
  // first tab, so nothing below can be silently constrained by an instrument that is not
  // shown. Until the reader picks a tab, land on the first instrument that has rows.
  const chosenInstrument = PACKET_SLUGS.includes(filterInstrument) ? filterInstrument : DEFAULT_PACKET_SLUG
  const firstWithRows = instrumentTabs.find(t => t.assigned > 0)?.slug
  const activeInstrumentFilter = userPickedInstrument ? chosenInstrument : (firstWithRows || chosenInstrument)

  const content = contentCache[activeInstrumentFilter]?.content ?? null
  const packet = useMemo(
    () => buildPacket(assignments, activeInstrumentFilter, { content }),
    [assignments, activeInstrumentFilter, content],
  )

  // Timepoints present for this instrument. A cohort or instrument change can remove the
  // selected value while this mounted tab keeps its local state; treat an unavailable value
  // as All so the roster is never silently constrained by a filter that is not in the list.
  const timepoints = ['All', ...packet.timepoints]
  const activeTimepointFilter = timepoints.includes(filterTimepoint) ? filterTimepoint : 'All'

  const rosterRows = useMemo(() => buildRosterRows(packet.instrument, packet.rows, {
    timepoint: activeTimepointFilter,
    status: activeKpiFilter,
    focusStudentIds: rosterFocus?.studentIds || null,
  }), [packet, activeTimepointFilter, activeKpiFilter, rosterFocus])

  const columns = useMemo(() => packet.columns.map(col => ({
    ...col,
    sortValue: row => rosterSortValue(row, col),
    render: row => renderCell(col, row),
  })), [packet.columns])

  // The roster in the order the reader sees it, as assignments, for the export.
  const sorted = useMemo(() => sortRows(rosterRows, columns, sort).map(r => r.assignment), [rosterRows, columns, sort])

  // ASPIRE-CHART: CSV export of the CURRENT responses view (same filters and
  // sort the reader sees). Client-side, from already-loaded authorized rows -
  // the same safety pattern as the students CSV export. No new data access.
  const exportResponsesCSV = () => {
    const headers = ['Student', 'Completed By', 'Instrument', 'Timepoint', 'Status', 'Submitted',
      'S1 Clinical Problem Solving', 'S1 Learning Activities', 'S1 Practice Readiness']
    const rows = sorted.map(a => {
      const r = responseOf(a)
      return [
        `${a.students?.last_name || ''}, ${a.students?.first_name || ''}`.replace(/^, /, ''),
        completedByLabel(a.respondent_type, a.respondent_name),
        a.evaluation_instruments?.display_name || '',
        CSV_TIMEPOINT_LABELS[a.timepoint] || a.timepoint || '',
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

  // ── Event handlers ────────────────────────────────────────────────────────

  function selectInstrument(slug) {
    setUserPickedInstrument(true)
    setFilterInstrument(slug)
    setFilterTimepoint('All')
    setActiveKpiFilter(null)
    setRosterFocus(null)
    setExpandedIds(new Set())
    setTableView(false)
    const tab = instrumentTabs.find(t => t.slug === slug)
    setLive(`${tab?.name || 'Instrument'} selected`)
  }

  function scrollToRoster() {
    const el = rosterRef.current
    if (!el || typeof el.scrollIntoView !== 'function') return
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

  // "See who": open the roster filtered to exactly the students the strip names.
  function handleFollowUp(followUp) {
    if (followUp.kind === 'baselineOnly') {
      setRosterFocus({ chip: followUp.chip, studentIds: new Set(followUp.studentIds) })
      setFilterTimepoint('All')
      setActiveKpiFilter(null)
    } else if (followUp.kind === 'awaiting') {
      setRosterFocus(null)
      setActiveKpiFilter('awaiting')
    }
    setLive('Roster filtered')
    scrollToRoster()
  }

  // "Paired scores": the roster holds only matched students, so each pre row sits beside its post.
  function handlePairedScores() {
    const ids = [...(packet.byStudent || new Map()).entries()].filter(([, e]) => e.pre && e.post).map(([id]) => id)
    setRosterFocus({ chip: 'Matched pairs', studentIds: new Set(ids) })
    setFilterTimepoint('All')
    setActiveKpiFilter(null)
    setSort({ key: 'student', dir: 'asc' })
    setLive('Roster filtered to matched pairs')
    scrollToRoster()
  }

  function toggleRow(id) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    // The bubble sheet reads its stems from the stored instrument definition.
    if (packet.instrument.itemText === 'stored') fetchInstrumentContent(packet.instrument.slug)
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

  // ── Render ────────────────────────────────────────────────────────────────

  const renderExpanded = (row) => {
    const sheet = buildBubbleSheet(packet.instrument, row, packet.byStudent, content)
    const a = row.assignment
    const canView = row.status === 'completed' && !!responseOf(a)?.responses
    return (
      <>
        {row.status !== 'completed' && (
          <div className="ds-detail-fields" style={{ display: 'grid', gap: 7, marginBottom: 6 }}>
            <DetailField label="Sent">{fmtDateTime(a.sent_at)}</DetailField>
            <DetailField label="Opened">{fmtDateTime(a.opened_at)}</DetailField>
            <DetailField label="Expires">{fmtDateTime(a.expires_at)}</DetailField>
            {a.revoked_at && <DetailField label="Revoked">{fmtDateTime(a.revoked_at)}</DetailField>}
          </div>
        )}
        <BubbleSheet
          sheet={sheet}
          name={row.name}
          onViewResponse={canView ? () => handleViewResponse(a) : null}
        />
      </>
    )
  }

  const rosterToolbar = (
    <>
      <select
        className="ds-select"
        aria-label="Timepoint filter"
        value={activeTimepointFilter}
        onChange={e => setFilterTimepoint(e.target.value)}
      >
        {timepoints.map(t => (
          <option key={t} value={t}>{t === 'All' ? 'All timepoints' : timepointLabel(t)}</option>
        ))}
      </select>
      <select
        className="ds-select"
        aria-label="Status filter"
        value={activeKpiFilter ?? 'All'}
        onChange={e => setActiveKpiFilter(e.target.value === 'All' ? null : e.target.value)}
      >
        <option value="All">All statuses</option>
        {STATUS_GROUPS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
      </select>
      {rosterFocus && (
        <span className="ds-chip">
          {rosterFocus.chip} · {rosterFocus.studentIds.size} {rosterFocus.studentIds.size === 1 ? 'student' : 'students'}
          <button type="button" aria-label="Clear the student filter" onClick={() => setRosterFocus(null)}>×</button>
        </span>
      )}
      <button type="button" className="ds-btn" onClick={exportResponsesCSV} disabled={sorted.length === 0}>
        ↓ Export CSV ({sorted.length})
      </button>
    </>
  )

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
        <SurveyAutomationDashboard
          cohortId={cohortId}
          // REVIEW-RELEASE-1: "Track responses" on a workflow's Sent log opens the Responses
          // tab on that workflow's instrument tab. RESPONSES-PACKET-1: the tab is keyed by
          // slug now, and a workflow with one timepoint also sets the roster's timepoint.
          onTrackResponses={(survey) => {
            const slug = survey?.slug
            if (slug && PACKET_SLUGS.includes(slug)) {
              setUserPickedInstrument(true)
              setFilterInstrument(slug)
            }
            setFilterTimepoint(['baseline', 'post_rotation'].includes(survey?.timepoint) ? survey.timepoint : 'All')
            setActiveKpiFilter(null)
            setRosterFocus(null)
            setActiveSubTab('cohort')
          }}
        />
      )}

      {/* ── Responses: the packet ───────────────────────────────────────── */}
      {activeSubTab === 'cohort' && (
        // LAYOUT-SHELL-CONSISTENCY-1/1B: fill the shared app-main shell explicitly (width:100% +
        // min-width:0 make full-width, shrink-safe behavior independent of the parent's align-items).
        <div style={{ width: '100%', minWidth: 0, padding: '4px 20px 24px' }}>

          {/* Header - title, subtitle, and freshness cue right-aligned (mirrors OverviewTab) */}
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-heading, #191919)', margin: '0 0 4px', fontFamily: F }}>
                Evaluation Results
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted, #6B7785)', margin: 0, fontFamily: F }}>
                One packet per instrument. The analysis sheet states what the numbers rest on before it states the finding.
              </p>
            </div>
            {syncDisplay && (
              <div style={{ fontSize: 11.5, color: 'var(--text-muted, #98A2B3)', whiteSpace: 'nowrap', fontFamily: F, flexShrink: 0, paddingBottom: 2 }}>
                {syncDisplay}
              </div>
            )}
          </div>

          {/* Loading */}
          {loading && (
            <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted, #9ca3af)', fontSize: 14, fontFamily: F }}>
              Loading evaluations…
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div style={{ padding: '24px 0', color: 'var(--color-status-danger, #dc2626)', fontSize: 14, lineHeight: 1.6, fontFamily: F }}>
              <strong>Error loading evaluations:</strong> {error.message}
            </div>
          )}

          {!loading && !error && (
            <div className="rp-packet">
              <InstrumentTabs tabs={instrumentTabs} selected={activeInstrumentFilter} onSelect={selectInstrument} />

              <AnalysisSheet
                packet={packet}
                cohortLabel={cohortLabel}
                tableView={tableView}
                onToggleTableView={setTableView}
                onFollowUp={handleFollowUp}
                onPairedScores={handlePairedScores}
              />

              <div ref={rosterRef} className="rp-roster">
                <DataSheet
                  level="full"
                  title="Individual Responses"
                  caption={`${packet.instrument.name} · ${rosterRows.length} of ${packet.rows.length} ${packet.rows.length === 1 ? 'assignment' : 'assignments'}`}
                  toolbar={rosterToolbar}
                  columns={columns}
                  rows={rosterRows}
                  rowKey={row => row.id}
                  sort={sort}
                  onSortChange={setSort}
                  expandable
                  expandedKeys={expandedIds}
                  onToggleExpand={toggleRow}
                  renderExpanded={renderExpanded}
                  expandLabel={row => `Answers for ${row.name}`}
                  emptyMessage={packet.rows.length === 0
                    ? 'No evaluations for this instrument in this cohort yet.'
                    : 'No evaluations match the current filters.'}
                  aria-label="Individual responses"
                />
              </div>

              <p className="sr-only" aria-live="polite">{live}</p>
            </div>
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
