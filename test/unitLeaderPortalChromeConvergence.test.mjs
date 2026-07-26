// Portal chrome convergence: Student and Unit Leader share the Nightfall taskbar.

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
const cssBlock = (selector) => {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) return ''
  const end = css.indexOf('\n}', start)
  return end === -1 ? '' : css.slice(start, end + 2)
}

test('canonical Cedars-Sinai logo asset exists and is used by Student and Unit Leader portals', () => {
  assert.ok(existsSync(join(root, 'public/cs-logo-large.png')))
  assert.match(shellCode, /logoSrc = '\/Cedars-Sinai\.png'/)
  assert.match(shellCode, /src=\{logoSrc\}/)
  assert.match(shellCode, /alt="Cedars-Sinai"/)
  assert.match(appCode, /title="Student Portal"[\s\S]{0,180}headerVariant="nightfall" logoSrc="\/cs-logo-large\.png"/)
  assert.match(appCode, /title="Unit Leader Portal"[\s\S]{0,140}headerVariant="nightfall" logoSrc="\/cs-logo-large\.png"/)
  assert.doesNotMatch(appCode, /title="Academic Partner Portal"[\s\S]{0,180}logoSrc="\/cs-logo-large\.png"/)
})

test('Nightfall header is shared and uses the canonical app token and logo treatment', () => {
  assert.match(indexCss, /--nightfall:\s+#1d2567/)
  assert.match(shellCode, /headerVariant = 'light'/)
  assert.match(shellCode, /headerClass = `ptl-header\$\{headerVariant === 'nightfall' \? ' ptl-header-nightfall' : ''\}`/)
  assert.match(css, /\.ptl-header-nightfall \{[\s\S]*?background: var\(--nightfall/)
  const logo = cssBlock('.ptl-header-nightfall .ptl-header-logo')
  assert.match(logo, /height: 46px/)
  assert.match(logo, /object-fit: contain/)
  assert.doesNotMatch(logo, /background: var\(--pearl/)
  assert.match(css, /\.ptl-header-nightfall \.ptl-header-divider \{[\s\S]*?height: 30px/)
  assert.match(css, /\.ptl-header-nightfall \.ptl-header-aspire/)
  assert.match(css, /\.ptl-header-nightfall \.ptl-header-aspire \{[\s\S]*?font-size: 20px/)
  assert.match(css, /\.ptl-header-nightfall \.ptl-header-sub/)
  assert.match(css, /\.ptl-header-nightfall \.ptl-header-name/)
})

test('the Nightfall gradient and shadow are shared tokens used by the main app and both portals', () => {
  // The single source of truth: tokens defined once, with a dark-theme shadow override.
  assert.match(indexCss, /--nightfall-gradient:\s*linear-gradient\(180deg, #1c2452 0%, #141928 100%\)/)
  assert.match(indexCss, /--nightfall-shadow:\s*0 2px 8px rgba\(29,37,103,0\.25\)/)
  assert.match(indexCss, /\[data-theme="dark"\] \{\s*--nightfall-shadow:\s*0 2px 8px rgba\(0,0,0,0\.40\)/)
  // Main app consumes the tokens (output unchanged; same values).
  assert.match(indexCss, /\.top-section \{[\s\S]*?box-shadow: var\(--nightfall-shadow\)/)
  assert.match(indexCss, /\.app-header \{\s*background: var\(--nightfall-gradient\)/)
  // Both portals (via the shared .ptl-header-nightfall) take the SAME background path as the
  // main-app .app-header: `background: var(--nightfall-gradient)` as the whole background, with no
  // portal-only solid background-color underneath (so the COMPUTED background matches, not just the
  // token). They also consume the shared shadow token.
  const nf = cssBlock('.ptl-header-nightfall')
  assert.match(nf, /background: var\(--nightfall-gradient\)/)
  assert.doesNotMatch(nf, /background:\s*var\(--nightfall,/)      // the old redundant solid layer is gone
  assert.doesNotMatch(nf, /background-image:/)                    // no separate image layer either
  assert.match(nf, /box-shadow: var\(--nightfall-shadow\)/)
  // No portal-only gradient, alternate gradient, or shadow literal remains.
  assert.doesNotMatch(nf, /linear-gradient\(180deg/)
  assert.doesNotMatch(nf, /rgba\(14,20,40/)
})

test('dark theme: the portal taskbar mirrors the main app flat solid, not a gradient that fades to black', () => {
  // The main app swaps the gradient for a flat near-black solid in dark theme.
  assert.match(indexCss, /\[data-theme="dark"\] \.app-header \{\s*background: var\(--color-header-bg, #0A0E14\)/)
  // The portal must do the identical swap so it does not keep the navy gradient (which visibly
  // faded toward black) while the main app is uniform. Same declaration, same token, same fallback.
  assert.match(css, /\[data-theme="dark"\] \.ptl-header-nightfall \{\s*background: var\(--color-header-bg, #0A0E14\)/)
  // No portal-only dark overlay, opacity, filter, or backdrop dims the header in either theme.
  const nf = cssBlock('.ptl-header-nightfall')
  assert.doesNotMatch(nf, /opacity:|filter:|backdrop-filter:|::before|::after/)
})

test('Student and Unit Leader profile photos use safe sources and keep initials fallback', () => {
  assert.match(appCode, /import \{ usePortalHeadshotUrl \} from '\.\.\/lib\/useStudentFile'/)
  assert.match(appCode, /const \{ url: studentHeaderPhotoUrl \} = usePortalHeadshotUrl\(\{ enabled: isStudent \}\)/)
  assert.match(appCode, /profileImageUrl=\{studentHeaderPhotoUrl\}/)
  assert.match(appCode, /profileImageUrl=\{userProfile\?\.avatar_url\}/)
  assert.match(shellCode, /profileImageUrl = null/)
  assert.match(shellCode, /const \[failedImageUrl, setFailedImageUrl\] = useState\(null\)/)
  assert.match(shellCode, /const showPhoto = Boolean\(profileImageUrl && failedImageUrl !== profileImageUrl\)/)
  assert.match(shellCode, /<img src=\{profileImageUrl\} alt="" onError=\{\(\) => setFailedImageUrl\(profileImageUrl\)\} \/>/)
  assert.match(shellCode, /: initials\(userName\)/)
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
  assert.match(css, /\.ptl-header-nightfall \.ptl-header-logo \{ height: 34px; max-width: 112px; \}/)
  assert.match(css, /\.ptl-nav-mobile-more/)
  assert.match(css, /\.ptl-sheet \{/)
  assert.match(read('src/portal/unit/UnitLeaderChrome.jsx'), /aria-haspopup="dialog"/)
  assert.match(read('src/portal/unit/UnitLeaderChrome.jsx'), /aria-modal="true"/)
})
