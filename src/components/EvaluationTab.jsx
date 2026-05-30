import React, { useState, useEffect, useCallback } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { CS_COLORS } from '../lib/brand'

const F = 'DM Sans, sans-serif'

// ── Timepoint display labels ──────────────────────────────────────────────────
const TIMEPOINT_LABELS = {
  baseline:                'Baseline',
  early_rotation_baseline: 'Early-Rotation Baseline',
  mid_rotation:            'Mid-Rotation Check-In',
  post_rotation:           'Post-Rotation Reflection',
}

// ── Status badge config — colors from brand.js CS_COLORS ─────────────────────
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

// Statuses shown in the summary strip and filter chips
const MAIN_STATUSES = ['sent', 'opened', 'completed', 'expired', 'revoked']

// ── Helpers ───────────────────────────────────────────────────────────────────

// Render-time effective status projection — does NOT mutate stored data.
// Applied consistently: badge rendering, KPI counts, summary strip, filter chips.
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
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(iso) {
  if (!iso) return '—'
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
          <LabelVal label="Hours at invitation"     value={a.approved_hours_at_invitation != null ? String(a.approved_hours_at_invitation) : '—'} />
          <LabelVal label="Hours at completion"     value={a.approved_hours_at_completion != null ? String(a.approved_hours_at_completion) : '—'} />
        </div>
        <div>
          <SectionLabel>SECTION I SCORES</SectionLabel>
          <LabelVal label="Clinical Problem-Solving" value={cps != null ? Number(cps).toFixed(2) : '—'} />
          <LabelVal label="Learning Activities"      value={la  != null ? Number(la).toFixed(2)  : '—'} />
          <LabelVal label="Practice Readiness"       value={pr  != null ? Number(pr).toFixed(2)  : '—'} />
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
  const [activeSubTab, setActiveSubTab] = useState('cohort')
  const [assignments,  setAssignments]  = useState([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)
  const [expandedIds,  setExpandedIds]  = useState(new Set())

  // Sort state — default: most recent sent_at first
  const [sortKey, setSortKey] = useState('sent_at')
  const [sortDir, setSortDir] = useState('desc')

  // Filter state — all main statuses active by default
  const [filterStatuses,   setFilterStatuses]   = useState(new Set(MAIN_STATUSES))
  const [filterInstrument, setFilterInstrument] = useState('All')
  const [filterTimepoint,  setFilterTimepoint]  = useState('All')

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
          students!inner ( id, first_name, last_name ),
          evaluation_instruments!inner ( slug, display_name ),
          evaluation_responses (
            submitted_at,
            score_s1_clinical_problem_solving,
            score_s1_learning_activities,
            score_s1_practice_readiness
          )
        `)
        .eq('cohort_id', cohortId)
        .order('sent_at', { ascending: false })
      if (err) throw err
      setAssignments(data || [])
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [cohortId])

  useEffect(() => { fetchAssignments() }, [fetchAssignments])

  // ── Derived values — all status-related logic uses effectiveStatus ─────────

  // Summary strip counts — use effectiveStatus so past-due sent/opened show as expired
  const statusCounts = MAIN_STATUSES.reduce((acc, s) => {
    acc[s] = assignments.filter(a => effectiveStatus(a) === s).length
    return acc
  }, {})

  // Distinct instrument and timepoint values for dropdowns
  const instruments = ['All', ...new Set(
    assignments.map(a => a.evaluation_instruments?.display_name).filter(Boolean)
  )]
  const timepoints = ['All', ...new Set(
    assignments.map(a => a.timepoint).filter(Boolean)
  )]

  // Client-side filtering — filter chips target effectiveStatus
  const filtered = assignments.filter(a => {
    const es = effectiveStatus(a)
    if (MAIN_STATUSES.includes(es) && !filterStatuses.has(es)) return false
    if (filterInstrument !== 'All' && a.evaluation_instruments?.display_name !== filterInstrument) return false
    if (filterTimepoint !== 'All' && a.timepoint !== filterTimepoint) return false
    return true
  })

  // Client-side sort
  const sorted = [...filtered].sort((a, b) => {
    let va, vb
    if (sortKey === 'student') {
      va = `${a.students?.last_name || ''} ${a.students?.first_name || ''}`.toLowerCase()
      vb = `${b.students?.last_name || ''} ${b.students?.first_name || ''}`.toLowerCase()
    } else if (sortKey === 'submitted_at') {
      va = extractResponse(a)?.submitted_at || ''
      vb = extractResponse(b)?.submitted_at || ''
    } else {
      va = a[sortKey] || ''
      vb = b[sortKey] || ''
    }
    if (va === vb) return 0
    return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
  })

  // ── KPI computations — operate on filtered set ────────────────────────────

  const completedRows  = filtered.filter(a => effectiveStatus(a) === 'completed')
  const openedRows     = filtered.filter(a => effectiveStatus(a) === 'opened')
  const completedCount = completedRows.length
  const openedCount    = openedRows.length
  const totalCount     = filtered.length
  const completionPct  = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : null

  // Section I averages — only completed rows with all three scores present
  const scoredRows = completedRows.filter(a => {
    const r = extractResponse(a)
    return r?.score_s1_clinical_problem_solving != null
      && r?.score_s1_learning_activities != null
      && r?.score_s1_practice_readiness != null
  })
  const avgCPS = scoredRows.length > 0
    ? scoredRows.reduce((s, a) => s + Number(extractResponse(a).score_s1_clinical_problem_solving), 0) / scoredRows.length
    : null
  const avgLA = scoredRows.length > 0
    ? scoredRows.reduce((s, a) => s + Number(extractResponse(a).score_s1_learning_activities), 0) / scoredRows.length
    : null
  const avgPR = scoredRows.length > 0
    ? scoredRows.reduce((s, a) => s + Number(extractResponse(a).score_s1_practice_readiness), 0) / scoredRows.length
    : null

  // ── Event handlers ────────────────────────────────────────────────────────

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

  function toggleStatusFilter(status) {
    setFilterStatuses(prev => {
      const next = new Set(prev)
      next.has(status) ? next.delete(status) : next.add(status)
      return next
    })
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  // Sub-tab button style — mirrors RotationTab.jsx btnStyle pattern
  const btnStyle = (key) => ({
    height: 32, padding: '0 13px', display: 'flex', alignItems: 'center',
    border: 'none', cursor: 'pointer', fontSize: 12,
    fontFamily: F, fontWeight: 500,
    background: activeSubTab === key ? 'var(--color-accent-primary,#1D2567)' : 'var(--bg-input,#fff)',
    color: activeSubTab === key ? '#fff' : 'var(--text-secondary,#4A5560)',
    transition: 'all 0.12s',
  })

  const CARD = {
    background: '#fff',
    borderRadius: 12,
    border: '1px solid rgba(29,37,103,0.08)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    padding: '20px 24px',
    flex: '1 1 180px',
    minWidth: 160,
  }

  const sel = {
    fontSize: 12, padding: '5px 10px', borderRadius: 6,
    border: '1px solid #d1d5db', background: '#fff',
    color: '#374151', fontFamily: F, cursor: 'pointer',
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: F, display: 'flex', flexDirection: 'column' }}>

      {/* Sub-tab picker — mirrors RotationTab.jsx structure and styling */}
      <div style={{ padding: '0 20px 12px', flexShrink: 0 }}>
        <div style={{
          display: 'flex',
          borderRadius: 7,
          border: '1px solid var(--border-input,rgba(29,37,103,0.10))',
          overflow: 'hidden',
          width: 'fit-content',
        }}>
          <button onClick={() => setActiveSubTab('cohort')}  style={btnStyle('cohort')}>Cohort View</button>
          <button onClick={() => setActiveSubTab('program')} style={btnStyle('program')}>Program View</button>
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

      {/* ── Cohort View ─────────────────────────────────────────────────── */}
      {activeSubTab === 'cohort' && (
        <div style={{ padding: '4px 20px 24px', maxWidth: 1400 }}>

          {/* Header */}
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#191919', margin: '0 0 4px', fontFamily: F }}>
              Evaluation Dashboard
            </h2>
            <p style={{ fontSize: 13, color: '#9ca3af', margin: 0, fontFamily: F }}>
              Review evaluation assignments and submitted responses by cohort.
            </p>
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
              {/* KPI cards */}
              <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>

                {/* Total Assigned */}
                <div style={CARD}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10, fontFamily: F }}>
                    Total Assigned
                  </div>
                  <div style={{ fontSize: 30, fontWeight: 700, color: '#191919', fontFamily: F, lineHeight: 1 }}>
                    {totalCount}
                  </div>
                </div>

                {/* Completed */}
                <div style={CARD}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10, fontFamily: F }}>
                    Completed
                  </div>
                  <div style={{ fontSize: 30, fontWeight: 700, color: '#166534', fontFamily: F, lineHeight: 1 }}>
                    {completedCount}
                  </div>
                  {completionPct !== null && (
                    <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6, fontFamily: F }}>
                      {completionPct}% completion rate
                    </div>
                  )}
                </div>

                {/* Opened */}
                <div style={CARD}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10, fontFamily: F }}>
                    Opened
                  </div>
                  <div style={{ fontSize: 30, fontWeight: 700, color: '#1D2567', fontFamily: F, lineHeight: 1 }}>
                    {openedCount}
                  </div>
                </div>

                {/* Section I Averages */}
                <div style={{ ...CARD, flex: '1 1 220px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10, fontFamily: F }}>
                    Section I Averages
                  </div>
                  {scoredRows.length === 0 ? (
                    <div style={{ fontSize: 22, fontWeight: 700, color: '#d1d5db', fontFamily: F }}>—</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                      {[['CPS', avgCPS], ['LA', avgLA], ['PR', avgPR]].map(([lbl, val]) => (
                        <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', width: 28, flexShrink: 0, fontFamily: F }}>{lbl}</span>
                          <span style={{ fontSize: 15, fontWeight: 700, color: '#191919', fontFamily: F, fontVariantNumeric: 'tabular-nums' }}>
                            {val != null ? val.toFixed(2) : '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Status summary strip — counts use effectiveStatus */}
              {assignments.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
                  {MAIN_STATUSES.map(s => {
                    const n = statusCounts[s]
                    if (!n) return null
                    const cfg = STATUS_CONFIG[s]
                    return (
                      <span key={s} style={{
                        fontSize: 12, fontWeight: 600,
                        background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}`,
                        padding: '4px 10px', borderRadius: 12, fontFamily: F,
                      }}>
                        {cfg.label} {n}
                      </span>
                    )
                  })}
                </div>
              )}

              {/* Filter strip */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
                {/* Status filter chips — target effectiveStatus */}
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {MAIN_STATUSES.map(s => {
                    const active = filterStatuses.has(s)
                    const cfg = STATUS_CONFIG[s]
                    return (
                      <button key={s}
                        onClick={() => toggleStatusFilter(s)}
                        style={{
                          fontSize: 11, fontWeight: 600,
                          padding: '4px 10px', borderRadius: 10,
                          cursor: 'pointer', fontFamily: F,
                          background: active ? cfg.bg   : '#f9fafb',
                          color:      active ? cfg.text : '#9ca3af',
                          border:     `1px solid ${active ? cfg.border : '#e5e7eb'}`,
                          transition: 'all 0.1s',
                        }}
                      >
                        {cfg.label}
                      </button>
                    )
                  })}
                </div>

                {/* Instrument dropdown */}
                <select value={filterInstrument} onChange={e => setFilterInstrument(e.target.value)} style={sel}>
                  {instruments.map(i => (
                    <option key={i} value={i}>{i === 'All' ? 'All instruments' : i}</option>
                  ))}
                </select>

                {/* Timepoint dropdown */}
                <select value={filterTimepoint} onChange={e => setFilterTimepoint(e.target.value)} style={sel}>
                  {timepoints.map(t => (
                    <option key={t} value={t}>{t === 'All' ? 'All timepoints' : (TIMEPOINT_LABELS[t] || t)}</option>
                  ))}
                </select>
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

              {/* Main table */}
              {sorted.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: F }}>
                    <thead>
                      <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                        <Th label="Student"    sortable onClick={() => handleSort('student')}    active={sortKey === 'student'}    dir={sortDir} />
                        <Th label="Instrument" />
                        <Th label="Timepoint"  />
                        <Th label="Status"     />
                        <Th label="Submitted"  sortable onClick={() => handleSort('submitted_at')} active={sortKey === 'submitted_at'} dir={sortDir} />
                        <Th label="Section I"  />
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
                                <span style={{
                                  fontSize: 12, color: '#374151',
                                  maxWidth: 220, display: 'inline-block',
                                  overflow: 'hidden', textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap', verticalAlign: 'middle',
                                }}>
                                  {a.evaluation_instruments?.display_name || '—'}
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
                                    : '—'
                                  }
                                </span>
                              </Td>
                            </tr>

                            {isExpanded && (
                              <tr style={{ background: idx % 2 === 0 ? '#f8f9fe' : '#f4f5fa' }}>
                                <td colSpan={6} style={{ padding: '16px 24px', borderBottom: '1px solid #e5e7eb' }}>
                                  <ExpandedRow assignment={a} response={response} />
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
    </div>
  )
}
