// SETTINGS-UNIFIED-DESIGN-1: information-architecture guards for the Settings rail.
//
// Appearance, Email Signature, and Tours & Help left the rail and became subsettings
// reached from within General; About is a new Workspace-group rail destination that took
// over the old build/deployment metadata previously nested inside General. These tests
// confirm: the rail is exactly the intended destinations per role, the three subsettings
// remain valid deep links via routableSections, SettingsShell resolves them (including the
// rail active-state fallback to General) and About correctly, GeneralPanel is the grouped
// subsettings hub with no leftover About/buildInfo content, AboutPanel owns the
// buildInfo-backed content, permissions gating for accounts/knowledge/preceptorParity is
// unchanged, and the UserMenu/InterviewersModal deep-link consumers are untouched.
//
// Run: node --test test/settingsUnifiedIa.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SETTINGS_SECTIONS, visibleSections, routableSections } from '../src/components/settings/settingsSections.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

// SETTINGS-UNIFIED-DESIGN-1B: About joined the General hub, so it is a non-rail
// subsetting exactly like the other three.
const NON_RAIL_SUBKEYS = ['appearance', 'signature', 'tours', 'about']

const ROLE_COMBOS = [
  { isOwner: false, isAdmin: false },
  { isOwner: false, isAdmin: true },
  { isOwner: true, isAdmin: true },
]

test('visibleSections: the rail is exactly the intended destinations, never the three subsettings', () => {
  for (const roleFlags of ROLE_COMBOS) {
    const rail = visibleSections(roleFlags).map(s => s.key)

    // Always present, for every role.
    assert.ok(rail.includes('general'), 'General must always be in the rail')

    // Never present - these are General subsettings now.
    for (const key of NON_RAIL_SUBKEYS) {
      assert.ok(!rail.includes(key), `${key} must never be in the rail`)
    }

    // Role-gated destinations match the existing visibility rules.
    assert.equal(rail.includes('accounts'), roleFlags.isAdmin, 'accounts rail membership must match isAdmin')
    // SETTINGS-KEITH-NESTED-1: Knowledge Center is no longer a top-level rail
    // destination. It became a workspace inside Keith, alongside Skills. Its
    // /settings/knowledge route stays routable and redirects there.
    assert.ok(!rail.includes('knowledge'), 'Knowledge Center now lives under Keith, not in the rail')
    assert.ok(!rail.includes('keithSkills') && !rail.includes('keithKnowledge'),
      "Keith's workspaces are reached through Keith, never as their own rail entries")
    assert.equal(rail.includes('preceptorParity'), roleFlags.isOwner, 'preceptorParity rail membership must match isOwner')

    // KEITH-P1: `keith` is now an IMPLEMENTED Administration destination (the
    // Skills workspace), so it belongs in the rail on the same isAdmin rule as
    // Accounts & Access and Knowledge Center. It moved out of the assertion
    // below when it stopped being a scaffold.
    assert.equal(rail.includes('keith'), roleFlags.isAdmin, 'keith rail membership must match isAdmin')

    // No unimplemented scaffolds leak into the rail.
    assert.ok(!rail.includes('templates'))
    assert.ok(!rail.includes('audit'))
  }
})

test('routableSections: appearance/signature/tours remain valid deep links for every role', () => {
  for (const roleFlags of ROLE_COMBOS) {
    const routableKeys = routableSections(roleFlags).map(s => s.key)
    for (const key of NON_RAIL_SUBKEYS) {
      assert.ok(routableKeys.includes(key), `${key} must remain routable for role ${JSON.stringify(roleFlags)}`)
    }
    // routableSections is a superset of visibleSections for the same role.
    const railKeys = visibleSections(roleFlags).map(s => s.key)
    for (const key of railKeys) {
      assert.ok(routableKeys.includes(key), `rail key ${key} must also be routable`)
    }
  }
})

test('the about section is registered correctly', () => {
  const about = SETTINGS_SECTIONS.find(s => s.key === 'about')
  assert.ok(about, 'about section must exist in the registry')
  assert.equal(about.path, '/settings/about')
  assert.equal(about.group, 'Workspace')
  assert.equal(about.implemented, true)
  assert.equal(about.inRail, false, 'about is a General subsetting (Information group), not a rail destination')
  assert.equal(about.visible({ isOwner: false, isAdmin: false }), true, 'about is visible to all users')
})

