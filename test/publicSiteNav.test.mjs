// ASPIRE-MOBILE-NAV: static-source guards for the simplified public-site mobile
// header + compact menu popover, and the enlarged Student Portal hero avatar.
// Run: node --test test/publicSiteNav.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const site = read('src/public-site/PublicSite.jsx')
const css = read('src/public-site/publicSite.css')
const content = read('src/public-site/publicContent.js')
const portalCss = read('src/portal/portal.css')
const portal = read('src/portal/StudentPortal.jsx')

test('public-site mobile header + compact menu', async (t) => {
  await t.test('the old full-screen drawer is gone', () => {
    assert.doesNotMatch(site, /ps-drawer/)
    assert.doesNotMatch(css, /ps-drawer/)
    assert.doesNotMatch(site, /aria-modal="true"/, 'no modal drawer')
    assert.doesNotMatch(site, /document\.body\.style\.overflow = 'hidden'/, 'no scroll lock')
  })

  await t.test('the hamburger button is present and accessible', () => {
    assert.match(site, /className="ps-nav-toggle" ref=\{toggleRef\}/)
    assert.match(site, /aria-haspopup="menu"/)
    assert.match(site, /aria-expanded=\{open\}/)
    assert.match(site, /aria-label=\{open \? 'Close menu' : 'Open menu'\}/)
  })

  await t.test('Open Portal is NOT a separate mobile header button (hidden on mobile, in the menu)', () => {
    // The inline header action is hidden on mobile via CSS.
    assert.match(css, /\.ps-header-actions > \.ps-login-btn \{ display: none; \}/)
    // Open Portal lives inside the menu popover as an emphasized full-width action.
    assert.match(site, /<div className="ps-menu-foot">[\s\S]*?to="\/portal"[\s\S]*?ps-btn ps-btn-primary ps-btn-block/)
  })

  await t.test('the compact popover contains all seven nav links', () => {
    // Menu maps NAV_LINKS; verify the canonical labels exist.
    for (const label of ['About', 'Eligibility', 'How to Apply', 'The Experience', 'For Preceptors', 'FAQ', 'Contact']) {
      assert.match(content, new RegExp(`label: '${label}'`), `NAV_LINKS missing ${label}`)
    }
    assert.match(site, /id="ps-menu"[\s\S]*?role="menu"/)
    assert.match(site, /role="menuitem" className="ps-menu-item"/)
  })

  await t.test('menu closes on Escape, on outside click, and returns focus to the toggle', () => {
    assert.match(site, /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); close\(\) \}/)
    assert.match(site, /const onDocDown = \(e\) => \{[\s\S]*?setOpenFor\(null\)/)
    assert.match(site, /addEventListener\('mousedown', onDocDown\)/)
    assert.match(site, /const close = \(\) => \{[\s\S]*?toggleRef\.current\.focus\(\)/)
  })

  await t.test('the compact popover is a right-aligned card, hidden on desktop', () => {
    assert.match(css, /\.ps-menu \{[\s\S]*?position: absolute;[\s\S]*?right: 0;[\s\S]*?border-radius: 14px;[\s\S]*?box-shadow:/)
    assert.match(css, /@media \(min-width: 761px\) \{\s*\.ps-menu \{ display: none; \}/)
    assert.match(css, /env\(safe-area-inset-top/, 'header respects the safe area')
    // No conflicting left positioning on the menu.
    assert.doesNotMatch(css, /\.ps-menu \{[^}]*left:/)
  })

  await t.test('the header inner fills the full width so the hamburger reaches the far right', () => {
    // Root cause fix: .ps-header-inner must not shrink-wrap inside the flex header.
    assert.match(css, /\.ps-header-inner \{[\s\S]*?flex: 1;/)
    assert.match(css, /\.ps-header-actions \{ margin-left: auto; \}/, 'mobile actions pushed to the far right')
  })

  await t.test('desktop navigation is unchanged (inline nav + inline action)', () => {
    assert.match(site, /<nav className="ps-nav" aria-label="Primary">[\s\S]*?NAV_LINKS\.map/)
    assert.match(site, /\? <Link to="\/portal" className="ps-login-btn">Open Portal<\/Link>/)
    // Desktop still hides the hamburger until <=760px.
    assert.match(css, /\.ps-nav-toggle \{\s*display: none;/)
    assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.ps-nav-toggle \{ display: flex; \}/)
  })
})

test('Student Portal hero avatar is larger and keeps the initials fallback', async (t) => {
  await t.test('desktop avatar is ~72-88px with a preserved ring', () => {
    assert.match(portalCss, /\.ptl-hero \.ptl-avatar \{ width: 80px; height: 80px;[\s\S]*?border: 3px solid rgba\(255,255,255/)
  })
  await t.test('mobile avatar is ~72-84px', () => {
    assert.match(portalCss, /\.ptl-hero \.ptl-avatar \{ width: 72px; height: 72px;/)
  })
  await t.test('circular crop and non-stretch image are preserved', () => {
    assert.match(portalCss, /\.ptl-avatar \{[\s\S]*?border-radius: 50%;/)
    assert.match(portalCss, /\.ptl-avatar img \{ width: 100%; height: 100%; object-fit: cover; \}/)
  })
  await t.test('initials fallback remains when no photo exists', () => {
    assert.match(portal, /student\.headshot_url \? <img[\s\S]*?: initials\(fullName\)/)
    assert.match(portal, /alt=""/, 'decorative avatar image has empty alt (initials carry identity)')
  })
})
