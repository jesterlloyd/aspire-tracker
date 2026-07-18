// ASPIRE-PUBLIC-VISUALS: static-source guards for the public-site editorial
// system after "The Pathway" redesign. Protects the illustration treatment,
// the Cedars-Sinai white-mark watermark, mobile stacking, and the responsive
// navigation thresholds. Run: node --test test/publicSiteVisuals.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const site = read('src/public-site/PublicSite.jsx')
const css = read('src/public-site/publicSite.css')

// Isolate the phone block so "mobile preserved" assertions cannot
// accidentally match desktop rules.
const mobileBlock = css.slice(css.indexOf('@media (max-width: 760px)'))
const tabletBlock = css.slice(css.indexOf('@media (max-width: 900px)'), css.indexOf('@media (max-width: 760px)'))

test('desktop heroes keep the editorial, image-led layout', async (t) => {
  await t.test('a wider container is reserved for the image-led hero only', () => {
    assert.match(css, /--ps-maxw-wide:\s*1280px;/)
    // Body/cards/FAQ keep the readable measure.
    assert.match(css, /--ps-maxw:\s*1160px;/)
  })

  await t.test('homepage hero: wide container, copy/art split, layered stage', () => {
    assert.match(css, /\.ps-hero-inner \{[\s\S]*?max-width: var\(--ps-maxw-wide\);[\s\S]*?grid-template-columns: 6fr 7fr;/)
    assert.match(css, /\.ps-hero-stage \{ position: relative; width: 100%; max-width: 680px; \}/)
  })

  await t.test('About + Preceptors head-split renders each approved illustration', () => {
    assert.match(css, /\.ps-head-split \{[\s\S]*?grid-template-columns: minmax\(0, 0\.9fr\) minmax\(0, 1fr\);/)
    assert.match(site, /className="ps-head-split"[\s\S]*?base="about"/)
    assert.match(site, /className="ps-head-split"[\s\S]*?base="preceptors"/)
  })

  await t.test('Experience: two-column editorial hero with the care-team art', () => {
    assert.match(css, /\.ps-exp-hero \{[\s\S]*?grid-template-columns: minmax\(0, 0\.9fr\) minmax\(0, 1fr\);/)
    assert.match(site, /className="ps-exp-hero"[\s\S]*?base="experience"/)
    assert.doesNotMatch(site, /ps-banner-art/)
    assert.doesNotMatch(css, /ps-banner-art/)
  })
})

test('the mobile illustration sizing and stacking are preserved', async (t) => {
  await t.test('heroes go single-column from the tablet breakpoint down', () => {
    assert.match(tabletBlock, /\.ps-hero-inner \{ grid-template-columns: 1fr;/)
    assert.match(tabletBlock, /\.ps-hero-art \{ order: -1; \}/)
    assert.match(tabletBlock, /\.ps-head-art \{ order: -1; max-width: 500px; margin: 0 auto; \}/)
  })
  await t.test('phone keeps the tighter caps', () => {
    assert.match(mobileBlock, /\.ps-hero-stage \{ max-width: 500px; \}/)
    assert.match(mobileBlock, /\.ps-head-art, \.ps-exp-art \{ max-width: 480px; \}/)
  })
  await t.test('Experience keeps headline-then-illustration order (no order flip)', () => {
    assert.match(tabletBlock, /\.ps-exp-hero \{ grid-template-columns: 1fr;/)
    assert.doesNotMatch(tabletBlock, /\.ps-exp-art \{[^}]*order: -1/)
    assert.doesNotMatch(mobileBlock, /\.ps-exp-art \{[^}]*order: -1/)
  })
})

test('the Preceptors band uses the Cedars-Sinai white mark, safely', async (t) => {
  await t.test('the generic outlined circle motif stays removed', () => {
    assert.doesNotMatch(site, /LoopMotif/, 'no LoopMotif import or usage remains')
    assert.doesNotMatch(site, /ps-band-motif/)
    assert.doesNotMatch(css, /ps-band-motif/)
  })

  await t.test('the approved white mark asset exists and is used in the callout', () => {
    assert.ok(existsSync(join(here, '..', 'public/cs-logo-white-mark.png')), 'white mark asset present')
    assert.match(site, /<img className="ps-band-mark" src="\/cs-logo-white-mark\.png"/)
  })

  await t.test('the watermark is decorative: empty alt + aria-hidden', () => {
    assert.match(site, /className="ps-band-mark"[\s\S]*?alt=""[\s\S]*?aria-hidden="true"/)
  })

  await t.test('the watermark is non-interactive (pointer-events + selection disabled)', () => {
    assert.match(css, /\.ps-band-mark \{[\s\S]*?pointer-events: none;[\s\S]*?user-select: none;/)
  })

  await t.test('the watermark sits behind the copy and cannot overflow horizontally', () => {
    assert.match(css, /\.ps-band-copy \{ position: relative; z-index: 1;/)
    assert.match(css, /\.ps-band-mark \{[\s\S]*?z-index: 0;/)
    // The band clips its own decoration rather than relying on page overflow.
    assert.match(css, /\.ps-band \{[\s\S]*?overflow: hidden;/)
  })
})

test('responsive navigation thresholds', async (t) => {
  await t.test('desktop inline nav + inline Open Portal/Log in action are intact', () => {
    assert.match(site, /<nav className="ps-nav" aria-label="Primary">[\s\S]*?NAV_LINKS\.map/)
    assert.match(site, /\? <Link to="\/portal" className="ps-login-btn">Open Portal<\/Link>/)
  })
  await t.test('the hamburger + compact popover take over below 1024px', () => {
    assert.match(css, /\.ps-nav-toggle \{\s*display: none;/)
    assert.match(css, /@media \(max-width: 1023px\) \{[\s\S]*?\.ps-nav-toggle \{ display: flex; \}/)
    assert.match(css, /@media \(min-width: 1024px\) \{\s*\n\s*\.ps-menu \{ display: none; \}/)
  })
})
