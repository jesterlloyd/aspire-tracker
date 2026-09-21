// Information-architecture guards for Settings.
//
// History: SETTINGS-UNIFIED-DESIGN-1 put Appearance, Email Signature, Tours & Help and
// About under a General hub in a third pane. APPEARANCE-STYLE-1 flattened everything into
// one rail, and the Owner sent it back (2026-09-21). SETTINGS-HIERARCHY-1 is the Apple
// System Settings pattern: the rail is the top-level destinations only, in the left
// selection canon Evaluation > Review & Release wears; General and Keith are list pages
// of drill-in rows; a drill-in opens in the same right pane under a breadcrumb, with the
// parent still selected, at its own route; every old path redirects.
//
// Run: node --test test/settingsUnifiedIa.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  SETTINGS_SECTIONS, SETTINGS_GROUPS, DEFAULT_SETTINGS_PATH, LEGACY_SETTINGS_REDIRECTS,
  visibleSections, routableSections, childSections,
} from '../src/components/settings/settingsSections.js'
import { STAFF_SETTINGS_PATH } from '../src/lib/portalLinks.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const shell = read('src/components/settings/SettingsShell.jsx')
const shellCss = read('src/components/settings/settingsShell.css')
const rail = read('src/styles/selectionRail.css')

const STAFF = { isOwner: false, isAdmin: false }
const ADMIN = { isOwner: false, isAdmin: true }
const OWNER = { isOwner: true, isAdmin: true }
const ROLE_COMBOS = [STAFF, ADMIN, OWNER]
const railKeys = (r) => visibleSections(r).map(s => s.key)
const section = (k) => SETTINGS_SECTIONS.find(s => s.key === k)

// ── The rail ────────────────────────────────────────────────────────────────

test('the rail is exactly the brief\'s six destinations, in its order, for the Owner', () => {
  assert.deepEqual(railKeys(OWNER), ['general', 'accounts', 'communityBenefit', 'keith', 'demoMode', 'preceptorParity'])
  assert.deepEqual(visibleSections(OWNER).map(s => s.label),
    ['General', 'Accounts & Access', 'Community Benefit', 'Keith', 'Demo Mode', 'Preceptor Parity'])
})

test('groups are Workspace, Administration, Diagnostics, contiguous', () => {
  assert.deepEqual(SETTINGS_GROUPS, ['Workspace', 'Administration', 'Diagnostics'])
  const seq = visibleSections(OWNER).map(s => s.group).filter((g, i, a) => g !== a[i - 1])
  assert.deepEqual(seq, SETTINGS_GROUPS)
  assert.equal(section('general').group, 'Workspace')
  for (const k of ['accounts', 'communityBenefit', 'keith']) assert.equal(section(k).group, 'Administration')
  for (const k of ['demoMode', 'preceptorParity']) assert.equal(section(k).group, 'Diagnostics')
})

test('Appearance, Email Signature, Tours & Help and About left the rail for General', () => {
  for (const r of ROLE_COMBOS) {
    for (const k of ['appearance', 'signature', 'tours', 'about', 'keithKnowledge', 'keithSkills', 'keithUsage']) {
      assert.ok(!railKeys(r).includes(k), `${k} is a drill-in, never in the rail`)
    }
    assert.ok(!railKeys(r).includes('templates') && !railKeys(r).includes('audit'))
  }
})

test('every role keeps the gates it had', () => {
  assert.deepEqual(railKeys(ADMIN), ['general', 'accounts', 'communityBenefit', 'keith'])
  assert.deepEqual(railKeys(STAFF), ['general'])
  const s = section
  for (const k of ['accounts', 'communityBenefit', 'keith', 'keithKnowledge', 'keithSkills', 'keithUsage']) {
    assert.equal(s(k).visible({ isAdmin: true }), true, k)
    assert.equal(s(k).visible({ isAdmin: false }), false, k)
  }
  for (const k of ['demoMode', 'preceptorParity']) {
    assert.equal(s(k).visible({ isOwner: true }), true, k)
    assert.equal(s(k).visible({ isOwner: false }), false, k)
  }
  for (const k of ['general', 'appearance', 'signature', 'tours', 'about']) assert.equal(s(k).visible(STAFF), true, k)
})

