// SETTINGS-KEITH-NESTED-1 made Keith a parent destination with three workspaces.
// SETTINGS-HIERARCHY-1 (Owner, 2026-09-21) settled how a parent shows them: the Apple
// System Settings pattern. /settings/keith is a LIST page of drill-in rows, a row opens
// its workspace in the same right pane under a "Keith" breadcrumb, and the rail keeps
// Keith selected. The master-detail middle pane, the 1280px compact picker and the
// second sticky nav are gone with KeithPanel.
//
// Navigation and information architecture only. No Keith behavior, skill state,
// permission, SQL, API or data-model change is in scope here, and several of
// these tests exist specifically to prove that.
//
// Run: node --test test/settingsKeithNested.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  SETTINGS_SECTIONS, LEGACY_SETTINGS_REDIRECTS, visibleSections, routableSections, childSections,
} from '../src/components/settings/settingsSections.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const shell = read('src/components/settings/SettingsShell.jsx')
const shellCss = read('src/components/settings/settingsShell.css')
const rail = read('src/styles/selectionRail.css')

const ADMIN = { isOwner: false, isAdmin: true }
const OWNER = { isOwner: true, isAdmin: true }
const STAFF = { isOwner: false, isAdmin: false }
const sectionFor = (key) => SETTINGS_SECTIONS.find(s => s.key === key)
const WORKSPACES = [
  ['keithKnowledge', '/settings/keith/knowledge', 'Knowledge Center', "Keith's governed knowledge and future Markdown vault"],
  ['keithSkills', '/settings/keith/skills', 'Skills', 'Governed capabilities, lifecycle, and usage'],
  ['keithUsage', '/settings/keith/usage', 'Usage & Cost', 'Keith activity, model usage, estimated spend, and operational health'],
]

// ── Route structure ──────────────────────────────────────────────────────────

test('Keith is a rail destination; its three workspaces are its drill-ins', () => {
  const keith = sectionFor('keith')
  assert.equal(keith.path, '/settings/keith')
  assert.equal(keith.group, 'Administration')
  assert.notEqual(keith.inRail, false, 'Keith is the top-level destination and stays in the rail')
  for (const [key, path, label, sub] of WORKSPACES) {
    const s = sectionFor(key)
    assert.equal(s.path, path)
    assert.equal(s.parent, 'keith')
    assert.equal(s.label, label)
    assert.equal(s.sub, sub, 'the supporting text is the approved copy')
    assert.equal(s.implemented, true)
    assert.equal(s.inRail, false, `${key} is reached through Keith, not from the rail`)
  }
})

test('/settings/keith is the Keith list page, not a redirect', () => {
  assert.doesNotMatch(shell, /path === '\/settings\/keith'\)/)
  assert.equal(LEGACY_SETTINGS_REDIRECTS['/settings/keith'], undefined)
  assert.match(shell, /const isListPage = currentKey === 'general' \|\| currentKey === 'keith'/)
  assert.match(shell, /<SettingsListPage section=\{current\} rows=\{childSections\(currentKey, roleFlags\)\} navigate=\{navigate\} \/>/)
})

test('the rows are alphabetical, in the registry, for Owner and Admin', () => {
  for (const flags of [OWNER, ADMIN]) {
    assert.deepEqual(childSections('keith', flags).map(s => s.key), WORKSPACES.map(w => w[0]))
  }
  assert.deepEqual(childSections('keith', STAFF), [])
})

test('the legacy Knowledge Center route redirects under Keith, before the unknown-path fallback', () => {
  assert.equal(LEGACY_SETTINGS_REDIRECTS['/settings/knowledge'], '/settings/keith/knowledge')
  assert.equal(sectionFor('knowledge'), undefined, 'it is a redirect now, not a page')
  const effect = shell.slice(shell.indexOf('useEffect(() => {'), shell.indexOf('}, [path])'))
  assert.ok(effect.indexOf('LEGACY_SETTINGS_REDIRECTS[path]') > -1)
  assert.ok(effect.indexOf('LEGACY_SETTINGS_REDIRECTS[path]') < effect.indexOf('!knownPaths.includes(path)'),
    'the legacy redirect must be evaluated before the unknown-path fallback')
  assert.match(effect, /navigate\(moved, \{ replace: true \}\)/)
})

test('all three workspace routes are directly reachable, not only through the list', () => {
  const paths = routableSections(ADMIN).map(s => s.path)
  for (const [, path] of WORKSPACES) assert.ok(paths.includes(path))
  assert.ok(paths.includes('/settings/keith'))
})

