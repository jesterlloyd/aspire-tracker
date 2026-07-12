import { useState, useCallback, useMemo } from 'react'
import { Eye } from 'lucide-react'
import PreceptorAutomationPanel from './PreceptorAutomationPanel'
import StudentEvalAutomationPanel from './StudentEvalAutomationPanel'
import CaseyFinkPostRotationAutomationPanel from './CaseyFinkPostRotationAutomationPanel'
import PostRotationAutomationPanel from './PostRotationAutomationPanel'
import AutomationEmailPreviewDrawer from '../connect/AutomationEmailPreviewDrawer'
import { getEvaluationPreviewFixture } from '../../lib/evaluation/evaluationPreviewFixtures'
import { resolveEffectiveWorkflow } from '../../lib/evaluation/workflowSelection'

// ASPIRE-EVALUATION-REVIEW-RELEASE-LAYOUT-1 - Review & Release as a workflow navigator with a
// selected operational workspace (Settings-inspired left nav + right workspace). This shell runs
// NO detection, release, or send logic: each panel still owns its own detection and reports its
// summary up via onCounts, even when it is not the selected (visible) workspace. Business logic,
// eligibility, release, previews, and certificate gating are unchanged; only the layout changed.

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'
const WORKSPACE_ID = 'survey-automation-workspace'

// Workflows in display order. `label` is the compact navigator label; `title` is the full title
// used by the email preview drawer. `badge` (optional) is a compact indicator; `paused` marks the
// non-gating ASPIRE feedback workflow whose release is paused.
const WORKFLOWS = [
  { key: 'preceptor',             label: 'Preceptor Readiness',    title: 'Preceptor Student Readiness Assessment',          recipient: 'Preceptor' },
  { key: 'student',               label: 'Student Feedback',       title: 'Student Feedback: Preceptor & Unit',              recipient: 'Student' },
  { key: 'caseyFinkPostRotation', label: 'Casey-Fink Post-Rotation', title: 'Casey-Fink Readiness for Practice, Post-Rotation', recipient: 'Student', badge: 'Certificate gate', badgeTone: 'gate' },
  { key: 'postRotation',          label: 'ASPIRE Rotation Feedback', title: 'ASPIRE Post-Rotation Evaluation',               recipient: 'Student', badge: 'Paused', badgeTone: 'paused', paused: true },
]

const CSS = `
/* LAYOUT-SHELL-CONSISTENCY-1: compact left navigator + flexible right workspace. The workspace
   column is minmax(0,1fr) so it expands to fill the shared shell and its tables/notes can shrink
   (min-width:0) without forcing horizontal overflow. */
.rr-layout { display:grid; grid-template-columns:minmax(250px, 280px) minmax(0, 1fr); gap:18px; align-items:flex-start; }
/* STICKY-NAV-1: the workflow navigator pins beneath the sticky app header + tab bar while the right
   workspace scrolls with the page. The page/document remains the only scroll container; the workspace
   is untouched (no fixed height, no overflow). align-self:start keeps the nav its own height (it must
   not stretch to the tall workspace row, or it could not move). overflow-y:auto + max-height only
   engage on short viewports, so on normal screens the four cards show fully with no inner scrollbar.
   Offset uses the shared --app-chrome-height token (header + tab bar). */
.rr-nav {
  min-width:0; display:flex; flex-direction:column; gap:8px;
  position:sticky; top:var(--app-chrome-height); align-self:start;
  max-height:calc(100dvh - var(--app-chrome-height) - 20px);
  overflow-y:auto; overscroll-behavior:contain;
}
.rr-nav-mobile { display:none; }
.rr-workspace {
  min-width:0; background:#fff; border:1px solid #e8e4dc; border-radius:14px;
  box-shadow:0 1px 3px rgba(25,25,25,0.06); padding:16px 20px 20px;
}
/* Navigation-only workflow rows: one selection button each (no per-row preview control). Selected
   state = subtle nightfall tint + thin nightfall left accent bar; hover is a lighter tint; focus is
   a distinct blue outline (separate from selection). */
.rr-row-select {
  width:100%; display:flex; align-items:center; text-align:left; padding:11px 12px;
  cursor:pointer; background:#fff; border:1px solid #e8e4dc; border-radius:12px;
  box-shadow:0 1px 3px rgba(25,25,25,0.06); font-family:${F};
}
.rr-row-select:hover { background:#fafbff; }
.rr-row-select.sel { background:#f7f9ff; box-shadow:0 1px 3px rgba(25,25,25,0.06), inset 3px 0 0 0 ${NAVY}; }
.rr-row-select.sel:hover { background:#f7f9ff; }
.rr-row-select:focus-visible { outline:3px solid #93c5fd; outline-offset:2px; }
.rr-preview-btn {
  display:inline-flex; align-items:center; gap:6px; padding:6px 12px; background:#fff; color:${NAVY};
  border:1px solid #d7ddf5; border-radius:8px; font-size:12.5px; font-weight:600; font-family:${F}; cursor:pointer;
}
.rr-preview-btn:focus-visible { outline:3px solid #93c5fd; outline-offset:2px; }
@media (max-width: 900px) {
  .rr-layout { grid-template-columns:1fr; }
  .rr-nav { display:none; }
  .rr-nav-mobile { display:block; width:100%; }
  .rr-workspace { width:100%; }
}
`

