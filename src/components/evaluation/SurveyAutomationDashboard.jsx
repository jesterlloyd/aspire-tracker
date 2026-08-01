import { useState, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, Send, ExternalLink, Mail } from 'lucide-react'
import PreceptorAutomationPanel from './PreceptorAutomationPanel'
import StudentEvalAutomationPanel from './StudentEvalAutomationPanel'
import CaseyFinkPostRotationAutomationPanel from './CaseyFinkPostRotationAutomationPanel'
import PostRotationAutomationPanel from './PostRotationAutomationPanel'
import AutomationEmailPreviewDrawer from '../connect/AutomationEmailPreviewDrawer'
import { getEvaluationPreviewFixture } from '../../lib/evaluation/evaluationPreviewFixtures'
import SurveyPreviewDrawer from './SurveyPreviewDrawer'
import UnitEvaluationReleaseConsole from './UnitEvaluationReleaseConsole'
import { SURVEY_CATALOG } from '../../lib/evaluation/surveyCatalog'
import { supabase } from '../../lib/supabase'
import {
  LAST_WORKFLOW_STORAGE_KEY,
  UNIT_LEADER_RELEASE_KEY, isReviewReleaseNavKey, resolveEffectiveNavKey, resolveInitialNavKey,
} from '../../lib/evaluation/workflowSelection'

// ASPIRE-EVALUATION-REVIEW-RELEASE-LAYOUT-1 - Review & Release as a workflow navigator with a
// selected operational workspace (Settings-inspired left nav + right workspace). This shell runs
// NO detection, release, or send logic: each panel still owns its own detection and reports its
// summary up via onCounts, even when it is not the selected (visible) workspace. Business logic,
// eligibility, release, previews, and certificate gating are unchanged; only the layout changed.
//
// EVAL-RR-UNIFIED-NAV-1: the navigator now has TWO sections - Survey Workflows (the four rows
// above) and Unit Leader Release (the release console, formerly a separate surface stacked above
// this dashboard in EvaluationTab). Selecting it swaps the right workspace to the console; the
// survey panels stay MOUNTED (display-toggled) so their detection counts keep feeding the nav
// status lines and the global banner. The console's queue, counts, filters, moderation/release/
// revoke actions, legacy read-only rows, eligibility, and timing rules are unchanged - it simply
// renders inside this shell (embedded) instead of above it.

const F = 'DM Sans, sans-serif'
const NAVY = '#1D2567'
const WORKSPACE_ID = 'survey-automation-workspace'

// Workflows in display order. `label` is the compact navigator label; `title` is the full title
// used by the email preview drawer. `badge` (optional) is a compact indicator; `paused` marks the
// non-gating ASPIRE feedback workflow whose release is paused.
// Workflows in display order, DERIVED from the shared catalog so the navigator, the
// survey preview, and the release routing cannot drift apart. The presentational
// badge fields stay here because they are navigator styling, not survey facts.
const BADGES = {
  caseyFinkPostRotation: { badge: 'Certificate gate', badgeTone: 'gate' },
}
const WORKFLOWS = SURVEY_CATALOG.map(s => ({
  key: s.key,
  label: s.label,
  title: s.title,
  recipient: s.recipient,
  paused: s.status === 'paused',
  ...(BADGES[s.key] || {}),
}))