test('appearance/signature/tours are implemented, visible to all, but opted out of the rail', () => {
  for (const key of NON_RAIL_SUBKEYS) {
    const section = SETTINGS_SECTIONS.find(s => s.key === key)
    assert.ok(section, `${key} section must still exist in the registry`)
    assert.equal(section.implemented, true, `${key} must stay implemented:true`)
    assert.equal(section.visible({ isOwner: false, isAdmin: false }), true, `${key} must stay visible to all users`)
    assert.equal(section.inRail, false, `${key} must be opted out of the rail`)
  }
})

test('SettingsShell source: routing, panel dispatch, and rail-active fallback', () => {
  const shell = read('src/components/settings/SettingsShell.jsx')

  assert.match(shell, /import\s*\{\s*visibleSections,\s*routableSections,\s*SETTINGS_HEADING_STYLE\s*\}\s*from\s*'\.\/settingsSections'/,
    'SettingsShell must import both visibleSections (rail) and routableSections (path matching)')
  assert.doesNotMatch(shell, /import AboutPanel/, 'AboutPanel is now rendered via GeneralPanel, not imported by the shell')
  assert.doesNotMatch(shell, /import AppearancePanel/, 'AppearancePanel is now rendered via GeneralPanel, not imported directly')
  assert.doesNotMatch(shell, /import SignaturePanel/, 'SignaturePanel is now rendered via GeneralPanel, not imported directly')
  assert.doesNotMatch(shell, /import ToursHelpPanel/, 'ToursHelpPanel is now rendered via GeneralPanel, not imported directly')

  // Path matching / normalization uses the routable set, not the rail-only set.
  assert.match(shell, /const routable = routableSections\(roleFlags\)/)
  assert.match(shell, /const knownPaths = routable\.map/)
  assert.match(shell, /const matched = routable\.find/)

  // Normalization effect is unchanged in intent: unknown /settings/* (and bare /settings)
  // still redirect to /settings/general via replace navigation.
  assert.match(shell, /path === '\/settings' \|\| \(path\.startsWith\('\/settings'\) && !knownPaths\.includes\(path\)\)/)
  assert.match(shell, /navigate\('\/settings\/general', \{ replace: true \}\)/)

  // Rail highlight folds appearance/signature/tours into general.
  assert.match(shell, /NON_RAIL_SUBKEYS\s*=\s*\[\s*'appearance',\s*'signature',\s*'tours',\s*'about'\s*\]/)
  // SETTINGS-KEITH-NESTED-1: the fallback gained a second fold - Keith's
  // workspaces highlight the Keith rail entry, so exactly one top-level
  // destination is ever selected.
  assert.match(shell, /railActiveKey = NON_RAIL_SUBKEYS\.includes\(matchedKey\)\s*\n\s*\? 'general'\s*\n\s*: \(KEITH_SUBKEYS\[matchedKey\] \? 'keith' : matchedKey\)/)
  assert.match(shell, /const KEITH_SUBKEYS = \{ keithSkills: 'skills', keithKnowledge: 'knowledge' \}/)
  assert.match(shell, /active = s\.key === railActiveKey/)

  // GeneralPanel receives a subKey for the three subsettings, and always gets onRestartTour
  // so it can reach ToursHelpPanel.
  assert.match(shell, /subKey\s*=\s*NON_RAIL_SUBKEYS\.includes\(matchedKey\)\s*\?\s*matchedKey\s*:\s*undefined/)
  assert.match(shell, /\['general', 'appearance', 'signature', 'tours', 'about'\]\.includes\(currentKey\)/)
  assert.match(shell, /<GeneralPanel subKey=\{subKey\} onRestartTour=\{onRestartTour\}\s*\/>/)
  assert.doesNotMatch(shell, /currentKey === 'about'\s*&&\s*<AboutPanel/, 'about no longer has a standalone dispatch branch')

  // SECTION_ICONS updated: about -> Info, general keeps Settings.
  assert.match(shell, /general:\s*Settings/)
  assert.match(shell, /about:\s*Info/)

  // SETTINGS-VISUAL-DENSITY-1: no per-section max-width remains - every section spans
  // the canonical workspace width.
  assert.doesNotMatch(shell, /maxWidth: currentKey/)
})

