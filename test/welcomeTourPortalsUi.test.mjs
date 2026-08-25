// WELCOME-TOUR-PORTALS-1: source-guard tests for the portal-side Welcome Tour anchors,
// mount, and restart wiring. This suite only covers the PORTAL half (PortalNav,
// UnitLeaderChrome, AcademicPartnerChrome, PortalShell, PortalApp). The staff-side
// tour engine (src/lib/onboardingTours.js, src/components/CustomOnboardingTour.jsx,
// src/App.jsx, src/components/settings/ToursHelpPanel.jsx) is owned by a parallel
// change and is exercised by test/welcomeTourPortalsCore.test.mjs, not here.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const nav = read('src/portal/PortalNav.jsx')
const unitChrome = read('src/portal/unit/UnitLeaderChrome.jsx')
const apChrome = read('src/portal/ap/AcademicPartnerChrome.jsx')
const shell = read('src/portal/PortalShell.jsx')
const app = read('src/portal/PortalApp.jsx')
const segmentedTabs = read('src/components/ui/SegmentedTabs.jsx')
const pkg = read('package.json')

const navCode = stripJs(nav)
const unitCode = stripJs(unitChrome)
const apCode = stripJs(apChrome)
const shellCode = stripJs(shell)
const appCode = stripJs(app)

test('no em dash anywhere in the changed portal files', () => {
  for (const [name, src] of [
    ['PortalNav.jsx', nav], ['UnitLeaderChrome.jsx', unitChrome], ['AcademicPartnerChrome.jsx', apChrome],
    ['PortalShell.jsx', shell], ['PortalApp.jsx', app], ['SegmentedTabs.jsx', segmentedTabs],
  ]) {
    assert.ok(!src.includes('—'), `${name} contains an em dash`)
  }
})

// ── PortalNav ────────────────────────────────────────────────────────────────

test('PortalNav carries the Home and Messages tour anchors', () => {
  assert.match(navCode, /className=\{`ptl-nav-item\$\{view === 'home' \? ' ptl-nav-item-active' : ''\}`\}[\s\S]{0,120}data-tour="portal-nav-home"/)
  assert.match(navCode, /className=\{`ptl-nav-item\$\{view === 'messages' \? ' ptl-nav-item-active' : ''\}`\}[\s\S]{0,160}data-tour="portal-nav-messages"/)
})

test('PortalNav carries portal-nav-action on both the <a> and <button> stage-action variants', () => {
  assert.match(navCode, /<a className="ptl-nav-item ptl-nav-action" href=\{action\.href\} data-tour="portal-nav-action">/)
  assert.match(navCode, /<button type="button" className="ptl-nav-item ptl-nav-action" data-tour="portal-nav-action" onClick=\{action\.onActivate\}>/)
})

// ── UnitLeaderChrome ─────────────────────────────────────────────────────────

