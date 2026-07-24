// Commit 3: Unit Leader Portal chrome converges with the Nightfall taskbar.

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const stripJs = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const shell = read('src/portal/PortalShell.jsx')
const app = read('src/portal/PortalApp.jsx')
const css = read('src/portal/portal.css')
const indexCss = read('src/index.css')

const shellCode = stripJs(shell)
const appCode = stripJs(app)

test('canonical Cedars-Sinai logo asset exists and is used by Unit Leader Portal', () => {
  assert.ok(existsSync(join(root, 'public/cs-logo-large.png')))
  assert.match(shellCode, /logoSrc = '\/Cedars-Sinai\.png'/)
  assert.match(shellCode, /src=\{logoSrc\}/)
  assert.match(shellCode, /alt="Cedars-Sinai"/)
  assert.match(appCode, /title="Unit Leader Portal"[\s\S]{0,140}headerVariant="nightfall" logoSrc="\/cs-logo-large\.png"/)
  assert.doesNotMatch(appCode, /title="Student Portal"[\s\S]{0,180}logoSrc="\/cs-logo-large\.png"/)
  assert.doesNotMatch(appCode, /title="Academic Partner Portal"[\s\S]{0,180}logoSrc="\/cs-logo-large\.png"/)
})

test('Nightfall header is opt-in and uses the canonical app token', () => {
  assert.match(indexCss, /--nightfall:\s+#1d2567/)
  assert.match(shellCode, /headerVariant = 'light'/)
  assert.match(shellCode, /headerClass = `ptl-header\$\{headerVariant === 'nightfall' \? ' ptl-header-nightfall' : ''\}`/)
  assert.match(css, /\.ptl-header-nightfall \{[\s\S]*?background: var\(--nightfall/)
  assert.match(css, /\.ptl-header-nightfall \.ptl-header-logo \{[\s\S]*?background: var\(--pearl/)
  assert.match(css, /\.ptl-header-nightfall \.ptl-header-aspire/)
  assert.match(css, /\.ptl-header-nightfall \.ptl-header-sub/)
  assert.match(css, /\.ptl-header-nightfall \.ptl-header-name/)
})

test('Unit Leader title, name, avatar, profile menu, and public site remain', () => {
  assert.match(appCode, /title="Unit Leader Portal"/)
  assert.match(appCode, /userName=\{userProfile\?\.full_name\}/)
  assert.match(appCode, /showHeaderName/)
  assert.match(appCode, /onProfile=\{\(\) => goUnitSection\('profile'\)\}/)
  assert.match(appCode, /publicSiteUrl="https:\/\/aspireintelligence\.app"/)
  assert.match(shellCode, /className="ptl-avatar-btn"/)
  assert.match(shellCode, /aria-haspopup="menu"/)
  assert.match(shellCode, /aria-expanded=\{open\}/)
  assert.match(shellCode, /> Profile<\/button>/)
  assert.match(shellCode, /> Public site/)
  assert.match(shellCode, /> Sign out<\/button>/)
})

test('secondary navigation remains separate from the Nightfall taskbar', () => {
  const unitBranch = appCode.slice(appCode.indexOf("roles.includes('unit_leader')"), appCode.indexOf("roles.includes('academic_partner')"))
  assert.ok(unitBranch.indexOf('<PortalShell') < unitBranch.indexOf('<UnitLeaderPortal'))
  assert.doesNotMatch(shellCode, /UnitLeaderNav|PortalNav|PortalMessagesWorkspace/)
  assert.match(read('src/portal/unit/UnitLeaderChrome.jsx'), /<nav className="ptl-nav" aria-label="Unit Leader Portal sections">/)
  assert.match(css, /\.ptl-nav \{[\s\S]*?background: #fff/)
})

test('staff-only topbar controls are not added to the portal shell', () => {
  for (const forbidden of [
    'cohort selector',
    'CohortSelector',
    'global search',
    'GlobalSearch',
    'ActionCenter',
    'Invite Staff',
    'Grant Portal Access',
    'Accounts & Access',
    'Add Student',
    'is_staff',
  ]) {
    assert.ok(!shellCode.includes(forbidden), `PortalShell must not include ${forbidden}`)
  }
})

test('mobile and accessibility behavior stay explicit', () => {
  assert.match(css, /@media \(max-width: 760px\) \{ \.ptl-header-name \{ display: none; \} \}/)
  assert.match(css, /\.ptl-header-nightfall \*:focus-visible/)
  assert.match(css, /\.ptl-nav-mobile-more/)
  assert.match(css, /\.ptl-sheet \{/)
  assert.match(read('src/portal/unit/UnitLeaderChrome.jsx'), /aria-haspopup="dialog"/)
  assert.match(read('src/portal/unit/UnitLeaderChrome.jsx'), /aria-modal="true"/)
})
