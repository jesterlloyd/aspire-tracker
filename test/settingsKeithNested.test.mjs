// SETTINGS-KEITH-NESTED-1: Keith is a parent destination with its own secondary
// navigation, following the Settings > General master-detail pattern rather than
// the Rotation segmented control.
//
// Navigation and information architecture only. No Keith behavior, skill state,
// permission, SQL, API or data-model change is in scope here, and several of
// these tests exist specifically to prove that.
//
// Run: node --test test/settingsKeithNested.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SETTINGS_SECTIONS, visibleSections, routableSections } from '../src/components/settings/settingsSections.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const shell = read('src/components/settings/SettingsShell.jsx')
const panel = read('src/components/settings/KeithPanel.jsx')

const ADMIN = { isOwner: false, isAdmin: true }
const OWNER = { isOwner: true, isAdmin: true }
const STAFF = { isOwner: false, isAdmin: false }
const sectionFor = (key) => SETTINGS_SECTIONS.find(s => s.key === key)

// ── Route structure ──────────────────────────────────────────────────────────

// KEITH-USAGE-1 updated this suite: Usage & Cost became the third workspace,
// the order went alphabetical (Knowledge Center, Skills, Usage & Cost), and the
// parent redirect landed on the first alphabetical entry instead of Skills.

test('the Keith routes exist with the intended rail membership', () => {
  const keith = sectionFor('keith')
  assert.equal(keith.path, '/settings/keith')
  assert.notEqual(keith.inRail, false, 'Keith is the top-level destination and stays in the rail')

  for (const [key, path] of [['keithSkills', '/settings/keith/skills'], ['keithKnowledge', '/settings/keith/knowledge'], ['keithUsage', '/settings/keith/usage']]) {
    const s = sectionFor(key)
    assert.equal(s.path, path)
    assert.equal(s.implemented, true)
    assert.equal(s.inRail, false, `${key} is reached through Keith, not from the rail`)
  }
  // The legacy route survives so old links keep working.
  assert.equal(sectionFor('knowledge').path, '/settings/knowledge')
  assert.equal(sectionFor('knowledge').inRail, false)
})

