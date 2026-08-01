// EVAL-RR-UNIFIED-NAV-1: Release to Unit Leaders folded into the Review & Release
// navigator (Survey Workflows / Unit Leader Release), replacing the stacked surface.
//
// Functional tests drive the pure nav-key resolvers, proving the superset routing AND
// that the survey-only resolver semantics the release-routing harness depends on are
// byte-preserved. Source guards pin the two-section navigator, the workspace switch,
// the mounted-but-hidden survey panels, the embedded console with untouched release
// behavior, the single ?workflow deep-link mechanism, and the accessibility semantics.
//
// Run: node --test test/reviewReleaseUnifiedNav.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  WORKFLOW_KEYS, DEFAULT_WORKFLOW_KEY,
  isWorkflowKey, resolveEffectiveWorkflow, resolveInitialWorkflow,
  UNIT_LEADER_RELEASE_KEY, isReviewReleaseNavKey, resolveEffectiveNavKey, resolveInitialNavKey,
} from '../src/lib/evaluation/workflowSelection.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

const dash    = read('src/components/evaluation/SurveyAutomationDashboard.jsx')
const consoleSrc = read('src/components/evaluation/UnitEvaluationReleaseConsole.jsx')
const tab     = read('src/components/EvaluationTab.jsx')

// ── Nav-key routing (functional) ─────────────────────────────────────────────────────

test('the navigator key space is the four survey workflows plus Release to Unit Leaders', () => {
  for (const k of WORKFLOW_KEYS) assert.equal(isReviewReleaseNavKey(k), true, k)
  assert.equal(isReviewReleaseNavKey(UNIT_LEADER_RELEASE_KEY), true)
  assert.equal(UNIT_LEADER_RELEASE_KEY, 'unitLeaderRelease')
  for (const junk of ['nope', '', null, undefined, 'settings']) {
    assert.equal(isReviewReleaseNavKey(junk), false, String(junk))
  }
})

test('deep link, refresh, and remembered selection all restore the Unit Leader item', () => {
  // URL wins.
  assert.equal(resolveInitialNavKey({ urlKey: UNIT_LEADER_RELEASE_KEY, storedKey: 'student' }), UNIT_LEADER_RELEASE_KEY)
  // Stored selection restores it on arrival with no URL key.
  assert.equal(resolveInitialNavKey({ storedKey: UNIT_LEADER_RELEASE_KEY }), UNIT_LEADER_RELEASE_KEY)
  // Junk still falls back to the first survey workflow (never a blank workspace).
  assert.equal(resolveInitialNavKey({ urlKey: 'nope', storedKey: 'alsoNope' }), DEFAULT_WORKFLOW_KEY)
  // Effective selection passes the UL key through; junk falls back.
  assert.equal(resolveEffectiveNavKey(UNIT_LEADER_RELEASE_KEY), UNIT_LEADER_RELEASE_KEY)
  assert.equal(resolveEffectiveNavKey('garbage'), DEFAULT_WORKFLOW_KEY)
  assert.equal(resolveEffectiveNavKey('student'), 'student')
})

test('the survey-only resolvers are byte-preserved (release routing cannot regress)', () => {
  // The UL key is NOT a survey workflow: the survey resolvers treat it as unknown.
  assert.equal(isWorkflowKey(UNIT_LEADER_RELEASE_KEY), false)
  assert.equal(resolveEffectiveWorkflow(UNIT_LEADER_RELEASE_KEY), DEFAULT_WORKFLOW_KEY)
  assert.equal(resolveInitialWorkflow({ urlKey: UNIT_LEADER_RELEASE_KEY }), DEFAULT_WORKFLOW_KEY)
  // And the survey semantics the harness pins are untouched.
  assert.equal(resolveEffectiveWorkflow('caseyFinkPostRotation'), 'caseyFinkPostRotation')
  assert.equal(resolveEffectiveWorkflow(null), DEFAULT_WORKFLOW_KEY)
})

// ── The two-section navigator ────────────────────────────────────────────────────────

test('the left rail has both sections with the Settings-style group labels', () => {
  assert.match(dash, /<p className="rr-nav-group">Survey Workflows<\/p>/)
  assert.match(dash, /<p className="rr-nav-group">Unit Leader Release<\/p>/)
  // The UL row is a real navigator row with the same selected treatment and semantics.
  assert.match(dash, /className=\{`rr-row-select\$\{unitReleaseSelected \? ' sel' : ''\}`\}/)
  assert.match(dash, /aria-current=\{unitReleaseSelected \? 'true' : undefined\}/)
  assert.match(dash, /Release to Unit Leaders/)
  // The mobile selector mirrors both sections.
  assert.match(dash, /<optgroup label="Survey Workflows">/)
  assert.match(dash, /<optgroup label="Unit Leader Release">/)
  assert.match(dash, /<option value=\{UNIT_LEADER_RELEASE_KEY\}>Release to Unit Leaders<\/option>/)
})

