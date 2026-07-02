import React, { useState, useCallback, useMemo } from 'react'
import PreceptorAutomationPanel from './PreceptorAutomationPanel'
import StudentEvalAutomationPanel from './StudentEvalAutomationPanel'
import SurveyAutomationCard from './SurveyAutomationCard'
import AutomationEmailPreviewDrawer from '../connect/AutomationEmailPreviewDrawer'
import { getEvaluationPreviewFixture } from '../../lib/evaluation/evaluationPreviewFixtures'

// SURVEY-UX-3 — Presentational shell for the two Survey Automation workflows.
//
// Two-layer layout: (1) a status band + compact summary cards on top for awareness, and
// (2) ONE shared full-width detail workspace below that renders the SELECTED workflow's
// dense tables and release controls. Dense content no longer renders inside half-width
// cards. This component runs NO detection, release, or send logic and lifts no detection
// state — each panel still owns its own detection and reports its counts up via onCounts.

const F = 'DM Sans, sans-serif'
const WORKSPACE_ID = 'survey-automation-workspace'

// The two survey workflows, in display order. `key` drives selection + the count rollup.
const WORKFLOWS = [
  { key: 'preceptor', title: 'Preceptor Student Readiness Assessment', recipientLabel: 'Preceptor' },
  { key: 'student',   title: 'Student Feedback: Preceptor & Unit',     recipientLabel: 'Student' },
]

export default function SurveyAutomationDashboard({ cohortId }) {
  // Presentational rollup only: survey key -> its reported summary counts.
  const [counts, setCounts] = useState({})
  // Explicit user selection; null means "use the sensible default" (first actionable, else preceptor).
  const [selected, setSelected] = useState(null)
  // EVALUATION-RELEASE-PREVIEW-1: which workflow's email preview drawer is open (null = closed).
  const [previewKey, setPreviewKey] = useState(null)

  // Bail when the reported summary is the same (memoized) object, so reporting never loops.
  const report = useCallback((key, summary) => {
    setCounts(prev => (prev[key] === summary ? prev : { ...prev, [key]: summary }))
  }, [])
  const reportPreceptor = useCallback((s) => report('preceptor', s), [report])
  const reportStudent   = useCallback((s) => report('student', s), [report])

  const isActionable = (key) =>
    (counts[key]?.due_sendable || 0) > 0 || (counts[key]?.due_unsendable || 0) > 0

  const totals = useMemo(() => {
    let ready = 0, needs = 0
    for (const s of Object.values(counts)) {
      ready += s?.due_sendable || 0
      needs += s?.due_unsendable || 0
    }
    return { ready, needs }
  }, [counts])

  // Default selection: explicit user choice wins; otherwise the first actionable workflow;
  // otherwise the first workflow (preceptor). Before any click, this auto-follows actionability
  // so a newly actionable workflow is surfaced in the detail workspace, not hidden.
  const firstActionable = WORKFLOWS.find(w => isActionable(w.key))?.key
  const effective = selected || firstActionable || WORKFLOWS[0].key

  const attention = totals.ready > 0 || totals.needs > 0
  const bandTitle = attention
    ? `${totals.ready} release${totals.ready === 1 ? '' : 's'} ready · ${totals.needs} needs attention`
    : 'All clear — no survey releases need attention'
  const bandSub = attention
    ? `across ${WORKFLOWS.length} survey workflows`
    : `${totals.ready} ready to release · ${totals.needs} needs attention across ${WORKFLOWS.length} survey workflows`

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

      {/* Compact summary cards: 2 columns on wide screens, single column when narrow. */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
        gap: 18, alignItems: 'start', marginBottom: 18,
      }}>
        {WORKFLOWS.map(w => (
          <SurveyAutomationCard
            key={w.key}
            title={w.title}
            recipientLabel={w.recipientLabel}
            counts={counts[w.key]}
            selected={effective === w.key}
            onSelect={() => setSelected(w.key)}
            onPreview={() => setPreviewKey(w.key)}
            workspaceId={WORKSPACE_ID}
          />
        ))}
      </div>

      {/* EVALUATION-RELEASE-PREVIEW-1: read-only email preview (safe synthetic data, no send/token/DB),
          rendered with the shared AutomationEmailPreviewDrawer used by ASPIRE Connect > Automations. */}
      {previewKey && (
        <AutomationEmailPreviewDrawer
          title={WORKFLOWS.find(w => w.key === previewKey)?.title}
          entry={getEvaluationPreviewFixture(previewKey)}
          onClose={() => setPreviewKey(null)}
        />
      )}

      {/* Shared full-width detail workspace — renders only the selected workflow. Both panels
          stay mounted so detection runs and counts keep flowing; the inactive one renders null. */}
      <section
        id={WORKSPACE_ID}
        style={{
          background: '#fff', border: '1px solid #e8e4dc', borderRadius: 14,
          boxShadow: '0 1px 3px rgba(25,25,25,0.06)', padding: '20px 22px',
        }}
      >
        <PreceptorAutomationPanel cohortId={cohortId} active={effective === 'preceptor'} onCounts={reportPreceptor} />
        {/* SR-2b-1: separate read-only queue for the student-completed survey. */}
        <StudentEvalAutomationPanel cohortId={cohortId} active={effective === 'student'} onCounts={reportStudent} />
      </section>
    </div>
  )
}
