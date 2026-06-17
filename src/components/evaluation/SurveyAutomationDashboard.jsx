import React, { useState, useCallback, useMemo } from 'react'
import PreceptorAutomationPanel from './PreceptorAutomationPanel'
import StudentEvalAutomationPanel from './StudentEvalAutomationPanel'

// SURVEY-UX-2 — Presentational shell for the two Survey Automation workflows.
//
// Renders a top-level status band plus a responsive 2-column grid of survey tiles. The band
// rolls up the SAME per-survey counts the cards already show: each panel reports its own
// (already-computed) detection summary upward via onCounts. This component runs NO detection,
// release, or send logic and lifts no detection state — it only aggregates numbers for display.

const F = 'DM Sans, sans-serif'

// One reporter per rendered survey workflow. WORKFLOW_COUNT drives the band subline.
const WORKFLOW_COUNT = 2

export default function SurveyAutomationDashboard({ cohortId }) {
  // Presentational rollup only: survey key -> its reported summary counts.
  const [counts, setCounts] = useState({})

  // Bail when the reported summary is the same (memoized) object, so reporting never loops.
  const report = useCallback((key, summary) => {
    setCounts(prev => (prev[key] === summary ? prev : { ...prev, [key]: summary }))
  }, [])
  const reportPreceptor = useCallback((s) => report('preceptor', s), [report])
  const reportStudent   = useCallback((s) => report('student', s), [report])

  const totals = useMemo(() => {
    let ready = 0, needs = 0
    for (const s of Object.values(counts)) {
      ready += s?.due_sendable || 0
      needs += s?.due_unsendable || 0
    }
    return { ready, needs }
  }, [counts])

  const attention = totals.ready > 0 || totals.needs > 0
  const bandTitle = attention
    ? `${totals.ready} release${totals.ready === 1 ? '' : 's'} ready · ${totals.needs} needs attention`
    : 'All clear — no survey releases need attention'
  const bandSub = attention
    ? `across ${WORKFLOW_COUNT} survey workflows`
    : `${totals.ready} ready to release · ${totals.needs} needs attention across ${WORKFLOW_COUNT} survey workflows`

  return (
    <div style={{ padding: '4px 20px 28px', maxWidth: 1200, fontFamily: F }}>
      {/* Status band — rolls up the same counts shown in the cards below. */}
      <div
        role="status"
        style={{
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18,
          padding: '14px 18px', borderRadius: 12,
          background: attention ? '#FBF5E8' : '#EDF7F0',
          border: `1px solid ${attention ? '#f0e0bd' : '#c6e7d0'}`,
        }}
      >
        <span aria-hidden="true" style={{
          flexShrink: 0, width: 10, height: 10, borderRadius: 999,
          background: attention ? '#b45309' : '#166534',
        }} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: attention ? '#92400e' : '#166534' }}>
            {bandTitle}
          </div>
          <div style={{ fontSize: 12, color: attention ? '#a16207' : '#3f7a52', marginTop: 2 }}>
            {bandSub}
          </div>
        </div>
      </div>

      {/* Responsive tiles: 2 columns on wide screens, single column when narrow. */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
        gap: 18, alignItems: 'start',
      }}>
        <PreceptorAutomationPanel cohortId={cohortId} onCounts={reportPreceptor} />
        {/* SR-2b-1: separate read-only queue for the student-completed survey. */}
        <StudentEvalAutomationPanel cohortId={cohortId} onCounts={reportStudent} />
      </div>
    </div>
  )
}