test('GeneralPanel source: master-detail hub, narrow-only back affordance, no leftover About content', () => {
  const general = read('src/components/settings/GeneralPanel.jsx')

  // No About/buildInfo content remains - it moved to AboutPanel.jsx. (Prose comments may
  // still mention "About" and "buildInfo" in passing when explaining the move; check for
  // an actual import/usage, not the word appearing anywhere.)
  assert.doesNotMatch(general, /from ['"].*buildInfo['"]/, 'GeneralPanel must not import buildInfo anymore')
  assert.doesNotMatch(general, /BUILD_SHA/, 'GeneralPanel must not reference BUILD_SHA anymore')
  assert.doesNotMatch(general, /AboutSection/, 'the dead AboutSection must be removed from GeneralPanel')
  assert.doesNotMatch(general, /GENERAL_SUBSECTIONS/, 'the dead GENERAL_SUBSECTIONS scaffold must be removed')
  assert.doesNotMatch(general, /role="tablist"/, 'the dead segmented sub-nav scaffold must be removed')

  // Updated heading copy.
  assert.doesNotMatch(general, /Preferences, support, and information/, 'the generic General subtitle is removed')

  // The three subsettings render via the unmodified existing panels.
  assert.match(general, /import AppearancePanel from '\.\/AppearancePanel'/)
  assert.match(general, /import SignaturePanel from '\.\/SignaturePanel'/)
  assert.match(general, /import ToursHelpPanel from '\.\/ToursHelpPanel'/)
  assert.match(general, /<AppearancePanel\s*\/>/)
  assert.match(general, /<SignaturePanel\s*\/>/)
  assert.match(general, /<ToursHelpPanel onRestartTour=\{onRestartTour\}\s*\/>/, 'ToursHelpPanel must still receive onRestartTour')

  // Grouped list rows navigate to the preserved paths.
  assert.match(general, /path:\s*'\/settings\/appearance'/)
  assert.match(general, /path:\s*'\/settings\/signature'/)
  assert.match(general, /path:\s*'\/settings\/tours'/)
  assert.match(general, /onClick=\{\(\) => navigate\(row\.path\)\}/)

  // Back affordance for the subKey views.
  assert.match(general, /function BackToGeneral/)
  assert.match(general, /navigate\('\/settings\/general'\)/)
  assert.match(general, /<BackToGeneral\s*\/>/)

  // Group labels present, matching the target IA.
  assert.match(general, /Preferences/)
  assert.match(general, /Support/)
})

test('AboutPanel source: owns the buildInfo-backed content and the copy button', () => {
  const about = read('src/components/settings/AboutPanel.jsx')

  assert.match(about, /import\s*\{\s*\n?\s*APP_NAME, APP_DESCRIPTION, CANONICAL_URL,/)
  assert.match(about, /BUILD_SHA, BUILD_ENV, environmentLabel, formatBuildTime,/)
  assert.match(about, /from '\.\.\/\.\.\/lib\/buildInfo'/)
  assert.match(about, /copySha/, 'the copy-to-clipboard handler must be present')
  assert.match(about, /navigator\.clipboard\.writeText\(BUILD_SHA\)/)
  assert.match(about, /aria-label="About"/)
  // SETTINGS-VISUAL-DENSITY-1: the heading now comes from the General hub and the
  // generic subtitle is gone - the panel is the SurfaceCard build rows only.
  assert.doesNotMatch(about, /About ASPIRE Intelligence and this deployment\./)
  assert.match(about, /<SurfaceCard padding="6px 18px 14px">/)
})

test('permissions: accounts/knowledge/preceptorParity gating functions are unchanged', () => {
  const accounts = SETTINGS_SECTIONS.find(s => s.key === 'accounts')
  const knowledge = SETTINGS_SECTIONS.find(s => s.key === 'knowledge')
  const preceptorParity = SETTINGS_SECTIONS.find(s => s.key === 'preceptorParity')

  assert.equal(accounts.visible({ isAdmin: true }), true)
  assert.equal(accounts.visible({ isAdmin: false }), false)
  assert.equal(knowledge.visible({ isAdmin: true }), true)
  assert.equal(knowledge.visible({ isAdmin: false }), false)
  assert.equal(preceptorParity.visible({ isOwner: true }), true)
  assert.equal(preceptorParity.visible({ isOwner: false }), false)

  assert.equal(accounts.group, 'Administration')
  // SETTINGS-KEITH-NESTED-1: knowledge no longer carries a rail group, because it
  // is no longer a rail destination. Its VISIBILITY gate above is unchanged, which
  // is what this test is actually protecting.
  assert.equal(knowledge.inRail, false)
  assert.equal(knowledge.group, undefined)
  const keith = SETTINGS_SECTIONS.find(s => s.key === 'keith')
  assert.equal(keith.group, 'Administration')
  assert.equal(keith.visible({ isAdmin: true }), true)
  assert.equal(keith.visible({ isAdmin: false }), false)
  assert.equal(preceptorParity.group, 'Diagnostics')
})

test('deep-link consumers unchanged: UserMenu -> /settings/general, InterviewersModal -> /settings/accounts', () => {
  const userMenu = read('src/components/UserMenu.jsx')
  const interviewersModal = read('src/components/InterviewersModal.jsx')

  assert.match(userMenu, /navigate\('\/settings\/general'\)/, 'UserMenu must still navigate to /settings/general')
  assert.match(interviewersModal, /navigate\('\/settings\/accounts'\)/, 'InterviewersModal must still navigate to /settings/accounts')
})

// ── SETTINGS-UNIFIED-DESIGN-1B: General > Information > About ────────────────

test('General hub lists About in the flat subsettings list and renders it as a subsetting', () => {
  const general = read('src/components/settings/GeneralPanel.jsx')
  // Flat list entry navigating to the preserved deep link - no grouped presentation.
  assert.match(general, /key: 'about',\s+path: '\/settings\/about'/)
  assert.doesNotMatch(general, /title: 'Information'/)
  // AboutPanel renders unmodified inside the hub.
  assert.match(general, /import AboutPanel from '\.\/AboutPanel'/)
  // The hub still never carries the build content itself.
  assert.doesNotMatch(general, /BUILD_SHA|from ['"].*buildInfo['"]/)
})

test('AboutPanel is unchanged: build fields and the copy button stay in AboutPanel.jsx', () => {
  const about = read('src/components/settings/AboutPanel.jsx')
  for (const marker of ['BUILD_SHA', 'BUILD_ENV', 'CANONICAL_URL', 'APP_NAME', 'Copy build ID']) {
    assert.ok(about.includes(marker), `AboutPanel keeps ${marker}`)
  }
})

test('mobile: the rail stacking rule survives the About restructure', () => {
  const shell = read('src/components/settings/SettingsShell.jsx')
  // The <=768px rule that stacks the rail above the panel is still present.
  assert.match(shell, /@media \(max-width: 768px\) \{ \.settings-nav-rail \{ position: static/)
})

// ── SETTINGS-UNIFIED-DESIGN-1C: responsive three-pane master-detail ──────────

test('the middle-pane subsettings list is flat and alphabetical', () => {
  const general = read('src/components/settings/GeneralPanel.jsx')
  // Extract the SUBSETTINGS array labels in source order.
  const block = general.slice(general.indexOf('const SUBSETTINGS'), general.indexOf(']', general.indexOf('const SUBSETTINGS')))
  const labels = [...block.matchAll(/label: '([^']+)'/g)].map(m => m[1])
  assert.deepEqual(labels, ['About', 'Appearance', 'Email Signature', 'Tours & Help'])
  const sorted = [...labels].sort((a, b) => a.localeCompare(b))
  assert.deepEqual(labels, sorted, 'list must be alphabetical by label')
  // No grouped eyebrows remain anywhere in the hub.
  assert.doesNotMatch(general, /title: 'Preferences'|title: 'Support'|title: 'Information'/)
})

test('About is the automatic desktop selection when General opens without a subKey', () => {
  const general = read('src/components/settings/GeneralPanel.jsx')
  assert.match(general, /const selectedKey = subKey \|\| 'about'/)
  // Default content resolution falls back to AboutPanel.
  assert.match(general, /return <AboutPanel \/>/)
})

test('desktop master-detail: list and content side by side, row selection, no Back', () => {
  const general = read('src/components/settings/GeneralPanel.jsx')
  // Middle pane (fixed basis) + right pane (flexible) rendered together on desktop.
  assert.match(general, /flex: '0 0 248px'[\s\S]{0,300}<SubsettingsList activeKey=\{selectedKey\}/)
  assert.match(general, /<SubsettingContent subKey=\{selectedKey\}/)
  // Rows navigate to the real routes so deep links and back/forward work.
  assert.match(general, /onClick=\{\(\) => navigate\(row\.path\)\}/)
  // Selected row is announced (aria-current), matching the rail's language.
  assert.match(general, /aria-current=\{active \? 'page' : undefined\}/)
  // The Back affordance renders ONLY in the narrow drill-down branch: it must appear
  // inside the `if (narrow)` block and nowhere after the desktop return begins.
  const narrowIdx = general.indexOf('if (narrow)')
  const desktopIdx = general.indexOf('Desktop master-detail: middle list + right content')
  const backUses = [...general.matchAll(/<BackToGeneral \/>/g)].map(m => m.index)
  assert.equal(backUses.length, 1, 'exactly one BackToGeneral usage')
  assert.ok(backUses[0] > narrowIdx && backUses[0] < desktopIdx, 'Back renders only in the narrow branch')
})

test('deep links select the matching middle-pane row for all four subsettings', () => {
  const general = read('src/components/settings/GeneralPanel.jsx')
  for (const key of ['about', 'appearance', 'signature', 'tours']) {
    assert.match(general, new RegExp(`key: '${key}',\\s+path: '/settings/${key === 'signature' ? 'signature' : key}'`))
  }
  // subKey (from the route) IS the selection: activeKey={selectedKey} with selectedKey = subKey || 'about'.
  assert.match(general, /const selectedKey = subKey \|\| 'about'/)
})

test('every section uses the full canonical workspace width (no caps)', () => {
  const shell = read('src/components/settings/SettingsShell.jsx')
  assert.doesNotMatch(shell, /maxWidth: currentKey/, 'the per-section maxWidth rule is gone')
  assert.doesNotMatch(shell, /maxWidth: (1040|720)/, 'no fixed width caps remain in the shell')
})

test('responsive fallback: narrow widths use drill-down, never three squeezed columns', () => {
  const general = read('src/components/settings/GeneralPanel.jsx')
  // A viewport hook at the shell's 768 breakpoint gates the two presentations.
  assert.match(general, /function useIsNarrow\(bp = 768\)/)
  assert.match(general, /if \(narrow\)/)
  // Narrow with a subsetting: Back + content; narrow without: list only.
  assert.match(general, /<BackToGeneral \/>[\s\S]{0,120}<SubsettingContent subKey=\{subKey\}/)
  assert.match(general, /<SubsettingsList activeKey=\{null\} \/>/)
  // Desktop panes may wrap rather than overflow (no horizontal scroll).
  assert.match(general, /flexWrap: 'wrap'/)
})

// ── SETTINGS-VISUAL-DENSITY-1: hierarchy, density, and canonical surfaces ────

test('the back breadcrumb sits at the workspace top offset with no extra shell padding', () => {
  const shell = read('src/components/settings/SettingsShell.jsx')
  // No shell-owned top/side padding: the breadcrumb inherits .app-main's 20px top,
  // matching the Interview Rubric's spacing, and Settings spans the canonical width.
  // SETTINGS-VISUAL-DENSITY-1B (measured): 20px horizontal padding is the canonical
  // card-column inset every main tab applies inside .app-main; no extra top padding.
  assert.match(shell, /padding: '0 20px 40px'/)
  assert.doesNotMatch(shell, /padding: '20px 32px 40px'/)
  assert.doesNotMatch(shell, /padding: '0 0 40px'/)
})

test('Settings | General | subsetting headings share one heading spec (one baseline)', () => {
  const sections = read('src/components/settings/settingsSections.js')
  assert.match(sections, /export const SETTINGS_HEADING_STYLE = \{/)
  const shell = read('src/components/settings/SettingsShell.jsx')
  assert.match(shell, /<h1 style=\{SETTINGS_HEADING_STYLE\}>Settings<\/h1>/)
  const general = read('src/components/settings/GeneralPanel.jsx')
  assert.match(general, /<h2 id="settings-general-heading" style=\{SETTINGS_HEADING_STYLE\}>General<\/h2>/)
  assert.match(general, /<h3 style=\{SETTINGS_HEADING_STYLE\}>\{selectedRow\?\.label \|\| 'About'\}<\/h3>/)
  // Primary sections align their first heading to the same spec.
  assert.match(read('src/components/settings/AccountsDirectory.jsx'), /\.\.\.SETTINGS_HEADING_STYLE/)
  assert.match(read('src/components/settings/PreceptorParityPanel.jsx'), /\.\.\.SETTINGS_HEADING_STYLE/)
  assert.match(read('src/components/settings/SettingsPageHeader.jsx'), /\.\.\.SETTINGS_HEADING_STYLE/)
})

test('generic subtitles are gone; operational guidance survives inside content', () => {
  const shell = read('src/components/settings/SettingsShell.jsx')
  assert.doesNotMatch(shell, /Manage your ASPIRE Intelligence workspace, preferences, access, and resources\./)
  assert.doesNotMatch(read('src/components/settings/AppearancePanel.jsx'), /Control how ASPIRE Intelligence looks/)
  assert.doesNotMatch(read('src/components/settings/ToursHelpPanel.jsx'), /Replay the guided tour or find your way/)
  // Email-signature scope guidance survives INSIDE the card content.
  const signature = read('src/components/settings/SignaturePanel.jsx')
  assert.match(signature, /manual ASPIRE Connect<\/strong> emails only/)
  assert.match(signature, /<SurfaceCard padding=\{18\}>[\s\S]{0,400}manual ASPIRE Connect/)
  // Preceptor Parity methodology guidance survives in its content intro.
  const parity = read('src/components/settings/PreceptorParityPanel.jsx')
  assert.match(parity, /by preceptor identity \(ID\)/)
})

test('canonical SurfaceCard replaces the custom bordered containers', () => {
  for (const f of ['AboutPanel', 'AppearancePanel', 'SignaturePanel', 'ToursHelpPanel']) {
    const src = read(`src/components/settings/${f}.jsx`)
    assert.match(src, /import SurfaceCard from '\.\.\/ui\/SurfaceCard'/, `${f} imports SurfaceCard`)
    // Card-level borders only (the old container pattern paired the border with a
    // 12px radius); small control borders like About's copy button are fine.
    assert.doesNotMatch(src, /border: '1px solid var\(--color-border-default[\s\S]{0,80}borderRadius: 12/, `${f} has no custom bordered card`)
  }
  // No stray cardStyle constant remains in ToursHelpPanel.
  assert.doesNotMatch(read('src/components/settings/ToursHelpPanel.jsx'), /const cardStyle/)
})

test('responsive: mobile drill-down and back affordance survive the density pass', () => {
  const general = read('src/components/settings/GeneralPanel.jsx')
  assert.match(general, /if \(narrow\)/)
  assert.match(general, /<BackToGeneral \/>[\s\S]{0,200}<SubsettingContent subKey=\{subKey\}/)
  // The mobile detail view now carries the subsetting heading (panels no longer do).
  assert.match(general, /<h2 style=\{SETTINGS_HEADING_STYLE\}>\{row\?\.label \|\| 'General'\}<\/h2>/)
  // Desktop three-heading layout is never forced narrow: the desktop branch is
  // unreachable when narrow (early returns above it).
  const narrowIdx = general.indexOf('if (narrow)')
  const desktopIdx = general.indexOf('Desktop master-detail: middle list')
  assert.ok(narrowIdx > -1 && desktopIdx > narrowIdx)
  // Panes wrap rather than overflow.
  assert.match(general, /flexWrap: 'wrap'/)
})

// ── SETTINGS-VISUAL-DENSITY-1B: rail-matched subsettings navigation ──────────

test('the General subsettings list mirrors the primary rail: padded card, inset pills, no dividers', () => {
  const general = read('src/components/settings/GeneralPanel.jsx')
  // Rounded SurfaceCard with 10px internal padding, like the rail (radius 14 / padding 10).
  assert.match(general, /<SurfaceCard as="nav" aria-label="General subsettings" radius=\{14\} padding=\{10\}>/)
  // Rows are inset pills with a 10px radius - including the selected one (navy pill + shadow).
  assert.match(general, /borderRadius: 10, marginBottom: ri === SUBSETTINGS\.length - 1 \? 0 : 4/)
  assert.match(general, /boxShadow: active \? '0 1px 3px rgba\(29,37,103,0\.30\)' : 'none'/)
  // No full-bleed rows and no divider lines remain.
  assert.doesNotMatch(general, /borderTop: ri === 0/)
  assert.doesNotMatch(general, /1px solid var\(--color-border-subtle, #f3f4f6\)'/)
  // Compact navigation column close to the rail's 236px footprint.
  assert.match(general, /flex: '0 0 248px', minWidth: 220/)
  // Alphabetical order, routing, and a11y unchanged (already asserted above; re-pin the essentials).
  assert.match(general, /aria-current=\{active \? 'page' : undefined\}/)
  assert.match(general, /onClick=\{\(\) => navigate\(row\.path\)\}/)
})