test('one deep-link mechanism: the same ?workflow param, replace semantics preserved', () => {
  assert.match(dash, /n\.set\('workflow', key\)/)
  assert.match(dash, /\{ replace: true \}/)
  assert.match(dash, /const current = isReviewReleaseNavKey\(urlKey\) \? urlKey : selected/)
  assert.match(dash, /resolveInitialNavKey\(\{ urlKey, storedKey, order: WORKFLOWS\.map\(w => w\.key\) \}\)/)
  // No second router or parallel navigation system.
  assert.match(dash, /import \{ useNavigate, useSearchParams \} from 'react-router-dom'/)
  assert.doesNotMatch(dash, /createBrowserRouter|BrowserRouter|wouter|Route |<Routes/)
})

// ── The workspace switch ─────────────────────────────────────────────────────────────

test('selecting Unit Leader Release swaps the workspace; survey panels stay mounted', () => {
  assert.match(dash, /\{unitReleaseSelected && <UnitEvaluationReleaseConsole embedded \/>\}/)
  // The survey surface is display-toggled, never unmounted, so detection keeps
  // reporting counts to the nav rows and banner while the console is open.
  assert.match(dash, /<div style=\{\{ display: unitReleaseSelected \? 'none' : 'block' \}\}>/)
  for (const panel of ['PreceptorAutomationPanel', 'StudentEvalAutomationPanel',
    'CaseyFinkPostRotationAutomationPanel', 'PostRotationAutomationPanel']) {
    assert.match(dash, new RegExp(`<${panel}[^>]*onCounts=`), `${panel} keeps its onCounts wiring`)
  }
  // The one shared workspace shell (no card-inside-card duplication).
  assert.match(dash, /<section id=\{WORKSPACE_ID\} className="rr-workspace">/)
})

