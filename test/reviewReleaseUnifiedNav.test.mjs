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
const queue   = read('src/components/evaluation/ReviewReleaseQueue.jsx')
// REVIEW-RELEASE-2; the rail's own rules moved to the shared selection canon
// (src/styles/selectionRail.css, SETTINGS-HIERARCHY-1), which Settings wears too.
const css     = read('src/components/evaluation/reviewReleaseClipboard.css') + '\n' + read('src/styles/selectionRail.css')
const tab     = read('src/components/EvaluationTab.jsx')

// ── Nav-key routing (functional) ─────────────────────────────────────────────────────

test('the navigator key space is the five survey workflows plus Release to Unit Leaders', () => {
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

test('the left rail has both sections, grouped as the brief names them', () => {
  // REVIEW-RELEASE-1 (section 5): Survey workflows (1 to 5) and Unit leader release (6),
  // every row the same navigator row, driven by the catalog's `group`.
  assert.match(dash, /<p className="rr-nav-group">Survey workflows<\/p>/)
  assert.match(dash, /<p className="rr-nav-group">Unit leader release<\/p>/)
  assert.match(dash, /WORKFLOWS\.filter\(w => w\.group === 'survey'\)\.map\(w => \(/)
  assert.match(dash, /WORKFLOWS\.filter\(w => w\.group === 'unitLeader'\)\.map\(w => \(/)
  // The UL row is a real navigator row with the same selected treatment and semantics.
  assert.match(dash, /className=\{`rr-row-select\$\{selected \? ' sel' : ''\}`\}/)
  assert.match(dash, /aria-current=\{selected \? 'true' : undefined\}/)
  assert.match(dash, /aria-pressed=\{selected\}/)
  // REVIEW-RELEASE-2 (brief, section 10): below 900px the rail itself stacks above the
  // board and loses its top margin. The narrow-screen <select> it replaced is gone.
  // SETTINGS-FIX-2: the layout stacks in the clipboard's sheet; the rail's own unpin lives
  // with the rail (selectionRail.css), AFTER its base rule, so no load order can undo it.
  assert.match(css, /@media \(max-width: 900px\) \{\s*\.rr-layout \{ grid-template-columns: 1fr; \}/)
  const railSheet = read('src/styles/selectionRail.css')
  assert.match(railSheet, /@media \(max-width: 900px\) \{\s*\.rr-nav \{ margin-top: 0; position: static; \}\s*\}/)
  assert.ok(railSheet.indexOf('@media (max-width: 900px)') > railSheet.indexOf('.rr-nav {'), 'the unpin comes after the rule it modifies')
  assert.doesNotMatch(dash, /rr-nav-mobile|<optgroup/)
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

test('every workflow, the Unit Leader release included, renders through the one queue', () => {
  // REVIEW-RELEASE-1: one queue component. Detection for every workflow runs whether or
  // not it is selected (two queries, one for the surveys and one for the UL release), so
  // the rail badges and the summary line always add up all six.
  assert.match(dash, /<ReviewReleaseQueue/)
  assert.match(dash, /queryKey: \['review_release_evidence', cohortId\]/)
  assert.match(dash, /queryKey: \['review_release_unit_leader'\]/)
  // HOME-1 (2026-09-24): the adapter block moved into reviewQueueBuild.js so the home page's
  // Needs you reads the same queues; the dashboard calls it and adapts nothing itself.
  assert.match(dash, /const queues = useMemo\(\(\) => buildQueues\(evidence\.data, ulQueue\.data\), \[evidence\.data, ulQueue\.data\]\)/)
  const build = read('src/lib/evaluation/reviewQueueBuild.js')
  assert.match(build, /out\.unitLeaderRelease = adaptUnitLeaderRelease\(/)
  for (const adapter of ['adaptCaseyFinkPreRotation', 'adaptPreceptor', 'adaptStudentFeedback', 'adaptCaseyFinkPostRotation', 'adaptAspireFeedback']) {
    assert.match(build, new RegExp(`out\\.\\w+ = ${adapter}\\(`), `${adapter} feeds the queues`)
  }
  // The UL release still acts through the same RPC action path as the console did.
  assert.match(dash, /postReleaseAction\(\{ action: meta\.action, responseId: item\.responseId, decision: meta\.decision \}\)/)
  // The one shared workspace shell (no card-inside-card duplication).
  // REVIEW-RELEASE-2: the workspace IS the board, and the clip is decorative.
  assert.match(dash, /<section id=\{WORKSPACE_ID\} className="rr-workspace rq-board">/)
  assert.match(dash, /<span className="rq-clip" aria-hidden="true"><i \/><i \/><\/span>/)
})

test('EvaluationTab renders the dashboard behind the same gate, and wires Track responses', () => {
  assert.doesNotMatch(tab, /<UnitEvaluationReleaseConsole/)
  assert.doesNotMatch(tab, /import UnitEvaluationReleaseConsole/)
  // Top-level Evaluation tabs unchanged: Responses + Review & Release, same gate.
  assert.match(tab, /Responses<\/button>/)
  assert.match(tab, /Review &amp; Release<\/button>/)
  assert.match(tab, /activeSubTab === 'automation' && \(isOwner \|\| isAdmin\) && \(\s*\n\s*<SurveyAutomationDashboard/)
  // Section 4: the Sent log links to the Responses tab filtered to that workflow.
  assert.match(tab, /onTrackResponses=\{\(survey\) => \{/)
  // RESPONSES-PACKET-1: the Responses tab is keyed by instrument slug, not display name.
  assert.match(tab, /setFilterInstrument\(slug\)/)
  assert.match(tab, /setActiveSubTab\('cohort'\)/)
})


// ── EVAL-RR-RAIL-C-1: the Owner-approved Settings-style compact rail ─────────────────

test('the rail is one Settings-style card at its own height, pinned while the board scrolls', () => {
  // REVIEW-RELEASE-1 (section 5) asked for the same height as the board and no sticky;
  // the Owner reversed both on 2026-09-19 from production: "when I scroll on the right,
  // the side panel on the left should stay showing" and its outline "should not be as
  // long as the clipboard". 270px because the six names are the Owner's full names.
  assert.match(css, /\.rr-layout \{ display: grid; grid-template-columns: 270px minmax\(0, 1fr\); gap: 20px; align-items: start; \}/)
  assert.match(css, /\.rr-nav \{[^}]*margin-top: 14px;[^}]*position: sticky; top: var\(--app-chrome-height, 0px\); align-self: start;[^}]*border: 0; border-radius: var\(--aspire-radius-card\);[^}]*box-shadow: var\(--aspire-shadow-card\);/)
  assert.match(css, /\.rq-board \{[^}]*margin-top: 14px;/)
  assert.match(css, /\.rr-row-select \{[^}]*border: 0;\s*border-radius: var\(--aspire-radius-control\);/)
  // Sections separated by a hairline, Settings-style.
  assert.match(css, /\.rr-nav \.rr-nav-group:not\(:first-child\) \{ margin-top: 6px; border-top: 1px solid var\(--aspire-rule\);/)
})

test('selected state is the filled navy row with white text', () => {
  assert.match(css, /\.rr-row-select\.sel, \.rr-row-select\.sel:hover \{ background: var\(--aspire-navy\); color: #fff; \}/)
  // The old card-selected treatment (tint + inset accent bar) is gone.
  assert.doesNotMatch(css, /inset 3px 0 0 0/)
  assert.doesNotMatch(dash, /inset 3px 0 0 0/)
})

test('a rail row is the name, "to <recipient>", and two count badges hidden at zero', () => {
  // REVIEW-RELEASE-1 (section 5): green badge = ready, amber badge = blocked, each hidden
  // when its count is 0. Counts come from the shared three-state shape, not from the old
  // panel summaries.
  assert.match(dash, /const ready = counts\?\.ready \|\| 0/)
  assert.match(dash, /const blocked = counts\?\.blocked \|\| 0/)
  assert.match(dash, /\{ready > 0 && <i className="r" title="Ready">\{ready\}<\/i>\}/)
  assert.match(dash, /\{blocked > 0 && <i className="b" title="Needs a fix">\{blocked\}<\/i>\}/)
  assert.match(dash, /<span className="rr-row-label">\{w\.label\}<small>to \{w\.to\}<\/small><\/span>/)
  // The full sentence survives for screen readers on the row itself.
  assert.match(dash, /aria-label=\{srBits\.join\(', '\)\}/)
  // The summary line adds up every workflow (section 5).
  assert.match(dash, /\{totals\.ready\}<\/b> ready to release/)
  assert.match(dash, /\{totals\.blocked\}<\/b> need a fix or a reminder/)
  assert.match(dash, /\{sentToday\}<\/b> sent today/)
  assert.match(dash, /sent today/)
  assert.match(dash, /across \{WORKFLOWS\.length\} workflows/)
})

// ── Accessibility ────────────────────────────────────────────────────────────────────

test('keyboard and active-state semantics: native buttons, aria-pressed, visible focus', () => {
  // Section 7: the rail is a group of buttons with aria-pressed; switching announces the
  // workflow name (the queue's heading changes and the summary line is a live region).
  assert.match(dash, /<nav className="rr-nav" aria-label="Survey workflows">/)
  assert.match(css, /\.rr-row-select:focus-visible \{ outline: 3px solid var\(--rr-navy\); outline-offset: 2px; \}/)
  const navRegion = dash.slice(dash.indexOf('aria-label="Survey workflows">'), dash.indexOf('</nav>'))
  assert.doesNotMatch(navRegion, /<div[^>]*onClick/)
  assert.match(queue, /<details className="rq-eligible"/)
  assert.match(queue, /aria-expanded=\{policyOpen\}/)
  assert.match(queue, /role="status"/)
})

test('no em dash in the code this pass wrote', () => {
  assert.doesNotMatch(dash, /—/)
  assert.doesNotMatch(read('src/lib/evaluation/workflowSelection.js'), /—/)
})
