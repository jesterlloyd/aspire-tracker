// FEEDBACK-MENU-1 (Owner, 2026-10-14): Send Feedback is no longer a floating button. A student
// mistook it for Messages; it now opens from Settings > General (staff) and the profile menu
// (portals). Run: node --test test/feedbackMenu.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { openFeedback, onOpenFeedback } from '../src/lib/feedbackBus.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('openFeedback reaches every mounted panel and nothing after it unmounts', () => {
  let opened = 0
  openFeedback() // nothing mounted: a no-op, never a throw
  const off = onOpenFeedback(() => { opened += 1 })
  openFeedback()
  assert.equal(opened, 1)
  off()
  openFeedback()
  assert.equal(opened, 1)
})

test('no surface renders a Feedback launcher', () => {
  assert.match(read('src/staff/StaffApp.jsx'), /<FeedbackPanel[\s\S]*?\n\s+hidden\n\s+open=\{feedbackOpen\}/)
  assert.match(read('src/portal/PortalUtilityLayer.jsx'), /<PortalFeedbackPanel[\s\S]*?\n\s+hidden\n/)
  // An Owner/Admin portal preview draws its own panel; it has no launcher either.
  const portalApp = read('src/portal/PortalApp.jsx')
  assert.match(portalApp, /<FeedbackPanel[\s\S]*?\n\s+hidden\n\s+open=\{activeUtility === 'feedback'\}/)
  assert.match(portalApp, /onOpenFeedback\(\(\) => setActiveUtility\('feedback'\)\)/)
  // A panel with no launcher is centred, not parked over the corner where the button was.
  assert.match(read('src/components/shared/SharedFeedbackPanel.jsx'), /const placement = hidden \? 'center' : side/)
  assert.match(read('src/index.css'), /\.shared-feedback-panel\.shared-feedback-panel-center \{/)
})

test('Settings > General has a Send Feedback row that opens the panel, after Tours & Help', () => {
  const shell = read('src/components/settings/SettingsShell.jsx')
  assert.match(shell, /\{ key: 'feedback', label: 'Send Feedback', [^}]*after: 'tours', run: openFeedback \}/)
  assert.match(shell, /import \{ openFeedback \} from '\.\.\/\.\.\/lib\/feedbackBus'/)
})

test('the portal profile menu offers Send Feedback only where a panel can open', () => {
  const shell = read('src/portal/PortalShell.jsx')
  assert.match(shell, /const feedbackAvailable = useFeedbackAvailable\(\)/)
  assert.match(shell, /feedbackAvailable && \([\s\S]{0,200}onClick=\{\(\) => \{ close\(\); openFeedback\(\) \}\}/)
  const layer = read('src/portal/PortalUtilityLayer.jsx')
  assert.match(layer, /const feedbackOn = enabled && feedbackEnabled/)
  assert.match(layer, /feedbackOn \? onOpenFeedback\(/)
})