test('the rail IS the Review & Release selection canon, reused, not restyled', () => {
  assert.match(shell, /import '\.\.\/\.\.\/styles\/selectionRail\.css'/)
  assert.match(read('src/components/evaluation/SurveyAutomationDashboard.jsx'), /import '\.\.\/\.\.\/styles\/selectionRail\.css'/)
  assert.match(shell, /<nav className="rr-nav settings-rail" aria-label="Settings sections">/)
  assert.match(shell, /<p className="rr-nav-group">\{group\}<\/p>/)
  assert.match(shell, /className=\{`rr-row-select settings-rail-row\$\{active \? ' sel' : ''\}`\}/)
  assert.match(shell, /<span className="rr-row-label">\{s\.label\}<\/span>/)
  assert.match(shell, /aria-current=\{active \? 'page' : undefined\}/)
  // The canon: a surface card, mono uppercase group labels with a hairline between
  // groups, and a filled navy selected row with white ink.
  assert.match(rail, /\.rr-nav \{[^}]*background: var\(--color-bg-surface\); border: 0; border-radius: var\(--aspire-radius-card\);[^}]*box-shadow: var\(--aspire-shadow-card\);/)
  assert.match(rail, /\.rr-nav-group \{\s*font-family: var\(--rr-mono\); font-size: 10px; letter-spacing: 0\.13em; text-transform: uppercase;/)
  assert.match(rail, /\.rr-nav \.rr-nav-group:not\(:first-child\) \{ margin-top: 6px; border-top: 1px solid var\(--aspire-rule\);/)
  assert.match(rail, /\.rr-row-select\.sel, \.rr-row-select\.sel:hover \{ background: var\(--aspire-navy\); color: #fff; \}/)
  assert.match(rail, /\.rr-row-select:hover \{ background: var\(--color-bg-hover\); \}/)
  // The variables it reads are defined on the rail itself, so it works outside the clipboard.
  assert.match(rail, /--rr-mono: var\(--aspire-mono\);\s*--rr-sans: var\(--aspire-sans\);\s*--rr-navy: var\(--color-accent-primary, var\(--aspire-navy\)\);/)
  // Settings adds only placement and its icon column; it never restates the canon's look.
  assert.doesNotMatch(shellCss, /\.rr-row-select\.sel \{|\.rr-nav-group \{|\.rr-row-select:hover/)
})

test('the icons are the ones Settings already used, monochrome, with no tile', () => {
  assert.match(shell, /general: Settings, accounts: Users, communityBenefit: HandCoins, keith: Sparkles,\s*demoMode: Presentation, preceptorParity: Scale,/)
  assert.match(shell, /about: BadgeInfo, appearance: Monitor, signature: PenLine, tours: Info,/)
  assert.match(shell, /keithKnowledge: FileText, keithSkills: Sparkles, keithUsage: BarChart3,/)
  assert.match(shellCss, /\.settings-rail-ic \{ flex: none; color: var\(--color-accent-primary, #1D2567\); \}/)
  assert.match(shellCss, /\.rr-row-select\.sel \.settings-rail-ic \{ color: #FFFFFF; \}/)
  assert.doesNotMatch(shell, /settings-nav-ic/)
  assert.doesNotMatch(shellCss, /settings-nav-ic|color-mix/)
})

// ── List pages ──────────────────────────────────────────────────────────────

test('General lists About, Appearance, Email Signature, Tours & Help, with the approved lines', () => {
  const rows = childSections('general', STAFF)
  assert.deepEqual(rows.map(r => r.label), ['About', 'Appearance', 'Email Signature', 'Tours & Help'])
  assert.deepEqual(rows.map(r => r.sub), [
    'Version, build, and deployment details', 'Style and color mode',
    'Your Connect signature', 'Replay the welcome tour and find help',
  ])
  assert.deepEqual(rows.map(r => r.path),
    ['/settings/general/about', '/settings/general/appearance', '/settings/general/signature', '/settings/general/tours'])
  // SETTINGS-BAND-1: the list page's one subtitle line lives in the header band, which
  // is the same height on every page, so it no longer pushes the list down.
  assert.match(shell, /general: 'Settings that are yours alone\. They follow you to any device\.'/)
  assert.match(shell, /<SettingsPageHeader id=\{headingId\} title=\{section\.label\} subtitle=\{LIST_PAGE_COPY\[section\.key\]\} \/>/)
})

test('a list row is a real button with an icon, a title, a line and a chevron', () => {
  const page = shell.slice(shell.indexOf('function SettingsListPage'), shell.indexOf('function SettingsCrumb'))
  assert.match(page, /<SurfaceCard as="ul" className="settings-list" padding=\{0\} aria-label=\{section\.label\}>/)
  assert.match(page, /<button type="button" className="settings-list-row" onClick=\{\(\) => navigate\(row\.path\)\}>/)
  assert.match(page, /\{row\.sub && <small>\{row\.sub\}<\/small>\}/)
  assert.match(page, /<ChevronRight [^>]*aria-hidden="true" className="settings-list-chev" \/>/)
  assert.match(shellCss, /\.settings-list-row:focus-visible \{[^}]*outline: 3px solid var\(--color-accent-primary/)
})

// ── Drill-ins ───────────────────────────────────────────────────────────────

test('a drill-in opens in the right pane under a breadcrumb, with its parent selected', () => {
  assert.match(shell, /const railActiveKey = current\.parent \|\| current\.key/)
  assert.match(shell, /const parent = current\.parent \? routable\.find\(s => s\.key === current\.parent\) : null/)
  const crumb = shell.slice(shell.indexOf('function SettingsCrumb'), shell.indexOf('export default function SettingsShell'))
  assert.match(crumb, /<nav className="settings-crumb" aria-label="Breadcrumb">/)
  assert.match(crumb, /onClick=\{\(\) => navigate\(parent\.path\)\}/)
  assert.match(crumb, /<span className="settings-crumb-sep" aria-hidden="true">\/<\/span>/)
  assert.match(crumb, /aria-current="page">\{here\.label\}</)
  // Two panes, never three: the page is the content column itself.
  assert.match(shellCss, /\.settings-grid \{\s*display: grid;\s*grid-template-columns: 240px minmax\(0, 1fr\);/)
  assert.doesNotMatch(shell, /GeneralPanel|KeithPanel|NON_RAIL_SUBKEYS/)
  assert.equal(existsSync(join(here, '..', 'src/components/settings/GeneralPanel.jsx')), false)
})

test('every drill-in has its own route under its parent, and renders its existing page', () => {
  for (const [k, p, panel] of [
    ['about', '/settings/general/about', '<AboutPanel />'],
    ['appearance', '/settings/general/appearance', '<AppearancePanel />'],
    ['signature', '/settings/general/signature', '<SignaturePanel />'],
    ['tours', '/settings/general/tours', '<ToursHelpPanel onRestartTour={onRestartTour} />'],
    ['keithKnowledge', '/settings/keith/knowledge', '<KnowledgeCenterPanel />'],
    ['keithSkills', '/settings/keith/skills', '<KeithSkillsPanel />'],
    ['keithUsage', '/settings/keith/usage', '<KeithUsagePanel />'],
  ]) {
    assert.equal(section(k).path, p)
    assert.ok(p.startsWith(section(section(k).parent).path + '/'), `${k} lives under its parent`)
    assert.ok(shell.includes(`currentKey === '${k}'`) && shell.includes(panel), `${k} renders ${panel}`)
  }
  for (const [k, panel] of [['accounts', '<AccountsAccessPanel />'], ['communityBenefit', '<CommunityBenefitPanel />'],
    ['preceptorParity', '<PreceptorParityPanel />'], ['demoMode', '<DemoModePanel />']]) {
    assert.ok(shell.includes(`currentKey === '${k}'`) && shell.includes(panel), `${k} renders ${panel}`)
  }
})

test('the pages that bring no heading get one from the shell, on the shared spec', () => {
  assert.match(shell, /const TITLED_BY_SHELL = \['signature', 'tours', 'about'\]/)
  assert.match(shell, /\{shellTitle && <SettingsPageHeader title=\{shellTitle\} subtitle=\{current\.sub\} \/>\}/)
  assert.match(read('src/components/settings/AppearancePanel.jsx'), /<SettingsPageHeader\s+id=\{`\$\{uid\}-title`\}\s+title="Appearance"/)
  // Every other page's title comes through the one band, which reads the shared spec.
  assert.match(read('src/components/settings/AccountsDirectory.jsx'), /<SettingsPageHeader\s+id="accounts-directory-heading"/)
  assert.match(read('src/components/settings/PreceptorParityPanel.jsx'), /<SettingsPageHeader\s+title="Preceptor Assignment Integrity"/)
  assert.match(read('src/components/settings/SettingsPageHeader.jsx'), /\.\.\.SETTINGS_HEADING_STYLE/)
})

// ── Routes ──────────────────────────────────────────────────────────────────

test('every old path redirects to where it lives now, with replace', () => {
  assert.deepEqual({ ...LEGACY_SETTINGS_REDIRECTS }, {
    '/settings': '/settings/general',
    '/settings/appearance': '/settings/general/appearance',
    '/settings/signature': '/settings/general/signature',
    '/settings/tours': '/settings/general/tours',
    '/settings/about': '/settings/general/about',
    '/settings/knowledge': '/settings/keith/knowledge',
  })
  const routablePaths = routableSections(OWNER).map(s => s.path)
  for (const to of Object.values(LEGACY_SETTINGS_REDIRECTS)) assert.ok(routablePaths.includes(to), `${to} is a real page`)
  for (const from of Object.keys(LEGACY_SETTINGS_REDIRECTS)) assert.ok(!routablePaths.includes(from), `${from} is not a page any more`)
  assert.match(shell, /const moved = LEGACY_SETTINGS_REDIRECTS\[path\]\s*\n\s*if \(moved\) \{\s*\n\s*navigate\(moved, \{ replace: true \}\)/)
  assert.match(shell, /if \(path\.startsWith\('\/settings'\) && !knownPaths\.includes\(path\)\) \{\s*\n\s*navigate\(DEFAULT_SETTINGS_PATH, \{ replace: true \}\)/)
  assert.equal(DEFAULT_SETTINGS_PATH, '/settings/general')
})

test('routableSections is a superset of the rail for every role', () => {
  for (const r of ROLE_COMBOS) {
    const routableKeys = routableSections(r).map(s => s.key)
    for (const key of railKeys(r)) assert.ok(routableKeys.includes(key))
    for (const key of ['appearance', 'signature', 'tours', 'about']) assert.ok(routableKeys.includes(key), `${key} for ${JSON.stringify(r)}`)
  }
})

test('deep-link consumers: the user menu and the portals open General; Interviewers opens Accounts', () => {
  assert.equal(STAFF_SETTINGS_PATH, '/settings/general')
  assert.match(read('src/components/UserMenu.jsx'), /navigate\(STAFF_SETTINGS_PATH\)/)
  assert.match(read('src/components/InterviewersModal.jsx'), /navigate\('\/settings\/accounts'\)/)
})

// ── SETTINGS-FIX-2: order-proof, one baseline, one size ─────────────────────

test('every Settings override beats the canon whatever order the two sheets load in', () => {
  // The live site loaded settingsShell.css BEFORE selectionRail.css, so an override of
  // equal specificity lost and every label slid right. Overrides carry one class more.
  assert.match(shellCss, /\.rr-row-select\.settings-rail-row \{ grid-template-columns: auto minmax\(0, 1fr\); gap: 10px; \}/)
  assert.match(shellCss, /\.settings-rail\.rr-nav \{ margin-top: 0; \}/)
  // No single-class rule in this sheet touches a property the canon sets on its rows.
  assert.doesNotMatch(shellCss, /(^|\n)\.settings-rail-row \{/)
  // And the canon keeps its own unpin after its base rule, in its own file.
  assert.ok(rail.indexOf('@media (max-width: 900px)') > rail.indexOf('.rr-nav {'))
})

test('"Settings" and the page title share one header band, so titles and first cards align', () => {
  assert.match(shell, /<div className="settings-side">\s*<SettingsPageHeader as="h1" title="Settings" \/>\s*<SettingsRail /)
  assert.doesNotMatch(shell, /settings-title/)
  assert.match(shellCss, /\.settings-side \{\s*align-self: stretch;/, 'the rail column stretches so the rail can stay pinned')
})

test('a destination reads the same size in the rail and in a list', () => {
  const label = /\.rr-row-label \{ min-width: 0; font-size: ([\d.]+)px; font-weight: (\d+);/.exec(rail)
  const row = /\.settings-list-text \{[^}]*font-size: ([\d.]+)px;\s*font-weight: (\d+);/.exec(shellCss)
  assert.ok(label && row)
  assert.equal(row[1], label[1], 'same size')
  assert.equal(row[2], label[2], 'same weight')
  assert.equal((shell.match(/size=\{16\} strokeWidth=\{2\} aria-hidden="true" className="settings-(rail|list)-ic"/g) || []).length, 2, 'same icon size')
})

test('the breadcrumb rides the back link\'s row, over the page column, so titles sit right under it', () => {
  assert.match(shell, /<div className="settings-top">\s*<WorkspaceBackLink path=\{backPath\} label=\{backLabel\} \/>\s*\{parent && <SettingsCrumb parent=\{parent\} here=\{current\} navigate=\{navigate\} \/>\}/)
  // The top row is the same two columns as the panes, so the crumb starts where the page does.
  assert.match(shellCss, /\.settings-top \{\s*display: grid;\s*grid-template-columns: 240px minmax\(0, 1fr\);\s*column-gap: 28px;/)
  assert.match(shellCss, /\.settings-grid \{[^}]*margin-top: 16px;/)
  assert.doesNotMatch(shellCss, /\.settings-crumb \{[^}]*position: absolute/)
})

// ── SETTINGS-BAND-1: one header band on every page ──────────────────────────

const band = read('src/components/settings/SettingsPageHeader.jsx')
const bandCss = read('src/components/settings/settingsPageHeader.css')

test('the band is one fixed shape: a title line and ONE reserved subtitle line', () => {
  assert.match(band, /<p className="settings-page-sub" aria-hidden=\{subtitle \? undefined : 'true'\}>\{subtitle \|\| null\}<\/p>/,
    'the subtitle line renders even when empty; that is what keeps every band the same height')
  assert.match(bandCss, /\.settings-page-head-row \{[^}]*min-height: 36px;/)
  assert.match(bandCss, /\.settings-page-sub \{\s*height: 20px;[^}]*line-height: 20px;[^}]*white-space: nowrap;/)
  assert.match(bandCss, /\.settings-page-head \{\s*margin: 0 0 var\(--aspire-gap-card, 16px\);/)
})

test('every Settings page opens with the band, and nothing else draws a page title', () => {
  for (const f of ['AppearancePanel', 'AccountsDirectory', 'CommunityBenefitPanel', 'DemoModePanel', 'PreceptorParityPanel',
    'KnowledgeCenterPanel', 'KeithSkillsPanel', 'KeithUsagePanel']) {
    const src = read(`src/components/settings/${f}.jsx`)
    assert.match(src, /<SettingsPageHeader\b/, `${f} opens with the band`)
    assert.doesNotMatch(src, /<h2 [^>]*SETTINGS_HEADING_STYLE/, `${f} draws no title of its own`)
  }
  assert.doesNotMatch(shell, /<h[12] [^>]*SETTINGS_HEADING_STYLE/)
})

test('every subtitle is one sentence that fits one line (85 characters)', () => {
  const subs = []
  for (const f of ['SettingsShell', 'AppearancePanel', 'AccountsDirectory', 'CommunityBenefitPanel', 'DemoModePanel',
    'PreceptorParityPanel', 'KnowledgeCenterPanel', 'KeithSkillsPanel', 'KeithUsagePanel']) {
    const src = read(`src/components/settings/${f}.jsx`)
    for (const m of src.matchAll(/subtitle="([^"]+)"/g)) subs.push(m[1])
    for (const m of src.matchAll(/(?:general|keith): '([^']+)'/g)) subs.push(m[1])
  }
  for (const s of SETTINGS_SECTIONS.filter(x => x.sub)) subs.push(s.sub)
  assert.ok(subs.length >= 14, `found ${subs.length} subtitles`)
  for (const s of subs) assert.ok(s.length <= 85, `"${s}" is ${s.length} characters`)
})

// ── Preserved from earlier passes ───────────────────────────────────────────

test('every section uses the full canonical workspace width (no caps)', () => {
  assert.doesNotMatch(shell, /maxWidth: currentKey|maxWidth: (1040|720)/)
  assert.doesNotMatch(shellCss, /max-width: (1040|720)px/)
})

test('the back breadcrumb sits at the workspace top offset, inside the canonical 20px inset', () => {
  assert.match(shellCss, /\.settings-shell \{\s*padding: 0 20px 40px;/)
  assert.match(shell, /<WorkspaceBackLink path=\{backPath\} label=\{backLabel\} \/>/)
})

test('AboutPanel source: owns the buildInfo-backed content and the copy button', () => {
  const about = read('src/components/settings/AboutPanel.jsx')
  assert.match(about, /from '\.\.\/\.\.\/lib\/buildInfo'/)
  assert.match(about, /navigator\.clipboard\.writeText\(BUILD_SHA\)/)
  assert.match(about, /aria-label="About"/)
  for (const marker of ['BUILD_SHA', 'BUILD_ENV', 'CANONICAL_URL', 'APP_NAME', 'Copy build ID']) {
    assert.ok(about.includes(marker), `AboutPanel keeps ${marker}`)
  }
})

test('generic subtitles are gone; operational guidance survives inside content', () => {
  assert.doesNotMatch(read('src/components/settings/AppearancePanel.jsx'), /Control how ASPIRE Intelligence looks/)
  assert.doesNotMatch(read('src/components/settings/ToursHelpPanel.jsx'), /Replay the guided tour or find your way/)
  const signature = read('src/components/settings/SignaturePanel.jsx')
  assert.match(signature, /manual ASPIRE Connect<\/strong> emails only/)
  assert.match(read('src/components/settings/PreceptorParityPanel.jsx'), /by preceptor identity \(ID\)/)
})

test('canonical SurfaceCard replaces the custom bordered containers', () => {
  for (const f of ['AboutPanel', 'AppearancePanel', 'SignaturePanel', 'ToursHelpPanel']) {
    const src = read(`src/components/settings/${f}.jsx`)
    assert.match(src, /import SurfaceCard from '\.\.\/ui\/SurfaceCard'/, `${f} imports SurfaceCard`)
    assert.doesNotMatch(src, /border: '1px solid var\(--color-border-default[\s\S]{0,80}borderRadius: 12/, `${f} has no custom bordered card`)
  }
})