test('/settings/keith redirects to Knowledge Center, the first alphabetical workspace', () => {
  // KEITH-USAGE-1: the default landing destination moved from Skills to
  // Knowledge Center when the workspace order went alphabetical.
  assert.match(shell, /if \(path === '\/settings\/keith'\) \{[\s\S]*?navigate\('\/settings\/keith\/knowledge', \{ replace: true \}\)/)
  // replace, not push: the parent must not become a history entry the user can
  // land back on and be redirected from again.
  assert.doesNotMatch(shell, /navigate\('\/settings\/keith\/knowledge'\)(?!, \{ replace)/)
})

test('the legacy Knowledge Center route redirects under Keith', () => {
  assert.match(shell, /if \(path === '\/settings\/knowledge'\) \{\s*\n\s*navigate\('\/settings\/keith\/knowledge', \{ replace: true \}\)/)
  // It must NOT fall through to the unknown-path handler, which would bounce a
  // valid old bookmark to General.
  const effect = shell.slice(shell.indexOf('useEffect(() => {'), shell.indexOf('}, [path])'))
  assert.ok(effect.indexOf("path === '/settings/knowledge'") < effect.indexOf("!knownPaths.includes(path)"),
    'the legacy redirect must be evaluated before the unknown-path fallback')
})

test('all three workspace routes are directly reachable, not only via redirect', () => {
  const paths = routableSections(ADMIN).map(s => s.path)
  assert.ok(paths.includes('/settings/keith/skills'))
  assert.ok(paths.includes('/settings/keith/knowledge'))
  assert.ok(paths.includes('/settings/keith/usage'))
  assert.ok(paths.includes('/settings/keith'))
  assert.ok(paths.includes('/settings/knowledge'), 'the legacy path must stay routable to be redirectable')
})

// ── Selection state ──────────────────────────────────────────────────────────

test('the rail highlights Keith for every Keith workspace', () => {
  // KEITH-USAGE-1: the fold map gained keithUsage.
  assert.match(shell, /const KEITH_SUBKEYS = \{ keithSkills: 'skills', keithKnowledge: 'knowledge', keithUsage: 'usage' \}/)
  assert.match(shell, /KEITH_SUBKEYS\[matchedKey\] \? 'keith' : matchedKey/)
  assert.match(shell, /active = s\.key === railActiveKey/)
})

test('the secondary navigation marks the selected workspace', () => {
  assert.match(panel, /aria-current=\{active \? 'page' : undefined\}/)
  assert.match(panel, /const active = row\.key === activeKey/)
  // Desktop passes the resolved key so a row is always selected.
  assert.match(panel, /<WorkspaceList activeKey=\{selectedKey\} \/>/)
})

test('the workspaces are alphabetical and Knowledge Center is the default', () => {
  // KEITH-USAGE-1: was skills-first by deliberate choice; the approved Usage &
  // Cost plan switched Keith to the Settings > General alphabetical convention.
  assert.match(panel, /const KEITH_DEFAULT_WORKSPACE = 'knowledge'/)
  const order = [...panel.matchAll(/key: '(skills|knowledge|usage)',/g)].map(m => m[1])
  assert.deepEqual(order, ['knowledge', 'skills', 'usage'],
    'alphabetical by label: Knowledge Center, Skills, Usage & Cost')
  assert.match(panel, /const selectedKey = subKey \|\| KEITH_DEFAULT_WORKSPACE/)
})

test('the supporting text matches the approved copy', () => {
  assert.match(panel, /description: 'Governed capabilities, lifecycle, and usage'/)
  assert.match(panel, /description: "Keith's governed knowledge and future Markdown vault"/)
  assert.match(panel, /description: 'Keith activity, model usage, estimated spend, and operational health'/)
})

// ── Access ───────────────────────────────────────────────────────────────────

test('Owner and Admin reach Keith and both workspaces; other staff reach none', () => {
  for (const flags of [OWNER, ADMIN]) {
    const paths = routableSections(flags).map(s => s.path)
    for (const p of ['/settings/keith', '/settings/keith/skills', '/settings/keith/knowledge', '/settings/keith/usage']) {
      assert.ok(paths.includes(p), `${p} must be reachable`)
    }
    assert.ok(visibleSections(flags).some(s => s.key === 'keith'))
  }
  const staffPaths = routableSections(STAFF).map(s => s.path)
  for (const p of ['/settings/keith', '/settings/keith/skills', '/settings/keith/knowledge', '/settings/keith/usage', '/settings/knowledge']) {
    assert.ok(!staffPaths.includes(p), `${p} must not be reachable without admin`)
  }
  assert.ok(!visibleSections(STAFF).some(s => s.key === 'keith'))
})

test('an unauthorized deep link falls back to General rather than rendering Keith', () => {
  // knownPaths is built from routableSections(roleFlags), so for a non-admin the
  // Keith paths are unknown and the normalization effect bounces them.
  assert.match(shell, /const knownPaths = routable\.map\(s => s\.path\)/)
  assert.match(shell, /!knownPaths\.includes\(path\)/)
  assert.match(shell, /navigate\('\/settings\/general', \{ replace: true \}\)/)
})

// ── Responsive and accessibility ─────────────────────────────────────────────

test('three columns above 1280px, compact picker at or below it', () => {
  // Shell owns column 1; this panel owns columns 2 and 3 in the wide layout.
  assert.match(panel, /flex: '0 0 248px', minWidth: 220/)
  assert.match(panel, /flex: '1 1 420px', minWidth: 0/)
  assert.match(panel, /const KEITH_COMPACT_BREAKPOINT = 1280/)
  assert.match(panel, /function useIsCompact\(bp = KEITH_COMPACT_BREAKPOINT\)/)
  assert.match(panel, /if \(compact\) \{/)
  assert.match(panel, /<CompactWorkspacePicker activeKey=\{selectedKey\} \/>/)
  // The compact branch is ONE column: the workspace follows the picker with no
  // second pane competing for width.
  const compactBranch = panel.slice(panel.indexOf('if (compact) {'), panel.indexOf('// Wide master-detail'))
  assert.doesNotMatch(compactBranch, /flex: '0 0 248px'/)
  assert.match(compactBranch, /<WorkspaceContent subKey=\{selectedKey\} \/>/)
  // The old drill-down is gone: a compact picker replaces it, so there is no
  // list-only state and no Back affordance to strand anyone in.
  assert.doesNotMatch(panel, /BackToKeith/)
  assert.doesNotMatch(panel, /useIsNarrow/)
})

test('the 1280 breakpoint is Keith-local and does not touch the shared Settings grid', () => {
  const general = read('src/components/settings/GeneralPanel.jsx')
  assert.match(general, /function useIsNarrow\(bp = 768\)/, 'General keeps its own 768 breakpoint')
  assert.doesNotMatch(general, /1280/)
  // The shell's rail-stacking rule is unchanged too.
  assert.match(shell, /@media \(max-width: 768px\)/)
  // Pin the CONSTRUCT, not the number: the shell mentions 1280 in a comment
  // recording the widths a past layout was measured at.
  assert.doesNotMatch(shell, /max-width: 1280/)
  assert.doesNotMatch(shell, /useIsCompact|KEITH_COMPACT_BREAKPOINT/)
  // And General's master-detail widths are untouched, so the two hubs still
  // share one grid above the Keith breakpoint.
  assert.match(general, /flex: '0 0 248px', minWidth: 220/)
  assert.match(general, /flex: '1 1 420px', minWidth: 0/)
})

test('the compact picker keeps the wide layout\'s semantics exactly', () => {
  const picker = panel.slice(panel.indexOf('function CompactWorkspacePicker'), panel.indexOf('function WorkspaceContent'))
  // Same nav landmark and label as the wide list, so the accessibility tree does
  // not change shape with the viewport.
  assert.match(picker, /<SurfaceCard as="nav" aria-label="Keith workspaces"/)
  assert.match(picker, /aria-current=\{active \? 'page' : undefined\}/)
  assert.match(picker, /aria-label=\{`\$\{row\.label\}: \$\{row\.description\}`\}/)
  assert.match(picker, /type="button"/, 'real buttons: native Tab and Enter, no roving-tabindex to get wrong')
  // Not a select and not a segmented control - the approved direction rejected a
  // segmented control as the Keith hierarchy.
  assert.doesNotMatch(picker, /<select|role="tablist"|role="tab"/)
  // Touch target large enough to hit on a tablet.
  assert.match(picker, /minHeight: 44/)
  // It navigates to the same real routes, so history behavior is identical.
  assert.match(picker, /onClick=\{\(\) => navigate\(row\.path\)\}/)
})

test('the secondary navigation is labelled and keyboard-operable', () => {
  assert.match(panel, /<SurfaceCard as="nav" aria-label="Keith workspaces"/)
  assert.match(panel, /type="button"/, 'real buttons, so Tab and Enter work without extra handlers')
  assert.match(panel, /aria-label=\{`\$\{row\.label\}: \$\{row\.description\}`\}/)
  assert.match(panel, /<section aria-label="Keith"/)
  assert.match(panel, /id="settings-keith-heading"/)
})

// ── Functional preservation ──────────────────────────────────────────────────

test('every workspace renders its own panel through the hub', () => {
  assert.match(panel, /import KeithSkillsPanel from '\.\/KeithSkillsPanel'/)
  assert.match(panel, /import KnowledgeCenterPanel from '\.\/KnowledgeCenterPanel'/)
  assert.match(panel, /import KeithUsagePanel from '\.\/KeithUsagePanel'/)
  assert.match(panel, /if \(subKey === 'skills'\) return <KeithSkillsPanel \/>/)
  assert.match(panel, /if \(subKey === 'usage'\) return <KeithUsagePanel \/>/)
  // The fallthrough is the default workspace, matching KEITH_DEFAULT_WORKSPACE.
  assert.match(panel, /return <KnowledgeCenterPanel \/>/)
  // The shell no longer mounts them directly; the hub owns both.
  assert.doesNotMatch(shell, /<KnowledgeCenterPanel \/>/)
  assert.doesNotMatch(shell, /<KeithSkillsPanel \/>/)
  assert.match(shell, /<KeithPanel subKey=\{keithSubKey\} \/>/)
})

test('this change touches navigation only: no API, permission or skill-state edit', () => {
  // The hub must not talk to the server or reason about skill lifecycle itself.
  assert.doesNotMatch(panel, /fetch\(|supabase|keith-skills-admin|activate|enabled/i)
  // Panel role gating is unchanged and still lives in the panels themselves.
  assert.match(read('src/components/settings/KeithSkillsPanel.jsx'), /isAdmin/)
  assert.match(read('src/components/settings/KnowledgeCenterPanel.jsx'), /isAdmin/)
  // Visibility predicates for the Keith routes are the same isAdmin gate as before.
  for (const key of ['keith', 'keithSkills', 'keithKnowledge', 'keithUsage', 'knowledge']) {
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

test('the refinement is table-only: navigation and the breakpoint are untouched', () => {
  assert.match(panel, /const KEITH_COMPACT_BREAKPOINT = 1280/)
  assert.match(panel, /<CompactWorkspacePicker activeKey=\{selectedKey\} \/>/)
  // failureCount itself is unchanged shared logic.
  assert.match(read('src/components/settings/keithSkillFields.js'), /export function failureCount\(stats\)/)
})

// ── ANCHORED-NAV-1: navigation stays put while the workspace scrolls ─────────
//
// Root cause found by measurement, not by reading: the .settings-nav-rail sticky
// rule had existed for some time and had NEVER worked. A sticky element travels
// only inside its containing block, and the rail's column was sized to its own
// content (315px) inside a 1346px row, because the row uses
// align-items: flex-start. With ~315px of travel it unpinned almost immediately
// and left with the page. Stretching the COLUMN is the fix; the sticky rule
// itself was already correct.
//
// The model copied is Evaluation > Review and Release (.rr-nav): STICKY NAV +
// PAGE SCROLL. Not an independently scrolling right pane, which would put two
// vertical scrollbars on one screen.

test('the Settings rail column stretches, so its sticky rule can actually work', () => {
  assert.match(shell, /\.settings-nav-col \{ align-self: stretch; \}/)
  assert.match(shell, /className="settings-nav-col"/)
  assert.match(shell, /\.settings-nav-rail \{ position: sticky; top: 120px;/)
  // Below the shell's own breakpoint the rail stacks above content, so stretching
  // it there would strand the nav in a tall empty column.
  assert.match(shell, /@media \(max-width: 768px\) \{ \.settings-nav-col \{ align-self: auto; \}/)
})

test('the Keith secondary nav anchors the same way, at the same offset', () => {
  assert.match(panel, /\.keith-nav-col \{ align-self: stretch; \}/)
  assert.match(panel, /className="keith-nav-col"/)
  assert.match(panel, /position: sticky; top: 120px; align-self: flex-start;/)
  assert.match(panel, /className="keith-nav-card"/)
  // Same top offset as the primary rail, so the two pin on one line rather than
  // at two different heights.
  const railTop = /\.settings-nav-rail \{ position: sticky; top: (\d+)px/.exec(shell)[1]
  const navTop = /\.keith-nav-card \{[\s\S]*?top: (\d+)px/.exec(panel)[1]
  assert.equal(navTop, railTop, 'both navs must pin at the same offset')
})

test('the compact picker stays reachable during a long scroll', () => {
  assert.match(panel, /\.keith-picker \{\s*\n\s*position: sticky; top: 120px;/)
  // It needs an opaque background or scrolled rows would show through it.
  assert.match(panel, /background: var\(--color-bg-app, #faf8f4\)/)
  assert.match(panel, /className="keith-picker"/)
  // The approved compact mode is preserved: no drill-down comes back.
  assert.doesNotMatch(panel, /BackToKeith/)
})

test('anchoring adds NO second vertical scroll region', () => {
  // The reference deliberately keeps the page as the single scroll owner. The
  // navs carry overflow-y only as a safety valve for a nav taller than the
  // viewport, with overscroll-behavior so it cannot chain to the page.
  for (const src of [shell, panel]) {
    assert.match(src, /overscroll-behavior: contain/)
  }
  // The workspace pane itself must NOT become a scroller - that is the thing the
  // approved scope rules out.
  assert.doesNotMatch(panel, /overflowY: 'auto'|overflow-y: auto;[^}]*keith-workspace/)
  const wide = panel.slice(panel.indexOf('// Wide master-detail'))
  assert.doesNotMatch(wide, /overflow/, 'the right workspace pane owns no scrolling of its own')
})

test('General, Accounts and Preceptor Parity are not restructured', () => {
  // They gain the rail fix for free (it lives in the shell) and are otherwise
  // untouched: no secondary nav to anchor, no scroll owner changed.
  const general = read('src/components/settings/GeneralPanel.jsx')
  const parity = read('src/components/settings/PreceptorParityPanel.jsx')
  const accounts = read('src/components/settings/AccountsAccessPanel.jsx')
  for (const src of [general, parity, accounts]) {
    assert.doesNotMatch(src, /position: 'sticky'|keith-nav-col|settings-nav-col/)
  }
})