// Compact per-workflow status line from the reported summary counts (no count changes here).
function statusLine(w, counts) {
  if (w.paused) return 'Release paused'
  const c = counts || {}
  const ready = c.due_sendable || 0
  const needs = c.due_unsendable || 0
  if (ready > 0 || needs > 0) {
    const parts = []
    if (ready > 0) parts.push(`${ready} ready`)
    if (needs > 0) parts.push(`${needs} needs attention`)
    return parts.join(' · ')
  }
  if (!counts) return 'Detecting…'
  const parts = ['0 ready']
  const sup = c.suppressed_existing || 0
  const notDue = c.not_due || 0
  const inelig = c.ineligible_hours || 0
  if (sup > 0) parts.push(`${sup} suppressed`)
  else if (notDue > 0) parts.push(`${notDue} not due`)
  else if (inelig > 0) parts.push(`${inelig} ineligible hours`)
  return parts.join(' · ')
}

function badgeStyle(tone) {
  if (tone === 'gate') return { color: '#b45309', background: '#FBF5E8', border: '1px solid #f0e0bd' }
  if (tone === 'paused') return { color: '#6b7280', background: '#f3f4f6', border: '1px solid #e5e7eb' }
  return { color: NAVY, background: '#EEF1FB', border: '1px solid #d7ddf5' }
}