test('UnitLeaderChrome: NavItem (main bar) carries portal-nav-<key> for all six sections', () => {
  assert.match(unitCode, /function NavItem\(\{ section, active, unread, onNavigate \}\) \{/)
  assert.match(unitCode, /data-tour=\{`portal-nav-\$\{key\}`\}/)
  for (const key of ['home', 'preceptors', 'messages', 'evaluations', 'placements', 'capacity']) {
    assert.ok(unitCode.includes(`key: '${key}'`), `SECTIONS is missing key ${key}`)
  }
})

test('UnitLeaderChrome: the anchor is on NavItem, which MoreSheet does not use', () => {
  // MoreSheet renders its own <button className="ptl-sheet-item"> items directly from SECTIONS,
  // never through NavItem, so it never receives the portal-nav-* anchor.
  const moreSheetStart = unitCode.indexOf('function MoreSheet(')
  const moreSheetEnd = unitCode.indexOf('\nexport function UnitLeaderNav', moreSheetStart)
  const moreSheetBody = unitCode.slice(moreSheetStart, moreSheetEnd)
  assert.ok(moreSheetStart > -1 && moreSheetEnd > moreSheetStart)
  assert.doesNotMatch(moreSheetBody, /data-tour/)
  assert.match(moreSheetBody, /className="ptl-sheet-item"/)
  // The main bar (UnitLeaderNav) is the only caller of NavItem.
  const navItemUsages = (unitCode.match(/<NavItem\b/g) || []).length
  assert.equal(navItemUsages, 1)
  const unitLeaderNavStart = unitCode.indexOf('export function UnitLeaderNav')
  assert.ok(unitCode.indexOf('<NavItem') > unitLeaderNavStart)
})

test('UnitLeaderChrome: the unit switcher carries portal-unit-switcher on its rendered wrapper', () => {
  const switcherStart = unitCode.indexOf('export function UnitSwitcher')
  const switcherEnd = unitCode.indexOf('\n/**', switcherStart)
  const switcherBody = unitCode.slice(switcherStart, switcherEnd)
  assert.match(switcherBody, /if \(unitKeys\.length === 0\) return null/)
  assert.match(switcherBody, /dataTour="portal-unit-switcher"/)
  // The single-unit static line is not the switcher and must not carry the anchor.
  const singleUnitLine = switcherBody.match(/if \(unitKeys\.length === 1\) \{[\s\S]*?\}/)?.[0] || ''
  assert.ok(singleUnitLine.length > 0)
  assert.doesNotMatch(singleUnitLine, /data-tour|dataTour/)
})

test('SegmentedTabs forwards an optional dataTour prop to its root element only when passed', () => {
  const stCode = stripJs(segmentedTabs)
  assert.match(stCode, /export default function SegmentedTabs\(\{ label, items = \[\], value, onChange, className = '', dataTour \}\)/)
  assert.match(stCode, /data-tour=\{dataTour\}/)
})

// ── AcademicPartnerChrome ────────────────────────────────────────────────────

test('AcademicPartnerChrome carries portal-nav-<key> for all three sections, including placement-requests', () => {
  assert.match(apCode, /data-tour=\{`portal-nav-\$\{key\}`\}/)
  for (const key of ['students', 'placement-requests', 'messages']) {
    assert.ok(apCode.includes(`key: '${key}'`), `SECTIONS is missing key ${key}`)
  }
})

// ── PortalShell ──────────────────────────────────────────────────────────────

test('PortalShell: the profile menu avatar button carries portal-profile-menu', () => {
  assert.match(shellCode, /className="ptl-avatar-btn"[\s\S]{0,160}data-tour="portal-profile-menu"/)
})

test('PortalShell: the shared header controls wrapper carries portal-scope-selector', () => {
  assert.match(shellCode, /<span className="ptl-header-controls" ref=\{setControlsSlot\} data-tour="portal-scope-selector" \/>/)
})

test('PortalShell: ProfileMenu renders Restart Welcome Tour only when onRestartTour is provided, before Sign out', () => {
  assert.match(shellCode, /function ProfileMenu\(\{[^)]*onRestartTour[^)]*\}\)/)
  assert.match(shellCode, /\{onRestartTour && \([\s\S]{0,200}Restart Welcome Tour[\s\S]{0,40}\)\}/)
  const publicSiteIdx = shellCode.indexOf('Public site')
  const restartIdx = shellCode.indexOf('Restart Welcome Tour')
  const signOutIdx = shellCode.indexOf('<LogOut size={15} /> Sign out')
  assert.ok(publicSiteIdx > -1 && restartIdx > -1 && signOutIdx > -1)
  assert.ok(publicSiteIdx < restartIdx && restartIdx < signOutIdx, 'Restart Welcome Tour must sit between Public site and Sign out')
})

