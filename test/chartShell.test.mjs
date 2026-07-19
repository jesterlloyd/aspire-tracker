// ASPIRE-CHART: static-source guards for the staff shell foundation - the
// chart token layer, the global light-mode focus baseline, the responsive
// header/nav conversion, route titles, and the accessible toast region.
// Run: node --test test/chartShell.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const tokens = read('src/styles/chartTokens.css')
const indexCss = read('src/index.css')
const header = read('src/components/Header/Header.jsx')
const brand = read('src/components/Header/HeaderBrand.jsx')
const search = read('src/components/Header/UniversalSearch.jsx')
const cohort = read('src/components/Header/CohortPicker.jsx')
const nav = read('src/components/UnifiedNav.jsx')
const toast = read('src/components/Toast.jsx')
const app = read('src/App.jsx')

test('the chart token layer', async (t) => {
  await t.test('loads after theme.css in the staff stylesheet', () => {
    const themeAt = indexCss.indexOf("@import './styles/theme.css'")
    const chartAt = indexCss.indexOf("@import './styles/chartTokens.css'")
    assert.ok(themeAt >= 0 && chartAt > themeAt, 'chartTokens imports after theme')
  })

  await t.test('imports the shared ASPIRE brand core', () => {
    assert.match(tokens, /@import '\.\/aspireBrand\.css';/)
  })

  await t.test('chart surfaces resolve through the semantic theme layer', () => {
    assert.match(tokens, /--chart-bg: var\(--bg-app/)
    assert.match(tokens, /--chart-ink: var\(--text-body/)
    assert.match(tokens, /--chart-navy: var\(--color-accent-primary/)
  })

  await t.test('dark mode is token-level, and status chips carry both modes', () => {
    assert.match(tokens, /\[data-theme="dark"\] \{[\s\S]*?--chart-ok-ink/)
    for (const tone of ['ok', 'wait', 'warn', 'info', 'err']) {
      assert.match(tokens, new RegExp(`\\.chart-chip-${tone}\\s*\\{`))
    }
  })

  await t.test('Fraunces enters staff only through the serif token', () => {
    assert.match(tokens, /--chart-serif: 'Fraunces'/)
    assert.match(tokens, /\.chart-route-title \{[\s\S]*?font-family: var\(--chart-serif\)/)
  })
})

test('global staff focus baseline', () => {
  assert.match(tokens, /\.app :focus-visible \{[\s\S]*?outline: 2px solid var\(--chart-focus\)/)
  // The search input no longer suppresses its own outline inline.
  assert.doesNotMatch(search, /outline:\s*'none'/)
})

test('responsive header', async (t) => {
  await t.test('the header band is class-driven and wraps below 980px', () => {
    assert.match(header, /<header className="chart-header">/)
    assert.match(tokens, /@media \(max-width: 1200px\) \{[\s\S]*?\.chart-header \{[\s\S]*?flex-wrap: wrap/)
  })

  await t.test('search flexes full-width on narrow screens (no clipped box)', () => {
    assert.match(search, /className="chart-search-area"/)
    assert.match(tokens, /\.chart-search-area \.header-search-input,\s*\n\s*\.chart-search-area \.header-search-input:focus \{ width: 100%; \}/)
    // Width control left inline would defeat the CSS: keep it out.
    assert.doesNotMatch(search, /width: searchFocused/)
  })

  await t.test('dropdowns can never exceed the viewport', () => {
    assert.match(tokens, /\.chart-search-dropdown \{[\s\S]*?width: min\(360px, calc\(100vw - 24px\)\)/)
    assert.match(tokens, /\.chart-cohort-dropdown \{[\s\S]*?width: min\(380px, calc\(100vw - 16px\)\)/)
    assert.match(cohort, /className="chart-cohort-dropdown"/)
  })

  await t.test('the wordmark cannot slide under the action icons', () => {
    assert.match(brand, /className="chart-brand"/)
    assert.match(tokens, /\.chart-brand \{[^}]*overflow: hidden/)
    assert.match(tokens, /\.chart-brand > \* \{ min-width: 0; \}/)
  })
})

test('responsive workspace nav', async (t) => {
  await t.test('the tab row scrolls horizontally instead of overflowing', () => {
    assert.match(nav, /<nav className="chart-nav" aria-label="Workspaces">/)
    assert.match(tokens, /\.chart-nav \{[\s\S]*?overflow-x: auto/)
  })

  await t.test('tabs are class-driven with aria-current on the active tab', () => {
    assert.match(nav, /className="chart-nav-tab"/)
    assert.match(nav, /aria-current=\{isActive \? 'page' : undefined\}/)
  })

  await t.test('mnemonic chips and refresh yield space on phones', () => {
    assert.match(nav, /className="chart-nav-chip"/)
    assert.match(tokens, /@media \(max-width: 760px\) \{[\s\S]*?\.chart-nav-chip \{ display: none !important; \}[\s\S]*?\.chart-nav-refresh \{ display: none; \}/)
  })

  await t.test('the shared badge tokens still drive the nav counters', () => {
    assert.match(nav, /import \{ BADGE_COUNT_BG, BADGE_COUNT_FG \} from '\.\.\/lib\/badgeTokens'/)
  })
})

test('shell accessibility and orientation', async (t) => {
  await t.test('toasts announce through a polite live region', () => {
    assert.match(toast, /role="status" aria-live="polite"/)
  })

  await t.test('staff routes set an orienting document title', () => {
    assert.match(app, /document\.title = label \? `\$\{label\} · ASPIRE Intelligence` : 'ASPIRE Intelligence'/)
    assert.match(app, /overview: 'At a Glance'/)
  })
})
