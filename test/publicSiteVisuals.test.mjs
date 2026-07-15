// ASPIRE-PUBLIC-VISUALS: static-source guards for the public-site desktop
// illustration refinements and the Cedars-Sinai white-mark watermark that
// replaced the generic decorative circle in the Preceptors callout. Desktop
// layouts gain editorial weight; the working mobile illustration sizing and
// stacking are preserved. Run: node --test test/publicSiteVisuals.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const site = read('src/public-site/PublicSite.jsx')
const css = read('src/public-site/publicSite.css')

// The mobile refinements live in the <=760px media block; isolate it so
// "mobile preserved" assertions cannot accidentally match desktop rules.
const mobileBlock = css.slice(css.indexOf('@media (max-width: 760px)'))

test('desktop heroes gain an editorial, image-led layout', async (t) => {
  await t.test('a wider container is reserved for the image-led heroes only', () => {
    assert.match(css, /--ps-maxw-wide:\s*1240px;/)
    // Body/cards/FAQ keep the readable measure.
    assert.match(css, /--ps-maxw:\s*1160px;/)
  })

  await t.test('homepage hero: wide container, ~5/7 split, larger figure', () => {
    assert.match(css, /\.ps-hero-inner \{[\s\S]*?max-width: var\(--ps-maxw-wide\);[\s\S]*?grid-template-columns: 5fr 7fr;/)
    assert.match(css, /\.ps-hero-figure \{ position: relative; width: 100%; max-width: 640px; \}/)
  })

  await t.test('About + Preceptors head-split: illustration ~55% of the row', () => {
    assert.match(css, /\.ps-head-split \{[\s\S]*?grid-template-columns: minmax\(0, 0\.82fr\) minmax\(0, 1fr\);/)
    // Both pages render the split with their approved illustration.
    assert.match(site, /className="ps-head-split"[\s\S]*?base="about"/)
    assert.match(site, /className="ps-head-split"[\s\S]*?base="preceptors"/)
  })

  await t.test('Experience: two-column editorial hero replaces the lone centered banner', () => {
    assert.match(css, /\.ps-exp-hero \{[\s\S]*?grid-template-columns: minmax\(0, 0\.82fr\) minmax\(0, 1fr\);/)
    assert.match(site, /className="ps-exp-hero"[\s\S]*?base="experience"/)
    // The old isolated centered banner class is gone from source and styles.
    assert.doesNotMatch(site, /ps-banner-art/)
    assert.doesNotMatch(css, /ps-banner-art/)
  })
})

test('the successful mobile illustration sizing and stacking are preserved', async (t) => {
  await t.test('homepage hero illustration stays large and stacks first on mobile', () => {
    assert.match(mobileBlock, /\.ps-hero-figure \{ max-width: 480px;/)
    assert.match(mobileBlock, /\.ps-hero-art \{ order: -1; \}/)
  })
  await t.test('About/Preceptors illustration keeps its 480px mobile cap and lead position', () => {
    assert.match(mobileBlock, /\.ps-head-art \{ order: -1; max-width: 480px; margin: 0 auto; \}/)
  })
  await t.test('Experience keeps headline-then-illustration order at the 480px cap (no order flip)', () => {
    assert.match(mobileBlock, /\.ps-exp-hero \{ grid-template-columns: 1fr;/)
    assert.match(mobileBlock, /\.ps-exp-art \{ max-width: 480px; margin: 0 auto; \}/)
    // The Experience art must NOT be pulled above the headline on mobile.
    assert.doesNotMatch(mobileBlock, /\.ps-exp-art \{[^}]*order: -1/)
  })
})

test('the generic Preceptors circle is replaced by the Cedars-Sinai white mark', async (t) => {
  await t.test('the generic outlined circle motif is fully removed', () => {
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
    // Copy is z-index 1; mark is z-index 0 (never covers the heading/button).
    assert.match(css, /\.ps-band-copy \{ position: relative; z-index: 1;/)
    assert.match(css, /\.ps-band-mark \{[\s\S]*?z-index: 0;/)
    // The band clips its own decoration rather than relying on page overflow.
    assert.match(css, /\.ps-band \{ background: var\(--ps-navy\); color: #fff; overflow: hidden; \}/)
  })
})

test('desktop and mobile navigation remain unchanged', async (t) => {
  await t.test('desktop inline nav + inline Open Portal/Log in action are intact', () => {
    assert.match(site, /<nav className="ps-nav" aria-label="Primary">[\s\S]*?NAV_LINKS\.map/)
    assert.match(site, /\? <Link to="\/portal" className="ps-login-btn">Open Portal<\/Link>/)
  })
  await t.test('the mobile hamburger + compact popover threshold is unchanged', () => {
    assert.match(css, /\.ps-nav-toggle \{\s*display: none;/)
    assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*?\.ps-nav-toggle \{ display: flex; \}/)
    assert.match(css, /@media \(min-width: 761px\) \{\s*\.ps-menu \{ display: none; \}/)
  })
})
