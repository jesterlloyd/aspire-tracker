// Information-architecture guards for the Settings rail.
//
// History: SETTINGS-UNIFIED-DESIGN-1 moved Appearance, Email Signature, Tours & Help and
// About into a General hub, which gave Settings three panes. APPEARANCE-STYLE-1
// (2026-09-21, the Owner's settings-appearance-mockup) returned it to two: a grouped rail
// (You, Workspace, Diagnostics) and the page. These tests hold the new shape: the rail
// is exactly the intended destinations per role, in the mockup's groups and order; every
// page keeps its role gate and its deep link; /settings/general is retired and falls to
// Appearance; the shell renders every page itself; the pages that had no heading of
// their own get one; and the protections that outlived General (AboutPanel's content,
// the SurfaceCard canon, no width caps, one heading spec) still hold.
//
// Run: node --test test/settingsUnifiedIa.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  SETTINGS_SECTIONS, SETTINGS_GROUPS, DEFAULT_SETTINGS_PATH, visibleSections, routableSections,
} from '../src/components/settings/settingsSections.js'
import { STAFF_SETTINGS_PATH } from '../src/lib/portalLinks.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const shell = read('src/components/settings/SettingsShell.jsx')
const shellCss = read('src/components/settings/settingsShell.css')

const STAFF = { isOwner: false, isAdmin: false }
const ADMIN = { isOwner: false, isAdmin: true }
const OWNER = { isOwner: true, isAdmin: true }
const ROLE_COMBOS = [STAFF, ADMIN, OWNER]
const rail = (r) => visibleSections(r).map(s => s.key)

test('the rail is the mockup\'s nine destinations, in its order, for the Owner', () => {
  assert.deepEqual(rail(OWNER), [
    'appearance', 'signature', 'tours',
    'accounts', 'communityBenefit', 'keith',
    'demoMode', 'preceptorParity', 'about',
  ])
})

test('every role keeps the gates it had; nothing is shown that was hidden before', () => {
  assert.deepEqual(rail(ADMIN), ['appearance', 'signature', 'tours', 'accounts', 'communityBenefit', 'keith', 'about'])
  assert.deepEqual(rail(STAFF), ['appearance', 'signature', 'tours', 'about'])
  for (const r of ROLE_COMBOS) {
    const keys = rail(r)
    assert.ok(!keys.includes('general'), 'General is retired')
    assert.ok(!keys.includes('knowledge'), 'Knowledge Center lives under Keith, not in the rail')
    assert.ok(!keys.includes('keithSkills') && !keys.includes('keithKnowledge') && !keys.includes('keithUsage'),
      "Keith's workspaces are reached through Keith, never as their own rail entries")
    assert.ok(!keys.includes('templates') && !keys.includes('audit'), 'no unimplemented scaffold leaks into the rail')
  }
})

test('groups are You, Workspace, Diagnostics, contiguous, with the mockup\'s second lines', () => {
  assert.deepEqual(SETTINGS_GROUPS, ['You', 'Workspace', 'Diagnostics'])
  const groupOf = Object.fromEntries(SETTINGS_SECTIONS.map(s => [s.key, s.group]))
  for (const k of ['appearance', 'signature', 'tours']) assert.equal(groupOf[k], 'You')
  for (const k of ['accounts', 'communityBenefit', 'keith']) assert.equal(groupOf[k], 'Workspace')
  for (const k of ['demoMode', 'preceptorParity', 'about']) assert.equal(groupOf[k], 'Diagnostics')
  // Contiguous in the registry, so the rail never repeats a group label.
  const seq = visibleSections(OWNER).map(s => s.group).filter((g, i, a) => g !== a[i - 1])
  assert.deepEqual(seq, SETTINGS_GROUPS)
  const sub = Object.fromEntries(SETTINGS_SECTIONS.map(s => [s.key, s.sub]))
  assert.equal(sub.appearance, 'Style and color mode')
  assert.equal(sub.signature, 'Your Connect signature')
  assert.equal(sub.tours, 'Replay the welcome tour')
  assert.equal(sub.about, 'Version and build')
})

test('labels stay Title Case (the canon), not the mockup\'s sentence case', () => {
  const label = Object.fromEntries(SETTINGS_SECTIONS.map(s => [s.key, s.label]))
  assert.equal(label.signature, 'Email Signature')
  assert.equal(label.tours, 'Tours & Help')
  assert.equal(label.accounts, 'Accounts & Access')
  assert.equal(label.demoMode, 'Demo Mode')
})