test('EvaluationTab no longer stacks the console above the dashboard', () => {
  assert.doesNotMatch(tab, /<UnitEvaluationReleaseConsole/)
  assert.doesNotMatch(tab, /import UnitEvaluationReleaseConsole/)
  // Top-level Evaluation tabs unchanged: Responses + Review & Release, same gate.
  assert.match(tab, /Responses<\/button>/)
  assert.match(tab, /Review &amp; Release<\/button>/)
  assert.match(tab, /activeSubTab === 'automation' && \(isOwner \|\| isAdmin\) && \(\s*\n\s*<SurveyAutomationDashboard cohortId=\{cohortId\} \/>/)
})

// ── The console is unchanged except its container ────────────────────────────────────

test('embedded only removes the page-level padding; every release behavior survives', () => {
  assert.match(consoleSrc, /UnitEvaluationReleaseConsole\(\{ embedded = false \}\)/)
  assert.match(consoleSrc, /padding: embedded \? 0 : '0 20px 24px'/)
  // Counts for all five release states.
  assert.match(consoleSrc, /const RELEASE_STATES = \['pending', 'moderated', 'released', 'revoked', 'ineligible'\]/)
  // All five filters.
  for (const f of ['Instrument filter', 'Unit filter', 'Timepoint filter', 'Release state filter', 'Moderation state filter']) {
    assert.match(consoleSrc, new RegExp(`aria-label="${f}"`), f)
  }
  // Moderation/release/revoke actions and their confirm path.
  assert.match(consoleSrc, /availableActions, rowIsReadOnly, ACTION_API, ACTION_STATUS_MESSAGE/)
  assert.match(consoleSrc, /postReleaseAction\(\{ action: meta\.action, responseId: row\.response_id, decision: meta\.decision \}\)/)
  // Legacy read-only rows.
  assert.match(consoleSrc, /Read-only\{r\.snapshot_source && r\.snapshot_source !== 'submission_trigger' \? ' \(legacy\)' : ''\}/)
  // Eligibility/timing copy (7-day rule) still stated; single-response non-anonymity kept.
  assert.match(consoleSrc, /rotation ends plus 7 days/)
  assert.match(consoleSrc, /not anonymous/i)
  // The queue read is untouched.
  assert.match(consoleSrc, /getReviewQueue\(\{/)
})

// ── EVAL-RR-RAIL-C-1: the Owner-approved Settings-style compact rail ─────────────────

test('the rail is one 232px Settings-style card of compact single-line rows', () => {
  assert.match(dash, /grid-template-columns:232px minmax\(0, 1fr\)/)
  // One quiet card: the rail itself carries the card chrome; rows carry none.
  assert.match(dash, /\.rr-nav \{[\s\S]*?background:#fff; border:1px solid #e8e4dc; border-radius:14px; padding:10px;/)
  assert.match(dash, /\.rr-row-select \{[\s\S]*?background:transparent; border:none; border-radius:9px;/)
  // Sticky behavior preserved on the card.
  assert.match(dash, /\.rr-nav \{[\s\S]*?position:sticky; top:var\(--app-chrome-height\);/)
  // Sections separated by a hairline, Settings-style.
  assert.match(dash, /\.rr-nav \.rr-nav-group:not\(:first-child\) \{ margin-top:8px; border-top:1px solid #f0ede6;/)
})

test('selected state is the filled navy row with white text', () => {
  assert.match(dash, /\.rr-row-select\.sel \{ background:\$\{NAVY\}; \}/)
  assert.match(dash, /\.rr-row-select\.sel \.rr-row-label \{ color:#fff; \}/)
  // The old card-selected treatment (tint + inset accent bar) is gone.
  assert.doesNotMatch(dash, /inset 3px 0 0 0/)
})

test('status compresses to chips and the gate dot; recipient subtitles are gone from the rail', () => {
  // Chips derive from the SAME panel-reported counts as before.
  assert.match(dash, /const ready = counts\?\.due_sendable \|\| 0/)
  assert.match(dash, /const needs = counts\?\.due_unsendable \|\| 0/)
  assert.match(dash, /\{ready > 0 && <span className="rr-chip" title=\{`\$\{ready\} ready to release`\}/)
  assert.match(dash, /\{needs > 0 && <span className="rr-chip rr-chip-attn" title=\{`\$\{needs\} needs attention`\}/)
  assert.match(dash, /\{w\.badge && <span className="rr-gate-dot" title=\{w\.badge\}/)
  assert.match(dash, /\{w\.paused && <span className="rr-chip rr-chip-paused"/)
  // Chips invert on the navy selected row.
  assert.match(dash, /\.rr-row-select\.sel \.rr-chip \{ background:rgba\(255,255,255,0\.22\); color:#fff;/)
  // No recipient subtitle or status prose inside desktop rows (w.recipient only feeds
  // the email preview title metadata; statusLine survives ONLY in the mobile select).
  assert.doesNotMatch(dash, /\{w\.recipient\}/)
  const desktopRow = dash.slice(dash.indexOf('function WorkflowNavRow'), dash.indexOf('export default function'))
  assert.doesNotMatch(desktopRow, /statusLine\(/)
  assert.match(dash, /- \{statusLine\(w, counts\[w\.key\]\)\}/, 'mobile select keeps the spelled-out status')
  // The full sentence survives for screen readers on the row itself.
  assert.match(dash, /aria-label=\{srBits\.join\(', '\)\}/)
})

// ── Accessibility ────────────────────────────────────────────────────────────────────

test('keyboard and active-state semantics: native buttons, aria-current, visible focus', () => {
  assert.match(dash, /aria-label="Review and Release tools"/)
  assert.match(dash, /\.rr-row-select:focus-visible \{ outline:3px solid #93c5fd; outline-offset:2px; \}/)
  // Rows are native <button type="button"> (Enter/Space work without extra handlers).
  const navRegion = dash.slice(dash.indexOf('aria-label="Review and Release tools"'), dash.indexOf('</nav>'))
  assert.doesNotMatch(navRegion, /<div[^>]*onClick/)
})

test('no em dash in the code this pass wrote', () => {
  // The console keeps its pre-existing em dashes (empty-cell glyphs and one prose dash
  // that predate this pass); only the lines this pass ADDED are swept.
  assert.doesNotMatch(dash, /—/)
  assert.doesNotMatch(read('src/lib/evaluation/workflowSelection.js'), /—/)
  const embeddedBlock = consoleSrc.slice(consoleSrc.indexOf('EVAL-RR-UNIFIED-NAV-1'), consoleSrc.indexOf('const [filters'))
  assert.doesNotMatch(embeddedBlock, /—/)
})