test('PortalShell: onRestartTour is accepted and threaded through to ProfileMenu', () => {
  // PROFILE-MENU-AVATARS-1: onChangePhoto joined the threaded props, widening
  // the character span between the first ProfileMenu prop and onRestartTour.
  assert.match(shellCode, /export default function PortalShell\(\{[\s\S]{0,400}onRestartTour,[\s\S]{0,60}children,/)
  assert.match(shellCode, /<ProfileMenu userName=\{userName\} profileImageUrl=\{profileImageUrl\}[\s\S]{0,220}onRestartTour=\{onRestartTour\} \/>/)
})

// ── PortalApp ────────────────────────────────────────────────────────────────

test('PortalApp imports CustomOnboardingTour and shouldAutoStartTour from the contract modules', () => {
  assert.match(appCode, /import CustomOnboardingTour from '\.\.\/components\/CustomOnboardingTour'/)
  assert.match(appCode, /import \{ shouldAutoStartTour \} from '\.\.\/lib\/onboardingTours'/)
})

test('PortalApp derives one experience string from the resolved role booleans', () => {
  assert.match(appCode, /const experience = isStudent \? 'student' : isUnitLeader \? 'unit_leader' : isAcademicPartner \? 'academic_partner' : isNursingAcademic \? 'nursing_academic' : null/)
})

test('PortalApp mounts CustomOnboardingTour with experience and context.apMessagesEnabled', () => {
  assert.match(appCode, /<CustomOnboardingTour[\s\S]{0,200}run=\{tourRunning\}[\s\S]{0,120}onClose=\{\(\) => setTourRunning\(false\)\}[\s\S]{0,120}experience=\{experience\}[\s\S]{0,120}context=\{\{ apMessagesEnabled \}\}/)
  // Mounted once (not duplicated per branch by literal repetition of the tag), reused via a variable.
  const tagCount = (appCode.match(/<CustomOnboardingTour\b/g) || []).length
  assert.equal(tagCount, 1)
  const overlayUsages = (appCode.match(/\{tourOverlay\}/g) || []).length
  assert.equal(overlayUsages, 4, 'tourOverlay must be included in all four PortalShell branches (student, unit_leader, academic_partner, nursing_academic)')
})

test('PortalApp: auto-start is armed exactly once via a ref guard', () => {
  assert.match(appCode, /const tourArmedRef = useRef\(false\)/)
  assert.match(appCode, /if \(tourArmedRef\.current\) return/)
  assert.match(appCode, /tourArmedRef\.current = true/)
  // The armed flag is set before scheduling, and scheduling happens exactly once per arm.
  const setTimeoutCount = (appCode.match(/setTimeout\(\(\) => setTourRunning\(true\), 700\)/g) || []).length
  assert.equal(setTimeoutCount, 1)
})

test('PortalApp: the Academic Partner auto-start waits for the capability fetch to settle', () => {
  assert.match(appCode, /const \[apCapabilityResolved, setApCapabilityResolved\] = useState\(false\)/)
  // The resolved flag is set on every settle path of the capability effect: no token, non-ok
  // response, success, and the catch block.
  assert.match(appCode, /if \(!token\) \{ if \(!cancelled\) setApCapabilityResolved\(true\); return \}/)
  assert.match(appCode, /if \(!res\.ok\) \{ setApCapabilityResolved\(true\); return \}/)
  assert.match(appCode, /setApMessagingCapable\(data\?\.ap_messaging === true\)[\s\S]{0,120}setApCapabilityResolved\(true\)/)
  assert.match(appCode, /catch \{[\s\S]{0,120}if \(!cancelled\) setApCapabilityResolved\(true\)/)
  // The auto-start guard itself blocks on this flag for academic_partner only.
  assert.match(appCode, /if \(experience === 'academic_partner' && !apCapabilityResolved\) return/)
  // Student and Unit Leader do not depend on any AP-only capability state to arm.
  assert.match(appCode, /if \(!userProfile \|\| userProfile\.onboarding_tour_completed === undefined\) return/)
})

test('PortalApp: auto-start effect also gates on shouldAutoStartTour(userProfile, experience)', () => {
  assert.match(appCode, /if \(!shouldAutoStartTour\(userProfile, experience\)\) return/)
})

test('PortalApp: onRestartTour is wired into all three PortalShell usages', () => {
  // PROFILE-MENU-AVATARS-1: each mount gained onChangePhoto (and the student
  // mount the canonical publicSiteUrl), widening the span before onRestartTour.
  assert.match(appCode, /title="Student Portal"[\s\S]{0,400}onRestartTour=\{\(\) => setTourRunning\(true\)\}/)
  assert.match(appCode, /title="Unit Leader Portal"[\s\S]{0,400}onRestartTour=\{\(\) => setTourRunning\(true\)\}/)
  assert.match(appCode, /title="Academic Partner Portal"[\s\S]{0,400}onRestartTour=\{\(\) => setTourRunning\(true\)\}/)
  assert.match(appCode, /title="Nursing Education & Leadership Portal"[\s\S]{0,500}onRestartTour=\{\(\) => setTourRunning\(true\)\}/)
  const wiredCount = (appCode.match(/onRestartTour=\{\(\) => setTourRunning\(true\)\}/g) || []).length
  assert.equal(wiredCount, 4)
})

// ── No new third-party tour dependency ────────────────────────────────────────

test('no joyride/shepherd/intro.js dependency was introduced', () => {
  assert.doesNotMatch(pkg, /"react-joyride"|"joyride"|"shepherd\.js"|"intro\.js"|"react-shepherd"/)
})