const CSS = `
/* LAYOUT-SHELL-CONSISTENCY-1 / EVAL-RR-RAIL-C-1 (Owner-approved Option C): a 232px
   Settings-style rail + flexible right workspace. The workspace column is minmax(0,1fr) so it
   expands to fill the shared shell and its tables/notes can shrink (min-width:0) without forcing
   horizontal overflow; the fixed narrow rail returns ~48px to the workspace, which lets the
   release table fit without horizontal clipping at common widths. */
.rr-layout { display:grid; grid-template-columns:232px minmax(0, 1fr); gap:20px; align-items:flex-start; }
/* STICKY-NAV-1 (preserved): the navigator pins beneath the sticky app header + tab bar while the
   right workspace scrolls with the page. EVAL-RR-RAIL-C-1: the rail is now ONE quiet card
   containing compact rows (the Settings first-rail pattern), not a stack of bordered cards. */
.rr-nav {
  min-width:0; display:flex; flex-direction:column; gap:2px;
  background:#fff; border:1px solid #e8e4dc; border-radius:14px; padding:10px;
  box-shadow:0 1px 3px rgba(25,25,25,0.06);
  position:sticky; top:var(--app-chrome-height); align-self:start;
  max-height:calc(100dvh - var(--app-chrome-height) - 20px);
  overflow-y:auto; overscroll-behavior:contain;
}
.rr-nav-mobile { display:none; }
.rr-workspace {
  min-width:0; background:#fff; border:1px solid #e8e4dc; border-radius:14px;
  box-shadow:0 1px 3px rgba(25,25,25,0.06); padding:16px 20px 20px;
}
/* EVAL-RR-RAIL-C-1: compact single-line navigation rows. Selected = FILLED nightfall navy with
   white text (the Settings selected treatment); hover is a light tint; focus stays a distinct
   blue outline (separate from selection). No borders, no shadows, no multi-line prose. */
.rr-row-select {
  width:100%; display:flex; align-items:center; text-align:left; padding:9px 10px; margin:0;
  cursor:pointer; background:transparent; border:none; border-radius:9px; font-family:${F};
}
.rr-row-select:hover { background:#f3f4fa; }
.rr-row-select.sel { background:${NAVY}; }
.rr-row-select.sel:hover { background:${NAVY}; }
.rr-row-label {
  flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  font-size:13px; font-weight:600; color:#1f2430;
}
.rr-row-select.sel .rr-row-label { color:#fff; }
/* Right-aligned status affordances: navy chip = ready to release, amber chip = needs attention,
   grey chip = paused, amber dot = certificate gate. Counts come from the same panel-reported
   summaries as before; only the presentation is compact. On the navy selected row the chips
   invert so they stay legible. */
.rr-chip {
  flex-shrink:0; min-width:20px; text-align:center; font-size:11px; font-weight:700;
  border-radius:999px; padding:2px 7px;
  background:#EEF1FB; color:${NAVY}; border:1px solid #d7ddf5;
}
.rr-chip-attn { background:#FBF5E8; color:#92400e; border-color:#f0e0bd; }
.rr-chip-paused { background:#f3f4f6; color:#6b7280; border-color:#e5e7eb; }
.rr-row-select.sel .rr-chip { background:rgba(255,255,255,0.22); color:#fff; border-color:transparent; }
.rr-gate-dot { flex-shrink:0; width:7px; height:7px; border-radius:999px; background:#d97706; }
.rr-row-select.sel .rr-gate-dot { background:#f5d9a8; }
/* EVAL-RR-UNIFIED-NAV-1: compact uppercase group labels for the navigator's two sections
   (Survey Workflows / Unit Leader Release), matching Settings' section rhythm; a hairline
   separates the sections. */
.rr-nav-group {
  font-size:10.5px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase;
  color:#6b7280; padding:6px 10px 4px; margin:0;
}
.rr-nav .rr-nav-group:not(:first-child) { margin-top:8px; border-top:1px solid #f0ede6; padding-top:12px; }
.rr-tools {
  display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:12px; padding:10px 12px;
  background:#fbfaf7; border:1px solid #eee9df; border-radius:10px;
}
.rr-tools-label {
  font-size:10.5px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:#6b7280; white-space:nowrap;
}
.rr-tool-primary {
  display:inline-flex; align-items:center; gap:7px; padding:9px 16px; background:${NAVY}; color:#fff;
  border:1px solid ${NAVY}; border-radius:9px; font-size:13px; font-weight:700; font-family:${F}; cursor:pointer;
}
.rr-tool-primary:hover { background:#161d52; }
.rr-tool-secondary {
  display:inline-flex; align-items:center; gap:6px; padding:8px 13px; background:#fff; color:${NAVY};
  border:1px solid #d7ddf5; border-radius:9px; font-size:12.5px; font-weight:600; font-family:${F}; cursor:pointer;
}
.rr-tool-secondary:hover { background:#f7f9ff; }
.rr-tool-test {
  display:inline-flex; align-items:center; gap:6px; padding:8px 13px; background:#fff; color:#92400e;
  border:1px dashed #e0b877; border-radius:9px; font-size:12.5px; font-weight:600; font-family:${F}; cursor:pointer;
}
.rr-tool-test:hover { background:#fffaf0; }
.rr-tool-primary:focus-visible, .rr-tool-secondary:focus-visible, .rr-tool-test:focus-visible {
  outline:3px solid #93c5fd; outline-offset:2px;
}
@media (max-width: 640px) {
  .rr-tool-primary, .rr-tool-secondary, .rr-tool-test { flex:1 1 auto; justify-content:center; }
}
.rr-row-select:hover { background:#fafbff; }
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

// (badgeStyle removed with EVAL-RR-RAIL-C-1: the rail's badge pills became the .rr-gate-dot /
// .rr-chip classes; the mobile select still spells badges out in text via statusLine.)

// Navigation-only workflow row: a single native selection button (no per-row preview control).
// Email preview is reached from the workspace Preview Email button. Enter/Space work natively.
//
// EVAL-RR-RAIL-C-1 (Owner-approved Option C): one compact line per row. The recipient subtitle
// is gone (the workspace title already carries the recipient badge) and the status prose is
// compressed into right-aligned chips - navy count = ready to release, amber count = needs
// attention, grey Paused chip, amber dot = certificate gate. Counts come from the SAME
// panel-reported summaries as before; the full sentence survives in the row's aria-label and
// tooltips so screen readers and hover lose nothing.
function WorkflowNavRow({ w, counts, selected, onSelect }) {
  const ready = counts?.due_sendable || 0
  const needs = counts?.due_unsendable || 0
  const srBits = [w.label]
  if (w.badge) srBits.push(w.badge)
  if (w.paused) srBits.push('release paused')
  if (ready > 0) srBits.push(`${ready} ready to release`)
  if (needs > 0) srBits.push(`${needs} needs attention`)
  return (
    <button
      type="button"
      className={`rr-row-select${selected ? ' sel' : ''}`}
      aria-current={selected ? 'true' : undefined}
      aria-label={srBits.join(', ')}
      onClick={onSelect}
    >
      <span className="rr-row-label">{w.label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {w.badge && <span className="rr-gate-dot" title={w.badge} aria-hidden="true" />}
        {w.paused && <span className="rr-chip rr-chip-paused" title="Release paused" aria-hidden="true">Paused</span>}
        {ready > 0 && <span className="rr-chip" title={`${ready} ready to release`} aria-hidden="true">{ready}</span>}
        {needs > 0 && <span className="rr-chip rr-chip-attn" title={`${needs} needs attention`} aria-hidden="true">{needs}</span>}
      </span>
    </button>
  )
}

export default function SurveyAutomationDashboard({ cohortId }) {
  // Presentational rollup only: survey key -> its reported summary counts.
  const [counts, setCounts] = useState({})
  // Explicit user selection; null means "use the priority default". Once set, it is never
  // auto-overridden by a later count refresh.
  // DETERMINISTIC SELECTION. Root cause of the old bug: DEFAULT_WORKFLOW_KEY was hardcoded to
  // caseyFinkPostRotation, unrelated to display order, so Review and Release always opened on the
  // third workflow. Precedence is now URL, then the last workflow this user opened, then the first
  // in displayed order. Counts remain not an input, preserving the 1B regression fix.
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const urlKey = searchParams.get('workflow')
  // EVAL-RR-UNIFIED-NAV-1: selection runs over the nav-key SUPERSET (the four survey
  // workflows plus Release to Unit Leaders), same precedence, same storage key, same
  // ?workflow= URL param - one deep-link mechanism for the whole navigator. Existing
  // survey deep links and stored selections keep working unchanged.
  const [selected, setSelected] = useState(() => {
    let storedKey = null
    try { storedKey = localStorage.getItem(LAST_WORKFLOW_STORAGE_KEY) } catch { /* storage unavailable */ }
    return resolveInitialNavKey({ urlKey, storedKey, order: WORKFLOWS.map(w => w.key) })
  })

  const selectWorkflow = useCallback((key) => {
    if (!isReviewReleaseNavKey(key)) return
    setSelected(key)
    try { localStorage.setItem(LAST_WORKFLOW_STORAGE_KEY, key) } catch { /* storage unavailable */ }
    // replace, so switching workflows does not fill the back stack with every click
    setSearchParams(prev => { const n = new URLSearchParams(prev); n.set('workflow', key); return n }, { replace: true })
  }, [setSearchParams])
  const [previewKey, setPreviewKey] = useState(null)
  // The SURVEY-definition preview, distinct from the email preview above.
  const [surveyPreviewKey, setSurveyPreviewKey] = useState(null)
  // "Send test to me" state. This is deliberately NOT called Release: it creates no
  // assignment, no token, and no response, and it can only send to the caller.
  const [testState, setTestState] = useState({ busy: false, note: '', url: '' })

  const sendTestToMe = useCallback(async (workflowKey) => {
    setTestState({ busy: true, note: '', url: '' })
    try {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      const res = await fetch('/api/evaluation-send-survey-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ workflow_key: workflowKey }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setTestState({ busy: false, url: '', note: res.status === 403
          ? 'Only an Owner or Admin can send a test.'
          : 'The test could not be sent.' })
        return
      }
      // SAME-ORIGIN ONLY. The emailed link is rewritten by the organization's URL isolation,
      // which is a security control and not something to work around. The in-app path is
      // therefore primary: reduce the returned URL to a RELATIVE route and navigate inside the
      // SPA. The email remains a secondary convenience.
      let path = ''
      try {
        const u = new URL(body?.test_url || '', window.location.origin)
        if (u.origin === window.location.origin) path = `${u.pathname}${u.search}`
      } catch { path = '' }
      setTestState({
        busy: false,
        url: path,
        note: body?.email_sent
          ? 'Test ready. Use Open test now. A TEST email was also sent as a backup, though your organization may isolate that link. Nothing was released.'
          : 'Test ready. Use Open test now. Nothing was released.',
      })
    } catch {
      setTestState({ busy: false, url: '', note: 'The test could not be sent.' })
    }
  }, [])

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
  // A valid nav key in the URL always wins, derived at render time so browser back and
  // forward move the selection without an effect. `effective` is the navigator selection
  // (a survey workflow OR the Unit Leader Release console); the survey-only resolver
  // semantics are preserved inside resolveEffectiveNavKey (unknown keys still fall back
  // to the first survey workflow).
  const current = isReviewReleaseNavKey(urlKey) ? urlKey : selected
  const effective = resolveEffectiveNavKey(current)
  const unitReleaseSelected = effective === UNIT_LEADER_RELEASE_KEY

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

      {/* Narrow-screen selector (replaces the left nav below 900px); mirrors the two
          navigator sections with optgroups. */}
      <select
        className="rr-nav-mobile"
        aria-label="Select Review and Release tool"
        value={effective}
        onChange={(e) => selectWorkflow(e.target.value)}
        style={{
          marginBottom: 14, padding: '9px 10px', borderRadius: 8, border: '1px solid #e5e7eb',
          fontSize: 13, fontFamily: F, color: '#191919', background: '#fff',
        }}
      >
        <optgroup label="Survey Workflows">
          {WORKFLOWS.map(w => (
            <option key={w.key} value={w.key}>
              {w.label}{w.badge ? ` (${w.badge})` : ''} - {statusLine(w, counts[w.key])}
            </option>
          ))}
        </optgroup>
        <optgroup label="Unit Leader Release">
          <option value={UNIT_LEADER_RELEASE_KEY}>Release to Unit Leaders</option>
        </optgroup>
      </select>

      <div className="rr-layout">
        {/* Left navigator (desktop): Survey Workflows, then Unit Leader Release. */}
        <nav className="rr-nav" aria-label="Review and Release tools">
          <p className="rr-nav-group">Survey Workflows</p>
          {WORKFLOWS.map(w => (
            <WorkflowNavRow
              key={w.key}
              w={w}
              counts={counts[w.key]}
              selected={effective === w.key}
              onSelect={() => selectWorkflow(w.key)}
            />
          ))}
          <p className="rr-nav-group">Unit Leader Release</p>
          {/* EVAL-RR-RAIL-C-1: same compact single-line row; the console self-describes in the
              workspace, so the rail carries no subtitle or prose. */}
          <button
            type="button"
            className={`rr-row-select${unitReleaseSelected ? ' sel' : ''}`}
            aria-current={unitReleaseSelected ? 'true' : undefined}
            onClick={() => selectWorkflow(UNIT_LEADER_RELEASE_KEY)}
          >
            <span className="rr-row-label">Release to Unit Leaders</span>
          </button>
        </nav>

        {/* Selected workspace. A survey workflow shows the survey tools + its panel; Release
            to Unit Leaders shows the release console INSIDE the same shell. The survey surface
            is display-toggled (never unmounted) so every panel keeps detecting and reporting
            its counts to the nav rows and the banner while the console is open. */}
        <section id={WORKSPACE_ID} className="rr-workspace">
          {unitReleaseSelected && <UnitEvaluationReleaseConsole embedded />}
          <div style={{ display: unitReleaseSelected ? 'none' : 'block' }}>
          {/* SURVEY TOOLS: the single home for the three read-only and test actions. Preview
              Survey carries the strongest weight as the most-used action; Send test to me is
              styled distinctly so it can never be mistaken for a production Release control. */}
          <div className="rr-tools" role="group" aria-label="Survey tools">
            <span className="rr-tools-label">Survey tools</span>
            <button
              type="button"
              className="rr-tool-primary"
              onClick={() => setSurveyPreviewKey(effective)}
              aria-label="Preview the survey questions for the selected workflow"
            >
              <Eye size={15} aria-hidden="true" /> Preview Survey
            </button>
            <button
              type="button"
              className="rr-tool-secondary"
              onClick={() => setPreviewKey(effective)}
              aria-label="Preview the invitation email for the selected workflow"
            >
              <Mail size={14} aria-hidden="true" /> Preview Email
            </button>
            <button
              type="button"
              className="rr-tool-test"
              disabled={testState.busy}
              onClick={() => sendTestToMe(effective)}
              aria-label="Send a test of the selected survey to my own email"
            >
              <Send size={14} aria-hidden="true" /> {testState.busy ? 'Preparing…' : 'Send test to me'}
            </button>
          </div>
          {testState.note && (
            <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#f7f9ff', border: '1px solid #d7ddf5', borderRadius: 10, padding: '9px 12px', marginBottom: 10, fontSize: 12.5, color: '#191919' }}>
              <span>{testState.note}</span>
              {testState.url && (
                <>
                  <button type="button" className="rr-tool-primary" onClick={() => navigate(testState.url)}>
                    <ExternalLink size={14} aria-hidden="true" /> Open test now
                  </button>
                  <button
                    type="button"
                    className="rr-tool-secondary"
                    onClick={() => {
                      // Absolute but same-origin. It carries no token and still requires the
                      // signed-in Owner/Admin session to open.
                      try { navigator.clipboard?.writeText(`${window.location.origin}${testState.url}`) } catch { /* clipboard unavailable */ }
                    }}
                  >
                    Copy test link
                  </button>
                </>
              )}
            </div>
          )}
          <PreceptorAutomationPanel cohortId={cohortId} active={effective === 'preceptor'} onCounts={reportPreceptor} />
          <StudentEvalAutomationPanel cohortId={cohortId} active={effective === 'student'} onCounts={reportStudent} />
          <CaseyFinkPostRotationAutomationPanel cohortId={cohortId} active={effective === 'caseyFinkPostRotation'} onCounts={reportCaseyFink} />
          <PostRotationAutomationPanel cohortId={cohortId} active={effective === 'postRotation'} onCounts={reportPostRotation} />
          </div>
        </section>
      </div>

      {/* Shared read-only email preview (safe synthetic data, no send/token/DB). */}
      {/* Survey-definition preview: reads the live definition, writes nothing. */}
      {surveyPreviewKey && (
        <SurveyPreviewDrawer workflowKey={surveyPreviewKey} onClose={() => setSurveyPreviewKey(null)} />
      )}

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
