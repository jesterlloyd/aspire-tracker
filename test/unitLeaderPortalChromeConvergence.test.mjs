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
  assert.match(shellCode, /const nightfall = headerVariant === 'nightfall'/)
  assert.match(shellCode, /headerClass = `ptl-header\$\{nightfall \? ' ptl-header-nightfall' : ''\}`/)
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

test('the Nightfall header reuses the main app .app-header behavior exactly (gradient only, no own shadow)', () => {
  // The single source of truth: tokens defined once, with a dark-theme shadow override.
  assert.match(indexCss, /--nightfall-gradient:\s*linear-gradient\(180deg, #1c2452 0%, #141928 100%\)/)
  assert.match(indexCss, /--nightfall-shadow:\s*0 2px 8px rgba\(29,37,103,0\.25\)/)
  assert.match(indexCss, /\[data-theme="dark"\] \{\s*--nightfall-shadow:\s*0 2px 8px rgba\(0,0,0,0\.40\)/)
  // In the main app the Nightfall shadow lives on the .top-section wrapper (one tier below the dark
  // bar, beneath the light tab bar); the dark bar .app-header itself has gradient and nothing else.
  assert.match(indexCss, /\.top-section \{[\s\S]*?box-shadow: var\(--nightfall-shadow\)/)
  assert.match(indexCss, /\.app-header \{\s*background: var\(--nightfall-gradient\);?\s*\}/)
  // The portal dark bar must render identically to .app-header: gradient as the whole background,
  // no portal-only solid underneath, and crucially NO box-shadow of its own (which had floated it).
  const nfCode = stripJs(cssBlock('.ptl-header-nightfall'))   // strip the explanatory comment first
  assert.match(nfCode, /background: var\(--nightfall-gradient\)/)
  assert.doesNotMatch(nfCode, /background:\s*var\(--nightfall,/)  // the old redundant solid layer is gone
  assert.doesNotMatch(nfCode, /background-image:/)               // no separate image layer either
  assert.doesNotMatch(nfCode, /box-shadow/)                      // no own shadow, exactly like .app-header
  // No portal-only gradient, alternate gradient, or shadow literal remains.
  assert.doesNotMatch(nfCode, /linear-gradient\(180deg/)
  assert.doesNotMatch(nfCode, /rgba\(14,20,40/)
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

test('the section nav is the attached solid light row inside the shared top-section chrome', () => {
  // Mirror of the main app .top-section: one sticky wrapper holds the header AND the nav, the
  // Nightfall shadow rides the wrapper (not the header), and the nav is a solid, full-bleed, attached
  // light bar (theme-aware --bg-card token, hairline bottom border) directly beneath the header.
  assert.match(shellCode, /const chromeClass = `ptl-topsection\$\{nightfall \? ' ptl-topsection-nightfall' : ''\}`/)
  assert.match(shellCode, /<div className=\{chromeClass\}>[\s\S]*?<header className=\{headerClass\}>[\s\S]*?<\/header>\s*\{nav\}\s*<\/div>/)
  assert.match(css, /\.ptl-topsection \{ position: sticky; top: 0; z-index: 20; \}/)
  assert.match(css, /\.ptl-topsection-nightfall \{ box-shadow: var\(--nightfall-shadow\); \}/)
  // Stickiness moved off the header onto the wrapper: no .ptl-header rule declares position: sticky.
  assert.doesNotMatch(css, /\.ptl-header \{[^}]*position: sticky/)
  // The nav row: attached (no bottom margin), full-bleed solid light bar with a hairline border.
  const navBlock = cssBlock('.ptl-nav')
  assert.match(navBlock, /background: var\(--bg-card, #fafaf7\)/)
  assert.match(navBlock, /border-bottom: 1px solid var\(--ptl-line/)
  assert.doesNotMatch(navBlock, /margin-bottom/)
  // The shell renders whatever nav each portal passes; it does not hard-code a role's nav component.
  assert.doesNotMatch(shellCode, /UnitLeaderNav|PortalNav|PortalMessagesWorkspace/)
  assert.match(appCode, /nav=\{<UnitLeaderNav view=\{unitView\} unread=\{unread\} onNavigate=\{goUnitSection\} \/>\}/)
  assert.match(appCode, /nav=\{\(\s*<PortalNav/)
  assert.match(read('src/portal/unit/UnitLeaderChrome.jsx'), /<nav className="ptl-nav" aria-label="Unit Leader Portal sections">/)
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