// ── Selection state ──────────────────────────────────────────────────────────

test('the rail keeps Keith selected on every Keith workspace, and the page gets a breadcrumb', () => {
  assert.match(shell, /const railActiveKey = current\.parent \|\| current\.key/)
  assert.match(shell, /const active = s\.key === activeKey/)
  assert.match(shell, /\{parent && <SettingsCrumb parent=\{parent\} here=\{current\} navigate=\{navigate\} \/>\}/)
  assert.match(shell, /<nav className="settings-crumb" aria-label="Breadcrumb">/)
  assert.match(shell, /<span className="settings-crumb-here" aria-current="page">\{here\.label\}<\/span>/)
})

// ── Access ───────────────────────────────────────────────────────────────────

test('Owner and Admin reach Keith and every workspace; other staff reach none', () => {
  for (const flags of [OWNER, ADMIN]) {
    const paths = routableSections(flags).map(s => s.path)
    for (const p of ['/settings/keith', ...WORKSPACES.map(w => w[1])]) {
      assert.ok(paths.includes(p), `${p} must be reachable`)
    }
    assert.ok(visibleSections(flags).some(s => s.key === 'keith'))
  }
  const staffPaths = routableSections(STAFF).map(s => s.path)
  for (const p of ['/settings/keith', ...WORKSPACES.map(w => w[1])]) {
    assert.ok(!staffPaths.includes(p), `${p} must not be reachable without admin`)
  }
  assert.ok(!visibleSections(STAFF).some(s => s.key === 'keith'))
})

test('an unauthorized deep link falls back to the default page rather than rendering Keith', () => {
  assert.match(shell, /const knownPaths = routable\.map\(s => s\.path\)/)
  assert.match(shell, /!knownPaths\.includes\(path\)/)
  assert.match(shell, /navigate\(DEFAULT_SETTINGS_PATH, \{ replace: true \}\)/)
})

// ── Functional preservation ──────────────────────────────────────────────────

test('a drill-in is titled with its row\'s name: Skills, not Keith', () => {
  const skills = read('src/components/settings/KeithSkillsPanel.jsx')
  assert.match(skills, /<SettingsPageHeader\s+title="Skills"/)
  assert.match(skills, /aria-labelledby="settings-keith-skills-heading"/)
  assert.match(read('src/components/settings/KnowledgeCenterPanel.jsx'), /<SettingsPageHeader\s+title="Knowledge Center"/)
  assert.match(read('src/components/settings/KeithUsagePanel.jsx'), /<SettingsPageHeader\s+title="Usage & Cost"/)
})

test('every workspace renders its own panel, unmodified, from the shell', () => {
  assert.equal(existsSync(join(here, '..', 'src/components/settings/KeithPanel.jsx')), false, 'KeithPanel is retired')
  assert.match(shell, /import KnowledgeCenterPanel from '\.\/KnowledgeCenterPanel'/)
  assert.match(shell, /import KeithSkillsPanel from '\.\/KeithSkillsPanel'/)
  assert.match(shell, /import KeithUsagePanel from '\.\/KeithUsagePanel'/)
  assert.match(shell, /currentKey === 'keithKnowledge' && <KnowledgeCenterPanel \/>/)
  assert.match(shell, /currentKey === 'keithSkills'    && <KeithSkillsPanel \/>/)
  assert.match(shell, /currentKey === 'keithUsage'     && <KeithUsagePanel \/>/)
})