// Navigation-only workflow row: a single native selection button (no per-row preview control).
// Email preview is reached from the workspace Preview Email button. Enter/Space work natively.
function WorkflowNavRow({ w, counts, selected, onSelect }) {
  return (
    <button
      type="button"
      className={`rr-row-select${selected ? ' sel' : ''}`}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
    >
      <span style={{ display: 'block', flex: 1, minWidth: 0 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#191919' }}>{w.label}</span>
          {w.badge && (
            <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap', ...badgeStyle(w.badgeTone) }}>
              {w.badge}
            </span>
          )}
        </span>
        <span style={{ display: 'block', fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{w.recipient}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: '#6b7280', marginTop: 3, lineHeight: 1.35 }}>{statusLine(w, counts)}</span>
      </span>
    </button>
  )
}

export default function SurveyAutomationDashboard({ cohortId }) {
  // Presentational rollup only: survey key -> its reported summary counts.
  const [counts, setCounts] = useState({})
  // Explicit user selection; null means "use the priority default". Once set, it is never
  // auto-overridden by a later count refresh.
  const [selected, setSelected] = useState(null)
  const [previewKey, setPreviewKey] = useState(null)

  const report = useCallback((key, summary) => {
    setCounts(prev => (prev[key] === summary ? prev : { ...prev, [key]: summary }))
  }, [])
  const reportPreceptor    = useCallback((s) => report('preceptor', s), [report])
  const reportStudent      = useCallback((s) => report('student', s), [report])
  const reportCaseyFink    = useCallback((s) => report('caseyFinkPostRotation', s), [report])
  const reportPostRotation = useCallback((s) => report('postRotation', s), [report])

  const totals = useMemo(() => {
    let ready = 0, needs = 0
    for (const s of Object.values(counts)) {
      ready += s?.due_sendable || 0
      needs += s?.due_unsendable || 0
    }
    return { ready, needs }
  }, [counts])

  // ROUTING-HOTFIX-1/1B: the operational workspace is DETERMINISTIC via the shared, pure resolver
  // (workflowSelection.resolveEffectiveWorkflow) - it is the user's explicit selection, or a fixed
  // default (the Casey-Fink certificate gate) until the user picks one. It NEVER auto-switches based
  // on which workflow's async counts arrive first. The prior "prefer first ready" auto-follow made
  // the active/releasing panel change out from under the user (a student release-ready for two
  // workflows resolved to whichever is earlier in WORKFLOWS order, and could auto-follow after a
  // release dropped that workflow's ready count to zero). Because the navigator highlight, the active
  // panel, and the preview all derive from this one value, the visible workflow and the releasing
  // workflow can never diverge. Each nav row still shows its own ready/attention status.
  const effective = resolveEffectiveWorkflow(selected)

  const attention = totals.ready > 0 || totals.needs > 0
  const bannerText = attention
    ? `${totals.ready} ready to release · ${totals.needs} needs attention across ${WORKFLOWS.length} workflows`
    : `All clear · 0 ready to release · 0 need attention across ${WORKFLOWS.length} workflows`

  const previewWorkflow = WORKFLOWS.find(w => w.key === previewKey)

  return (
    <div style={{ padding: '4px 20px 28px', fontFamily: F }}>
      <style>{CSS}</style>

      {/* Global header */}
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: NAVY, margin: '0 0 2px' }}>Review & Release</h2>
        <p style={{ fontSize: 12.5, color: '#6b7280', margin: 0, lineHeight: 1.5 }}>
          Review detected survey needs, preview messages, and manually release approved evaluations.
        </p>
      </div>

      {/* Compact global status banner (counts unchanged) */}
      <div
        role="status"
        style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
          padding: '8px 14px', borderRadius: 10,
          background: attention ? '#FBF5E8' : '#EDF7F0',
          border: `1px solid ${attention ? '#f0e0bd' : '#c6e7d0'}`,
        }}
      >
        <span aria-hidden="true" style={{
          flexShrink: 0, width: 8, height: 8, borderRadius: 999,
          background: attention ? '#b45309' : '#166534',
        }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: attention ? '#92400e' : '#166534' }}>
          {bannerText}
        </span>
      </div>

      {/* Narrow-screen workflow selector (replaces the left nav below 900px). */}
      <select
        className="rr-nav-mobile"
        aria-label="Select survey workflow"
        value={effective}
        onChange={(e) => setSelected(e.target.value)}
        style={{
          marginBottom: 14, padding: '9px 10px', borderRadius: 8, border: '1px solid #e5e7eb',
          fontSize: 13, fontFamily: F, color: '#191919', background: '#fff',
        }}
      >
        {WORKFLOWS.map(w => (
          <option key={w.key} value={w.key}>
            {w.label}{w.badge ? ` (${w.badge})` : ''} - {statusLine(w, counts[w.key])}
          </option>
        ))}
      </select>

      <div className="rr-layout">
        {/* Left workflow navigator (desktop). */}
        <nav className="rr-nav" aria-label="Survey workflows">
          {WORKFLOWS.map(w => (
            <WorkflowNavRow
              key={w.key}
              w={w}
              counts={counts[w.key]}
              selected={effective === w.key}
              onSelect={() => setSelected(w.key)}
            />
          ))}
        </nav>

        {/* Selected workflow workspace. Panels self-describe (title/badges/description/detection/
            metrics/queue); the toolbar adds only a labeled Preview Email action. */}
        <section id={WORKSPACE_ID} className="rr-workspace">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button
              type="button"
              className="rr-preview-btn"
              onClick={() => setPreviewKey(effective)}
              aria-label="Preview email for the selected workflow"
            >
              <Eye size={15} /> Preview Email
            </button>
          </div>
          <PreceptorAutomationPanel cohortId={cohortId} active={effective === 'preceptor'} onCounts={reportPreceptor} />
          <StudentEvalAutomationPanel cohortId={cohortId} active={effective === 'student'} onCounts={reportStudent} />
          <CaseyFinkPostRotationAutomationPanel cohortId={cohortId} active={effective === 'caseyFinkPostRotation'} onCounts={reportCaseyFink} />
          <PostRotationAutomationPanel cohortId={cohortId} active={effective === 'postRotation'} onCounts={reportPostRotation} />
        </section>
      </div>

      {/* Shared read-only email preview (safe synthetic data, no send/token/DB). */}
      {previewKey && (
        <AutomationEmailPreviewDrawer
          title={previewWorkflow?.title}
          entry={getEvaluationPreviewFixture(previewKey)}
          onClose={() => setPreviewKey(null)}
        />
      )}
    </div>
  )
}