test('routableSections is a superset of the rail, and General is no longer a page', () => {
  for (const r of ROLE_COMBOS) {
    const routableKeys = routableSections(r).map(s => s.key)
    for (const key of rail(r)) assert.ok(routableKeys.includes(key), `rail key ${key} must also be routable`)
    for (const key of ['appearance', 'signature', 'tours', 'about']) {
      assert.ok(routableKeys.includes(key), `${key} must stay a deep link for ${JSON.stringify(r)}`)
    }
    assert.ok(!routableKeys.includes('general'))
  }
  assert.equal(SETTINGS_SECTIONS.find(s => s.key === 'general'), undefined)
})

test('the about section is registered correctly', () => {
  const about = SETTINGS_SECTIONS.find(s => s.key === 'about')
  assert.equal(about.path, '/settings/about')
  assert.equal(about.group, 'Diagnostics')
  assert.equal(about.implemented, true)
  assert.notEqual(about.inRail, false, 'About is a rail destination again')
  assert.equal(about.visible(STAFF), true, 'About is visible to everyone')
})

test('SettingsShell: normalization falls to Appearance, and it renders every page itself', () => {
  assert.equal(DEFAULT_SETTINGS_PATH, '/settings/appearance')
  assert.match(shell, /const routable = routableSections\(roleFlags\)/)
  assert.match(shell, /const knownPaths = routable\.map/)
  assert.match(shell, /const matched = routable\.find/)
  assert.match(shell, /path === '\/settings' \|\| \(path\.startsWith\('\/settings'\) && !knownPaths\.includes\(path\)\)/)
  assert.match(shell, /navigate\(DEFAULT_SETTINGS_PATH, \{ replace: true \}\)/)
  assert.doesNotMatch(shell, /settings\/general'/, 'nothing routes to the retired hub')

  assert.equal(existsSync(join(here, '..', 'src/components/settings/GeneralPanel.jsx')), false, 'GeneralPanel is deleted')
  assert.doesNotMatch(shell, /GeneralPanel|NON_RAIL_SUBKEYS/)
  for (const [key, panel] of [
    ['appearance', '<AppearancePanel />'], ['signature', '<SignaturePanel />'],
    ['tours', '<ToursHelpPanel onRestartTour={onRestartTour} />'], ['about', '<AboutPanel />'],
    ['accounts', '<AccountsAccessPanel />'], ['communityBenefit', '<CommunityBenefitPanel />'],
    ['preceptorParity', '<PreceptorParityPanel />'], ['demoMode', '<DemoModePanel />'],
  ]) {
    assert.ok(shell.includes(`currentKey === '${key}'`) && shell.includes(panel), `${key} renders ${panel}`)
  }
  assert.match(shell, /const KEITH_SUBKEYS = \{ keithSkills: 'skills', keithKnowledge: 'knowledge', keithUsage: 'usage' \}/)
  assert.match(shell, /active = s\.key === railActiveKey/)
})

test('the pages that brought no heading get one from the shell, on the shared spec', () => {
  assert.match(shell, /const TITLED_BY_SHELL = \['signature', 'tours', 'about'\]/)
  assert.match(shell, /\{shellTitle && <h2 style=\{SETTINGS_HEADING_STYLE\}>\{shellTitle\}<\/h2>\}/)
  // Appearance titles itself (with its description line), on the same spec.
  assert.match(read('src/components/settings/AppearancePanel.jsx'), /style=\{\{ \.\.\.SETTINGS_HEADING_STYLE, margin: 0 \}\}>Appearance<\/h2>/)
  assert.match(read('src/components/settings/settingsSections.js'), /export const SETTINGS_HEADING_STYLE = \{/)
  assert.match(read('src/components/settings/AccountsDirectory.jsx'), /\.\.\.SETTINGS_HEADING_STYLE/)
  assert.match(read('src/components/settings/PreceptorParityPanel.jsx'), /\.\.\.SETTINGS_HEADING_STYLE/)
  assert.match(read('src/components/settings/SettingsPageHeader.jsx'), /\.\.\.SETTINGS_HEADING_STYLE/)
})

test('the rail: grouped, iconed, aria-current, a white surface and a navy inset bar', () => {
  assert.match(shell, /<nav className="settings-nav" aria-label="Settings sections">/)
  assert.match(shell, /role="group" aria-labelledby=\{`settings-group-\$\{group\}`\}/)
  assert.match(shell, /aria-current=\{active \? 'page' : undefined\}/)
  assert.match(shell, /<span className="settings-nav-ic" aria-hidden="true">/)
  assert.match(shell, /\{s\.sub && <small>\{s\.sub\}<\/small>\}/)
  assert.match(shellCss, /\.settings-nav-item\[aria-current="page"\],\s*\.settings-nav-item\[aria-current="page"\]:hover \{[^}]*background: var\(--color-bg-surface[^}]*inset 3px 0 0 var\(--color-accent-primary/)
  assert.match(shellCss, /\.settings-nav-item:focus-visible \{\s*outline: 3px solid var\(--color-accent-primary[^;]*;\s*outline-offset: 2px;/)
})

test('two panes: a 240px rail beside the page, one column below 860px', () => {
  assert.match(shellCss, /\.settings-grid \{\s*display: grid;\s*grid-template-columns: 240px minmax\(0, 1fr\);/)
  assert.match(shellCss, /@media \(max-width: 860px\) \{\s*\.settings-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/)
})

test('every section uses the full canonical workspace width (no caps)', () => {
  assert.doesNotMatch(shell, /maxWidth: currentKey/)
  assert.doesNotMatch(shell, /maxWidth: (1040|720)/)
  assert.doesNotMatch(shellCss, /max-width: (1040|720)px/)
})

test('the back breadcrumb sits at the workspace top offset, inside the canonical 20px inset', () => {
  assert.match(shellCss, /\.settings-shell \{\s*padding: 0 20px 40px;/)
  assert.match(shell, /<WorkspaceBackLink path=\{backPath\} label=\{backLabel\} \/>/)
})

test('AboutPanel source: owns the buildInfo-backed content and the copy button', () => {
  const about = read('src/components/settings/AboutPanel.jsx')
  assert.match(about, /import\s*\{\s*\n?\s*APP_NAME, APP_DESCRIPTION, CANONICAL_URL,/)
  assert.match(about, /BUILD_SHA, BUILD_ENV, environmentLabel, formatBuildTime,/)
  assert.match(about, /from '\.\.\/\.\.\/lib\/buildInfo'/)
  assert.match(about, /navigator\.clipboard\.writeText\(BUILD_SHA\)/)
  assert.match(about, /aria-label="About"/)
  assert.match(about, /<SurfaceCard padding="6px 18px 14px">/)
  for (const marker of ['BUILD_SHA', 'BUILD_ENV', 'CANONICAL_URL', 'APP_NAME', 'Copy build ID']) {
    assert.ok(about.includes(marker), `AboutPanel keeps ${marker}`)
  }
})

test('permissions: every gating function is unchanged', () => {
  const s = (k) => SETTINGS_SECTIONS.find(x => x.key === k)
  for (const k of ['accounts', 'communityBenefit', 'keith', 'knowledge', 'keithKnowledge', 'keithSkills', 'keithUsage']) {
    assert.equal(s(k).visible({ isAdmin: true }), true, k)
    assert.equal(s(k).visible({ isAdmin: false }), false, k)
  }
  for (const k of ['demoMode', 'preceptorParity']) {
    assert.equal(s(k).visible({ isOwner: true }), true, k)
    assert.equal(s(k).visible({ isOwner: false }), false, k)
  }
  for (const k of ['appearance', 'signature', 'tours', 'about']) assert.equal(s(k).visible(STAFF), true, k)
  assert.equal(s('knowledge').inRail, false)
})

test('deep-link consumers: the user menu and the portals open Appearance; Interviewers still opens Accounts', () => {
  assert.equal(STAFF_SETTINGS_PATH, '/settings/appearance')
  assert.match(read('src/components/UserMenu.jsx'), /navigate\(STAFF_SETTINGS_PATH\)/)
  assert.match(read('src/components/InterviewersModal.jsx'), /navigate\('\/settings\/accounts'\)/)
})

test('generic subtitles are gone; operational guidance survives inside content', () => {
  assert.doesNotMatch(shell, /Manage your ASPIRE Intelligence workspace, preferences, access, and resources\./)
  assert.doesNotMatch(read('src/components/settings/AppearancePanel.jsx'), /Control how ASPIRE Intelligence looks/)
  assert.doesNotMatch(read('src/components/settings/ToursHelpPanel.jsx'), /Replay the guided tour or find your way/)
  const signature = read('src/components/settings/SignaturePanel.jsx')
  assert.match(signature, /manual ASPIRE Connect<\/strong> emails only/)
  assert.match(signature, /<SurfaceCard padding=\{18\}>[\s\S]{0,400}manual ASPIRE Connect/)
  assert.match(read('src/components/settings/PreceptorParityPanel.jsx'), /by preceptor identity \(ID\)/)
})

test('canonical SurfaceCard replaces the custom bordered containers', () => {
  for (const f of ['AboutPanel', 'AppearancePanel', 'SignaturePanel', 'ToursHelpPanel']) {
    const src = read(`src/components/settings/${f}.jsx`)
    assert.match(src, /import SurfaceCard from '\.\.\/ui\/SurfaceCard'/, `${f} imports SurfaceCard`)
    assert.doesNotMatch(src, /border: '1px solid var\(--color-border-default[\s\S]{0,80}borderRadius: 12/, `${f} has no custom bordered card`)
  }
  assert.doesNotMatch(read('src/components/settings/ToursHelpPanel.jsx'), /const cardStyle/)
})