test('this change touches navigation only: no API, permission or skill-state edit', () => {
  // The shell must not talk to the server or reason about skill lifecycle itself.
  assert.doesNotMatch(shell, /fetch\(|supabase|keith-skills-admin/i)
  // Panel role gating is unchanged and still lives in the panels themselves.
  assert.match(read('src/components/settings/KeithSkillsPanel.jsx'), /isAdmin/)
  assert.match(read('src/components/settings/KnowledgeCenterPanel.jsx'), /isAdmin/)
  // Visibility predicates for the Keith routes are the same isAdmin gate as before.
  for (const key of ['keith', 'keithSkills', 'keithKnowledge', 'keithUsage']) {
    assert.equal(sectionFor(key).visible({ isAdmin: true }), true)
    assert.equal(sectionFor(key).visible({ isAdmin: false }), false)
  }
})

// ── Skills table density refinement ─────────────────────────────────────────
// The eight-column table needed ~845px and never got it: at 1400px the container
// was 724px and at 1100px it was 700px, so "Failures (30d)" fell off the right
// edge, reachable only by discovering the inner scroll. Two column-level changes,
// no navigation change and no data loss.

test('the slug truncates with CSS, so the full value stays available', () => {
  const skills = read('src/components/settings/KeithSkillsPanel.jsx')
  // Strip the JSX comment block first: it explains the change by naming the old
  // value, and must not trip its own assertion.
  const slugCell = skills
    .slice(skills.indexOf("key: 'skill'"), skills.indexOf("key: 'status'"))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  assert.match(slugCell, /textOverflow: 'ellipsis'/)
  assert.match(slugCell, /whiteSpace: 'nowrap'/)
  assert.match(slugCell, /title=\{s\.slug \|\| undefined\}/, 'hover disclosure for sighted users')
  // CSS truncation keeps the whole slug in the DOM, so assistive tech, find-in-page
  // and copy still get it. A JS substring would have destroyed that.
  assert.match(slugCell, /\{s\.slug\}/)
  assert.doesNotMatch(slugCell, /\.slice\(|\.substring\(|truncate\(/)
  // The old value-splitting wrap is gone; it drove three-line rows.
  assert.doesNotMatch(slugCell, /wordBreak: 'break-all'/)
})

test('Invocations and Failures merge into one Activity column with both values', () => {
  const skills = read('src/components/settings/KeithSkillsPanel.jsx')
  assert.match(skills, /label: 'Activity \(30d\)'/)
  assert.doesNotMatch(skills, /label: 'Invocations \(30d\)'/)
  assert.doesNotMatch(skills, /label: 'Failures \(30d\)'/)

  const cell = skills.slice(skills.indexOf("key: 'activity'"), skills.lastIndexOf(']'))
  // Both numbers survive, and failures keep their red emphasis when nonzero.
  assert.match(cell, /const total = Number\(s\.stats\?\.total\) \|\| 0/)
  assert.match(cell, /const fails = failureCount\(s\.stats\)/)
  assert.match(cell, /fails > 0 \? \{ color: '#dc2626', fontWeight: 600 \}/)
  // The separator is decorative; the pair carries one spoken label instead.
  assert.match(cell, /aria-hidden="true"/)
  assert.match(cell, /aria-label=\{`\$\{total\} invocation\$\{total === 1 \? '' : 's'\}, \$\{fails\} failure\$\{fails === 1 \? '' : 's'\}`\}/)
})

test('the refinement is table-only: failureCount is unchanged shared logic', () => {
  assert.match(read('src/components/settings/keithSkillFields.js'), /export function failureCount\(stats\)/)
})

// ── ANCHORED-NAV-1: navigation stays put while the page scrolls ──────────────
//
// Root cause, found by measurement: a sticky element travels only inside its
// containing block. The Settings rail is a GRID item now (SETTINGS-HIERARCHY-1), whose
// containing block is its grid area, the row's full height, so it needs no stretched
// wrapper. The model is Evaluation > Review and Release's rail, and since this change it
// IS that rail: STICKY NAV + PAGE SCROLL, never an independently scrolling right pane.

test('the Settings rail is the canon rail: sticky under the chrome, static once stacked', () => {
  assert.match(shell, /<nav className="rr-nav settings-rail" aria-label="Settings sections">/)
  assert.match(rail, /\.rr-nav \{[^}]*position: sticky; top: var\(--app-chrome-height, 0px\); align-self: start;/)
  assert.match(shellCss, /\.settings-grid \{[^}]*display: grid;[^}]*align-items: start;/)
  // The unpin lives with the canon (after its base rule); Settings only stacks its grid.
  assert.match(rail, /@media \(max-width: 900px\) \{\s*\.rr-nav \{ margin-top: 0; position: static; \}/)
  assert.match(shellCss, /@media \(max-width: 900px\) \{\s*\.settings-grid \{ grid-template-columns: minmax\(0, 1fr\);/)
})

test('there is one navigation, and no second vertical scroll region', () => {
  assert.doesNotMatch(shell, /keith-nav|keith-picker|KEITH_COMPACT_BREAKPOINT|useIsCompact/)
  assert.doesNotMatch(shellCss, /overflow-y: auto/)
  assert.doesNotMatch(shellCss, /max-width: 1280/)
})

test('Accounts and Preceptor Parity are not restructured', () => {
  const parity = read('src/components/settings/PreceptorParityPanel.jsx')
  const accounts = read('src/components/settings/AccountsAccessPanel.jsx')
  for (const src of [parity, accounts]) {
    assert.doesNotMatch(src, /position: 'sticky'|keith-nav-col|settings-nav-col/)
  }
})
